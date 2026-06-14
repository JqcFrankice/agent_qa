import type { FastifyPluginAsync } from "fastify";
import { rejectSkillRequestSchema } from "@server-agent/shared";
import type { AppDb } from "../../db/client.js";
import { SkillsRepository } from "../../db/repositories/skills.js";
import { UserRepository } from "../../db/repositories/users.js";
import { AppError, errorBody } from "../../errors.js";
import { requireAdmin } from "../../middleware/admin.js";

interface AdminSkillRouteDeps {
  db: AppDb;
}

const adminSkillRoutes: FastifyPluginAsync<AdminSkillRouteDeps> = async (app, deps) => {
  const repo = new SkillsRepository(deps.db);
  const users = new UserRepository(deps.db);

  app.get("/skills", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return reply;
    const status = ((request.query as { status?: string })?.status ?? "pending");
    if (status !== "pending" && status !== "approved" && status !== "rejected") {
      const error = new AppError(400, "ADMIN_VALIDATION", "status 不合法");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const rows = status === "pending"
      ? await repo.listPending()
      : await repo.listByReviewStatus(status);
    const authorIds = Array.from(new Set(rows.map((r) => r.authorUserId)));
    const usersById = await users.findManyByIds(authorIds);
    return {
      skills: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        systemPrompt: r.systemPrompt,
        inputSchema: r.inputSchema ? JSON.parse(r.inputSchema) : null,
        tags: JSON.parse(r.tags),
        slug: r.slug,
        version: r.version,
        reviewStatus: r.reviewStatus,
        rejectReason: r.rejectReason,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        authorUsername: usersById.get(r.authorUserId)?.username ?? "?"
      }))
    };
  });

  app.post<{ Params: { id: string } }>("/skills/:id/approve", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return reply;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      const error = new AppError(404, "SKILL_NOT_FOUND", "skill 不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const row = await repo.approve(id, admin.id);
    if (!row) {
      const error = new AppError(404, "SKILL_NOT_FOUND", "skill 不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/skills/:id/reject", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return reply;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) {
      const error = new AppError(404, "SKILL_NOT_FOUND", "skill 不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const parsed = rejectSkillRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = new AppError(400, "ADMIN_VALIDATION", "reason 不合法");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const row = await repo.reject(id, admin.id, parsed.data.reason);
    if (!row) {
      const error = new AppError(404, "SKILL_NOT_FOUND", "skill 不存在");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    return { ok: true };
  });
};

export default adminSkillRoutes;
