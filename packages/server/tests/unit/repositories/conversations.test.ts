import { describe, expect, it } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { UserRepository } from "../../../src/db/repositories/users.js";
import { ConversationsRepository } from "../../../src/db/repositories/conversations.js";

async function insertTestUser(db: ReturnType<typeof createTestDb>, name: string) {
  return new UserRepository(db).create(name, "hash");
}

describe("ConversationsRepository", () => {
  it("lists only non-deleted conversations for the owner ordered by updatedAt desc", async () => {
    const db = createTestDb();
    const repo = new ConversationsRepository(db);
    const userA = await insertTestUser(db, "alice");
    const userB = await insertTestUser(db, "bob");
    const first = await repo.create(userA.id, { provider: "aiwoo-claude", model: "claude-opus-4-7" });
    await repo.create(userB.id, { provider: "aiwoo-claude", model: "claude-opus-4-7" });
    const second = await repo.create(userA.id, { provider: "aiwoo-codex", model: "gpt-5.5" });
    await repo.softDelete(first.id, userA.id);
    await repo.rename(second.id, userA.id, "Renamed");

    const rows = await repo.listByUser(userA.id);
    expect(rows.map((row) => row.id)).toEqual([second.id]);
    expect(rows[0].title).toBe("Renamed");
  });

  it("scopes findById to owner and hides soft-deleted", async () => {
    const db = createTestDb();
    const repo = new ConversationsRepository(db);
    const userA = await insertTestUser(db, "alice");
    const userB = await insertTestUser(db, "bob");
    const conv = await repo.create(userA.id, { provider: "aiwoo-claude", model: "claude-opus-4-7" });
    expect(await repo.findById(conv.id, userB.id)).toBeNull();
    expect((await repo.findById(conv.id, userA.id))?.id).toBe(conv.id);
    await repo.softDelete(conv.id, userA.id);
    expect(await repo.findById(conv.id, userA.id)).toBeNull();
  });
});
