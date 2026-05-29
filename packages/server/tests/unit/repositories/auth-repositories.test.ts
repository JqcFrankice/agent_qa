import { describe, expect, it } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { InviteRepository } from "../../../src/db/repositories/invites.js";
import { SessionRepository } from "../../../src/db/repositories/sessions.js";
import { UserRepository } from "../../../src/db/repositories/users.js";

describe("auth repositories", () => {
  it("creates users and finds by username", async () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    const user = await users.create("alice", "hash");
    expect(user.id).toBeGreaterThan(0);
    expect((await users.findByUsername("alice"))?.passwordHash).toBe("hash");
  });

  it("consumes invite uses", async () => {
    const db = createTestDb();
    const invites = new InviteRepository(db);
    await invites.create({ code: "ABCDEFGHJKLM", usesRemaining: 1, createdBy: "test", note: "unit" });
    expect(await invites.consume("ABCDEFGHJKLM")).toBe(true);
    expect(await invites.consume("ABCDEFGHJKLM")).toBe(false);
  });

  it("creates and revokes sessions", async () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    const sessions = new SessionRepository(db);
    const user = await users.create("alice", "hash");
    await sessions.create({ id: "sid", userId: user.id, expiresAt: new Date(Date.now() + 86400000), ipAddress: "127.0.0.1", userAgent: "vitest" });
    expect((await sessions.findValid("sid", new Date()))?.user.username).toBe("alice");
    await sessions.delete("sid");
    expect(await sessions.findValid("sid", new Date())).toBeNull();
  });
});
