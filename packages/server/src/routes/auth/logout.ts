import type { FastifyInstance } from "fastify";
import { SessionRepository } from "../../db/repositories/sessions.js";
import { AppError, errorBody } from "../../errors.js";
import type { AuthRouteDeps } from "./types.js";

export async function logoutRoute(app: FastifyInstance, deps: AuthRouteDeps) {
  app.post("/logout", async (request, reply) => {
    const sid = request.cookies.sa_sid;
    if (!sid) {
      const error = new AppError(401, "AUTH_NOT_AUTHENTICATED", "请先登录");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    await new SessionRepository(deps.db).delete(sid);
    reply.clearCookie("sa_sid", { path: "/" });
    return { ok: true };
  });
}
