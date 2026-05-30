import type { FastifyPluginAsync } from "fastify";
import { createConversationRequestSchema, updateConversationRequestSchema } from "@server-agent/shared";
import type { AppDb } from "../db/client.js";
import { ConversationsRepository } from "../db/repositories/conversations.js";
import { AppError, errorBody } from "../errors.js";
import { requireUser } from "../middleware/session.js";

interface ConversationRouteDeps {
  db: AppDb;
}

function toDto(row: {
  id: string;
  title: string | null;
  provider: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

const conversationRoutes: FastifyPluginAsync<ConversationRouteDeps> = async (app, deps) => {
  const repo = new ConversationsRepository(deps.db);

  app.get("/conversations", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const rows = await repo.listByUser(user.id);
    return { conversations: rows.map(toDto) };
  });

  app.post("/conversations", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const parsed = createConversationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = new AppError(400, "CONV_VALIDATION", "会话参数不合法");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const row = await repo.create(user.id, {
      provider: parsed.data.provider,
      model: parsed.data.model,
      systemPrompt: parsed.data.systemPrompt ?? null
    });
    return reply.code(201).send({ conversation: toDto(row) });
  });

  app.patch<{ Params: { id: string } }>("/conversations/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const parsed = updateConversationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = new AppError(400, "CONV_VALIDATION", "标题不合法");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const row = await repo.rename(request.params.id, user.id, parsed.data.title!);
    if (!row) {
      const error = new AppError(404, "CONV_NOT_FOUND", "会话不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    return { conversation: toDto(row) };
  });

  app.delete<{ Params: { id: string } }>("/conversations/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const deleted = await repo.softDelete(request.params.id, user.id);
    if (!deleted) {
      const error = new AppError(404, "CONV_NOT_FOUND", "会话不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    return { ok: true };
  });
};

export default conversationRoutes;
