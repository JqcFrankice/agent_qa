import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, errorBody } from "../errors.js";
import { requireUser } from "./session.js";

export function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = requireUser(request, reply);
  if (!user) return null;
  if (user.role !== "admin") {
    const error = new AppError(403, "ADMIN_FORBIDDEN", "需要管理员权限");
    void reply.code(error.statusCode).send(errorBody(error));
    return null;
  }
  return user;
}
