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
    const adminUser = await user(db, "boss");
    const aPublic = await repo.create(alice.id, { title: "shared", systemPrompt: "x" });
    await repo.publish(aPublic.id, alice.id);
    await repo.approve(aPublic.id, adminUser.id);
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
    const adminUser = await user(db, "boss");
    const skill = await repo.create(alice.id, { title: "t", systemPrompt: "p" });

    expect(await repo.findAvailableForUse(skill.id, bob.id)).toBeNull();
    expect((await repo.findAvailableForUse(skill.id, alice.id))?.id).toBe(skill.id);
    await repo.publish(skill.id, alice.id);
    await repo.approve(skill.id, adminUser.id);
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

  it("listPending returns only public+pending skills", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const s1 = await repo.create(alice.id, { title: "P1", systemPrompt: "p" });
    await repo.publish(s1.id, alice.id);
    await repo.create(alice.id, { title: "P2", systemPrompt: "p" });
    const pending = await repo.listPending();
    expect(pending.map((r) => r.id)).toEqual([s1.id]);
  });

  it("approve sets approved status, reviewedAt/By, increments version", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const adminUser = await user(db, "boss");
    const s = await repo.create(alice.id, { title: "T", systemPrompt: "p" });
    await repo.publish(s.id, alice.id);
    const before = await repo.findById(s.id, alice.id);
    expect(before?.version).toBe(1);
    const approved = await repo.approve(s.id, adminUser.id);
    expect(approved?.reviewStatus).toBe("approved");
    expect(approved?.reviewedAt).toBeInstanceOf(Date);
    expect(approved?.reviewedBy).toBe(adminUser.id);
    expect(approved?.version).toBe(2);
    expect(approved?.rejectReason).toBeNull();
  });

  it("reject sets rejected status with reason", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const adminUser = await user(db, "boss");
    const s = await repo.create(alice.id, { title: "T", systemPrompt: "p" });
    await repo.publish(s.id, alice.id);
    const rejected = await repo.reject(s.id, adminUser.id, "敏感词命中");
    expect(rejected?.reviewStatus).toBe("rejected");
    expect(rejected?.rejectReason).toBe("敏感词命中");
    expect(rejected?.reviewedBy).toBe(adminUser.id);
  });

  it("listAvailableTo: non-author only sees approved public skills", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const bob = await user(db, "bob");
    const adminUser = await user(db, "boss");
    const sPending = await repo.create(alice.id, { title: "Pending", systemPrompt: "p" });
    await repo.publish(sPending.id, alice.id);
    const sApproved = await repo.create(alice.id, { title: "OK", systemPrompt: "p" });
    await repo.publish(sApproved.id, alice.id);
    await repo.approve(sApproved.id, adminUser.id);
    const sRejected = await repo.create(alice.id, { title: "Bad", systemPrompt: "p" });
    await repo.publish(sRejected.id, alice.id);
    await repo.reject(sRejected.id, adminUser.id, "no");

    const bobList = await repo.listAvailableTo(bob.id);
    expect(bobList.map((r) => r.id)).toEqual([sApproved.id]);

    const aliceList = await repo.listAvailableTo(alice.id);
    expect(aliceList.length).toBe(3);
  });

  it("update with systemPrompt change resets review to pending", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const adminUser = await user(db, "boss");
    const s = await repo.create(alice.id, { title: "T", systemPrompt: "p1" });
    await repo.publish(s.id, alice.id);
    await repo.approve(s.id, adminUser.id);
    const updated = await repo.update(s.id, alice.id, { systemPrompt: "p2" });
    expect(updated?.reviewStatus).toBe("pending");
    expect(updated?.reviewedAt).toBeNull();
    expect(updated?.reviewedBy).toBeNull();
    expect(updated?.rejectReason).toBeNull();
  });

  it("update with only title change does NOT reset review", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const adminUser = await user(db, "boss");
    const s = await repo.create(alice.id, { title: "T", systemPrompt: "p" });
    await repo.publish(s.id, alice.id);
    await repo.approve(s.id, adminUser.id);
    const updated = await repo.update(s.id, alice.id, { title: "T2" });
    expect(updated?.reviewStatus).toBe("approved");
    expect(updated?.reviewedAt).toBeInstanceOf(Date);
  });

  it("publish resets review to pending and clears prior review fields", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const adminUser = await user(db, "boss");
    const s = await repo.create(alice.id, { title: "T", systemPrompt: "p" });
    await repo.publish(s.id, alice.id);
    await repo.reject(s.id, adminUser.id, "nope");
    const republished = await repo.publish(s.id, alice.id);
    expect(republished?.reviewStatus).toBe("pending");
    expect(republished?.rejectReason).toBeNull();
    expect(republished?.reviewedAt).toBeNull();
    expect(republished?.reviewedBy).toBeNull();
  });
});
