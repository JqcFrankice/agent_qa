import { describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { runAdminCli } from "../../../../scripts/admin-cli.js";
import { InviteRepository } from "../../src/db/repositories/invites.js";
import { SessionRepository } from "../../src/db/repositories/sessions.js";
import { UserRepository } from "../../src/db/repositories/users.js";

describe("admin CLI", () => {
  it("creates, lists, and revokes invites", async () => {
    const db = createTestDb();
    const create = await runAdminCli(["invite", "create", "--uses", "2", "--note", "unit"], { db });
    expect(create.exitCode).toBe(0);
    const code = create.stdout.match(/[A-HJ-KM-NP-Z2-9]{12}/)?.[0];
    expect(code).toBeTruthy();

    const list = await runAdminCli(["invite", "list"], { db });
    expect(list.stdout).toContain(code);
    expect(list.stdout).toContain("unit");

    const revoke = await runAdminCli(["invite", "revoke", code!], { db });
    expect(revoke.exitCode).toBe(0);
    expect(await new InviteRepository(db).consume(code!)).toBe(false);
  });

  it("lists users, revokes sessions, and deletes users", async () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    const sessions = new SessionRepository(db);
    const user = await users.create("alice", "hash");
    await sessions.create({ id: "sid", userId: user.id, expiresAt: new Date(Date.now() + 86400000) });

    const list = await runAdminCli(["user", "list"], { db });
    expect(list.stdout).toContain("alice");

    const revoke = await runAdminCli(["user", "revoke-sessions", "alice"], { db });
    expect(revoke.exitCode).toBe(0);
    expect(await sessions.findValid("sid", new Date())).toBeNull();

    const del = await runAdminCli(["user", "delete", "alice"], { db });
    expect(del.exitCode).toBe(0);
    expect(await users.findByUsername("alice")).toBeNull();
  });

  it("preset import: inserts on first run, updates on second run (idempotent)", async () => {
    const db = createTestDb();
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "preset-test-"));
    const file = join(dir, "qa.json");
    writeFileSync(file, JSON.stringify([
      { slug: "qa-x", title: "X v1", description: "", tags: ["qa"], systemPrompt: "p1" }
    ]));

    const r1 = await runAdminCli(["preset", "import", file], { db });
    expect(r1.exitCode).toBe(0);
    expect(r1.stdout).toMatch(/inserted: 1/);
    expect(r1.stdout).toMatch(/updated: 0/);

    writeFileSync(file, JSON.stringify([
      { slug: "qa-x", title: "X v2", description: "", tags: ["qa"], systemPrompt: "p2" }
    ]));
    const r2 = await runAdminCli(["preset", "import", file], { db });
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toMatch(/inserted: 0/);
    expect(r2.stdout).toMatch(/updated: 1/);

    const { SkillsRepository } = await import("../../src/db/repositories/skills.js");
    const repo = new SkillsRepository(db);
    const found = await repo.findBySlug("qa-x");
    expect(found?.title).toBe("X v2");
    expect(found?.systemPrompt).toBe("p2");
    expect(found?.isPublic).toBe(1);
  });

  it("preset import: rejects malformed JSON with clear error", async () => {
    const db = createTestDb();
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "preset-bad-"));
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify([
      { slug: "x", description: "", systemPrompt: "p" }
    ]));
    const r = await runAdminCli(["preset", "import", file], { db });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/title|invalid|required/i);
  });
});
