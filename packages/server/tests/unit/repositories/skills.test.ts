import { describe, expect, it } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { UserRepository } from "../../../src/db/repositories/users.js";
import { SkillsRepository } from "../../../src/db/repositories/skills.js";

async function user(db: ReturnType<typeof createTestDb>, name: string) {
  const repo = new UserRepository(db);
  const existing = await repo.findByUsername(name);
  if (existing) return existing;
  return repo.create(name, "hash");
}

describe("SkillsRepository", () => {
  it("creates and lists skills scoped to author", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const bob = await user(db, "bob");
    const a1 = await repo.create(alice.id, { title: "A1", systemPrompt: "p1" });
    await repo.create(bob.id, { title: "B1", systemPrompt: "p2" });

    const aliceList = await repo.listAvailableTo(alice.id);
    expect(aliceList.map((r) => r.id)).toEqual([a1.id]);
  });

  it("includes public skills from other authors and excludes soft-deleted", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const bob = await user(db, "bob");
    const aPublic = await repo.create(alice.id, { title: "shared", systemPrompt: "x" });
    await repo.publish(aPublic.id, alice.id);
    const aPrivate = await repo.create(alice.id, { title: "secret", systemPrompt: "y" });

    const bobList = await repo.listAvailableTo(bob.id);
    expect(bobList.map((r) => r.id)).toEqual([aPublic.id]);

    await repo.softDelete(aPublic.id, alice.id);
    expect((await repo.listAvailableTo(bob.id)).length).toBe(0);
    expect((await repo.listAvailableTo(alice.id)).map((r) => r.id)).toEqual([aPrivate.id]);
  });

  it("findAvailableForUse enforces ownership or public visibility", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const bob = await user(db, "bob");
    const skill = await repo.create(alice.id, { title: "t", systemPrompt: "p" });

    expect(await repo.findAvailableForUse(skill.id, bob.id)).toBeNull();
    expect((await repo.findAvailableForUse(skill.id, alice.id))?.id).toBe(skill.id);
    await repo.publish(skill.id, alice.id);
    expect((await repo.findAvailableForUse(skill.id, bob.id))?.id).toBe(skill.id);
  });

  it("publish sets publishedAt and unpublish clears it", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const skill = await repo.create(alice.id, { title: "t", systemPrompt: "p" });
    const published = await repo.publish(skill.id, alice.id);
    expect(published?.isPublic).toBe(1);
    expect(published?.publishedAt).toBeInstanceOf(Date);
    const unpublished = await repo.unpublish(skill.id, alice.id);
    expect(unpublished?.isPublic).toBe(0);
    expect(unpublished?.publishedAt).toBeNull();
  });

  it("update only allowed by author", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const bob = await user(db, "bob");
    const skill = await repo.create(alice.id, { title: "t", systemPrompt: "p" });
    expect(await repo.update(skill.id, bob.id, { title: "hijack" })).toBeNull();
    const updated = await repo.update(skill.id, alice.id, { title: "renamed" });
    expect(updated?.title).toBe("renamed");
  });

  it("upsertBySlug inserts new skill on first call", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const author = await user(db, "system");
    const row = await repo.upsertBySlug(author.id, {
      slug: "qa-bug-repro",
      title: "Bug 复现",
      description: "desc",
      systemPrompt: "You are QA.",
      inputSchema: [{ name: "bug_id", label: "Bug ID", type: "text" }],
      tags: ["qa"],
      isPublic: true
    });
    expect(row.slug).toBe("qa-bug-repro");
    expect(row.title).toBe("Bug 复现");
    expect(row.isPublic).toBe(1);
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(JSON.parse(row.tags)).toEqual(["qa"]);
  });

  it("upsertBySlug updates existing skill on second call with same slug", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const author = await user(db, "system");
    const first = await repo.upsertBySlug(author.id, {
      slug: "qa-bug-repro", title: "v1", description: "", systemPrompt: "p1"
    });
    const second = await repo.upsertBySlug(author.id, {
      slug: "qa-bug-repro", title: "v2", description: "new", systemPrompt: "p2"
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe("v2");
    expect(second.systemPrompt).toBe("p2");
  });

  it("upsertBySlug rejects different author for same slug", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const sys = await user(db, "system");
    const alice = await user(db, "alice");
    await repo.upsertBySlug(sys.id, { slug: "shared", title: "t", description: "", systemPrompt: "p" });
    await expect(repo.upsertBySlug(alice.id, { slug: "shared", title: "t2", description: "", systemPrompt: "p2" }))
      .rejects.toThrow();
  });
});
