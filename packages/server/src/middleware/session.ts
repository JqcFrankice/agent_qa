import type { FastifyReply, FastifyRequest } from "fastify";
import { SessionRepository } from "../db/repositories/sessions.js";
import { AppError, errorBody } from "../errors.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      id: number;
      username: string;
      createdAt: Date;
      role: "user" | "admin";
    };
  }
}

export function sessionMiddleware(sessions: SessionRepository) {
  return async (request: FastifyRequest) => {
    const sid = request.cookies.sa_sid;
    if (!sid) return;
    const row = await sessions.findValid(sid, new Date());
    if (!row) return;
    request.user = {
      id: row.user.id,
      username: row.user.username,
      createdAt: row.user.createdAt,
      role: row.user.role
    };
  };
}

export function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (request.user) return request.user;
  const error = new AppError(401, "AUTH_NOT_AUTHENTICATED", "请先登录");
  void reply.code(error.statusCode).send(errorBody(error));
  return null;
}
