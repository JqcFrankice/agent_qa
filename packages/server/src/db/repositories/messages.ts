import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { AppDb } from "../client.js";
import { conversations, messages } from "../schema.js";
import { newDbId } from "../id.js";

interface CompleteMetadata {
  providerMessageId?: string | null;
  usage?: { inputTokens?: number | null; outputTokens?: number | null } | null;
}

export class MessagesRepository {
  constructor(private readonly db: AppDb) {}

  async listForConversation(conversationId: string, userId: number) {
    return this.db.select({
      id: messages.id,
      conversationId: messages.conversationId,
      role: messages.role,
      content: messages.content,
      status: messages.status,
      errorCode: messages.errorCode,
      createdAt: messages.createdAt
    }).from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(
        eq(messages.conversationId, conversationId),
        eq(conversations.userId, userId),
        isNull(conversations.deletedAt)
      ))
      .orderBy(asc(messages.createdAt), asc(sql`messages.rowid`));
  }

  async createUserMessage(conversationId: string, content: string) {
    const [row] = await this.db.insert(messages).values({
      id: newDbId(),
      conversationId,
      role: "user",
      content,
      status: "complete"
    }).returning();
    return row;
  }

  async createAssistantStreaming(conversationId: string) {
    const [row] = await this.db.insert(messages).values({
      id: newDbId(),
      conversationId,
      role: "assistant",
      content: "",
      status: "streaming"
    }).returning();
    return row;
  }

  async appendContent(messageId: string, contentChunk: string) {
    await this.db.update(messages)
      .set({ content: sql`${messages.content} || ${contentChunk}` })
      .where(eq(messages.id, messageId));
  }

  async markComplete(messageId: string, metadata: CompleteMetadata) {
    await this.db.update(messages).set({
      status: "complete",
      providerMessageId: metadata.providerMessageId ?? null,
      inputTokens: metadata.usage?.inputTokens ?? null,
      outputTokens: metadata.usage?.outputTokens ?? null
    }).where(eq(messages.id, messageId));
  }

  async markError(messageId: string, errorCode: string) {
    await this.db.update(messages).set({ status: "error", errorCode }).where(eq(messages.id, messageId));
  }

  async markAborted(messageId: string) {
    await this.db.update(messages).set({ status: "aborted" }).where(eq(messages.id, messageId));
  }

  async listHistoryForProvider(conversationId: string, userId: number) {
    const rows = await this.listForConversation(conversationId, userId);
    return rows
      .filter((row) => row.status === "complete" && row.content.length > 0)
      .map((row) => ({ role: row.role, content: row.content }));
  }
}
