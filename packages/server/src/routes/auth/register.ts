import type { FastifyInstance } from "fastify";
import { registerRequestSchema } from "@server-agent/shared";
import { hashPassword } from "../../crypto/argon2.js";
import { InviteRepository } from "../../db/repositories/invites.js";
import { UserRepository } from "../../db/repositories/users.js";
import { AppError, errorBody } from "../../errors.js";
import { checkRateLimit } from "../../middleware/rate-limit.js";
import type { AuthRouteDeps } from "./types.js";

const REGISTER_LIMIT = 3;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_LOCK_MS = 30 * 60 * 1000;

export async function registerRoute(app: FastifyInstance, deps: AuthRouteDeps) {
  app.post("/register", async (request, reply) => {
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = new AppError(400, "AUTH_VALIDATION", "注册信息格式不正确");
      return reply.code(error.statusCode).send(errorBody(error));
    }

    const rateLimit = checkRateLimit(deps.db, { key: `register:ip:${request.ip}`, limit: REGISTER_LIMIT, windowMs: REGISTER_WINDOW_MS, lockMs: REGISTER_LOCK_MS });
    if (!rateLimit.allowed) {
      const error = new AppError(429, "AUTH_RATE_LIMITED", "请求过于频繁，请稍后再试");
      return reply.code(error.statusCode).header("Retry-After", String(rateLimit.retryAfterSec ?? Math.ceil(REGISTER_LOCK_MS / 1000))).send(errorBody(error));
    }

    const turnstileOk = await deps.turnstileVerifier(parsed.data.turnstileToken, request.ip);
    if (!turnstileOk) {
      const error = new AppError(423, "AUTH_TURNSTILE_FAILED", "人机验证失败");
      return reply.code(error.statusCode).send(errorBody(error));
    }

    const users = new UserRepository(deps.db);
    if (await users.findByUsername(parsed.data.username)) {
      const error = new AppError(409, "AUTH_USERNAME_TAKEN", "用户名已被占用");
      return reply.code(error.statusCode).send(errorBody(error));
    }

    const invites = new InviteRepository(deps.db);
    if (!await invites.consume(parsed.data.inviteCode)) {
      const error = new AppError(400, "AUTH_INVITE_INVALID", "邀请码无效或已用完");
      return reply.code(error.statusCode).send(errorBody(error));
    }

    await users.create(parsed.data.username, await hashPassword(parsed.data.password));
    return reply.code(201).send({ ok: true });
  });
}
