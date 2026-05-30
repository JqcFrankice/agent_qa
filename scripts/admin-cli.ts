#!/usr/bin/env tsx
import { Command } from "commander";
import { stdin as input } from "node:process";
import type { AppDb } from "../packages/server/src/db/client.js";
import { openDatabase } from "../packages/server/src/db/client.js";
import { newInviteCode } from "../packages/server/src/crypto/invite-code.js";
import { hashPassword } from "../packages/server/src/crypto/argon2.js";
import { InviteRepository } from "../packages/server/src/db/repositories/invites.js";
import { SessionRepository } from "../packages/server/src/db/repositories/sessions.js";
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
