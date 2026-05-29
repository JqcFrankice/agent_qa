import type { FastifyInstance } from "fastify";
import { loginRequestSchema } from "@server-agent/shared";
import { verifyPassword } from "../../crypto/argon2.js";
import { newSessionId } from "../../crypto/session-id.js";
import { SessionRepository } from "../../db/repositories/sessions.js";
import { UserRepository } from "../../db/repositories/users.js";
import { AppError, errorBody } from "../../errors.js";
import type { AuthRouteDeps } from "./types.js";

const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export async function loginRoute(app: FastifyInstance, deps: AuthRouteDeps) {
  app.post("/login", async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = new AppError(400, "AUTH_VALIDATION", "登录信息格式不正确");
      return reply.code(error.statusCode).send(errorBody(error));
    }

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
