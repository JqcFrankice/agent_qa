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
});
