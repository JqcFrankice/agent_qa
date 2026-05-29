import { describe, expect, it } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { InviteRepository } from "../../../src/db/repositories/invites.js";
import { UserRepository } from "../../../src/db/repositories/users.js";
import { buildApp } from "../../../src/server.js";

async function seedInvite(code = "ABCDEFGHJKLM") {
  const db = createTestDb();
  await new InviteRepository(db).create({ code, usesRemaining: 1, createdBy: "test", note: "integration" });
  return db;
}

describe("auth routes", () => {
  it("registers a new user with a valid invite", async () => {
    const db = await seedInvite();
    const app = await buildApp({ db, turnstileVerifier: async () => true });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "password123", inviteCode: "ABCDEFGHJKLM", turnstileToken: "token" }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });
    expect(await new UserRepository(db).findByUsername("alice")).not.toBeNull();
    await app.close();
  });

  it("rejects duplicate usernames", async () => {
    const db = await seedInvite();
    await new UserRepository(db).create("alice", "hash");
    const app = await buildApp({ db, turnstileVerifier: async () => true });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "password123", inviteCode: "ABCDEFGHJKLM", turnstileToken: "token" }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("AUTH_USERNAME_TAKEN");
    await app.close();
  });

  it("logs in, reads current user, and logs out", async () => {
    const db = await seedInvite();
    const app = await buildApp({ db, turnstileVerifier: async () => true });
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "password123", inviteCode: "ABCDEFGHJKLM", turnstileToken: "token" }
    });

    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alice", password: "password123" } });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers["set-cookie"];
    expect(cookie).toContain("sa_sid=");

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe("alice");

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(logout.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("AUTH_NOT_AUTHENTICATED");
    await app.close();
  });

  it("rejects bad login credentials", async () => {
    const db = await seedInvite();
    const app = await buildApp({ db, turnstileVerifier: async () => true });
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "missing", password: "password123" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTH_INVALID_CREDENTIALS");
    await app.close();
  });

  it("requires authentication for /api/auth/me", async () => {
    const app = await buildApp({ db: createTestDb(), turnstileVerifier: async () => true });
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTH_NOT_AUTHENTICATED");
    await app.close();
  });
});
