import { and, desc, eq, isNull } from "drizzle-orm";
import type { AppDb } from "../client.js";
import { conversations, messages } from "../schema.js";
import { newDbId } from "../id.js";

interface CreateConversationInput {
  provider: string;
  model: string;
  systemPrompt?: string | null;
  skillId?: number | null;
}

export class ConversationsRepository {
  constructor(private readonly db: AppDb) {}

  async create(userId: number, input: CreateConversationInput) {
    const [row] = await this.db.insert(conversations).values({
      id: newDbId(),
      userId,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.systemPrompt ?? null,
      skillId: input.skillId ?? null
    }).returning();
    return row;
  }

  async listByUser(userId: number) {
    return this.db.select().from(conversations).where(and(
      eq(conversations.userId, userId),
      isNull(conversations.deletedAt)
    )).orderBy(desc(conversations.updatedAt));
  }

  async findById(id: string, userId: number) {
    const [row] = await this.db.select().from(conversations).where(and(
      eq(conversations.id, id),
      eq(conversations.userId, userId),
      isNull(conversations.deletedAt)
    )).limit(1);
    return row ?? null;
  }

  async rename(id: string, userId: number, title: string) {
    const result = await this.db.update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId), isNull(conversations.deletedAt)))
      .returning();
    return result[0] ?? null;
  }

  async softDelete(id: string, userId: number) {
    const result = await this.db.update(conversations)
      .set({ deletedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId), isNull(conversations.deletedAt)))
      .returning();
    return result.length > 0;
  }

  async restore(id: string, userId: number) {
    const result = await this.db.update(conversations)
      .set({ deletedAt: null })
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning();
    return result[0] ?? null;
  }

  async touch(id: string) {
    await this.db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, id));
  }

  async hasStreamingMessage(id: string) {
    const [row] = await this.db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.conversationId, id), eq(messages.status, "streaming")))
      .limit(1);
    return Boolean(row);
  }

  async setTitleIfEmpty(id: string, title: string) {
    await this.db.update(conversations)
      .set({ title })
      .where(and(eq(conversations.id, id), isNull(conversations.title)));
  }
}
