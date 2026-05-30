import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  defaultProvider: text("default_provider")
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

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  systemPrompt: text("system_prompt"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  deletedAt: integer("deleted_at", { mode: "timestamp" })
}, (t) => ({
  byUserUpdated: index("idx_conversations_user_updated").on(t.userId, t.updatedAt),
  byUserActive: index("idx_conversations_user_active").on(t.userId, t.deletedAt)
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
