import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { AppDb } from "../client.js";
import { skills } from "../schema.js";

interface CreateSkillInput {
  title: string;
  description?: string;
  systemPrompt: string;
  defaultProvider?: string | null;
  defaultModel?: string | null;
}

interface UpdateSkillInput {
  title?: string;
  description?: string;
  systemPrompt?: string;
  defaultProvider?: string | null;
  defaultModel?: string | null;
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
      defaultModel: input.defaultModel ?? null
    }).returning();
    return row;
  }

  async listAvailableTo(userId: number) {
    return this.db.select().from(skills).where(and(
      isNull(skills.deletedAt),
      or(eq(skills.authorUserId, userId), eq(skills.isPublic, 1))
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
      or(eq(skills.authorUserId, userId), eq(skills.isPublic, 1))
    )).limit(1);
    return row ?? null;
  }

  async update(id: number, userId: number, patch: UpdateSkillInput) {
    const result = await this.db.update(skills)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(skills.id, id), eq(skills.authorUserId, userId), isNull(skills.deletedAt)))
      .returning();
    return result[0] ?? null;
  }

  async publish(id: number, userId: number) {
    const result = await this.db.update(skills)
      .set({ isPublic: 1, publishedAt: new Date(), updatedAt: new Date() })
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
}
