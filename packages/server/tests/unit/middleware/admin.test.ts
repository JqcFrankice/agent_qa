import { describe, expect, it, beforeAll } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { InviteRepository } from "../../../src/db/repositories/invites.js";
import { UserRepository } from "../../../src/db/repositories/users.js";
import { buildApp } from "../../../src/server.js";

let appBuilder: typeof buildApp;

beforeAll(async () => {
  process.env.PORT = "8080";
  process.env.HOST = "127.0.0.1";
  process.env.NODE_ENV = "test";
  ({ buildApp: appBuilder } = await import("../../../src/server.js"));
});

const INVITE_CODE = "ADMINMWTEST1";

async function loginAs(username: string, role: "user" | "admin") {
  const db = createTestDb();
  await new InviteRepository(db).create({ code: INVITE_CODE, usesRemaining: 5, createdBy: "test" });
  const app = await appBuilder({ db });
  await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username, password: "password123", inviteCode: INVITE_CODE }
  });
  if (role === "admin") {
    await new UserRepository(db).setRole(username, "admin");
  }
  const login = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { username, password: "password123" }
  });
  const cookie = ((login.headers["set-cookie"] as string) ?? "").split(";")[0];
  return { app, cookie };
}

describe("requireAdmin middleware via /api/admin/skills", () => {
  it("returns 401 when not logged in", async () => {
    const db = createTestDb();
    const app = await appBuilder({ db });
    const res = await app.inject({ method: "GET", url: "/api/admin/skills" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 when logged in as user role", async () => {
    const { app, cookie } = await loginAs("alice", "user");
    const res = await app.inject({ method: "GET", url: "/api/admin/skills", headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("ADMIN_FORBIDDEN");
    await app.close();
  });

  it("passes when logged in as admin role", async () => {
    const { app, cookie } = await loginAs("boss", "admin");
    const res = await app.inject({ method: "GET", url: "/api/admin/skills", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().skills)).toBe(true);
    await app.close();
  });
});
