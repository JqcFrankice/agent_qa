import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  defaultProvider: text("default_provider"),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user")
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent")
}, (t) => ({
  byUser: index("idx_sessions_user_id").on(t.userId),
  byExpires: index("idx_sessions_expires").on(t.expiresAt)
}));

export const inviteCodes = sqliteTable("invite_codes", {
  code: text("code").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  usesRemaining: integer("uses_remaining").notNull().default(1),
  createdBy: text("created_by").notNull(),
  note: text("note")
});

export const skills = sqliteTable("skills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  authorUserId: integer("author_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  systemPrompt: text("system_prompt").notNull(),
  defaultProvider: text("default_provider"),
  defaultModel: text("default_model"),
  isPublic: integer("is_public").notNull().default(0),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  inputSchema: text("input_schema"),
  tags: text("tags").notNull().default("[]"),
  slug: text("slug"),
  reviewStatus: text("review_status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  rejectReason: text("reject_reason"),
  version: integer("version").notNull().default(1),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  reviewedBy: integer("reviewed_by").references(() => users.id)
}, (t) => ({
  byAuthorActive: index("idx_skills_author_active").on(t.authorUserId, t.deletedAt),
  byPublic: index("idx_skills_public_published").on(t.isPublic, t.publishedAt),
  bySlug: uniqueIndex("idx_skills_slug").on(t.slug).where(sql`${t.slug} IS NOT NULL`),
  byReviewStatus: index("idx_skills_review_status").on(t.reviewStatus, t.isPublic).where(sql`${t.deletedAt} IS NULL`)
}));

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  systemPrompt: text("system_prompt"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  skillId: integer("skill_id").references(() => skills.id)
}, (t) => ({
  byUserUpdated: index("idx_conversations_user_updated").on(t.userId, t.updatedAt),
  byUserActive: index("idx_conversations_user_active").on(t.userId, t.deletedAt),
  bySkill: index("idx_conversations_skill").on(t.skillId)
}));

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull().default(""),
  status: text("status", { enum: ["complete", "streaming", "aborted", "error"] }).notNull().default("complete"),
  errorCode: text("error_code"),
  providerMessageId: text("provider_message_id"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`)
}, (t) => ({
  byConvCreated: index("idx_messages_conv_created").on(t.conversationId, t.createdAt)
}));
