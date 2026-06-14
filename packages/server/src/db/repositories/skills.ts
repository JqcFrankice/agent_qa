import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { SkillInputField } from "@server-agent/shared";
import type { AppDb } from "../client.js";
import { skills } from "../schema.js";

interface CreateSkillInput {
  title: string;
  description?: string;
  systemPrompt: string;
  defaultProvider?: string | null;
  defaultModel?: string | null;
  inputSchema?: SkillInputField[] | null;
  tags?: string[];
}

interface UpdateSkillInput {
  title?: string;
  description?: string;
  systemPrompt?: string;
  defaultProvider?: string | null;
  defaultModel?: string | null;
  inputSchema?: SkillInputField[] | null;
  tags?: string[];
}

interface UpsertSkillInput {
  slug: string;
  title: string;
  description?: string;
  systemPrompt: string;
  defaultProvider?: string | null;
  defaultModel?: string | null;
  inputSchema?: SkillInputField[] | null;
  tags?: string[];
  isPublic?: boolean;
  reviewStatus?: "pending" | "approved" | "rejected";
}

export class SkillsRepository {
  constructor(private readonly db: AppDb) {}

  async create(authorUserId: number, input: CreateSkillInput) {
    const [row] = await this.db.insert(skills).values({
      authorUserId,
      title: input.title,
      description: input.description ?? "",
      systemPrompt: input.systemPrompt,
      defaultProvider: input.defaultProvider ?? null,
      defaultModel: input.defaultModel ?? null,
      inputSchema: input.inputSchema ? JSON.stringify(input.inputSchema) : null,
      tags: JSON.stringify(input.tags ?? [])
    }).returning();
    return row;
  }

  async listAvailableTo(userId: number) {
    return this.db.select().from(skills).where(and(
      isNull(skills.deletedAt),
      or(
        eq(skills.authorUserId, userId),
        and(eq(skills.isPublic, 1), eq(skills.reviewStatus, "approved"))
      )
    )).orderBy(desc(skills.updatedAt));
  }

  async findById(id: number, userId: number) {
    const [row] = await this.db.select().from(skills).where(and(
      eq(skills.id, id),
      eq(skills.authorUserId, userId),
      isNull(skills.deletedAt)
    )).limit(1);
    return row ?? null;
  }

  async findAvailableForUse(id: number, userId: number) {
    const [row] = await this.db.select().from(skills).where(and(
      eq(skills.id, id),
      isNull(skills.deletedAt),
      or(
        eq(skills.authorUserId, userId),
        and(eq(skills.isPublic, 1), eq(skills.reviewStatus, "approved"))
      )
    )).limit(1);
    return row ?? null;
  }

  async findBySlug(slug: string) {
    const [row] = await this.db.select().from(skills).where(eq(skills.slug, slug)).limit(1);
    return row ?? null;
  }

  async update(id: number, userId: number, patch: UpdateSkillInput) {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) setValues.title = patch.title;
    if (patch.description !== undefined) setValues.description = patch.description;
    if (patch.systemPrompt !== undefined) setValues.systemPrompt = patch.systemPrompt;
    if (patch.defaultProvider !== undefined) setValues.defaultProvider = patch.defaultProvider;
    if (patch.defaultModel !== undefined) setValues.defaultModel = patch.defaultModel;
    if (patch.inputSchema !== undefined) {
      setValues.inputSchema = patch.inputSchema ? JSON.stringify(patch.inputSchema) : null;
    }
    if (patch.tags !== undefined) setValues.tags = JSON.stringify(patch.tags);
    const needsReReview = patch.systemPrompt !== undefined || patch.inputSchema !== undefined;
    if (needsReReview) {
      setValues.reviewStatus = "pending";
      setValues.reviewedAt = null;
      setValues.reviewedBy = null;
      setValues.rejectReason = null;
    }
    const result = await this.db.update(skills).set(setValues)
      .where(and(eq(skills.id, id), eq(skills.authorUserId, userId), isNull(skills.deletedAt)))
      .returning();
    return result[0] ?? null;
  }

  async publish(id: number, userId: number) {
    const result = await this.db.update(skills)
      .set({
        isPublic: 1,
        publishedAt: new Date(),
        reviewStatus: "pending",
        reviewedAt: null,
        reviewedBy: null,
        rejectReason: null,
        updatedAt: new Date()
      })
      .where(and(eq(skills.id, id), eq(skills.authorUserId, userId), isNull(skills.deletedAt)))
      .returning();
    return result[0] ?? null;
  }

  async unpublish(id: number, userId: number) {
    const result = await this.db.update(skills)
      .set({ isPublic: 0, publishedAt: null, updatedAt: new Date() })
      .where(and(eq(skills.id, id), eq(skills.authorUserId, userId), isNull(skills.deletedAt)))
      .returning();
    return result[0] ?? null;
  }

  async softDelete(id: number, userId: number) {
    const result = await this.db.update(skills)
      .set({ deletedAt: new Date() })
      .where(and(eq(skills.id, id), eq(skills.authorUserId, userId), isNull(skills.deletedAt)))
      .returning();
    return result.length > 0;
  }

  async listPending() {
    return this.db.select().from(skills).where(and(
      eq(skills.reviewStatus, "pending"),
      eq(skills.isPublic, 1),
      isNull(skills.deletedAt)
    )).orderBy(asc(skills.createdAt));
  }

  async listByReviewStatus(status: "approved" | "rejected") {
    return this.db.select().from(skills).where(and(
      eq(skills.reviewStatus, status),
      eq(skills.isPublic, 1),
      isNull(skills.deletedAt)
    )).orderBy(desc(skills.reviewedAt));
  }

  async approve(id: number, adminUserId: number) {
    const [row] = await this.db.update(skills).set({
      reviewStatus: "approved",
      reviewedAt: new Date(),
      reviewedBy: adminUserId,
      rejectReason: null,
      version: sql`${skills.version} + 1`,
      updatedAt: new Date()
    }).where(and(eq(skills.id, id), isNull(skills.deletedAt))).returning();
    return row ?? null;
  }

  async reject(id: number, adminUserId: number, reason: string) {
    const [row] = await this.db.update(skills).set({
      reviewStatus: "rejected",
      reviewedAt: new Date(),
      reviewedBy: adminUserId,
      rejectReason: reason,
      updatedAt: new Date()
    }).where(and(eq(skills.id, id), isNull(skills.deletedAt))).returning();
    return row ?? null;
  }

  async upsertBySlug(authorUserId: number, input: UpsertSkillInput) {
    const now = new Date();
    const [existing] = await this.db.select().from(skills).where(eq(skills.slug, input.slug)).limit(1);
    if (existing && existing.authorUserId !== authorUserId) {
      throw new Error(`slug ${input.slug} already owned by user ${existing.authorUserId}`);
    }
    const reviewStatus = input.reviewStatus ?? "pending";
    const values = {
      authorUserId,
      slug: input.slug,
      title: input.title,
      description: input.description ?? "",
      systemPrompt: input.systemPrompt,
      defaultProvider: input.defaultProvider ?? null,
      defaultModel: input.defaultModel ?? null,
      inputSchema: input.inputSchema ? JSON.stringify(input.inputSchema) : null,
      tags: JSON.stringify(input.tags ?? []),
      isPublic: input.isPublic ? 1 : 0,
      publishedAt: input.isPublic ? now : null,
      reviewStatus,
      reviewedAt: reviewStatus === "approved" ? now : null,
      updatedAt: now
    };
    if (existing) {
      const [row] = await this.db.update(skills).set(values).where(eq(skills.id, existing.id)).returning();
      return row;
    }
    const [row] = await this.db.insert(skills).values(values).returning();
    return row;
  }
}
