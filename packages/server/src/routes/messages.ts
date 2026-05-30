import type { FastifyPluginAsync } from "fastify";
import { createMessageRequestSchema } from "@server-agent/shared";
import type { AppDb } from "../db/client.js";
import { ConversationsRepository } from "../db/repositories/conversations.js";
import { MessagesRepository } from "../db/repositories/messages.js";
import { AppError, errorBody } from "../errors.js";
import { checkRateLimit } from "../middleware/rate-limit.js";
import { requireUser } from "../middleware/session.js";
import { getProvider } from "../providers/registry.js";
import type { ChatMessage, ProviderAdapter } from "../providers/types.js";

interface MessageRouteDeps {
  db: AppDb;
  providerRegistry: Record<string, ProviderAdapter>;
  defaultProvider: string;
}

const MESSAGE_LIMIT = 30;
const MESSAGE_WINDOW_MS = 60 * 1000;
const FLUSH_BYTES = 256;
const FLUSH_INTERVAL_MS = 200;

function writeSse(raw: NodeJS.WritableStream, event: string, data: unknown): void {
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

const messageRoutes: FastifyPluginAsync<MessageRouteDeps> = async (app, deps) => {
  const conversations = new ConversationsRepository(deps.db);
  const messages = new MessagesRepository(deps.db);

  app.get<{ Params: { id: string } }>("/conversations/:id/messages", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const conversation = await conversations.findById(request.params.id, user.id);
    if (!conversation) {
      const error = new AppError(404, "CONV_NOT_FOUND", "会话不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const rows = await messages.listForConversation(request.params.id, user.id);
    return {
      messages: rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        status: row.status,
        errorCode: row.errorCode,
        createdAt: row.createdAt.toISOString()
      }))
    };
  });

  app.post<{ Params: { id: string } }>("/conversations/:id/messages", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const conversation = await conversations.findById(request.params.id, user.id);
    if (!conversation) {
      const error = new AppError(404, "CONV_NOT_FOUND", "会话不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }

    if (await conversations.hasStreamingMessage(conversation.id)) {
      const error = new AppError(409, "CONV_BUSY", "该会话正在生成回复，请稍候");
      return reply.code(error.statusCode).send(errorBody(error));
    }

    const parsed = createMessageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = new AppError(400, "CONV_VALIDATION", "消息内容不合法");
      return reply.code(error.statusCode).send(errorBody(error));
    }

    const limit = checkRateLimit(deps.db, { key: `msg:user:${user.id}`, limit: MESSAGE_LIMIT, windowMs: MESSAGE_WINDOW_MS, lockMs: MESSAGE_WINDOW_MS });
    if (!limit.allowed) {
      const error = new AppError(429, "CONV_RATE_LIMITED", "发送过于频繁，请稍后再试");
      return reply.code(error.statusCode).header("Retry-After", String(limit.retryAfterSec ?? 60)).send(errorBody(error));
    }

    const content = parsed.data.content;
    const isFirstMessage = (await messages.listForConversation(conversation.id, user.id)).length === 0;
    await messages.createUserMessage(conversation.id, content);
    if (isFirstMessage && conversation.title === null) {
      await conversations.setTitleIfEmpty(conversation.id, content.slice(0, 40));
    }
    await conversations.touch(conversation.id);
    const assistant = await messages.createAssistantStreaming(conversation.id);
    const assistantMessageId = assistant.id;

    const history: ChatMessage[] = (await messages.listHistoryForProvider(conversation.id, user.id)).map((row) => ({
      role: row.role,
      content: row.content
    }));

    const adapter = getProvider(deps.providerRegistry, conversation.provider);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    writeSse(reply.raw, "ready", { assistantMessageId });

    const controller = new AbortController();
    reply.raw.on("close", () => controller.abort());

    let buffer = "";
    let lastFlush = Date.now();
    const flushBuffer = async () => {
      if (buffer.length === 0) return;
      await messages.appendContent(assistantMessageId, buffer);
      buffer = "";
      lastFlush = Date.now();
    };

    try {
      for await (const event of adapter.stream({
        model: conversation.model,
        messages: history,
        systemPrompt: conversation.systemPrompt ?? undefined,
        signal: controller.signal
      })) {
        if (event.type === "delta") {
          const text = event.textDelta ?? "";
          buffer += text;
          writeSse(reply.raw, "delta", { text });
          if (buffer.length >= FLUSH_BYTES || Date.now() - lastFlush >= FLUSH_INTERVAL_MS) await flushBuffer();
        } else if (event.type === "done") {
          await flushBuffer();
          await messages.markComplete(assistantMessageId, event);
          writeSse(reply.raw, "done", { finishReason: event.finishReason, usage: event.usage });
          return;
        } else if (event.type === "error") {
          await flushBuffer();
          await messages.markError(assistantMessageId, event.error?.code ?? "UPSTREAM_ERROR");
          writeSse(reply.raw, "error", event.error ?? { code: "UPSTREAM_ERROR", message: "上游服务异常" });
          return;
        }
      }
    } catch (err) {
      await flushBuffer();
      if ((err as Error).name === "AbortError" || controller.signal.aborted) {
        await messages.markAborted(assistantMessageId);
        return;
      }
      await messages.markError(assistantMessageId, "INTERNAL");
      if (!reply.raw.destroyed) writeSse(reply.raw, "error", { code: "INTERNAL", message: "服务器内部错误" });
    } finally {
      reply.raw.end();
    }
  });
};

export default messageRoutes;
