# Phase 3 — Skill 沉淀流水线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在 /chat 把满意的 prompt 一键存成 skill，下次开会话能选 skill 自动注入 system message；skill 支持私有/公开两种模式。

**Architecture:** SQLite 加 `skills` 表 + `conversations.skill_id` 列（forward-only migration）；Fastify 加 5 个 REST 路由（CRUD + extract）；React 前端 sidebar 加 Skills tab + 「保存为 Skill」modal + 新建会话时可选 skill 注入 systemPrompt。skill 不绑 provider/model（D5），保持 provider-agnostic。

**Tech Stack:** TypeScript / Fastify 4 / better-sqlite3 + Drizzle / React 18 + TanStack Query / Vite / Vitest / zod

**前置上下文：**

- Spec：[`docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md`](../specs/2026-05-30-phase-3-6-roadmap.md) §1
- 必读约束：[`AGENTS.md`](../../../AGENTS.md) §3 部署、§6.1 build:shared 顺序、§6.5 spec/plan 流程
- 决策已定（D1-D5）：手动按钮保存 / 纯 prompt 模板（无参数化） / `is_public` 字段 + 无审核 / 机械拼接生成 draft / skill 不绑 provider/model
- 数据库迁移规则：**forward-only**，新文件 `0002_skills.sql`，不修改 `0000_initial.sql` / `0001_conversations_messages.sql`
- 测试惯例：repository 层用 `tests/unit/repositories/*.test.ts`；route 层用 `tests/unit/routes/*.test.ts` 或 `server.smoke.test.ts`；前端只对纯函数/钩子做单测，UI 主要靠手动验收

---

## File Structure

**新建：**

- `packages/server/src/db/migrations/0002_skills.sql` — skill 表 + conversations.skill_id 迁移
- `packages/server/src/db/repositories/skills.ts` — `SkillsRepository`：CRUD + 软删 + 列表（私有 + 公开 union）+ 提取 draft
- `packages/server/src/routes/skills.ts` — `/api/skills` 5 个路由 + extract
- `packages/server/tests/unit/repositories/skills.test.ts` — repo 单测（owner 隔离 / 公开可见性 / 软删过滤 / extract 拼接）
- `packages/server/tests/unit/routes/skills.test.ts` — route 单测（403 / 404 / extract / fallback）
- `packages/shared/src/schemas/skills.ts` — `Skill*Schema` zod + `SkillDto` 类型
- `packages/web/src/lib/skills.ts` — 前端 API 客户端
- `packages/web/src/routes/chat/SkillsPanel.tsx` — sidebar 内的 Skills tab UI
- `packages/web/src/routes/chat/SaveSkillDialog.tsx` — 「保存为 Skill」modal
- `packages/web/src/routes/chat/SkillItem.tsx` — Skills 列表里单条 item

**修改：**

- `packages/server/src/db/schema.ts` — 加 `skills` table + `conversations.skillId` 列
- `packages/server/src/server.ts` — 注册 `skillsRoutes`
- `packages/shared/src/schemas/index.ts` — 导出 skills schema
- `packages/shared/src/schemas/conversations.ts` — `createConversationRequestSchema` 加可选 `skillId`，`ConversationDto` 加 `skillId`
- `packages/server/src/db/repositories/conversations.ts` — `create` 接受 `skillId`，`findById` / 列表返回 `skillId`，`hydrateSystemPrompt` 实现 fallback（skill 软删则用 conversation 自带 systemPrompt）
- `packages/server/src/routes/conversations.ts` — 创建会话时校验 skill 归属（私有/公开），写入 skill_id + system_prompt 快照
- `packages/server/src/routes/messages.ts` — history 加载时若 conversation.skill_id 指向已删 skill，仍正常返回（用快照的 system_prompt，不抛错）
- `packages/web/src/routes/chat/Sidebar.tsx` — tab 切换：会话 / Skills
- `packages/web/src/routes/chat/index.tsx` — `useSkills` query、新建会话时透传 skillId、Composer 旁加「保存为 Skill」按钮
- `packages/web/src/routes/chat/Composer.tsx` — 加「保存为 Skill」按钮（`onSaveSkill` prop）
- `packages/web/src/routes/chat/NewConversationDialog.tsx` — 选 skill 后预填 systemPrompt
- `packages/web/src/lib/api.ts` — `createConversation` 入参加 `skillId`，`ConversationDto` 加 `skillId`
- `AGENTS.md` — §6 加 Phase 3 学到的坑（skill_id fallback、systemPrompt 快照策略）
- `README.md` — §"路线图" Phase 3 → done

**关键设计取舍：**

- `conversations.system_prompt` 在 create 时 **快照** skill.system_prompt（不是运行时 join），这样 skill 软删/改名/被发布者改文本，不影响已存在会话 — 实现 §1.5 验收 "skill 软删后基于它的 conversation 不报错" 的最简方案。
- `conversations.skill_id` 仅作"溯源/统计"用，不参与 system message 生成。Phase 5 加版本管理时改成 `skill_version_id` 也是 add 列、不破坏现有数据。
- Skill 不分 provider，单一 `system_prompt` 字段；`default_provider` / `default_model` 为可选 prefill，前端取值时如果用户在 NewConversationDialog 改了，以用户为准。

---

## Task 1：DB Schema 与 Migration

**Files:**

- Create: `packages/server/src/db/migrations/0002_skills.sql`
- Modify: `packages/server/src/db/schema.ts`

- [ ] **Step 1.1：写 migration SQL**

Create `packages/server/src/db/migrations/0002_skills.sql`：

```sql
CREATE TABLE `skills` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `author_user_id` integer NOT NULL,
  `title` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `system_prompt` text NOT NULL,
  `default_provider` text,
  `default_model` text,
  `is_public` integer DEFAULT 0 NOT NULL,
  `published_at` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_skills_author_active` ON `skills` (`author_user_id`,`deleted_at`);
CREATE INDEX `idx_skills_public_published` ON `skills` (`is_public`,`published_at`);

ALTER TABLE `conversations` ADD COLUMN `skill_id` integer REFERENCES `skills`(`id`);
CREATE INDEX `idx_conversations_skill` ON `conversations` (`skill_id`);
```

> 说明：sqlite 不支持 partial index 里跨表 ON DELETE，统一用普通 index；`is_public` 用 integer 0/1 与现有 schema 风格对齐；时间戳全 `integer` + `unixepoch()` 与 conversations/messages 一致（spec §1.4 用 ISO TEXT 是叙述性，落地实现以 schema 一致性为准）。

- [ ] **Step 1.2：更新 Drizzle schema**

Modify `packages/server/src/db/schema.ts`：在 `messages` 之后追加 `skills` 表，并在 `conversations` 表里加 `skillId` 列：

```ts
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
  deletedAt: integer("deleted_at", { mode: "timestamp" })
}, (t) => ({
  byAuthorActive: index("idx_skills_author_active").on(t.authorUserId, t.deletedAt),
  byPublic: index("idx_skills_public_published").on(t.isPublic, t.publishedAt)
}));
```

把 `conversations` 定义里加一列：

```ts
skillId: integer("skill_id").references(() => skills.id),
```

注意：`skills` 表必须**放在 `conversations` 之前**（顺序：users → sessions → inviteCodes → skills → conversations → messages），这样 `conversations.skillId` 直接 `() => skills.id` 即可，不需要 lazy ref。如果 skills 放在 conversations 后面，TS 顺序解析下要 `(): any =>` 才能编译，会触发 `@typescript-eslint/no-explicit-any` lint 报错。

- [ ] **Step 1.3：跑 migration 验证 schema**

```bash
rm -f /tmp/phase3-skill.db
DB_PATH=/tmp/phase3-skill.db npm -w @server-agent/server run db:migrate
sqlite3 /tmp/phase3-skill.db ".schema skills"
sqlite3 /tmp/phase3-skill.db "PRAGMA table_info(conversations);" | grep skill_id
```

Expected：输出 `skills` 表结构 + `conversations.skill_id` 一行（type=INTEGER）。

- [ ] **Step 1.4：commit**

```bash
git add packages/server/src/db/migrations/0002_skills.sql packages/server/src/db/schema.ts
git commit -m "feat(server): add skills table and conversations.skill_id"
```

---

## Task 2：SkillsRepository（先写测试再实现）

**Files:**

- Create: `packages/server/src/db/repositories/skills.ts`
- Test: `packages/server/tests/unit/repositories/skills.test.ts`

- [ ] **Step 2.1：写失败测试 — owner 隔离 + 软删 + 公开可见**

Create `packages/server/tests/unit/repositories/skills.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { UserRepository } from "../../../src/db/repositories/users.js";
import { SkillsRepository } from "../../../src/db/repositories/skills.js";

async function user(db: ReturnType<typeof createTestDb>, name: string) {
  return new UserRepository(db).create(name, "hash");
}

describe("SkillsRepository", () => {
  it("creates and lists skills scoped to author", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const bob = await user(db, "bob");
    const a1 = await repo.create(alice.id, { title: "A1", systemPrompt: "p1" });
    await repo.create(bob.id, { title: "B1", systemPrompt: "p2" });

    const aliceList = await repo.listAvailableTo(alice.id);
    expect(aliceList.map((r) => r.id)).toEqual([a1.id]);
  });

  it("includes public skills from other authors and excludes soft-deleted", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const bob = await user(db, "bob");
    const aPublic = await repo.create(alice.id, { title: "shared", systemPrompt: "x" });
    await repo.publish(aPublic.id, alice.id);
    const aPrivate = await repo.create(alice.id, { title: "secret", systemPrompt: "y" });

    const bobList = await repo.listAvailableTo(bob.id);
    expect(bobList.map((r) => r.id)).toEqual([aPublic.id]);

    await repo.softDelete(aPublic.id, alice.id);
    expect((await repo.listAvailableTo(bob.id)).length).toBe(0);
    expect((await repo.listAvailableTo(alice.id)).map((r) => r.id)).toEqual([aPrivate.id]);
  });

  it("findAvailableForUse enforces ownership or public visibility", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const bob = await user(db, "bob");
    const skill = await repo.create(alice.id, { title: "t", systemPrompt: "p" });

    expect(await repo.findAvailableForUse(skill.id, bob.id)).toBeNull();
    expect((await repo.findAvailableForUse(skill.id, alice.id))?.id).toBe(skill.id);
    await repo.publish(skill.id, alice.id);
    expect((await repo.findAvailableForUse(skill.id, bob.id))?.id).toBe(skill.id);
  });

  it("publish sets publishedAt and unpublish clears it", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const skill = await repo.create(alice.id, { title: "t", systemPrompt: "p" });
    const published = await repo.publish(skill.id, alice.id);
    expect(published?.isPublic).toBe(1);
    expect(published?.publishedAt).toBeInstanceOf(Date);
    const unpublished = await repo.unpublish(skill.id, alice.id);
    expect(unpublished?.isPublic).toBe(0);
    expect(unpublished?.publishedAt).toBeNull();
  });

  it("update only allowed by author", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const bob = await user(db, "bob");
    const skill = await repo.create(alice.id, { title: "t", systemPrompt: "p" });
    expect(await repo.update(skill.id, bob.id, { title: "hijack" })).toBeNull();
    const updated = await repo.update(skill.id, alice.id, { title: "renamed" });
    expect(updated?.title).toBe("renamed");
  });
});
```

- [ ] **Step 2.2：跑测试确认失败**

```bash
npm -w @server-agent/server test -- skills.test
```

Expected：所有用例 fail，因 `SkillsRepository` 不存在。

- [ ] **Step 2.3：实现 SkillsRepository**

Create `packages/server/src/db/repositories/skills.ts`：

```ts
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
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
```

- [ ] **Step 2.4：跑测试确认通过**

```bash
npm -w @server-agent/server test -- skills.test
```

Expected：5 个用例全过。

- [ ] **Step 2.5：commit**

```bash
git add packages/server/src/db/repositories/skills.ts packages/server/tests/unit/repositories/skills.test.ts
git commit -m "feat(server): add SkillsRepository with author/public visibility"
```

---

## Task 3：Shared Schemas

**Files:**

- Create: `packages/shared/src/schemas/skills.ts`
- Modify: `packages/shared/src/schemas/index.ts`, `packages/shared/src/schemas/conversations.ts`

- [ ] **Step 3.1：写 skill schema**

Create `packages/shared/src/schemas/skills.ts`：

```ts
import { z } from "zod";
import { providerIdSchema } from "./conversations.js";

export const skillTitleSchema = z.string().trim().min(1).max(80);
export const skillDescriptionSchema = z.string().trim().max(280).default("");
export const skillSystemPromptSchema = z.string().trim().min(1).max(8000);

export const createSkillRequestSchema = z.object({
  title: skillTitleSchema,
  description: skillDescriptionSchema.optional(),
  systemPrompt: skillSystemPromptSchema,
  defaultProvider: providerIdSchema.optional(),
  defaultModel: z.string().min(1).optional(),
  isPublic: z.boolean().optional()
});

export const updateSkillRequestSchema = z.object({
  title: skillTitleSchema.optional(),
  description: skillDescriptionSchema.optional(),
  systemPrompt: skillSystemPromptSchema.optional(),
  defaultProvider: providerIdSchema.nullable().optional(),
  defaultModel: z.string().min(1).nullable().optional(),
  isPublic: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, { message: "no fields to update" });

export const extractSkillRequestSchema = z.object({
  conversationId: z.string().min(1)
});

export interface SkillDto {
  id: number;
  title: string;
  description: string;
  systemPrompt: string;
  defaultProvider: string | null;
  defaultModel: string | null;
  isPublic: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorUsername: string;
  isOwn: boolean;
}

export interface SkillDraftDto {
  title: string;
  systemPrompt: string;
}
```

- [ ] **Step 3.2：导出**

Modify `packages/shared/src/schemas/index.ts`：

```ts
export * from "./auth.js";
export * from "./user.js";
export * from "./conversations.js";
export * from "./skills.js";
```

如果 `conversations.js` 还没在 index 里被 re-export（看现有内容），保持现状即可；如果 `providerIdSchema` 没 export，把它在 `conversations.ts` 末尾添 `export` 关键字（应该已经是导出的，verify 一下）。

- [ ] **Step 3.3：在 conversation schema 里加 skillId**

Modify `packages/shared/src/schemas/conversations.ts`：把 `createConversationRequestSchema` 改成：

```ts
export const createConversationRequestSchema = z.object({
  provider: providerIdSchema,
  model: z.string().min(1),
  systemPrompt: z.string().max(4000).optional(),
  skillId: z.number().int().positive().optional()
}).superRefine((value, ctx) => {
  if (!isKnownProviderModel(value.provider, value.model)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "model is not allowed for provider" });
  }
});
```

并把 `ConversationDto` 加一列：

```ts
export interface ConversationDto {
  id: string;
  title: string | null;
  provider: keyof typeof PROVIDER_MODELS;
  model: string;
  skillId: number | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3.4：build shared 验证类型**

```bash
npm -w @server-agent/shared run build
```

Expected：无类型错误，`packages/shared/dist/schemas/skills.js` 生成。

> 注意：AGENTS.md §6.1 说 deploy 时 `db:migrate` 之前必须 `build:shared`，这里同理 — 后续 server 测试导入 shared dist 也需要它最新。

- [ ] **Step 3.5：commit**

```bash
git add packages/shared/src/schemas
git commit -m "feat(shared): add skill schemas and conversation skillId"
```

---

## Task 4：Conversations Repository / Routes 接入 skill

**Files:**

- Modify: `packages/server/src/db/repositories/conversations.ts`, `packages/server/src/routes/conversations.ts`
- Test: `packages/server/tests/unit/repositories/conversations.test.ts`（追加用例）

- [ ] **Step 4.1：写失败测试 — create with skill 写入 skill_id 与快照**

追加到 `packages/server/tests/unit/repositories/conversations.test.ts`：

```ts
it("creates with skillId and snapshots systemPrompt", async () => {
  const db = createTestDb();
  const convRepo = new ConversationsRepository(db);
  const alice = await insertTestUser(db, "alice");
  const conv = await convRepo.create(alice.id, {
    provider: "aiwoo-claude",
    model: "claude-opus-4-8",
    systemPrompt: "snapshot prompt",
    skillId: 7
  });
  expect(conv.skillId).toBe(7);
  expect(conv.systemPrompt).toBe("snapshot prompt");
});
```

跑测试确认失败：`npm -w @server-agent/server test -- conversations.test`。

- [ ] **Step 4.2：实现 — repo 接受 skillId**

Modify `packages/server/src/db/repositories/conversations.ts`，把 `CreateConversationInput` 与 `create` 改成：

```ts
interface CreateConversationInput {
  provider: string;
  model: string;
  systemPrompt?: string | null;
  skillId?: number | null;
}

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
```

跑测试：`npm -w @server-agent/server test -- conversations.test` → 全过。

- [ ] **Step 4.3：route 校验 skill 归属并写入快照**

Modify `packages/server/src/routes/conversations.ts`：

- 增加 deps：`skills: SkillsRepository`（构造）
- `POST /conversations` handler：

```ts
let snapshotPrompt = parsed.data.systemPrompt ?? null;
let skillId: number | null = null;
if (parsed.data.skillId !== undefined) {
  const skill = await deps.skills.findAvailableForUse(parsed.data.skillId, user.id);
  if (!skill) {
    const error = new AppError(404, "SKILL_NOT_FOUND", "Skill 不存在或不可用");
    return reply.code(error.statusCode).send(errorBody(error));
  }
  skillId = skill.id;
  if (!snapshotPrompt) snapshotPrompt = skill.systemPrompt;
}
const row = await repo.create(user.id, {
  provider: parsed.data.provider,
  model: parsed.data.model,
  systemPrompt: snapshotPrompt,
  skillId
});
```

把 `toDto` 加 `skillId`：

```ts
function toDto(row: { id: string; title: string | null; provider: string; model: string; skillId: number | null; createdAt: Date; updatedAt: Date; }) {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider,
    model: row.model,
    skillId: row.skillId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
```

把 `ConversationRouteDeps` 加 `skills: SkillsRepository`：

```ts
interface ConversationRouteDeps {
  db: AppDb;
  skills: SkillsRepository;
}
```

并把 `repo` 改为按 deps 而不是 new（保留现状即可，但 conversation route 现在还需要查 skill repo）。

- [ ] **Step 4.4：server.ts 注入 skills repo**

Modify `packages/server/src/server.ts`：

```ts
import { SkillsRepository } from "./db/repositories/skills.js";
// ...
const skillsRepo = new SkillsRepository(db);
await app.register(conversationRoutes, { prefix: "/api", db, skills: skillsRepo });
```

- [ ] **Step 4.5：跑全部测试 + typecheck**

```bash
npm -w @server-agent/shared run build
npm -w @server-agent/server run typecheck
npm -w @server-agent/server test
```

Expected：全过。

- [ ] **Step 4.6：commit**

```bash
git add packages/server/src/db/repositories/conversations.ts packages/server/src/routes/conversations.ts packages/server/src/server.ts packages/server/tests/unit/repositories/conversations.test.ts
git commit -m "feat(server): allow creating conversation from skill with prompt snapshot"
```

---

## Task 5：Skills 路由（CRUD + extract）

**Files:**

- Create: `packages/server/src/routes/skills.ts`
- Test: `packages/server/tests/unit/routes/skills.test.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 5.1：写失败 route 测试**

Create `packages/server/tests/unit/routes/skills.test.ts`：

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { UserRepository } from "../../../src/db/repositories/users.js";
import { SessionRepository } from "../../../src/db/repositories/sessions.js";
import type { AppDb } from "../../../src/db/client.js";

let buildApp: typeof import("../../../src/server.js").buildApp;

beforeAll(async () => {
  process.env.PORT = "8080";
  process.env.HOST = "127.0.0.1";
  process.env.NODE_ENV = "test";
  ({ buildApp } = await import("../../../src/server.js"));
});

async function loginAs(db: AppDb, username: string) {
  const user = await new UserRepository(db).create(username, "hash");
  const session = await new SessionRepository(db).create(user.id, { ip: null, userAgent: null });
  return { user, cookie: `sid=${session.id}` };
}

describe("skills routes", () => {
  it("POST /api/skills creates a private skill", async () => {
    const db = createTestDb();
    const app = await buildApp({ db });
    const { cookie } = await loginAs(db, "alice");
    const res = await app.inject({ method: "POST", url: "/api/skills", headers: { cookie }, payload: { title: "t", systemPrompt: "p" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().skill.isPublic).toBe(false);
    await app.close();
  });

  it("GET /api/skills lists own + public skills", async () => {
    const db = createTestDb();
    const app = await buildApp({ db });
    const alice = await loginAs(db, "alice");
    const bob = await loginAs(db, "bob");
    const aliceSkill = await app.inject({ method: "POST", url: "/api/skills", headers: { cookie: alice.cookie }, payload: { title: "shared", systemPrompt: "x", isPublic: true } });
    expect(aliceSkill.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/api/skills", headers: { cookie: bob.cookie } });
    expect(list.json().skills.length).toBe(1);
    expect(list.json().skills[0].isOwn).toBe(false);
    await app.close();
  });

  it("PATCH /api/skills/:id forbids non-author", async () => {
    const db = createTestDb();
    const app = await buildApp({ db });
    const alice = await loginAs(db, "alice");
    const bob = await loginAs(db, "bob");
    const created = await app.inject({ method: "POST", url: "/api/skills", headers: { cookie: alice.cookie }, payload: { title: "t", systemPrompt: "p" } });
    const skillId = created.json().skill.id;
    const res = await app.inject({ method: "PATCH", url: `/api/skills/${skillId}`, headers: { cookie: bob.cookie }, payload: { title: "hijack" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("DELETE /api/skills/:id soft-deletes", async () => {
    const db = createTestDb();
    const app = await buildApp({ db });
    const alice = await loginAs(db, "alice");
    const created = await app.inject({ method: "POST", url: "/api/skills", headers: { cookie: alice.cookie }, payload: { title: "t", systemPrompt: "p" } });
    const skillId = created.json().skill.id;
    const del = await app.inject({ method: "DELETE", url: `/api/skills/${skillId}`, headers: { cookie: alice.cookie } });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/skills", headers: { cookie: alice.cookie } });
    expect(list.json().skills.length).toBe(0);
    await app.close();
  });

  it("POST /api/conversations/:id/extract-skill builds draft from messages", async () => {
    const db = createTestDb();
    const app = await buildApp({ db });
    const alice = await loginAs(db, "alice");
    const conv = await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie: alice.cookie }, payload: { provider: "aiwoo-claude", model: "claude-opus-4-8", systemPrompt: "you are helpful" } });
    const convId = conv.json().conversation.id;
    // 直接往 messages 表里塞两条 user msg
    const { MessagesRepository } = await import("../../../src/db/repositories/messages.js");
    const m = new MessagesRepository(db);
    await m.createUserMessage(convId, "first user message");
    await m.createUserMessage(convId, "second user message");
    const res = await app.inject({ method: "POST", url: `/api/conversations/${convId}/extract-skill`, headers: { cookie: alice.cookie } });
    expect(res.statusCode).toBe(200);
    const draft = res.json().draft;
    expect(draft.title).toMatch(/first user message/);
    expect(draft.systemPrompt).toContain("you are helpful");
    expect(draft.systemPrompt).toContain("first user message");
    expect(draft.systemPrompt).toContain("second user message");
    await app.close();
  });
});
```

- [ ] **Step 5.2：跑测试确认失败**

```bash
npm -w @server-agent/server test -- skills
```

Expected：fail（路由 404）。

- [ ] **Step 5.3：实现路由**

Create `packages/server/src/routes/skills.ts`：

```ts
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
    return { skills: rows.map((r) => toDto(r, user.id, usersById.get(r.authorUserId)?.username ?? "?")) };
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
    if (!Number.isFinite(id)) return reply.code(404).send(errorBody(new AppError(404, "SKILL_NOT_FOUND", "skill 不存在")));
    const parsed = updateSkillRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error = new AppError(400, "SKILL_VALIDATION", "skill 参数不合法");
      return reply.code(error.statusCode).send(errorBody(error));
    }
    const { isPublic, ...rest } = parsed.data;
    let row = Object.keys(rest).length > 0 ? await repo.update(id, user.id, rest) : await repo.findById(id, user.id);
    if (!row) return reply.code(404).send(errorBody(new AppError(404, "SKILL_NOT_FOUND", "skill 不存在")));
    if (isPublic === true) row = (await repo.publish(id, user.id)) ?? row;
    if (isPublic === false) row = (await repo.unpublish(id, user.id)) ?? row;
    const author = await users.findById(user.id);
    return { skill: toDto(row, user.id, author?.username ?? "?") };
  });

  app.delete<{ Params: { id: string } }>("/skills/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(404).send(errorBody(new AppError(404, "SKILL_NOT_FOUND", "skill 不存在")));
    const ok = await repo.softDelete(id, user.id);
    if (!ok) return reply.code(404).send(errorBody(new AppError(404, "SKILL_NOT_FOUND", "skill 不存在")));
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
    if (conversation.systemPrompt) promptParts.push(`# 原 system prompt\n${conversation.systemPrompt}`);
    if (userMsgs.length > 0) promptParts.push(`# 历史 user 消息\n${userMsgs.map((m, i) => `${i + 1}. ${m}`).join("\n")}`);
    const systemPrompt = promptParts.join("\n\n") || "（暂无内容，请手动编辑）";
    return { draft: { title, systemPrompt } };
  });
};

export default skillsRoutes;
```

注意：`UserRepository.findManyByIds` 与 `findById` 可能不存在 — 在下一步补。

- [ ] **Step 5.4：补 UserRepository 缺失方法**

Modify `packages/server/src/db/repositories/users.ts`：如果没有 `findManyByIds` / `findById`，加上：

```ts
async findById(id: number) {
  const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

async findManyByIds(ids: number[]) {
  if (ids.length === 0) return new Map<number, { id: number; username: string }>();
  const rows = await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}
```

import `inArray`：`import { eq, inArray } from "drizzle-orm";`。先 `grep` 一下看现有 imports，按现状增量改。

- [ ] **Step 5.5：注册路由**

Modify `packages/server/src/server.ts`：

```ts
import skillsRoutes from "./routes/skills.js";
// ...
await app.register(skillsRoutes, { prefix: "/api", db });
```

注册位置放在 `conversationRoutes` 之后、`messageRoutes` 之前（保持就近）。

- [ ] **Step 5.6：跑测试**

```bash
npm -w @server-agent/shared run build
npm -w @server-agent/server test
```

Expected：所有用例（包括 skills 5 个 + 已有 conversations/auth/etc）全过。

- [ ] **Step 5.7：commit**

```bash
git add packages/server/src/routes/skills.ts packages/server/src/db/repositories/users.ts packages/server/src/server.ts packages/server/tests/unit/routes/skills.test.ts
git commit -m "feat(server): add skills CRUD routes and conversation extract-skill"
```

---

## Task 6：前端 API 客户端

**Files:**

- Create: `packages/web/src/lib/skills.ts`
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 6.1：写客户端**

Create `packages/web/src/lib/skills.ts`：

```ts
import type { SkillDto, SkillDraftDto } from "@server-agent/shared";

interface ApiErrorBody { error: { code: string; message: string } }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init.headers }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = body as ApiErrorBody;
    throw new Error(error.error?.message ?? "请求失败");
  }
  return body as T;
}

export interface SkillInput {
  title: string;
  description?: string;
  systemPrompt: string;
  defaultProvider?: string;
  defaultModel?: string;
  isPublic?: boolean;
}

export function listSkills() {
  return request<{ skills: SkillDto[] }>("/api/skills");
}
export function createSkill(input: SkillInput) {
  return request<{ skill: SkillDto }>("/api/skills", { method: "POST", body: JSON.stringify(input) });
}
export function updateSkill(id: number, patch: Partial<SkillInput>) {
  return request<{ skill: SkillDto }>(`/api/skills/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}
export function deleteSkill(id: number) {
  return request<{ ok: true }>(`/api/skills/${id}`, { method: "DELETE" });
}
export function extractSkillFromConversation(conversationId: string) {
  return request<{ draft: SkillDraftDto }>(`/api/conversations/${conversationId}/extract-skill`, { method: "POST" });
}
```

- [ ] **Step 6.2：api.ts 加 skillId**

Modify `packages/web/src/lib/api.ts`：

- 把 `ConversationDto` 加 `skillId: number | null`
- 把 `createConversation` 入参的类型从 `{ provider; model; systemPrompt? }` 加上 `skillId?: number`，并把它放进 `JSON.stringify(input)`

- [ ] **Step 6.3：build web 验证**

```bash
npm -w @server-agent/shared run build
npm -w @server-agent/web run typecheck
```

Expected：无错误。

- [ ] **Step 6.4：commit**

```bash
git add packages/web/src/lib
git commit -m "feat(web): add skills api client"
```

---

## Task 7：前端 — Sidebar Skills tab

**Files:**

- Create: `packages/web/src/routes/chat/SkillsPanel.tsx`, `packages/web/src/routes/chat/SkillItem.tsx`
- Modify: `packages/web/src/routes/chat/Sidebar.tsx`, `packages/web/src/routes/chat/index.tsx`

- [ ] **Step 7.1：写 SkillItem**

Create `packages/web/src/routes/chat/SkillItem.tsx`：

```tsx
import { Globe, Lock, MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { SkillDto } from "@server-agent/shared";
import { Button } from "../../components/ui/button.js";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../../components/ui/dropdown-menu.js";

interface Props {
  skill: SkillDto;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePublic: () => void;
}

export function SkillItem({ skill, onUse, onEdit, onDelete, onTogglePublic }: Props) {
  return (
    <div className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-800">
      <button className="flex-1 truncate text-left text-sm" onClick={onUse} title={skill.description || skill.title}>
        <span className="mr-1">{skill.isPublic ? <Globe className="inline h-3 w-3" /> : <Lock className="inline h-3 w-3" />}</span>
        {skill.title}
        {!skill.isOwn && <span className="ml-1 text-xs text-zinc-500">@{skill.authorUsername}</span>}
      </button>
      {skill.isOwn && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100">
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-3 w-3" /> 编辑</DropdownMenuItem>
            <DropdownMenuItem onClick={onTogglePublic}>{skill.isPublic ? "设为私有" : "公开发布"}</DropdownMenuItem>
            <DropdownMenuItem className="text-red-400" onClick={onDelete}><Trash2 className="mr-2 h-3 w-3" /> 删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
```

> 如果 `dropdown-menu.tsx` 现有导出名称不同，按现有用法对齐 — 先 `grep -n "export" packages/web/src/components/ui/dropdown-menu.tsx`。

- [ ] **Step 7.2：写 SkillsPanel**

Create `packages/web/src/routes/chat/SkillsPanel.tsx`：

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SkillDto } from "@server-agent/shared";
import { deleteSkill, listSkills, updateSkill } from "../../lib/skills.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { SkillItem } from "./SkillItem.js";

interface Props {
  onUseSkill: (skill: SkillDto) => void;
  onEditSkill: (skill: SkillDto) => void;
}

export function SkillsPanel({ onUseSkill, onEditSkill }: Props) {
  const qc = useQueryClient();
  const skillsQuery = useQuery({ queryKey: ["skills"], queryFn: listSkills });

  const togglePublic = useMutation({
    mutationFn: ({ skill }: { skill: SkillDto }) => updateSkill(skill.id, { isPublic: !skill.isPublic }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
    onError: () => toast.error("操作失败")
  });

  const removeSkill = useMutation({
    mutationFn: (id: number) => deleteSkill(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] })
  });

  if (skillsQuery.isLoading) {
    return <div className="space-y-2 px-1"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>;
  }
  const skills = skillsQuery.data?.skills ?? [];
  if (skills.length === 0) {
    return <p className="px-2 py-4 text-sm text-zinc-500">还没有 Skill。在对话里点「保存为 Skill」试试。</p>;
  }
  return (
    <div className="space-y-1 px-1">
      {skills.map((skill) => (
        <SkillItem
          key={skill.id}
          skill={skill}
          onUse={() => onUseSkill(skill)}
          onEdit={() => onEditSkill(skill)}
          onDelete={() => {
            if (window.confirm(`确认删除 "${skill.title}"？`)) removeSkill.mutate(skill.id);
          }}
          onTogglePublic={() => togglePublic.mutate({ skill })}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 7.3：Sidebar 加 tab 切换**

Modify `packages/web/src/routes/chat/Sidebar.tsx`：把单一 conversations 列表换成 `[tab, setTab]` 状态（默认 `"chats"`），上方加两个 tab 按钮，下方根据 tab 渲染 conversation 列表 / `<SkillsPanel onUseSkill={...} onEditSkill={...} />`。signature 加 `onUseSkill` `onEditSkill` 两个 prop。

```tsx
// 顶部 import
import { useState } from "react";
import type { SkillDto } from "@server-agent/shared";
import { SkillsPanel } from "./SkillsPanel.js";

// props 加：
// onUseSkill: (skill: SkillDto) => void;
// onEditSkill: (skill: SkillDto) => void;

// 在 return 里替换原来的"会话列表区块"：
const [tab, setTab] = useState<"chats" | "skills">("chats");
// ...
<div className="flex gap-1 px-3 pb-2">
  <Button variant={tab === "chats" ? "default" : "ghost"} size="sm" onClick={() => setTab("chats")}>会话</Button>
  <Button variant={tab === "skills" ? "default" : "ghost"} size="sm" onClick={() => setTab("skills")}>Skills</Button>
</div>
{tab === "chats" ? (
  // 原来的 conversation list
) : (
  <SkillsPanel onUseSkill={onUseSkill} onEditSkill={onEditSkill} />
)}
```

- [ ] **Step 7.4：ChatPage 串起来**

Modify `packages/web/src/routes/chat/index.tsx`：

```tsx
const [editSkill, setEditSkill] = useState<SkillDto | null>(null);
const handleUseSkill = (skill: SkillDto) => {
  setDialogOpen(true);
  setSkillForNew(skill);
};
```

`<Sidebar ... onUseSkill={handleUseSkill} onEditSkill={setEditSkill} />`。

- [ ] **Step 7.5：build + smoke**

```bash
npm -w @server-agent/web run typecheck
```

Expected：无错误。

- [ ] **Step 7.6：commit**

```bash
git add packages/web/src/routes/chat/Sidebar.tsx packages/web/src/routes/chat/SkillsPanel.tsx packages/web/src/routes/chat/SkillItem.tsx packages/web/src/routes/chat/index.tsx
git commit -m "feat(web): add Skills tab in sidebar"
```

---

## Task 8：「保存为 Skill」对话框

**Files:**

- Create: `packages/web/src/routes/chat/SaveSkillDialog.tsx`
- Modify: `packages/web/src/routes/chat/Composer.tsx`, `packages/web/src/routes/chat/index.tsx`

- [ ] **Step 8.1：写对话框**

Create `packages/web/src/routes/chat/SaveSkillDialog.tsx`：

```tsx
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog.js";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";

interface Props {
  open: boolean;
  draft: { title: string; systemPrompt: string } | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { title: string; systemPrompt: string; description: string; isPublic: boolean }) => void;
  isSubmitting: boolean;
}

export function SaveSkillDialog({ open, draft, onOpenChange, onSubmit, isSubmitting }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  useEffect(() => {
    if (open && draft) {
      setTitle(draft.title);
      setSystemPrompt(draft.systemPrompt);
      setDescription("");
      setIsPublic(false);
    }
  }, [open, draft]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>保存为 Skill</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm">标题</label>
            <input className="w-full rounded bg-zinc-800 p-2 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </div>
          <div>
            <label className="text-sm">描述（可选，280 字内）</label>
            <input className="w-full rounded bg-zinc-800 p-2 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} />
          </div>
          <div>
            <label className="text-sm">System Prompt</label>
            <Textarea rows={10} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> 公开发布（其他用户可见并复用）
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => onSubmit({ title, description, systemPrompt, isPublic })} disabled={isSubmitting || !title.trim() || !systemPrompt.trim()}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 8.2：Composer 加按钮**

Modify `packages/web/src/routes/chat/Composer.tsx`：在 `onSend` / `onStop` 同行加 `onSaveSkill` 按钮（只有 `activeId && !isStreaming` 时显示）。`Composer` 接收 `onSaveSkill?: () => void` prop，按钮放在发送按钮左边：

```tsx
{onSaveSkill && (
  <Button variant="ghost" size="sm" onClick={onSaveSkill}>保存为 Skill</Button>
)}
```

- [ ] **Step 8.3：ChatPage 串起来**

Modify `packages/web/src/routes/chat/index.tsx`：

```tsx
import { extractSkillFromConversation, createSkill } from "../../lib/skills.js";
import { SaveSkillDialog } from "./SaveSkillDialog.js";

const [saveSkillOpen, setSaveSkillOpen] = useState(false);
const [skillDraft, setSkillDraft] = useState<{ title: string; systemPrompt: string } | null>(null);

const openSaveSkill = async () => {
  if (!activeId) return;
  try {
    const { draft } = await extractSkillFromConversation(activeId);
    setSkillDraft(draft);
    setSaveSkillOpen(true);
  } catch {
    toast.error("无法提取 skill 草稿");
  }
};

const saveSkillMutation = useMutation({
  mutationFn: createSkill,
  onSuccess: () => {
    toast.success("Skill 已保存");
    setSaveSkillOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["skills"] });
  },
  onError: () => toast.error("保存失败")
});
```

`<Composer ... onSaveSkill={activeId ? openSaveSkill : undefined} />`，并在 dialog 区块下方挂：

```tsx
<SaveSkillDialog
  open={saveSkillOpen}
  draft={skillDraft}
  onOpenChange={setSaveSkillOpen}
  isSubmitting={saveSkillMutation.isPending}
  onSubmit={(input) => saveSkillMutation.mutate(input)}
/>
```

- [ ] **Step 8.4：typecheck**

```bash
npm -w @server-agent/web run typecheck
```

Expected：通过。

- [ ] **Step 8.5：commit**

```bash
git add packages/web/src/routes/chat/SaveSkillDialog.tsx packages/web/src/routes/chat/Composer.tsx packages/web/src/routes/chat/index.tsx
git commit -m "feat(web): add 保存为 Skill dialog with conversation extract"
```

---

## Task 9：选 Skill 新建会话

**Files:**

- Modify: `packages/web/src/routes/chat/NewConversationDialog.tsx`, `packages/web/src/routes/chat/index.tsx`

- [ ] **Step 9.1：NewConversationDialog 接受 skill prefill**

Modify `packages/web/src/routes/chat/NewConversationDialog.tsx`：

- props 加 `skill?: { id: number; systemPrompt: string; defaultProvider: string | null; defaultModel: string | null; title: string } | null`
- `useEffect` 在 `skill` 变化时把 `systemPrompt` 预填到 textarea；如果 skill 有 `defaultProvider/defaultModel` 也 prefill
- 提交时把 `skillId: skill?.id` 一并传到 onCreate

- [ ] **Step 9.2：ChatPage 维护 skillForNew 状态并接到 mutation**

Modify `packages/web/src/routes/chat/index.tsx`：

```tsx
const [skillForNew, setSkillForNew] = useState<SkillDto | null>(null);

const onCreate = (input: { provider: string; model: string; systemPrompt?: string; skillId?: number }) => {
  createMutation.mutate(input as { provider: ProviderId; model: string; systemPrompt?: string; skillId?: number });
  setSkillForNew(null);
};
```

`<NewConversationDialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setSkillForNew(null); }} skill={skillForNew} onCreate={onCreate} />`。

- [ ] **Step 9.3：typecheck + 跑一次完整 build**

```bash
npm run typecheck
npm test
npm run build
```

Expected：全过。

- [ ] **Step 9.4：commit**

```bash
git add packages/web/src/routes/chat/NewConversationDialog.tsx packages/web/src/routes/chat/index.tsx
git commit -m "feat(web): create conversation from selected skill"
```

---

## Task 10：完整 lint / typecheck / test / build + 集成 smoke

**Files:** —

- [ ] **Step 10.1：四件套全绿**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected：全过。如果 lint 报 unused、`any`、empty interface 等，按现有 commit `b76694d` 风格修。

- [ ] **Step 10.2：本地 smoke**

```bash
DB_PATH=/tmp/phase3-smoke.db npm -w @server-agent/server run db:migrate
SESSION_COOKIE_SECRET=12345678901234567890123456789012 DB_PATH=/tmp/phase3-smoke.db npm -w @server-agent/server start &
SERVER_PID=$!
sleep 2
curl -s http://127.0.0.1:8080/api/health
kill $SERVER_PID
```

Expected：`{"status":"ok"}`。

- [ ] **Step 10.3：commit lint 修复（如有）**

```bash
git add -A
git commit -m "chore: fix lint after phase 3"
```

跳过此步如果上一步无改动。

---

## Task 11：上线 + 验收

**Files:** —

- [ ] **Step 11.1：开 PR**

```bash
git push -u origin <branch>
gh pr create --title "feat(phase 3): skills pipeline" --body "$(cat <<'EOF'
## Summary
- 新增 skills 表 + conversations.skill_id（migration 0002）
- 5 个 REST 路由：CRUD + extract-skill
- 前端 sidebar Skills tab + 「保存为 Skill」modal + 新建会话时 skill prefill

## Test plan
- [x] repo unit
- [x] route unit
- [x] lint/typecheck/test/build
- [ ] 部署后手测：保存 / 选用 / 删除 / 公开切换 / 跨用户公开可见
EOF
)"
```

- [ ] **Step 11.2：merge 后等部署**

GH Actions 自动跑 deploy-agent.sh（参考 AGENTS.md §3）。等绿后：

```bash
curl https://aicoolyun.vip/api/health
ssh root@43.108.21.46 'journalctl -u server-agent -n 100 --no-pager' | tail -50
```

- [ ] **Step 11.3：浏览器手测**

1. 登录 → 创建会话 → 跟模型聊一段 → 点「保存为 Skill」→ 标题已预填、prompt 已拼接 → 确认保存（私有）
2. sidebar → Skills tab → 看到刚存的 skill
3. 点 skill → NewConversationDialog 弹出，systemPrompt 预填 → 选 provider/model → 创建 → 新会话发一条消息，应有响应
4. 切公开 → 用户 B 登录 → Skills tab 看到 A 的公开 skill（带 @alice 标记）
5. 用户 B 不能编辑/删除 A 的 skill（只看不到 menu）
6. A 软删此 skill → Skills tab 不再显示；用户 B 已存在的会话仍能继续对话（用 systemPrompt 快照）

- [ ] **Step 11.4：把坑写进 AGENTS.md §6**

把过程中发现的细节加到 `AGENTS.md`：例如「skill 软删后 conversation.system_prompt 用快照不 join」「`is_public` integer 0/1 不要写成 boolean」之类。Push 即可。

```bash
git add AGENTS.md README.md
git commit -m "docs: phase 3 done, sync README and AGENTS"
git push
```

- [ ] **Step 11.5：roadmap → done**

Modify `docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md` §5：把 Phase 3 状态 `next` → `done`，commit + push。

---

## 收尾验收 checklist（对照 spec §1.5）

- [ ] lint / typecheck / test / build 全绿
- [ ] 用户 A 创建私有 skill，用户 B 列表里看不到（Step 11.3 #4 验证）
- [ ] 用户 A 改 public，用户 B 看到、能基于其创建新会话（Step 11.3 #4-#5）
- [ ] skill 软删后 sidebar 不再列；旧会话不报错（Step 11.3 #6）
- [ ] 从 conversation 提取 skill：draft 是预期拼接结果（Step 11.3 #1 + Step 5.1 单测）
- [ ] 真实 aiwoo claude 跑一次 skill 注入会话（Step 11.3 #3）
- [ ] 部署生产 + 浏览器手测三个动作（保存/选用/删除）— Step 11.3
- [ ] 关键坑写进 AGENTS.md §6 — Step 11.4
