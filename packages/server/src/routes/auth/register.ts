import type { FastifyInstance } from "fastify";
import { registerRequestSchema } from "@server-agent/shared";
import { hashPassword } from "../../crypto/argon2.js";
import { InviteRepository } from "../../db/repositories/invites.js";
import { UserRepository } from "../../db/repositories/users.js";
import { AppError, errorBody } from "../../errors.js";
import type { AuthRouteDeps } from "./types.js";

export async function registerRoute(app: FastifyInstance, deps: AuthRouteDeps) {
  app.post("/register", async (request, reply) => {
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = new AppError(400, "AUTH_VALIDATION", "注册信息格式不正确");
      return reply.code(error.statusCode).send(errorBody(error));
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
