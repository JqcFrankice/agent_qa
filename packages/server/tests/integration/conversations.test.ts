import { describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { InviteRepository } from "../../src/db/repositories/invites.js";
import { buildApp } from "../../src/server.js";

type TestApp = Awaited<ReturnType<typeof buildApp>>;

async function buildLoggedInTestApp(username: string) {
  const db = createTestDb();
  await new InviteRepository(db).create({ code: "ABCDEFGHJKLM", usesRemaining: 10, createdBy: "test", note: "it" });
  const app = await buildApp({ db });
  const cookie = await registerAndLogin(app, username);
  return { app, db, cookie };
}

async function registerAndLogin(app: TestApp, username: string): Promise<string> {
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123", inviteCode: "ABCDEFGHJKLM" } });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "password123" } });
  const raw = login.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value!.split(";")[0];
}

describe("conversation routes", () => {
  it("requires auth for GET /api/conversations", async () => {
    const app = await buildApp({ db: createTestDb() });
    const res = await app.inject({ method: "GET", url: "/api/conversations" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTH_NOT_AUTHENTICATED");
    await app.close();
  });

  it("creates, lists, renames, and deletes an owned conversation", async () => {
    const { app, cookie } = await buildLoggedInTestApp("alice");
    const create = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: { cookie },
      payload: { provider: "aiwoo-claude", model: "claude-opus-4-8" }
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().conversation.id;

    const rename = await app.inject({ method: "PATCH", url: `/api/conversations/${id}`, headers: { cookie }, payload: { title: "New title" } });
    expect(rename.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/conversations", headers: { cookie } });
    expect(list.json().conversations[0].title).toBe("New title");

    const del = await app.inject({ method: "DELETE", url: `/api/conversations/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/api/conversations", headers: { cookie } });
    expect(after.json().conversations).toEqual([]);
    await app.close();
  });

  it("rejects invalid provider/model", async () => {
    const { app, cookie } = await buildLoggedInTestApp("alice");
    const res = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: { cookie },
      payload: { provider: "aiwoo-claude", model: "gpt-5.5" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CONV_VALIDATION");
    await app.close();
  });

  it("returns 404 for another user's conversation", async () => {
    const alice = await buildLoggedInTestApp("alice");
    const bobCookie = await registerAndLogin(alice.app, "bob");
    const created = await alice.app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: alice.cookie }, payload: { provider: "aiwoo-claude", model: "claude-opus-4-8" } });
    const id = created.json().conversation.id;
    const res = await alice.app.inject({ method: "PATCH", url: `/api/conversations/${id}`, headers: { cookie: bobCookie }, payload: { title: "hijack" } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("CONV_NOT_FOUND");
    await alice.app.close();
  });
});
