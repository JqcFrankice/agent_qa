import { describe, expect, it } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { InviteRepository } from "../../../src/db/repositories/invites.js";
import { buildApp } from "../../../src/server.js";

type TestApp = Awaited<ReturnType<typeof buildApp>>;

const INVITE_CODE = "ABCDEFGHJKLM";

async function buildLoggedInApp(username: string) {
  const db = createTestDb();
  await new InviteRepository(db).create({ code: INVITE_CODE, usesRemaining: 10, createdBy: "test", note: "it" });
  const app = await buildApp({ db });
  const cookie = await registerAndLogin(app, username);
  return { app, db, cookie };
}

async function registerAndLogin(app: TestApp, username: string): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username, password: "password123", inviteCode: INVITE_CODE }
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password: "password123" }
  });
  const raw = login.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value!.split(";")[0];
}

describe("skills routes", () => {
  it("POST /api/skills creates a private skill", async () => {
    const { app, cookie } = await buildLoggedInApp("alice");
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      headers: { cookie },
      payload: { title: "t", systemPrompt: "p" }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().skill.isPublic).toBe(false);
    await app.close();
  });

  it("GET /api/skills lists own + public skills", async () => {
    const alice = await buildLoggedInApp("alice");
    const bobCookie = await registerAndLogin(alice.app, "bob");
    const aliceSkill = await alice.app.inject({
      method: "POST",
      url: "/api/skills",
      headers: { cookie: alice.cookie },
      payload: { title: "shared", systemPrompt: "x", isPublic: true }
    });
    expect(aliceSkill.statusCode).toBe(201);
    const list = await alice.app.inject({
      method: "GET",
      url: "/api/skills",
      headers: { cookie: bobCookie }
    });
    expect(list.json().skills.length).toBe(1);
    expect(list.json().skills[0].isOwn).toBe(false);
    expect(list.json().skills[0].authorUsername).toBe("alice");
    await alice.app.close();
  });

  it("PATCH /api/skills/:id forbids non-author", async () => {
    const alice = await buildLoggedInApp("alice");
    const bobCookie = await registerAndLogin(alice.app, "bob");
    const created = await alice.app.inject({
      method: "POST",
      url: "/api/skills",
      headers: { cookie: alice.cookie },
      payload: { title: "t", systemPrompt: "p" }
    });
    const skillId = created.json().skill.id;
    const res = await alice.app.inject({
      method: "PATCH",
      url: `/api/skills/${skillId}`,
      headers: { cookie: bobCookie },
      payload: { title: "hijack" }
    });
    expect(res.statusCode).toBe(404);
    await alice.app.close();
  });

  it("DELETE /api/skills/:id soft-deletes", async () => {
    const { app, cookie } = await buildLoggedInApp("alice");
    const created = await app.inject({
      method: "POST",
      url: "/api/skills",
      headers: { cookie },
      payload: { title: "t", systemPrompt: "p" }
    });
    const skillId = created.json().skill.id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/skills/${skillId}`,
      headers: { cookie }
    });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({
      method: "GET",
      url: "/api/skills",
      headers: { cookie }
    });
    expect(list.json().skills.length).toBe(0);
    await app.close();
  });

  it("POST /api/conversations/:id/extract-skill builds draft from messages", async () => {
    const { app, db, cookie } = await buildLoggedInApp("alice");
    const conv = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: { cookie },
      payload: { provider: "aiwoo-claude", model: "claude-opus-4-8", systemPrompt: "you are helpful" }
    });
    expect(conv.statusCode).toBe(201);
    const convId = conv.json().conversation.id;
    const { MessagesRepository } = await import("../../../src/db/repositories/messages.js");
    const messages = new MessagesRepository(db);
    await messages.createUserMessage(convId, "first user message");
    await messages.createUserMessage(convId, "second user message");
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${convId}/extract-skill`,
      headers: { cookie }
    });
    expect(res.statusCode).toBe(200);
    const draft = res.json().draft;
    expect(draft.title).toMatch(/first user message/);
    expect(draft.systemPrompt).toContain("you are helpful");
    expect(draft.systemPrompt).toContain("first user message");
    expect(draft.systemPrompt).toContain("second user message");
    await app.close();
  });

  it("system preset rejects non-author PATCH and DELETE", async () => {
    const { app, db, cookie } = await buildLoggedInApp("alice");
    const { UserRepository } = await import("../../../src/db/repositories/users.js");
    const { SkillsRepository } = await import("../../../src/db/repositories/skills.js");
    const userRepo = new UserRepository(db);
    let sysUser = await userRepo.findByUsername("system");
    if (!sysUser) sysUser = await userRepo.create("system", "!disabled");
    const skillsRepo = new SkillsRepository(db);
    const preset = await skillsRepo.upsertBySlug(sysUser.id, {
      slug: "qa-test", title: "Test Preset", description: "", systemPrompt: "p", isPublic: true
    });

    const list = await app.inject({ method: "GET", url: "/api/skills", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const found = list.json().skills.find((s: { id: number }) => s.id === preset.id);
    expect(found).toBeDefined();
    expect(found.isOwn).toBe(false);
    expect(found.isSystem).toBe(true);
    expect(found.tags).toEqual([]);
    expect(found.inputSchema).toBeNull();
    expect(found.slug).toBe("qa-test");

    const patch = await app.inject({
      method: "PATCH", url: `/api/skills/${preset.id}`, headers: { cookie },
      payload: { title: "hijack" }
    });
    expect(patch.statusCode).toBe(404);

    const del = await app.inject({
      method: "DELETE", url: `/api/skills/${preset.id}`, headers: { cookie }
    });
    expect(del.statusCode).toBe(404);

    await app.close();
  });

  it("POST /api/skills accepts inputSchema and tags", async () => {
    const { app, cookie } = await buildLoggedInApp("alice");
    const res = await app.inject({
      method: "POST", url: "/api/skills", headers: { cookie },
      payload: {
        title: "Custom",
        systemPrompt: "Hello {{name}}",
        inputSchema: [{ name: "name", label: "Your name", type: "text", required: true }],
        tags: ["custom"]
      }
    });
    expect(res.statusCode).toBe(201);
    const skill = res.json().skill;
    expect(skill.inputSchema).toEqual([{ name: "name", label: "Your name", type: "text", required: true }]);
    expect(skill.tags).toEqual(["custom"]);
    expect(skill.slug).toBeNull();
    expect(skill.isSystem).toBe(false);
    await app.close();
  });
});
