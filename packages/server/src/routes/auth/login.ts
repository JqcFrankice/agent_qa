import type { FastifyInstance } from "fastify";
import { loginRequestSchema } from "@server-agent/shared";
import { verifyPassword } from "../../crypto/argon2.js";
import { newSessionId } from "../../crypto/session-id.js";
import { SessionRepository } from "../../db/repositories/sessions.js";
import { UserRepository } from "../../db/repositories/users.js";
import { AppError, errorBody } from "../../errors.js";
import { checkRateLimit } from "../../middleware/rate-limit.js";
import type { AuthRouteDeps } from "./types.js";

const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 60 * 60 * 1000;
const LOGIN_LOCK_MS = 30 * 60 * 1000;

function sendRateLimited(reply: { code: (statusCode: number) => { header: (name: string, value: string) => { send: (body: unknown) => unknown } } }, retryAfterSec: number) {
  const error = new AppError(429, "AUTH_RATE_LIMITED", "请求过于频繁，请稍后再试");
  return reply.code(error.statusCode).header("Retry-After", String(retryAfterSec)).send(errorBody(error));
}

export async function loginRoute(app: FastifyInstance, deps: AuthRouteDeps) {
  app.post("/login", async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = new AppError(400, "AUTH_VALIDATION", "登录信息格式不正确");
      return reply.code(error.statusCode).send(errorBody(error));
    }

    const ipLimit = checkRateLimit(deps.db, { key: `login:ip:${request.ip}`, limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS, lockMs: LOGIN_LOCK_MS });
    if (!ipLimit.allowed) return sendRateLimited(reply, ipLimit.retryAfterSec ?? Math.ceil(LOGIN_LOCK_MS / 1000));
    const usernameLimit = checkRateLimit(deps.db, { key: `login:user:${parsed.data.username}`, limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS, lockMs: LOGIN_LOCK_MS });
    if (!usernameLimit.allowed) return sendRateLimited(reply, usernameLimit.retryAfterSec ?? Math.ceil(LOGIN_LOCK_MS / 1000));

    const users = new UserRepository(deps.db);
    const user = await users.findByUsername(parsed.data.username);
    if (!user || !await verifyPassword(user.passwordHash, parsed.data.password)) {
      const error = new AppError(401, "AUTH_INVALID_CREDENTIALS", "用户名或密码不正确");
      return reply.code(error.statusCode).send(errorBody(error));
    }

    const sid = newSessionId();
    await new SessionRepository(deps.db).create({
      id: sid,
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000),
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null
    });
    reply.setCookie("sa_sid", sid, {
      httpOnly: true,
      secure: deps.secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SEC
    });
    return { ok: true, user: { id: user.id, username: user.username } };
  });
}
