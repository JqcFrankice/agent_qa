#!/usr/bin/env tsx
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { stdin as input } from "node:process";
import { z } from "zod";
import { skillInputSchemaSchema, skillTagsSchema } from "@server-agent/shared";
import type { AppDb } from "../packages/server/src/db/client.js";
import { openDatabase } from "../packages/server/src/db/client.js";
import { newInviteCode } from "../packages/server/src/crypto/invite-code.js";
import { hashPassword } from "../packages/server/src/crypto/argon2.js";
import { InviteRepository } from "../packages/server/src/db/repositories/invites.js";
import { SessionRepository } from "../packages/server/src/db/repositories/sessions.js";
import { SkillsRepository } from "../packages/server/src/db/repositories/skills.js";
import { UserRepository } from "../packages/server/src/db/repositories/users.js";
import { loadConfig } from "../packages/server/src/config.js";

interface AdminCliDeps {
  db: AppDb;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  readPassword?: () => Promise<string>;
}

interface AdminCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runAdminCli(argv: string[], deps?: Partial<AdminCliDeps>): Promise<AdminCliResult> {
  let stdout = "";
  let stderr = "";
  const db = deps?.db ?? openDatabase(loadConfig().dbPath);
  const out = deps?.stdout ?? ((text: string) => { stdout += `${text}\n`; });
  const err = deps?.stderr ?? ((text: string) => { stderr += `${text}\n`; });

  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (text) => { stdout += text; },
    writeErr: (text) => { stderr += text; }
  });

  const invite = program.command("invite");
  invite.command("create")
    .option("--uses <n>", "number of uses", "1")
    .option("--expires <duration>", "expiry duration like 7d")
    .option("--note <note>", "note")
    .action(async (opts: { uses: string; expires?: string; note?: string }) => {
      const code = newInviteCode();
      await new InviteRepository(db).create({
        code,
        usesRemaining: Number.parseInt(opts.uses, 10),
        createdBy: "admin-cli",
        note: opts.note ?? null,
        expiresAt: opts.expires ? parseExpiry(opts.expires) : null
      });
      out(code);
    });
  invite.command("list").action(async () => {
    const rows = await new InviteRepository(db).list();
    for (const row of rows) out(`${row.code}\tuses=${row.usesRemaining}\tnote=${row.note ?? ""}`);
  });
  invite.command("revoke").argument("<code>").action(async (code: string) => {
    await new InviteRepository(db).revoke(code);
    out(`revoked ${code}`);
  });

  const user = program.command("user");
  user.command("list").action(async () => {
    const rows = await new UserRepository(db).list();
    for (const row of rows) out(`${row.id}\t${row.username}`);
  });
  user.command("revoke-sessions").argument("<username>").action(async (username: string) => {
    const users = new UserRepository(db);
    const row = await users.findByUsername(username);
    if (!row) throw new Error("user not found");
    await new SessionRepository(db).deleteForUser(row.id);
    out(`revoked sessions for ${username}`);
  });
  user.command("reset-password").argument("<username>").action(async (username: string) => {
    const readPassword = deps?.readPassword ?? readPasswordFromTty;
    const password = await readPassword();
    const users = new UserRepository(db);
    const row = await users.findByUsername(username);
    if (!row) throw new Error("user not found");
    await users.updatePassword(username, await hashPassword(password));
    out(`reset password for ${username}`);
  });
  user.command("delete").argument("<username>").action(async (username: string) => {
    await new UserRepository(db).deleteByUsername(username);
    out(`deleted ${username}`);
  });

  const preset = program.command("preset");
  preset.command("import")
    .argument("<file>", "JSON file with preset array")
    .option("--public", "publish presets immediately", true)
    .option("--no-public", "import as private")
    .action(async (file: string, opts: { public: boolean }) => {
      const presetItemSchema = z.object({
        slug: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        title: z.string().trim().min(1).max(80),
        description: z.string().trim().max(280).optional(),
        systemPrompt: z.string().trim().min(1).max(8000),
        defaultProvider: z.string().optional(),
        defaultModel: z.string().optional(),
        inputSchema: skillInputSchemaSchema.nullable().optional(),
        tags: skillTagsSchema.optional()
      });
      const fileSchema = z.array(presetItemSchema).min(1).max(100);
      const raw = JSON.parse(readFileSync(file, "utf8"));
      const parsed = fileSchema.safeParse(raw);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new Error(`invalid preset file: ${detail}`);
      }
      const userRepo = new UserRepository(db);
      let sysUser = await userRepo.findByUsername("system");
      if (!sysUser) sysUser = await userRepo.create("system", "!disabled");

      const skillsRepo = new SkillsRepository(db);
      let inserted = 0;
      let updated = 0;
      for (const item of parsed.data) {
        const before = await skillsRepo.findBySlug(item.slug);
        await skillsRepo.upsertBySlug(sysUser.id, {
          slug: item.slug,
          title: item.title,
          description: item.description ?? "",
          systemPrompt: item.systemPrompt,
          defaultProvider: item.defaultProvider ?? null,
          defaultModel: item.defaultModel ?? null,
          inputSchema: item.inputSchema ?? null,
          tags: item.tags ?? [],
          isPublic: opts.public
        });
        if (before) updated++;
        else inserted++;
      }
      out(`inserted: ${inserted}, updated: ${updated}`);
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return { exitCode: 0, stdout, stderr };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    err(message);
    return { exitCode: 1, stdout, stderr };
  }
}

function parseExpiry(value: string): Date {
  const match = /^(\d+)d$/.exec(value);
  if (!match) throw new Error("expires must use Nd format");
  return new Date(Date.now() + Number.parseInt(match[1], 10) * 24 * 60 * 60 * 1000);
}

async function readPasswordFromTty(): Promise<string> {
  if (!input.isTTY) throw new Error("reset-password requires an interactive TTY");
  throw new Error("interactive password input is not implemented in tests");
}

if (process.argv[1]?.endsWith("admin-cli.ts")) {
  const result = await runAdminCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
