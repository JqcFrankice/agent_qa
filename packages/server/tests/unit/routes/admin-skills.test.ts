import { describe, expect, it, beforeAll } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { InviteRepository } from "../../../src/db/repositories/invites.js";
import { UserRepository } from "../../../src/db/repositories/users.js";
import { SkillsRepository } from "../../../src/db/repositories/skills.js";
import type { AppDb } from "../../../src/db/client.js";
import { buildApp } from "../../../src/server.js";

let appBuilder: typeof buildApp;

beforeAll(async () => {
  process.env.PORT = "8080";
  process.env.HOST = "127.0.0.1";
  process.env.NODE_ENV = "test";
  ({ buildApp: appBuilder } = await import("../../../src/server.js"));
});

const INVITE_CODE = "ADMINSKILLTEST";

async function setupCommon() {
  const db = createTestDb();
  await new InviteRepository(db).create({ code: INVITE_CODE, usesRemaining: 99, createdBy: "test" });
  const app = await appBuilder({ db });

  // 注册 alice (普通用户) 和 boss (admin)
  for (const u of ["alice", "boss"]) {
    await app.inject({
      method: "POST", url: "/api/auth/register",
      payload: { username: u, password: "password123", inviteCode: INVITE_CODE }
    });
  }
  await new UserRepository(db).setRole("boss", "admin");

  const aliceLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { username: "alice", password: "password123" }
  });
  const adminLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { username: "boss", password: "password123" }
  });

  const userCookie = ((aliceLogin.headers["set-cookie"] as string) ?? "").split(";")[0];
  const adminCookie = ((adminLogin.headers["set-cookie"] as string) ?? "").split(";")[0];
  const aliceId = (await new UserRepository(db).findByUsername("alice"))!.id;

  return { db, app, userCookie, adminCookie, aliceId };
}

async function makePendingSkill(db: AppDb, aliceId: number) {
  const repo = new SkillsRepository(db);
  const s = await repo.create(aliceId, { title: "P", systemPrompt: "p" });
  await repo.publish(s.id, aliceId);
  return s;
}

describe("admin skills routes", () => {
  it("GET /api/admin/skills?status=pending returns pending list with author username", async () => {
    const { db, app, adminCookie, aliceId } = await setupCommon();
    await makePendingSkill(db, aliceId);
    const res = await app.inject({ method: "GET", url: "/api/admin/skills?status=pending", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skills.length).toBe(1);
    expect(body.skills[0].title).toBe("P");
    expect(body.skills[0].authorUsername).toBe("alice");
    expect(body.skills[0].reviewStatus).toBe("pending");
    await app.close();
  });

  it("POST /api/admin/skills/:id/approve sets approved status", async () => {
    const { db, app, adminCookie, aliceId } = await setupCommon();
    const s = await makePendingSkill(db, aliceId);
    const res = await app.inject({ method: "POST", url: `/api/admin/skills/${s.id}/approve`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const after = await new SkillsRepository(db).findById(s.id, aliceId);
    expect(after?.reviewStatus).toBe("approved");
    await app.close();
  });

  it("POST /api/admin/skills/:id/reject requires reason", async () => {
    const { db, app, adminCookie, aliceId } = await setupCommon();
    const s = await makePendingSkill(db, aliceId);
    const noReason = await app.inject({
      method: "POST", url: `/api/admin/skills/${s.id}/reject`,
      headers: { cookie: adminCookie }, payload: {}
    });
    expect(noReason.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST", url: `/api/admin/skills/${s.id}/reject`,
      headers: { cookie: adminCookie }, payload: { reason: "敏感词" }
    });
    expect(ok.statusCode).toBe(200);
    const after = await new SkillsRepository(db).findById(s.id, aliceId);
    expect(after?.reviewStatus).toBe("rejected");
    expect(after?.rejectReason).toBe("敏感词");
    await app.close();
  });

  it("non-admin user gets 403 on admin routes", async () => {
    const { app, userCookie } = await setupCommon();
    const res = await app.inject({ method: "GET", url: "/api/admin/skills", headers: { cookie: userCookie } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
