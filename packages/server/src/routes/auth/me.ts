import type { FastifyInstance } from "fastify";
import { AppError, errorBody } from "../../errors.js";

export async function meRoute(app: FastifyInstance) {
  app.get("/me", async (request, reply) => {
    if (!request.user) {
      const error = new AppError(401, "AUTH_NOT_AUTHENTICATED", "请先登录");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    return { user: { id: request.user.id, username: request.user.username, createdAt: request.user.createdAt.toISOString(), role: request.user.role } };
  });
}
