import type { FastifyPluginAsync } from "fastify";
import {
  createSkillRequestSchema,
  updateSkillRequestSchema
} from "@server-agent/shared";
import type { AppDb } from "../db/client.js";
import { SkillsRepository } from "../db/repositories/skills.js";
import { ConversationsRepository } from "../db/repositories/conversations.js";
import { MessagesRepository } from "../db/repositories/messages.js";
import { UserRepository } from "../db/repositories/users.js";
import { AppError, errorBody } from "../errors.js";
import { requireUser } from "../middleware/session.js";

interface SkillRouteDeps {
  db: AppDb;
}

interface SkillRow {
  id: number;
  authorUserId: number;
  title: string;
  description: string;
  systemPrompt: string;
  defaultProvider: string | null;
  defaultModel: string | null;
  isPublic: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(row: SkillRow, currentUserId: number, authorUsername: string) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    systemPrompt: row.systemPrompt,
    defaultProvider: row.defaultProvider,
    defaultModel: row.defaultModel,
    isPublic: row.isPublic === 1,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    authorUsername,
    isOwn: row.authorUserId === currentUserId
  };
}

const skillsRoutes: FastifyPluginAsync<SkillRouteDeps> = async (app, deps) => {
  const repo = new SkillsRepository(deps.db);
  const conversations = new ConversationsRepository(deps.db);
  const messages = new MessagesRepository(deps.db);
  const users = new UserRepository(deps.db);

  app.get("/skills", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const rows = await repo.listAvailableTo(user.id);
    const authorIds = Array.from(new Set(rows.map((r) => r.authorUserId)));
    const usersById = await users.findManyByIds(authorIds);
    return {
      skills: rows.map((r) => toDto(r, user.id, usersById.get(r.authorUserId)?.username ?? "?"))
    };
  });

  app.post("/skills", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const parsed = createSkillRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = new AppError(400, "SKILL_VALIDATION", "skill 参数不合法");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    let row = await repo.create(user.id, {
      title: parsed.data.title,
      description: parsed.data.description,
      systemPrompt: parsed.data.systemPrompt,
      defaultProvider: parsed.data.defaultProvider ?? null,
      defaultModel: parsed.data.defaultModel ?? null
    });
    if (parsed.data.isPublic) {
      const published = await repo.publish(row.id, user.id);
      if (published) row = published;
    }
    const author = await users.findById(user.id);
    return reply.code(201).send({ skill: toDto(row, user.id, author?.username ?? "?") });
  });

  app.patch<{ Params: { id: string } }>("/skills/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      const error = new AppError(404, "SKILL_NOT_FOUND", "skill 不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const parsed = updateSkillRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = new AppError(400, "SKILL_VALIDATION", "skill 参数不合法");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const { isPublic, ...rest } = parsed.data;
    let row = Object.keys(rest).length > 0
      ? await repo.update(id, user.id, rest)
      : await repo.findById(id, user.id);
    if (!row) {
      const error = new AppError(404, "SKILL_NOT_FOUND", "skill 不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    if (isPublic === true) row = (await repo.publish(id, user.id)) ?? row;
    if (isPublic === false) row = (await repo.unpublish(id, user.id)) ?? row;
    const author = await users.findById(user.id);
    return { skill: toDto(row, user.id, author?.username ?? "?") };
  });

  app.delete<{ Params: { id: string } }>("/skills/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      const error = new AppError(404, "SKILL_NOT_FOUND", "skill 不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const ok = await repo.softDelete(id, user.id);
    if (!ok) {
      const error = new AppError(404, "SKILL_NOT_FOUND", "skill 不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/conversations/:id/extract-skill", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const conversation = await conversations.findById(request.params.id, user.id);
    if (!conversation) {
      const error = new AppError(404, "CONV_NOT_FOUND", "会话不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const rows = await messages.listForConversation(conversation.id, user.id);
    const userMsgs = rows.filter((r) => r.role === "user").map((r) => r.content);
    const titleSeed = userMsgs[0] ?? conversation.title ?? "未命名 Skill";
    const title = titleSeed.slice(0, 40).trim() || "未命名 Skill";
    const promptParts: string[] = [];
    if (conversation.systemPrompt) {
      promptParts.push(`# 原 system prompt\n${conversation.systemPrompt}`);
    }
    if (userMsgs.length > 0) {
      promptParts.push(
        `# 历史 user 消息\n${userMsgs.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
      );
    }
    const systemPrompt = promptParts.join("\n\n") || "（暂无内容，请手动编辑）";
    return { draft: { title, systemPrompt } };
  });
};

export default skillsRoutes;
