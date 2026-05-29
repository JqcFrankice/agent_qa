# Phase 2b Chat Core MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 2b chat core MVP: authenticated multi-conversation chat history, aiwoo Claude/Codex streaming adapters, SSE POST streaming, and a `/chat` UI.

**Architecture:** This plan assumes Phase 2a has already landed the workspace layout, Fastify auth/session middleware, Drizzle SQLite persistence, React/Vite/Tailwind frontend, shared package, and deploy migration pipeline described in `docs/superpowers/specs/2026-05-27-phase-2a-account-system-design.md`. Phase 2b adds conversation/message persistence, a neutral provider adapter boundary, authenticated repository-backed routes, and a React chat shell that consumes POST chunked SSE via `fetch` + `ReadableStream`.

**Tech Stack:** Node 22, TypeScript ESM, Fastify, Drizzle ORM + SQLite, Vitest, React, Vite, Tailwind, TanStack Query, shadcn/ui primitives, react-markdown, remark-gfm, Shiki, sonner.

---

## Pre-flight: verify Phase 2a baseline exists

**Files:**
- Read: `package.json`
- Read: `packages/server/package.json`
- Read: `packages/server/src/server.ts`
- Read: `packages/server/src/db/schema.ts`
- Read: `packages/server/src/middleware/session.ts`
- Read: `packages/web/src/App.tsx`
- Read: `packages/shared/src/index.ts`

- [ ] **Step 1: Confirm the repository is on a feature branch or isolated worktree**

Run:
```bash
git branch --show-current
git status --short
```
Expected: not `main`, or explicit human approval to work on `main`; status is clean except intentional plan/docs changes.

- [ ] **Step 2: Confirm Phase 2a files exist**

Run:
```bash
test -f packages/server/src/db/schema.ts && test -f packages/server/src/middleware/session.ts && test -f packages/web/src/App.tsx && test -f packages/shared/src/index.ts
```
Expected: exit code 0.

If this fails, stop. Implement `docs/superpowers/specs/2026-05-27-phase-2a-account-system-design.md` before Phase 2b.

- [ ] **Step 3: Confirm baseline checks pass**

Run:
```bash
npm run lint --workspaces --if-present && npm run typecheck --workspaces --if-present && npm run test --workspaces --if-present
```
Expected: all pass. If baseline fails, stop and fix or ask before proceeding.

- [ ] **Step 4: Verify current aiwoo model IDs before coding**

Run this on a machine with the aiwoo Claude key available:
```bash
curl -fsS https://aiwoo.vip/v1/models \
  -H "x-api-key: ${ANTHROPIC_AUTH_TOKEN}" \
  -H "anthropic-version: 2023-06-01"
```
Expected: response includes the current wf/model IDs. Update Task 1 model constants if the spec IDs have drifted.

---

## File structure to create/modify

### Shared package

- `packages/shared/src/providers/models.ts` — provider/model whitelist shared by web and server.
- `packages/shared/src/schemas/conversations.ts` — zod schemas and TS types for conversation/message APIs.
- `packages/shared/src/index.ts` — export provider and conversation modules.

### Server package

- `packages/server/src/config.ts` — add aiwoo/provider env fields and startup whitelist validation.
- `packages/server/src/errors.ts` — add conversation/upstream error codes if Phase 2a error helper exists.
- `packages/server/src/db/schema.ts` — add `conversations` and `messages` tables.
- `packages/server/src/db/migrations/0001_conversations_messages.sql` — forward migration for the two new tables.
- `packages/server/src/db/repositories/conversations.ts` — owner-scoped CRUD and streaming-state queries.
- `packages/server/src/db/repositories/messages.ts` — owner-scoped message reads/writes and streaming append/status helpers.
- `packages/server/src/db/cleanup.ts` — startup cleanup that marks orphan `streaming` messages as `aborted`.
- `packages/server/src/providers/types.ts` — neutral chat adapter types.
- `packages/server/src/providers/sse-parser.ts` — dependency-free SSE frame parser.
- `packages/server/src/providers/aiwoo-claude.ts` — Anthropic Messages streaming adapter.
- `packages/server/src/providers/aiwoo-codex.ts` — OpenAI Responses streaming adapter.
- `packages/server/src/providers/registry.ts` — adapter lookup and model validation.
- `packages/server/src/routes/conversations.ts` — conversation CRUD routes.
- `packages/server/src/routes/messages.ts` — message list and streaming POST routes.
- `packages/server/src/server.ts` — register cleanup hook and new routes.
- `packages/server/tests/unit/providers/*.test.ts` — parser and adapter unit tests.
- `packages/server/tests/unit/repositories/*.test.ts` — conversation/message repository tests.
- `packages/server/tests/integration/conversations.test.ts` — CRUD route integration tests.
- `packages/server/tests/integration/messages-stream.test.ts` — streaming route integration tests.

### Web package

- `packages/web/package.json` — add markdown/shadcn/toast dependencies.
- `packages/web/src/lib/api.ts` — add conversation/message API functions.
- `packages/web/src/lib/streamMessage.ts` — POST SSE stream reader.
- `packages/web/src/routes/chat/index.tsx` — chat page container.
- `packages/web/src/routes/chat/Sidebar.tsx` — conversation list and account footer.
- `packages/web/src/routes/chat/ConversationItem.tsx` — rename/delete menu.
- `packages/web/src/routes/chat/NewConversationDialog.tsx` — provider/model/system prompt dialog.
- `packages/web/src/routes/chat/MessageList.tsx` — message scroll area.
- `packages/web/src/routes/chat/MessageBubble.tsx` — message rendering and status badge.
- `packages/web/src/routes/chat/MarkdownView.tsx` — markdown renderer.
- `packages/web/src/routes/chat/CodeBlock.tsx` — Shiki highlighted code block with copy button.
- `packages/web/src/routes/chat/Composer.tsx` — textarea with Send/Stop behavior.
- `packages/web/src/components/ui/*` — minimal shadcn/ui copied components used by chat.
- `packages/web/src/App.tsx` — redirect `/` and `/home` to `/chat` for authenticated users.

### Deploy/docs

- `deploy/agent.env.example` — add aiwoo and default provider/model env fields.
- No Caddyfile changes for Phase 2b.
- No deploy script changes beyond the Phase 2a migration pipeline.

---

## Task 1: Shared provider whitelist and API schemas

**Files:**
- Create: `packages/shared/src/providers/models.ts`
- Create: `packages/shared/src/schemas/conversations.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/providers/models.test.ts` or existing shared test location

- [ ] **Step 1: Write failing tests for provider whitelist helpers**

Create `packages/shared/src/providers/models.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER_ID, isKnownProvider, isKnownProviderModel, PROVIDER_MODELS } from "./models.js";

describe("provider model whitelist", () => {
  it("contains Claude and Codex providers", () => {
    expect(Object.keys(PROVIDER_MODELS)).toEqual(["aiwoo-claude", "aiwoo-codex"]);
  });

  it("validates provider/model pairs", () => {
    expect(isKnownProvider("aiwoo-claude")).toBe(true);
    expect(isKnownProvider("unknown")).toBe(false);
    expect(isKnownProviderModel("aiwoo-claude", PROVIDER_MODELS["aiwoo-claude"][0].id)).toBe(true);
    expect(isKnownProviderModel("aiwoo-claude", PROVIDER_MODELS["aiwoo-codex"][0].id)).toBe(false);
  });

  it("exposes a default provider that is known", () => {
    expect(DEFAULT_PROVIDER_ID).toBe("aiwoo-claude");
    expect(isKnownProvider(DEFAULT_PROVIDER_ID)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm run test --workspace=@server-agent/shared -- providers/models.test.ts
```
Expected: FAIL because `models.ts` does not exist.

- [ ] **Step 3: Implement provider whitelist**

Create `packages/shared/src/providers/models.ts`:
```ts
export const PROVIDER_MODELS = {
  "aiwoo-claude": [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
    { id: "claude-4.5-haiku", label: "Claude Haiku 4.5" }
  ],
  "aiwoo-codex": [
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5-codex", label: "GPT-5 Codex" }
  ]
} as const;

export type ProviderId = keyof typeof PROVIDER_MODELS;
export type ProviderModel = (typeof PROVIDER_MODELS)[ProviderId][number]["id"];

export const DEFAULT_PROVIDER_ID: ProviderId = "aiwoo-claude";

export function isKnownProvider(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDER_MODELS, value);
}

export function isKnownProviderModel(provider: string, model: string): boolean {
  if (!isKnownProvider(provider)) return false;
  return PROVIDER_MODELS[provider].some((item) => item.id === model);
}
```

- [ ] **Step 4: Add conversation schemas**

Create `packages/shared/src/schemas/conversations.ts`:
```ts
import { z } from "zod";
import { isKnownProviderModel, PROVIDER_MODELS } from "../providers/models.js";

export const providerIdSchema = z.enum(["aiwoo-claude", "aiwoo-codex"]);

export const createConversationRequestSchema = z.object({
  provider: providerIdSchema,
  model: z.string().min(1),
  systemPrompt: z.string().max(4000).optional()
}).superRefine((value, ctx) => {
  if (!isKnownProviderModel(value.provider, value.model)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "model is not allowed for provider" });
  }
});

export const updateConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(80).optional()
}).refine((value) => value.title !== undefined, { message: "title is required" });

export const createMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(32000)
});

export interface ConversationDto {
  id: string;
  title: string | null;
  provider: keyof typeof PROVIDER_MODELS;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "aborted" | "error";
  errorCode: string | null;
  createdAt: string;
}
```

- [ ] **Step 5: Export shared modules**

Modify `packages/shared/src/index.ts`:
```ts
export * from "./providers/models.js";
export * from "./schemas/conversations.js";
```
Preserve existing exports from Phase 2a by appending these lines rather than replacing the file.

- [ ] **Step 6: Verify and commit**

Run:
```bash
npm run test --workspace=@server-agent/shared -- providers/models.test.ts && npm run typecheck --workspace=@server-agent/shared
```
Expected: PASS.

Commit:
```bash
git add packages/shared/src/providers/models.ts packages/shared/src/providers/models.test.ts packages/shared/src/schemas/conversations.ts packages/shared/src/index.ts
git commit -m "feat(shared): add chat provider and conversation schemas"
```

---

## Task 2: Database schema, migration, repositories, and startup cleanup

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/db/migrations/0001_conversations_messages.sql`
- Create: `packages/server/src/db/repositories/conversations.ts`
- Create: `packages/server/src/db/repositories/messages.ts`
- Create: `packages/server/src/db/cleanup.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/tests/unit/repositories/conversations.test.ts`
- Test: `packages/server/tests/unit/repositories/messages.test.ts`

- [ ] **Step 1: Write repository tests for owner isolation and soft delete**

Create `packages/server/tests/unit/repositories/conversations.test.ts` using the existing Phase 2a test DB helper. Required assertions:
```ts
it("lists only non-deleted conversations for the owner ordered by updatedAt desc", async () => {
  const db = createTestDb();
  const repo = new ConversationsRepository(db);
  const userA = await insertTestUser(db, "alice");
  const userB = await insertTestUser(db, "bob");
  const first = await repo.create(userA.id, { provider: "aiwoo-claude", model: "claude-opus-4-7" });
  await repo.create(userB.id, { provider: "aiwoo-claude", model: "claude-opus-4-7" });
  const second = await repo.create(userA.id, { provider: "aiwoo-codex", model: "gpt-5.5" });
  await repo.softDelete(first.id, userA.id);
  await repo.rename(second.id, userA.id, "Renamed");

  const rows = await repo.listByUser(userA.id);
  expect(rows.map((row) => row.id)).toEqual([second.id]);
  expect(rows[0].title).toBe("Renamed");
});
```

- [ ] **Step 2: Write message repository tests for append/status/cleanup**

Create `packages/server/tests/unit/repositories/messages.test.ts` with assertions:
```ts
it("appends assistant content and marks streaming leftovers aborted", async () => {
  const db = createTestDb();
  const conversations = new ConversationsRepository(db);
  const messages = new MessagesRepository(db);
  const user = await insertTestUser(db, "alice");
  const conversation = await conversations.create(user.id, { provider: "aiwoo-claude", model: "claude-opus-4-7" });
  const assistant = await messages.createAssistantStreaming(conversation.id);

  await messages.appendContent(assistant.id, "Hello");
  await messages.appendContent(assistant.id, " world");
  await markStreamingMessagesAborted(db);

  const rows = await messages.listForConversation(conversation.id, user.id);
  expect(rows[0].content).toBe("Hello world");
  expect(rows[0].status).toBe("aborted");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
npm run test --workspace=@server-agent/server -- repositories/conversations.test.ts repositories/messages.test.ts
```
Expected: FAIL because tables/repositories do not exist.

- [ ] **Step 4: Add schema tables**

Append to `packages/server/src/db/schema.ts`:
```ts
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
```

- [ ] **Step 5: Add forward migration**

Create `packages/server/src/db/migrations/0001_conversations_messages.sql`:
```sql
CREATE TABLE `conversations` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL,
  `title` text,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `system_prompt` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_conversations_user_updated` ON `conversations` (`user_id`,`updated_at`);
CREATE INDEX `idx_conversations_user_active` ON `conversations` (`user_id`,`deleted_at`);

CREATE TABLE `messages` (
  `id` text PRIMARY KEY NOT NULL,
  `conversation_id` text NOT NULL,
  `role` text NOT NULL,
  `content` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'complete' NOT NULL,
  `error_code` text,
  `provider_message_id` text,
  `input_tokens` integer,
  `output_tokens` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_messages_conv_created` ON `messages` (`conversation_id`,`created_at`);
```

- [ ] **Step 6: Implement ID helper inside repositories**

Use this local helper in both repositories or a small `packages/server/src/db/id.ts` file:
```ts
import { randomBytes } from "node:crypto";

export function newDbId(): string {
  return randomBytes(16).toString("base64url");
}
```

- [ ] **Step 7: Implement repositories**

`ConversationsRepository` must expose:
```ts
create(userId, { provider, model, systemPrompt })
listByUser(userId)
findById(id, userId)
rename(id, userId, title)
softDelete(id, userId)
restore(id, userId)
touch(id)
hasStreamingMessage(id)
setTitleIfEmpty(id, title)
```

`MessagesRepository` must expose:
```ts
listForConversation(conversationId, userId)
createUserMessage(conversationId, content)
createAssistantStreaming(conversationId)
appendContent(messageId, contentChunk)
markComplete(messageId, metadata)
markError(messageId, errorCode)
markAborted(messageId)
listHistoryForProvider(conversationId, userId)
```

All reads that accept `userId` must join through `conversations` and include `conversations.user_id = userId` and `deleted_at IS NULL`.

- [ ] **Step 8: Add startup cleanup**

Create `packages/server/src/db/cleanup.ts`:
```ts
import { eq } from "drizzle-orm";
import type { AppDb } from "./client.js";
import { messages } from "./schema.js";

export async function markStreamingMessagesAborted(db: AppDb): Promise<void> {
  await db.update(messages).set({ status: "aborted" }).where(eq(messages.status, "streaming"));
}
```

Call it from `buildApp()` after DB initialization and before route registration.

- [ ] **Step 9: Verify and commit**

Run:
```bash
npm run test --workspace=@server-agent/server -- repositories/conversations.test.ts repositories/messages.test.ts && npm run typecheck --workspace=@server-agent/server
```
Expected: PASS.

Commit:
```bash
git add packages/server/src/db packages/server/tests/unit/repositories
git commit -m "feat(server): add conversation message persistence"
```

---

## Task 3: Provider adapters and SSE parser

**Files:**
- Create: `packages/server/src/providers/types.ts`
- Create: `packages/server/src/providers/sse-parser.ts`
- Create: `packages/server/src/providers/aiwoo-claude.ts`
- Create: `packages/server/src/providers/aiwoo-codex.ts`
- Create: `packages/server/src/providers/registry.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `deploy/agent.env.example`
- Test: `packages/server/tests/unit/providers/sse-parser.test.ts`
- Test: `packages/server/tests/unit/providers/aiwoo-claude.test.ts`
- Test: `packages/server/tests/unit/providers/aiwoo-codex.test.ts`

- [ ] **Step 1: Write SSE parser tests**

Create `packages/server/tests/unit/providers/sse-parser.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SseFrameParser } from "../../../src/providers/sse-parser.js";

describe("SseFrameParser", () => {
  it("parses frames split across chunks", () => {
    const parser = new SseFrameParser();
    expect(parser.push("event: delta\ndata: {\"text\":\"Hel")).toEqual([]);
    expect(parser.push("lo\"}\n\n")).toEqual([{ event: "delta", data: "{\"text\":\"Hello\"}" }]);
  });

  it("supports CRLF frame separators", () => {
    const parser = new SseFrameParser();
    expect(parser.push("event: done\r\ndata: {}\r\n\r\n")).toEqual([{ event: "done", data: "{}" }]);
  });
});
```

- [ ] **Step 2: Write adapter fixture tests**

For each adapter test, mock `fetch` to return a `Response` whose body is `ReadableStream` with fixture chunks. Claude fixture:
```ts
const claudeSse = [
  'event: message_start\ndata: {"message":{"id":"msg_1","usage":{"input_tokens":3}}}\n\n',
  'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hi"}}\n\n',
  'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
  'event: message_stop\ndata: {}\n\n'
];
```
Expected emitted events:
```ts
[
  { type: "delta", textDelta: "Hi" },
  { type: "done", finishReason: "end_turn", providerMessageId: "msg_1", usage: { inputTokens: 3, outputTokens: 2 } }
]
```

Codex fixture:
```ts
const codexSse = [
  'event: response.output_text.delta\ndata: {"delta":"Hi"}\n\n',
  'event: response.completed\ndata: {"response":{"id":"resp_1","usage":{"input_tokens":3,"output_tokens":2},"status":"completed"}}\n\n'
];
```
Expected emitted events:
```ts
[
  { type: "delta", textDelta: "Hi" },
  { type: "done", finishReason: "completed", providerMessageId: "resp_1", usage: { inputTokens: 3, outputTokens: 2 } }
]
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
npm run test --workspace=@server-agent/server -- providers
```
Expected: FAIL because provider files do not exist.

- [ ] **Step 4: Implement neutral provider types**

Create `packages/server/src/providers/types.ts` exactly matching the Phase 2b spec §3.1.

- [ ] **Step 5: Implement parser**

Create `packages/server/src/providers/sse-parser.ts`:
```ts
export interface SseFrame {
  event: string;
  data: string;
}

export class SseFrameParser {
  private buffer = "";

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    while (true) {
      const normalized = this.buffer.replace(/\r\n/g, "\n");
      const index = normalized.indexOf("\n\n");
      if (index < 0) return frames;
      const raw = normalized.slice(0, index);
      const consumed = this.buffer.indexOf("\n\n") >= 0 ? this.buffer.indexOf("\n\n") + 2 : this.buffer.indexOf("\r\n\r\n") + 4;
      this.buffer = this.buffer.slice(consumed);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
    }
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}
```

- [ ] **Step 6: Implement aiwoo adapters**

Implement `AiwooClaudeAdapter` and `AiwooCodexAdapter` with:
- constructor config: `{ baseUrl, authToken/apiKey, firstByteTimeoutMs }`
- `fetch` POST to `${baseUrl}/v1/messages` for Claude and `${baseUrl}/v1/responses` for Codex
- first-byte timeout using a timer that aborts an internal controller if no chunk arrives before `firstByteTimeoutMs`
- no retry
- HTTP status mapping: 503 + `model_not_found` → `UPSTREAM_MODEL_UNAVAILABLE`, other 4xx → `UPSTREAM_BAD_REQUEST`, other 5xx → `UPSTREAM_ERROR`
- yielded `ChatStreamEvent` objects only; never provider-native shapes.

- [ ] **Step 7: Add config/env validation**

Modify `packages/server/src/config.ts` to require:
```ts
ANTHROPIC_AUTH_TOKEN: z.string().min(1),
OPENAI_API_KEY: z.string().min(1),
AIWOO_BASE_URL: z.string().url().default("https://aiwoo.vip"),
DEFAULT_PROVIDER: z.enum(["aiwoo-claude", "aiwoo-codex"]),
DEFAULT_MODEL: z.string().min(1),
UPSTREAM_FIRST_BYTE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000)
```
After parsing, call `isKnownProviderModel(parsed.DEFAULT_PROVIDER, parsed.DEFAULT_MODEL)` and throw a zod-style config error if false.

- [ ] **Step 8: Update env example**

Append to `deploy/agent.env.example`:
```env
ANTHROPIC_AUTH_TOKEN=replace-with-aiwoo-claude-key
OPENAI_API_KEY=replace-with-aiwoo-codex-key
AIWOO_BASE_URL=https://aiwoo.vip
DEFAULT_PROVIDER=aiwoo-claude
DEFAULT_MODEL=claude-opus-4-7
UPSTREAM_FIRST_BYTE_TIMEOUT_MS=30000
```

- [ ] **Step 9: Verify and commit**

Run:
```bash
npm run test --workspace=@server-agent/server -- providers && npm run typecheck --workspace=@server-agent/server
```
Expected: PASS.

Commit:
```bash
git add packages/server/src/providers packages/server/src/config.ts packages/server/tests/unit/providers deploy/agent.env.example
git commit -m "feat(server): add aiwoo streaming provider adapters"
```

---

## Task 4: Conversation CRUD API routes

**Files:**
- Create: `packages/server/src/routes/conversations.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/tests/integration/conversations.test.ts`

- [ ] **Step 1: Write integration tests**

Create tests covering:
```ts
it("requires auth for GET /api/conversations", async () => {
  const app = await buildTestApp();
  const res = await app.inject({ method: "GET", url: "/api/conversations" });
  expect(res.statusCode).toBe(401);
});

it("creates, lists, renames, and deletes an owned conversation", async () => {
  const { app, cookie } = await buildLoggedInTestApp("alice");
  const create = await app.inject({
    method: "POST",
    url: "/api/conversations",
    headers: { cookie },
    payload: { provider: "aiwoo-claude", model: "claude-opus-4-7" }
  });
  expect(create.statusCode).toBe(201);
  const id = create.json().conversation.id;

  const rename = await app.inject({ method: "PATCH", url: `/api/conversations/${id}`, headers: { cookie }, payload: { title: "New title" } });
  expect(rename.statusCode).toBe(200);

  const list = await app.inject({ method: "GET", url: "/api/conversations", headers: { cookie } });
  expect(list.json().conversations[0].title).toBe("New title");

  const del = await app.inject({ method: "DELETE", url: `/api/conversations/${id}`, headers: { cookie } });
  expect(del.statusCode).toBe(200);
});

it("returns 404 for another user's conversation", async () => {
  const alice = await buildLoggedInTestApp("alice");
  const bob = await loginExistingUser(alice.app, "bob");
  const created = await alice.app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: alice.cookie }, payload: { provider: "aiwoo-claude", model: "claude-opus-4-7" } });
  const res = await alice.app.inject({ method: "GET", url: `/api/conversations/${created.json().conversation.id}/messages`, headers: { cookie: bob.cookie } });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm run test --workspace=@server-agent/server -- conversations.test.ts
```
Expected: FAIL with 404 route not found.

- [ ] **Step 3: Implement routes**

Create `packages/server/src/routes/conversations.ts` with routes:
- `GET /api/conversations`
- `POST /api/conversations`
- `PATCH /api/conversations/:id`
- `DELETE /api/conversations/:id`

Every handler must:
- require `request.user`, else 401 `AUTH_NOT_AUTHENTICATED`
- use shared zod schemas
- return `CONV_VALIDATION` for bad provider/model/title
- use repository methods that include `userId`
- return 404 `CONV_NOT_FOUND` when repository returns null/0 rows.

- [ ] **Step 4: Register route**

Modify `packages/server/src/server.ts`:
```ts
await app.register(conversationRoutes, { prefix: "/api" });
```

- [ ] **Step 5: Verify and commit**

Run:
```bash
npm run test --workspace=@server-agent/server -- conversations.test.ts && npm run typecheck --workspace=@server-agent/server
```
Expected: PASS.

Commit:
```bash
git add packages/server/src/routes/conversations.ts packages/server/src/server.ts packages/server/tests/integration/conversations.test.ts
git commit -m "feat(server): add conversation CRUD routes"
```

---

## Task 5: Message list and streaming POST route

**Files:**
- Create: `packages/server/src/routes/messages.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/tests/integration/messages-stream.test.ts`

- [ ] **Step 1: Write streaming route tests**

Create tests covering:
- unauthenticated `GET /api/conversations/:id/messages` returns 401
- other user's conversation returns 404
- happy path POST writes user + assistant messages, emits `ready`, `delta`, `done`, final assistant status `complete`
- provider error emits `error`, final assistant status `error`
- existing streaming assistant in conversation returns 409 `CONV_BUSY`
- abort path marks assistant `aborted` and preserves partial content.

Happy-path response assertion should inspect raw text:
```ts
expect(res.body).toContain("event: ready");
expect(res.body).toContain("event: delta");
expect(res.body).toContain('data: {"text":"Hello"}');
expect(res.body).toContain("event: done");
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm run test --workspace=@server-agent/server -- messages-stream.test.ts
```
Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement SSE frame writer helper**

In `packages/server/src/routes/messages.ts`:
```ts
function writeSse(raw: NodeJS.WritableStream, event: string, data: unknown): void {
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}
```

- [ ] **Step 4: Implement GET messages route**

`GET /api/conversations/:id/messages` must:
- require auth
- call `messagesRepo.listForConversation(id, request.user.id)`
- return 404 if conversation lookup fails
- return `{ messages: [...] }` ordered by `createdAt` ascending.

- [ ] **Step 5: Implement POST streaming route transaction setup**

Before starting SSE:
1. require auth
2. load conversation by `(id, userId)` or 404
3. reject if `hasStreamingMessage(id)` with 409 `CONV_BUSY`
4. validate `{ content }`
5. apply per-user 30 messages/min rate limit using Phase 2a rate-limit helper
6. insert user message complete
7. insert assistant message streaming
8. if title is null and this is first user message, set title to `content.slice(0, 40)`
9. touch conversation updatedAt.

- [ ] **Step 6: Implement stream loop**

After setup:
```ts
reply.raw.writeHead(200, {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no"
});
writeSse(reply.raw, "ready", { assistantMessageId });

const controller = new AbortController();
request.raw.on("close", () => controller.abort());
let buffer = "";
let lastFlush = Date.now();
const flushBuffer = async () => {
  if (buffer.length === 0) return;
  await messagesRepo.appendContent(assistantMessageId, buffer);
  buffer = "";
  lastFlush = Date.now();
};

try {
  for await (const event of adapter.stream({ model: conversation.model, messages: history, systemPrompt: conversation.systemPrompt ?? undefined, signal: controller.signal })) {
    if (event.type === "delta") {
      const text = event.textDelta ?? "";
      buffer += text;
      writeSse(reply.raw, "delta", { text });
      if (buffer.length >= 256 || Date.now() - lastFlush >= 200) await flushBuffer();
    }
    if (event.type === "done") {
      await flushBuffer();
      await messagesRepo.markComplete(assistantMessageId, event);
      writeSse(reply.raw, "done", { finishReason: event.finishReason, usage: event.usage });
      return;
    }
    if (event.type === "error") {
      await flushBuffer();
      await messagesRepo.markError(assistantMessageId, event.error?.code ?? "UPSTREAM_ERROR");
      writeSse(reply.raw, "error", event.error ?? { code: "UPSTREAM_ERROR", message: "上游服务异常" });
      return;
    }
  }
} catch (err) {
  await flushBuffer();
  if ((err as Error).name === "AbortError" || controller.signal.aborted) {
    await messagesRepo.markAborted(assistantMessageId);
    return;
  }
  await messagesRepo.markError(assistantMessageId, "INTERNAL");
  if (!reply.raw.destroyed) writeSse(reply.raw, "error", { code: "INTERNAL", message: "服务器内部错误" });
} finally {
  reply.raw.end();
}
```

- [ ] **Step 7: Register route**

Modify `packages/server/src/server.ts`:
```ts
await app.register(messageRoutes, { prefix: "/api" });
```

- [ ] **Step 8: Verify and commit**

Run:
```bash
npm run test --workspace=@server-agent/server -- messages-stream.test.ts && npm run typecheck --workspace=@server-agent/server
```
Expected: PASS.

Commit:
```bash
git add packages/server/src/routes/messages.ts packages/server/src/server.ts packages/server/tests/integration/messages-stream.test.ts
git commit -m "feat(server): add streaming message routes"
```

---

## Task 6: Web API client and SSE reader

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/lib/streamMessage.ts`
- Test: `packages/web/src/lib/streamMessage.test.ts`

- [ ] **Step 1: Write stream reader tests**

Mock `fetch` with chunked `ReadableStream` and assert yielded events:
```ts
it("parses ready delta and done events from chunked SSE", async () => {
  mockFetchSse([
    'event: ready\ndata: {"assistantMessageId":"a1"}\n\n',
    'event: delta\ndata: {"text":"Hel',
    'lo"}\n\n',
    'event: done\ndata: {"finishReason":"stop"}\n\n'
  ]);

  const events = [];
  for await (const event of streamMessage("c1", "hi", new AbortController().signal)) events.push(event);

  expect(events).toEqual([
    { type: "ready", assistantMessageId: "a1" },
    { type: "delta", text: "Hello" },
    { type: "done", finishReason: "stop" }
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm run test --workspace=@server-agent/web -- streamMessage.test.ts
```
Expected: FAIL because `streamMessage.ts` does not exist.

- [ ] **Step 3: Implement `streamMessage`**

Create `packages/web/src/lib/streamMessage.ts` using the exact generator contract from spec §6.5. Include a local `parseSSE(frame)` function that reads `event:` and `data:` lines and returns typed events.

- [ ] **Step 4: Add API functions**

Append to `packages/web/src/lib/api.ts`:
```ts
export async function listConversations() { return apiGet("/api/conversations"); }
export async function createConversation(input: { provider: string; model: string; systemPrompt?: string }) { return apiPost("/api/conversations", input); }
export async function renameConversation(id: string, title: string) { return apiPatch(`/api/conversations/${id}`, { title }); }
export async function deleteConversation(id: string) { return apiDelete(`/api/conversations/${id}`); }
export async function listMessages(conversationId: string) { return apiGet(`/api/conversations/${conversationId}/messages`); }
```
Use the existing Phase 2a fetch wrapper style and keep `credentials: "include"`.

- [ ] **Step 5: Verify and commit**

Run:
```bash
npm run test --workspace=@server-agent/web -- streamMessage.test.ts && npm run typecheck --workspace=@server-agent/web
```
Expected: PASS.

Commit:
```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/streamMessage.ts packages/web/src/lib/streamMessage.test.ts
git commit -m "feat(web): add chat API and stream reader"
```

---

## Task 7: Chat UI shell, sidebar, composer, and markdown rendering

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/src/routes/chat/index.tsx`
- Create: `packages/web/src/routes/chat/Sidebar.tsx`
- Create: `packages/web/src/routes/chat/ConversationItem.tsx`
- Create: `packages/web/src/routes/chat/NewConversationDialog.tsx`
- Create: `packages/web/src/routes/chat/MessageList.tsx`
- Create: `packages/web/src/routes/chat/MessageBubble.tsx`
- Create: `packages/web/src/routes/chat/MarkdownView.tsx`
- Create: `packages/web/src/routes/chat/CodeBlock.tsx`
- Create: `packages/web/src/routes/chat/Composer.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Install frontend dependencies**

Run:
```bash
npm install --workspace=@server-agent/web react-markdown remark-gfm shiki sonner lucide-react class-variance-authority clsx tailwind-merge @radix-ui/react-dialog @radix-ui/react-dropdown-menu
```
Expected: `packages/web/package.json` and root lockfile update.

- [ ] **Step 2: Add minimal shadcn utility**

Create `packages/web/src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Add minimal UI components used by chat**

Create only the shadcn-style files the chat imports: `button.tsx`, `textarea.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `skeleton.tsx`. Keep them copy-paste local and avoid adding unused components.

- [ ] **Step 4: Implement chat container**

`packages/web/src/routes/chat/index.tsx` must:
- query conversations with React Query
- keep selected conversation id in state
- load selected messages
- use `useStreamMessage` local hook wrapping `streamMessage`
- abort active stream before switching conversations after confirmation
- invalidate messages and conversations when stream completes.

- [ ] **Step 5: Implement sidebar and conversation item**

Sidebar requirements:
- 260px fixed width
- `+ New Conversation` opens dialog
- list conversations sorted as API returns
- conversation item menu supports rename and delete
- bottom account area shows username and Logout.

- [ ] **Step 6: Implement new conversation dialog**

Dialog requirements:
- provider dropdown from `PROVIDER_MODELS`
- model dropdown filtered by provider
- default provider/model from server config if exposed by `/api/auth/me`, otherwise first whitelist item
- optional system prompt textarea max 4000 characters
- create conversation, close dialog, select new conversation.

- [ ] **Step 7: Implement message rendering**

`MessageBubble` requirements:
- user messages right-aligned or visually distinct
- assistant messages left-aligned
- `status='aborted'` shows “已中断” badge
- `status='error'` shows red error bubble using `errorCode`
- assistant content rendered through `MarkdownView`.

- [ ] **Step 8: Implement Markdown and code block**

`MarkdownView` requirements:
- use `react-markdown`
- use `remark-gfm`
- do not enable raw HTML or `rehype-raw`
- code blocks render via `CodeBlock` with Shiki `github-dark-default`
- code block includes a Copy button using `navigator.clipboard.writeText`.

- [ ] **Step 9: Implement composer**

Composer requirements:
- textarea max 8 visual rows
- `Enter` sends, `Shift+Enter` inserts newline
- when streaming, send button becomes Stop and calls abort
- empty trimmed content cannot send.

- [ ] **Step 10: Update routes**

Modify `packages/web/src/App.tsx`:
- `/` authenticated users redirect to `/chat`, unauthenticated users to `/login`
- `/home` redirects to `/chat`
- `/chat` requires auth.

- [ ] **Step 11: Verify and commit**

Run:
```bash
npm run typecheck --workspace=@server-agent/web && npm run build --workspace=@server-agent/web
```
Expected: PASS.

Commit:
```bash
git add packages/web package-lock.json
git commit -m "feat(web): add chat interface"
```

---

## Task 8: End-to-end drills and final verification

**Files:**
- Modify only if verification reveals defects.

- [ ] **Step 1: Run full automated checks**

Run:
```bash
npm run lint --workspaces --if-present && npm run typecheck --workspaces --if-present && npm run test --workspaces --if-present && npm run build --workspaces --if-present
```
Expected: all pass.

- [ ] **Step 2: Verify unauthenticated API rejection**

Run locally with app started:
```bash
curl -i http://127.0.0.1:8080/api/conversations
```
Expected: HTTP 401 with `AUTH_NOT_AUTHENTICATED`.

- [ ] **Step 3: Verify startup cleanup drill**

Using local test DB, insert one `messages.status='streaming'`, start the server, then query DB.
Expected: row becomes `status='aborted'` and content remains unchanged.

- [ ] **Step 4: Verify upstream unavailable drill**

Temporarily run with:
```env
DEFAULT_MODEL=fake-model
```
Send a message in `/chat`.
Expected: SSE `event: error` with `UPSTREAM_MODEL_UNAVAILABLE`, assistant message `status='error'`, UI red error bubble.

- [ ] **Step 5: Verify user abort drill**

Send a long message in `/chat`, click Stop while streaming.
Expected: browser aborts, server aborts upstream fetch, assistant message stores partial content with `status='aborted'`, UI shows “已中断”.

- [ ] **Step 6: Verify manual E2E checklist**

Complete the Phase 2b spec §9.2 checklist items 1–17. Record any failure as a new bugfix commit before finalizing.

- [ ] **Step 7: Final commit if drills required fixes**

If any fixes were made:
```bash
git add <fixed-files>
git commit -m "fix: stabilize chat core drills"
```

- [ ] **Step 8: Push branch**

Run:
```bash
git push -u origin HEAD
```
Expected: branch pushed.

---

## Self-review notes

- Spec coverage: covers data model/migration, provider adapters, model whitelist, CRUD routes, streaming POST, abort semantics, startup cleanup, `/chat` UI, env fields, drills, and verification.
- Intentional dependency: Phase 2b requires Phase 2a to exist first. The current repository may still be Phase 1-shaped; do not start Task 1 until pre-flight passes.
- No Caddy or deploy script changes are planned for Phase 2b beyond adding migration/env fields, matching the spec.
