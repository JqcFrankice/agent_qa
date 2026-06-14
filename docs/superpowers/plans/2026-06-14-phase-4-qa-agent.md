# Phase 4 — QA-AGENT 模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 /chat 用户点内置 QA preset → 弹动态表单填字段 → interpolate 后塞进 system prompt → LLM 输出结构化的 bug 复现 / 测试用例 / 回归 checklist。

**Architecture:** SQLite migration 0003 加 `skills.{input_schema, tags, slug}` 三列 + 占位 system 用户；shared zod 加 `SkillInputField` discriminated union（text/textarea/select）+ `tags` schema；server `SkillsRepository` 加 `upsertBySlug`，admin CLI 加 `preset import` 子命令；前端新增 `SkillFormDialog` 渲染表单 + 实时预览，interpolate 在前端做（最终 prompt 写进 `conversations.system_prompt` 快照保留 Phase 3 不变量）。0 新增路由。

**Tech Stack:** TypeScript / Fastify 4 / better-sqlite3 + Drizzle / React 18 + TanStack Query / Vite / Vitest / zod / commander（admin CLI）

**前置上下文：**

- Spec：[`docs/superpowers/specs/2026-06-14-phase-4-qa-agent-design.md`](../specs/2026-06-14-phase-4-qa-agent-design.md)
- 当前 Phase 3 状态：skills 表 + conversations.skill_id 在线，前端 Skills tab + SaveSkillDialog 工作
- 必读约束：[`AGENTS.md`](../../../AGENTS.md) §3 部署 / §6.1 build:shared 顺序 / §6.5 spec/plan 流程 / §6.8（开发阶段豁免，可直接 main）/ §6.9 schema 表声明顺序 / §6.10 WAL 模式
- D1-D5 决策已定，本 plan 不再讨论替代方案

---

## File Structure

**新建：**

- `packages/server/src/db/migrations/0003_qa_skills.sql` — INSERT system 用户 + skills 加 3 列 + slug partial unique index
- `packages/server/src/presets/qa-skills.json` — 3 条 QA preset 数据（slug / title / description / tags / inputSchema / systemPrompt）
- `packages/server/tests/unit/lib/interpolate.test.ts` —— 6 case 行为契约
- `packages/server/src/lib/interpolate.ts` —— 后端共用版（preset 验收测试用）
- `packages/web/src/lib/interpolate.ts` —— 前端 30 行 `interpolate(template, values)`
- `packages/web/src/lib/interpolate.test.ts` —— 同 6 case
- `packages/web/src/routes/chat/SkillFormDialog.tsx` —— 动态表单 + 实时预览

**修改：**

- `packages/server/src/db/schema.ts` — skills 加 inputSchema/tags/slug 列 + bySlug partial unique index
- `packages/server/src/db/repositories/skills.ts` — 加 `upsertBySlug` 方法
- `packages/server/src/routes/skills.ts` — POST/PATCH 接受 inputSchema/tags；toDto 加 inputSchema/tags/slug/isSystem
- `packages/server/src/routes/conversations.ts` — toDto 不动（systemPrompt 已在 Phase 3 接好快照）
- `packages/shared/src/schemas/skills.ts` — 加 `skillInputFieldSchema` / `skillTagsSchema` / `SkillDto` 字段扩展
- `scripts/admin-cli.ts` — 加 `preset import <json-file>` 子命令
- `packages/server/tests/unit/admin-cli.test.ts` — 加 preset import 单测
- `packages/server/tests/unit/repositories/skills.test.ts` — 加 upsertBySlug 单测
- `packages/server/tests/unit/routes/skills.test.ts` — 加 system preset PATCH/DELETE 自动 404 单测
- `packages/web/src/lib/api.ts` — `createConversation` 入参 typing 不变（systemPrompt 已支持）
- `packages/web/src/lib/skills.ts` — `SkillInput` 加 inputSchema/tags 可选字段
- `packages/web/src/routes/chat/NewConversationDialog.tsx` — 加 `presetPrompt?: string` prop + useEffect 优先级
- `packages/web/src/routes/chat/index.tsx` — state + handleUseSkill 改造 + handleFormContinue + 挂载 SkillFormDialog
- `packages/web/src/routes/chat/SkillsPanel.tsx` — 顶部 tag chip filter
- `packages/web/src/routes/chat/SkillItem.tsx` — `skill.isSystem` 时隐藏 dropdown menu

**关键设计取舍：**

- 后端 `interpolate.ts` 实际 Phase 4 用不到（前端做插值）；放后端只为单测共享。如不接受这点重复，可改为只前端版 + 把测试放前端 → **plan 选择放双份并各自 6 case 单测**，理由：未来 server-side 可能要在 import 时验证 preset 模板（CLI 里调一次 interpolate(systemPrompt, {}) 看占位符是否合法）。Phase 5+ 一致使用。
- preset slug 对应 1:1 system 用户 author。slug 是全局 unique key（partial index `WHERE slug IS NOT NULL`），不冲突 user 创建的 NULL slug 行。
- system 用户 `username='system' password_hash='!disabled'`：argon2 verify 自动失败，无需在 login 路由特判。
- `SkillFormDialog` 与 `NewConversationDialog` 链式触发（不嵌套）：保持职责单一 + 未来 SkillFormDialog 可独立复用（编辑 skill 预览 / 公开详情页）。
- 前端 chip filter 用 mutex（"全部" + 单个 active tag）。多 tag 组合留 Phase 5+。

---

## Task 1：DB schema + Migration 0003

**Files:**

- Create: `packages/server/src/db/migrations/0003_qa_skills.sql`
- Modify: `packages/server/src/db/schema.ts`

- [ ] **Step 1.1：写 migration SQL**

Create `packages/server/src/db/migrations/0003_qa_skills.sql`：

```sql
-- 1. system 占位作者（不可登录）
INSERT OR IGNORE INTO users (username, password_hash, default_provider)
VALUES ('system', '!disabled', NULL);

-- 2. skills 加 3 列（forward-only）
ALTER TABLE `skills` ADD COLUMN `input_schema` text;
ALTER TABLE `skills` ADD COLUMN `tags` text DEFAULT '[]' NOT NULL;
ALTER TABLE `skills` ADD COLUMN `slug` text;

-- 3. slug 唯一索引（仅 NOT NULL 行参与去重）
CREATE UNIQUE INDEX `idx_skills_slug` ON `skills` (`slug`) WHERE `slug` IS NOT NULL;
```

注：`!disabled` 不是合法 argon2 hash，login 路径 `verifyPassword` 自然 reject。INSERT OR IGNORE 让 migration 幂等（重跑不报错）。

- [ ] **Step 1.2：更新 Drizzle schema**

Modify `packages/server/src/db/schema.ts`：在 `skills` 表里加 3 个列，并加 partial unique index。

把 `skills` 表 `(t) => ({ ... })` 之前的列定义里追加：

```ts
inputSchema: text("input_schema"),
tags: text("tags").notNull().default("[]"),
slug: text("slug"),
```

把 indexes 对象加一项（注意 `uniqueIndex` 来自 drizzle-orm/sqlite-core，需 import）：

```ts
bySlug: uniqueIndex("idx_skills_slug").on(t.slug).where(sql`${t.slug} IS NOT NULL`)
```

如果 `uniqueIndex` 没在 imports，把它加进 `import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";`。

- [ ] **Step 1.3：跑 migration 验证**

```bash
rm -f /tmp/phase4-skill.db
DB_PATH=/tmp/phase4-skill.db npm -w @server-agent/server run db:migrate
sqlite3 /tmp/phase4-skill.db "PRAGMA table_info(skills);" | grep -E "input_schema|tags|slug"
sqlite3 /tmp/phase4-skill.db "SELECT id, username FROM users WHERE username='system';"
```

Expected：

```
12|input_schema|TEXT|0||0
13|tags|TEXT|1|'[]'|0
14|slug|TEXT|0||0
1|system           (id 视先后顺序)
```

- [ ] **Step 1.4：跑 typecheck + lint**

```bash
npm -w @server-agent/server run typecheck
npm run lint
```

Expected：全过。

- [ ] **Step 1.5：commit**

```bash
git add packages/server/src/db/migrations/0003_qa_skills.sql packages/server/src/db/schema.ts
git commit -m "feat(server): add skills.{input_schema,tags,slug} + system user (phase 4 prep)"
```

---

## Task 2：shared zod schemas + DTO 扩展

**Files:**

- Modify: `packages/shared/src/schemas/skills.ts`

- [ ] **Step 2.1：加 SkillInputField + SkillTags zod**

Modify `packages/shared/src/schemas/skills.ts`：在文件顶部 imports 后追加（注意 zod 已 import）。在 `createSkillRequestSchema` 之前加：

```ts
const baseField = {
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "name must be lowercase identifier"),
  label: z.string().trim().min(1).max(80),
  required: z.boolean().optional()
};

export const skillInputFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...baseField, type: z.literal("text"), placeholder: z.string().max(200).optional() }),
  z.object({ ...baseField, type: z.literal("textarea"), placeholder: z.string().max(200).optional() }),
  z.object({
    ...baseField,
    type: z.literal("select"),
    options: z.array(z.object({
      value: z.string().min(1).max(80),
      label: z.string().trim().min(1).max(80)
    })).min(1).max(50)
  })
]);

export const skillInputSchemaSchema = z.array(skillInputFieldSchema).max(20);

export const skillTagsSchema = z.array(
  z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "tag must be lowercase + hyphen, 1-32 chars")
).max(8);

export type SkillInputField = z.infer<typeof skillInputFieldSchema>;
```

- [ ] **Step 2.2：扩展 createSkillRequestSchema 与 updateSkillRequestSchema**

把 `createSkillRequestSchema` 改成：

```ts
export const createSkillRequestSchema = z.object({
  title: skillTitleSchema,
  description: skillDescriptionSchema.optional(),
  systemPrompt: skillSystemPromptSchema,
  defaultProvider: providerIdSchema.optional(),
  defaultModel: z.string().min(1).optional(),
  isPublic: z.boolean().optional(),
  inputSchema: skillInputSchemaSchema.nullable().optional(),
  tags: skillTagsSchema.optional()
});
```

把 `updateSkillRequestSchema` 改成（保留原 refine）：

```ts
export const updateSkillRequestSchema = z.object({
  title: skillTitleSchema.optional(),
  description: skillDescriptionSchema.optional(),
  systemPrompt: skillSystemPromptSchema.optional(),
  defaultProvider: providerIdSchema.nullable().optional(),
  defaultModel: z.string().min(1).nullable().optional(),
  isPublic: z.boolean().optional(),
  inputSchema: skillInputSchemaSchema.nullable().optional(),
  tags: skillTagsSchema.optional()
}).refine((value) => Object.keys(value).length > 0, { message: "no fields to update" });
```

- [ ] **Step 2.3：扩展 SkillDto interface**

把 `SkillDto` interface 改成：

```ts
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
  inputSchema: SkillInputField[] | null;
  tags: string[];
  slug: string | null;
  isSystem: boolean;
}
```

- [ ] **Step 2.4：build shared 验证**

```bash
npm -w @server-agent/shared run build
npm -w @server-agent/server run typecheck
npm -w @server-agent/web run typecheck
```

Expected：所有 typecheck 全过。注意 server `toDto` 已经返回的字段（id/title/.../isOwn）跟扩展后 SkillDto 现在多 4 个字段，**这步会 fail**（toDto 返回的对象不满足新 SkillDto）—— **这是预期**，Task 5 会修。本 task 不依赖 server typecheck pass。

如果只想本步绿，可以临时给 SkillDto 4 个新字段加 `?:` 改成可选 —— **不要这么做**，spec 要求强类型。继续推进 Task 5。

实际验证：`npm -w @server-agent/shared run build` 必须通过；server typecheck 暂可红。

- [ ] **Step 2.5：commit**

```bash
git add packages/shared/src/schemas/skills.ts
git commit -m "feat(shared): add SkillInputField/tags schemas and SkillDto extension"
```

---

## Task 3：SkillsRepository.upsertBySlug（TDD）

**Files:**

- Modify: `packages/server/src/db/repositories/skills.ts`
- Test: `packages/server/tests/unit/repositories/skills.test.ts`

- [ ] **Step 3.1：写失败测试**

追加到 `packages/server/tests/unit/repositories/skills.test.ts`（在 describe block 内尾部）：

```ts
it("upsertBySlug inserts new skill on first call", async () => {
  const db = createTestDb();
  const repo = new SkillsRepository(db);
  const author = await user(db, "system");
  const row = await repo.upsertBySlug(author.id, {
    slug: "qa-bug-repro",
    title: "Bug 复现",
    description: "desc",
    systemPrompt: "You are QA.",
    inputSchema: [{ name: "bug_id", label: "Bug ID", type: "text" }],
    tags: ["qa"],
    isPublic: true
  });
  expect(row.slug).toBe("qa-bug-repro");
  expect(row.title).toBe("Bug 复现");
  expect(row.isPublic).toBe(1);
  expect(row.publishedAt).toBeInstanceOf(Date);
  expect(row.tags).toBe('[{"qa"}]'.replace('{"qa"}', '"qa"'));  // SQLite 存 JSON string
});

it("upsertBySlug updates existing skill on second call with same slug", async () => {
  const db = createTestDb();
  const repo = new SkillsRepository(db);
  const author = await user(db, "system");
  const first = await repo.upsertBySlug(author.id, {
    slug: "qa-bug-repro", title: "v1", description: "", systemPrompt: "p1"
  });
  const second = await repo.upsertBySlug(author.id, {
    slug: "qa-bug-repro", title: "v2", description: "new", systemPrompt: "p2"
  });
  expect(second.id).toBe(first.id);
  expect(second.title).toBe("v2");
  expect(second.systemPrompt).toBe("p2");
});

it("upsertBySlug rejects different author for same slug", async () => {
  const db = createTestDb();
  const repo = new SkillsRepository(db);
  const sys = await user(db, "system");
  const alice = await user(db, "alice");
  await repo.upsertBySlug(sys.id, { slug: "shared", title: "t", description: "", systemPrompt: "p" });
  await expect(repo.upsertBySlug(alice.id, { slug: "shared", title: "t2", description: "", systemPrompt: "p2" }))
    .rejects.toThrow();
});
```

注意：第一个测试里 `expect(row.tags).toBe(...)` 的写法看起来奇怪 —— 实际上 drizzle `text` mode 直接读出 `string`（JSON 没自动 parse）。改成更直观的：

```ts
expect(JSON.parse(row.tags)).toEqual(["qa"]);
```

把 first 测试的 last 行改成上面的形式。

- [ ] **Step 3.2：跑测试确认失败**

```bash
npm -w @server-agent/server test -- skills.test
```

Expected：3 个新 case fail（method not found），原 5 case 仍 pass。

- [ ] **Step 3.3：实现 upsertBySlug**

Modify `packages/server/src/db/repositories/skills.ts`：在 import 区追加 `SkillInputField`：

```ts
import type { SkillInputField } from "@server-agent/shared";
```

加 `UpsertSkillInput` interface（在文件顶部 input interface 区）：

```ts
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
}
```

在 class `SkillsRepository` 内 `softDelete` 之后追加：

```ts
async upsertBySlug(authorUserId: number, input: UpsertSkillInput) {
  const now = new Date();
  const [existing] = await this.db.select().from(skills).where(eq(skills.slug, input.slug)).limit(1);
  if (existing && existing.authorUserId !== authorUserId) {
    throw new Error(`slug ${input.slug} already owned by user ${existing.authorUserId}`);
  }
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
    updatedAt: now
  };
  if (existing) {
    const [row] = await this.db.update(skills).set(values)
      .where(eq(skills.id, existing.id)).returning();
    return row;
  }
  const [row] = await this.db.insert(skills).values(values).returning();
  return row;
}
```

- [ ] **Step 3.4：跑测试确认通过**

```bash
npm -w @server-agent/server test -- skills.test
```

Expected：8 个 case 全过（5 原 + 3 新）。

- [ ] **Step 3.5：commit**

```bash
git add packages/server/src/db/repositories/skills.ts packages/server/tests/unit/repositories/skills.test.ts
git commit -m "feat(server): SkillsRepository.upsertBySlug for preset import"
```

---

## Task 4：interpolate util（前端 + 后端共用，TDD 6 case）

**Files:**

- Create: `packages/server/src/lib/interpolate.ts`
- Create: `packages/server/tests/unit/lib/interpolate.test.ts`
- Create: `packages/web/src/lib/interpolate.ts`
- Create: `packages/web/src/lib/interpolate.test.ts`

- [ ] **Step 4.1：写后端 lib 失败测试**

Create `packages/server/tests/unit/lib/interpolate.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { interpolate } from "../../../src/lib/interpolate.js";

describe("interpolate", () => {
  it("replaces single placeholder", () => {
    expect(interpolate("hello {{name}}", { name: "world" })).toBe("hello world");
  });

  it("replaces multiple placeholders", () => {
    expect(interpolate("{{a}} and {{b}}", { a: "x", b: "y" })).toBe("x and y");
  });

  it("preserves placeholder when value is missing", () => {
    expect(interpolate("hello {{name}}", {})).toBe("hello {{name}}");
  });

  it("supports content before and after placeholders", () => {
    expect(interpolate("prefix {{x}} middle {{y}} suffix", { x: "1", y: "2" }))
      .toBe("prefix 1 middle 2 suffix");
  });

  it("replaces same placeholder multiple times", () => {
    expect(interpolate("{{n}}-{{n}}-{{n}}", { n: "k" })).toBe("k-k-k");
  });

  it("does not match other syntaxes", () => {
    expect(interpolate("{x} ${y} {{ z }}", { x: "1", y: "2", z: "3" }))
      .toBe("{x} ${y} {{ z }}");
  });
});
```

注意目录：`packages/server/tests/unit/lib/` 之前不存在，第一次创文件会自动建。

- [ ] **Step 4.2：跑测试确认失败**

```bash
mkdir -p packages/server/src/lib
npm -w @server-agent/server test -- interpolate
```

Expected：fail（module not found）。

- [ ] **Step 4.3：实现后端 interpolate**

Create `packages/server/src/lib/interpolate.ts`：

```ts
/**
 * 插值模板：把 `{{var}}` 替换为 values[var]，未提供的占位符保留原样。
 *
 * 不匹配 `{var}`、`${var}`、`{{ var }}`（带空格）等其他语法。
 */
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}
```

- [ ] **Step 4.4：跑测试确认通过**

```bash
npm -w @server-agent/server test -- interpolate
```

Expected：6 case 全过。

- [ ] **Step 4.5：写前端镜像测试 + 实现**

Create `packages/web/src/lib/interpolate.ts`（与后端字节相同）：

```ts
/**
 * 插值模板：把 `{{var}}` 替换为 values[var]，未提供的占位符保留原样。
 *
 * 不匹配 `{var}`、`${var}`、`{{ var }}`（带空格）等其他语法。
 */
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}
```

Create `packages/web/src/lib/interpolate.test.ts`（与后端测试相同，仅 import 路径改）：

```ts
import { describe, expect, it } from "vitest";
import { interpolate } from "./interpolate.js";

describe("interpolate", () => {
  it("replaces single placeholder", () => {
    expect(interpolate("hello {{name}}", { name: "world" })).toBe("hello world");
  });
  it("replaces multiple placeholders", () => {
    expect(interpolate("{{a}} and {{b}}", { a: "x", b: "y" })).toBe("x and y");
  });
  it("preserves placeholder when value is missing", () => {
    expect(interpolate("hello {{name}}", {})).toBe("hello {{name}}");
  });
  it("supports content before and after placeholders", () => {
    expect(interpolate("prefix {{x}} middle {{y}} suffix", { x: "1", y: "2" }))
      .toBe("prefix 1 middle 2 suffix");
  });
  it("replaces same placeholder multiple times", () => {
    expect(interpolate("{{n}}-{{n}}-{{n}}", { n: "k" })).toBe("k-k-k");
  });
  it("does not match other syntaxes", () => {
    expect(interpolate("{x} ${y} {{ z }}", { x: "1", y: "2", z: "3" }))
      .toBe("{x} ${y} {{ z }}");
  });
});
```

跑前端测试：

```bash
npm -w @server-agent/web test -- interpolate
```

Expected：6 case 全过。

- [ ] **Step 4.6：commit**

```bash
git add packages/server/src/lib/interpolate.ts packages/server/tests/unit/lib/interpolate.test.ts packages/web/src/lib/interpolate.ts packages/web/src/lib/interpolate.test.ts
git commit -m "feat: add interpolate({{var}}) util with 6 case spec (frontend + backend)"
```

---

## Task 5：server skills route 接 inputSchema/tags + DTO 扩展

**Files:**

- Modify: `packages/server/src/routes/skills.ts`
- Test: `packages/server/tests/unit/routes/skills.test.ts`

- [ ] **Step 5.1：写测试 — system preset 跨用户 PATCH 仍 404**

追加到 `packages/server/tests/unit/routes/skills.test.ts`（在 describe 内尾部）：

```ts
it("system preset created via upsertBySlug forbids any user PATCH", async () => {
  const db = createTestDb();
  const app = await buildApp({ db });

  // 直接通过 repo 制造一条 system preset
  const { UserRepository } = await import("../../../src/db/repositories/users.js");
  const { SkillsRepository } = await import("../../../src/db/repositories/skills.js");
  const sysUser = await new UserRepository(db).create("system", "!disabled");
  const skillsRepo = new SkillsRepository(db);
  const preset = await skillsRepo.upsertBySlug(sysUser.id, {
    slug: "qa-test", title: "Test Preset", description: "", systemPrompt: "p", isPublic: true
  });

  const alice = await buildLoggedInApp("alice");
  // 注：buildLoggedInApp 默认 db 不同，此 case 需要在同一 db 注册 alice
  // 改方案：用同 db 直接注册并登录

  await alice.app.close();
  await app.close();

  // 上面 buildLoggedInApp 会创建独立 db，无法直接复用 — 重写这个 case：
});
```

注意上面的注释 — `buildLoggedInApp` helper 当前实现每次新建独立 db，跨 db 测试不便。**重写 case 使用现有 helper 在同 db 内注册**：

```ts
it("system preset rejects non-author PATCH and DELETE", async () => {
  // buildLoggedInApp 会创建 db 并注册 alice
  const { app, db, cookie } = await buildLoggedInApp("alice");
  // 在同一 db 里手动制造 system preset
  const { UserRepository } = await import("../../../src/db/repositories/users.js");
  const { SkillsRepository } = await import("../../../src/db/repositories/skills.js");
  const sysUser = await new UserRepository(db).create("system", "!disabled");
  const skillsRepo = new SkillsRepository(db);
  const preset = await skillsRepo.upsertBySlug(sysUser.id, {
    slug: "qa-test", title: "Test Preset", description: "", systemPrompt: "p", isPublic: true
  });

  // alice 看得到（GET /skills 含 isOwn=false, isSystem=true）
  const list = await app.inject({ method: "GET", url: "/api/skills", headers: { cookie } });
  expect(list.statusCode).toBe(200);
  const found = list.json().skills.find((s: { id: number }) => s.id === preset.id);
  expect(found).toBeDefined();
  expect(found.isOwn).toBe(false);
  expect(found.isSystem).toBe(true);
  expect(found.tags).toEqual([]);
  expect(found.inputSchema).toBeNull();
  expect(found.slug).toBe("qa-test");

  // alice PATCH → 404
  const patch = await app.inject({
    method: "PATCH", url: `/api/skills/${preset.id}`, headers: { cookie },
    payload: { title: "hijack" }
  });
  expect(patch.statusCode).toBe(404);

  // alice DELETE → 404
  const del = await app.inject({
    method: "DELETE", url: `/api/skills/${preset.id}`, headers: { cookie }
  });
  expect(del.statusCode).toBe(404);

  await app.close();
});

it("POST /api/skills accepts inputSchema and tags", async () => {
  const { app, cookie } = await buildLoggedInApp("alice");
  const res = await app.inject({
    method: "POST", url: "/api/skills", headers: { cookie },
    payload: {
      title: "Custom",
      systemPrompt: "Hello {{name}}",
      inputSchema: [{ name: "name", label: "Your name", type: "text", required: true }],
      tags: ["custom"]
    }
  });
  expect(res.statusCode).toBe(201);
  const skill = res.json().skill;
  expect(skill.inputSchema).toEqual([{ name: "name", label: "Your name", type: "text", required: true }]);
  expect(skill.tags).toEqual(["custom"]);
  expect(skill.slug).toBeNull();
  expect(skill.isSystem).toBe(false);
  await app.close();
});
```

- [ ] **Step 5.2：跑测试确认失败**

```bash
npm -w @server-agent/server test -- skills
```

Expected：2 个新 case fail（DTO 字段不存在 / `isSystem` undefined）。

- [ ] **Step 5.3：扩展 toDto + 路由 handler**

Modify `packages/server/src/routes/skills.ts`：

把 `SkillRow` interface 加 3 个字段（保持其它字段不变）：

```ts
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
  inputSchema: string | null;   // JSON string
  tags: string;                 // JSON string
  slug: string | null;
}
```

加常量（在 imports 之后）：

```ts
const SYSTEM_USERNAME = "system";
```

把 `toDto` 改成（接受 `authorUsername` 字符串）：

```ts
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
    isOwn: row.authorUserId === currentUserId,
    inputSchema: row.inputSchema ? JSON.parse(row.inputSchema) : null,
    tags: JSON.parse(row.tags),
    slug: row.slug,
    isSystem: authorUsername === SYSTEM_USERNAME
  };
}
```

POST handler — 把 `repo.create(...)` 调用扩展：

把现有：

```ts
let row = await repo.create(user.id, {
  title: parsed.data.title,
  description: parsed.data.description,
  systemPrompt: parsed.data.systemPrompt,
  defaultProvider: parsed.data.defaultProvider ?? null,
  defaultModel: parsed.data.defaultModel ?? null
});
```

改成：

```ts
let row = await repo.create(user.id, {
  title: parsed.data.title,
  description: parsed.data.description,
  systemPrompt: parsed.data.systemPrompt,
  defaultProvider: parsed.data.defaultProvider ?? null,
  defaultModel: parsed.data.defaultModel ?? null,
  inputSchema: parsed.data.inputSchema ?? null,
  tags: parsed.data.tags ?? []
});
```

PATCH handler — 把现有 `rest` 透传给 `repo.update`，但需要 `inputSchema` / `tags` 字段也在 `update` 里被序列化。看下 SkillsRepository.update 的当前实现 — 它直接 `set({ ...patch, updatedAt })`，drizzle 不会自动 stringify object/array。

**这意味着要给 SkillsRepository.create 和 update 也加 inputSchema/tags 处理**（Task 3 的 upsertBySlug 已经处理）。修补 Task 3 — 在 update 和 create 里加：

把 SkillsRepository.create 改成（在 Task 3 之外但同一文件）：

```ts
interface CreateSkillInput {
  title: string;
  description?: string;
  systemPrompt: string;
  defaultProvider?: string | null;
  defaultModel?: string | null;
  inputSchema?: SkillInputField[] | null;
  tags?: string[];
}

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
```

把 SkillsRepository.update 改成接受同样可选字段并序列化：

```ts
interface UpdateSkillInput {
  title?: string;
  description?: string;
  systemPrompt?: string;
  defaultProvider?: string | null;
  defaultModel?: string | null;
  inputSchema?: SkillInputField[] | null;
  tags?: string[];
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
  const result = await this.db.update(skills).set(setValues)
    .where(and(eq(skills.id, id), eq(skills.authorUserId, userId), isNull(skills.deletedAt)))
    .returning();
  return result[0] ?? null;
}
```

把 GET handler 里的 author lookup 部分扩展，因 `usersById` 可能不含 system 用户（如果 alice 看到 system preset）。当前实现 `users.findManyByIds(authorIds)` 会包含 system 用户 id（authorIds 自然集合），所以无需改。

最后改 `SkillsRepository.findById` / `findAvailableForUse` / `listAvailableTo` —— 这些方法返回的 row 已经含新字段（drizzle select 全部列），无需改。

- [ ] **Step 5.4：跑全套测试 + typecheck**

```bash
npm -w @server-agent/shared run build
npm -w @server-agent/server run typecheck
npm -w @server-agent/server test
```

Expected：所有用例（含 Task 3 + Task 5 新增）全过。

- [ ] **Step 5.5：commit**

```bash
git add packages/server/src/routes/skills.ts packages/server/src/db/repositories/skills.ts packages/server/tests/unit/routes/skills.test.ts
git commit -m "feat(server): skills route + repo handle inputSchema/tags/slug; toDto adds isSystem"
```

---

## Task 6：内置 QA preset JSON

**Files:**

- Create: `packages/server/src/presets/qa-skills.json`

- [ ] **Step 6.1：创建 preset 数据文件**

Create `packages/server/src/presets/qa-skills.json`：

```json
[
  {
    "slug": "qa-bug-repro",
    "title": "Bug 复现助手",
    "description": "把粗糙 bug 描述变成标准复现步骤 + 边界用例",
    "tags": ["qa"],
    "inputSchema": [
      {
        "name": "bug_summary",
        "label": "Bug 概述",
        "type": "textarea",
        "required": true,
        "placeholder": "用户点击发送按钮没反应"
      },
      {
        "name": "steps_known",
        "label": "已知操作步骤（可空）",
        "type": "textarea"
      },
      {
        "name": "expected_actual",
        "label": "期望 vs 实际",
        "type": "textarea",
        "required": true
      },
      {
        "name": "environment",
        "label": "环境（OS / 浏览器 / 版本）",
        "type": "text"
      },
      {
        "name": "severity",
        "label": "严重程度",
        "type": "select",
        "required": true,
        "options": [
          { "value": "P0", "label": "P0 阻塞" },
          { "value": "P1", "label": "P1 重要" },
          { "value": "P2", "label": "P2 一般" },
          { "value": "P3", "label": "P3 低" }
        ]
      }
    ],
    "systemPrompt": "你是一名资深 QA 工程师，擅长把粗糙的 bug 描述转成标准复现文档。\n\n# Bug 信息\n\n- 概述：{{bug_summary}}\n- 严重程度：{{severity}}\n- 环境：{{environment}}\n\n# 已知线索\n\n操作步骤（用户提供）：\n{{steps_known}}\n\n期望 vs 实际：\n{{expected_actual}}\n\n# 你的任务\n\n1. **标准复现步骤**：编号 1, 2, 3...，每步描述具体动作 + 期望响应。从已知步骤补全缺失的前置条件（登录态、数据准备、环境）。\n2. **关键观察点**：每步如果有可能影响结果的状态（缓存、cookie、并发），单独标注。\n3. **边界用例（≤5 条）**：列出 \"如果 X 也这样做会怎样\" 的变体。每条标注假设性影响（也复现 / 不复现 / 未知）。\n4. **优先验证项**：基于 severity 和现有信息，给出 3 条最值得先验证的猜想（顺序按 ROI）。\n\n输出格式：Markdown，分四节，使用上面的标题。如果某节信息不足，写 「需用户补充：xxx」。"
  },
  {
    "slug": "qa-test-cases",
    "title": "测试用例生成器",
    "description": "feature spec → 可执行测试用例表（Markdown）",
    "tags": ["qa"],
    "inputSchema": [
      {
        "name": "feature_spec",
        "label": "Feature 描述 / 需求文档（可粘贴）",
        "type": "textarea",
        "required": true
      },
      {
        "name": "coverage_focus",
        "label": "覆盖侧重",
        "type": "select",
        "required": true,
        "options": [
          { "value": "all", "label": "全部" },
          { "value": "functional", "label": "功能" },
          { "value": "boundary", "label": "边界" },
          { "value": "security", "label": "安全" },
          { "value": "performance", "label": "性能" }
        ]
      },
      {
        "name": "out_of_scope",
        "label": "不需要覆盖的部分（可空）",
        "type": "textarea"
      }
    ],
    "systemPrompt": "你是一名测试用例设计专家，给定 feature 描述，输出可执行的测试用例表。\n\n# Feature 描述\n\n{{feature_spec}}\n\n# 覆盖侧重\n\n{{coverage_focus}}\n\n# 不在范围\n\n{{out_of_scope}}\n\n# 你的任务\n\n输出 Markdown 表格，列：用例 ID | 模块 | 类别 | 前置条件 | 操作步骤 | 期望结果 | 优先级\n\n要求：\n- 用例 ID 格式 TC-001 起递增\n- 类别 ∈ {功能, 边界, 异常, 集成, 兼容性}（按 coverage_focus 取舍）\n- 优先级 P0 / P1 / P2 按风险与频率综合判断\n- 至少覆盖：1 个 happy path、2 个常见边界、1 个异常恢复\n- 跳过 \"不在范围\" 提到的内容\n- 每个用例的 \"操作步骤\" 用编号列表，**每步可独立执行验证**\n\n表格之后，单独列 「未覆盖但建议讨论」 的开放问题（≤3 条）。"
  },
  {
    "slug": "qa-regression-checklist",
    "title": "回归 checklist",
    "description": "改动概要 + 模块 → 该回归哪些路径",
    "tags": ["qa"],
    "inputSchema": [
      {
        "name": "change_summary",
        "label": "改动概要（commit message / PR 描述）",
        "type": "textarea",
        "required": true
      },
      {
        "name": "affected_modules",
        "label": "直接改动的模块 / 文件路径（逗号分隔）",
        "type": "text",
        "required": true
      },
      {
        "name": "release_window",
        "label": "发布窗口",
        "type": "select",
        "required": true,
        "options": [
          { "value": "hotfix", "label": "紧急 hotfix" },
          { "value": "scheduled", "label": "计划版本" },
          { "value": "major", "label": "大版本" }
        ]
      }
    ],
    "systemPrompt": "你是一名 release 测试负责人，要为本次改动出一份回归测试 checklist。\n\n# 改动概要\n\n{{change_summary}}\n\n# 直接改动模块\n\n{{affected_modules}}\n\n# 发布窗口\n\n{{release_window}}\n\n# 你的任务\n\n1. **直接受影响**：列出改动模块自身需要验证的核心路径（≤5 条）。\n2. **间接受影响**：基于「直接改动模块」推断可能受连带影响的上游 / 下游 / 同接口模块（≤8 条），每条说明 \"为什么可能受影响\"。\n3. **共用基础设施**：根据 release_window 决定是否纳入\n   - 紧急 hotfix：跳过\n   - 计划版本：登录、权限、核心 CRUD、订阅 / 计费（如适用）\n   - 大版本：全量加 性能、迁移脚本、回滚能力\n4. **回归优先级排序**：把上面三类合并成单一有序 checklist，每条标 P0 / P1 / P2 + 预估耗时档位（<5min / 5-30min / >30min）。\n\n输出 Markdown checklist，每项 `- [ ] [P0/30min] 模块 - 用例描述`。最后给一个总耗时估算区间。"
  }
]
```

- [ ] **Step 6.2：验证 JSON 合法**

```bash
node -e "JSON.parse(require('fs').readFileSync('packages/server/src/presets/qa-skills.json','utf8')); console.log('ok')"
```

Expected：`ok`。

- [ ] **Step 6.3：commit**

```bash
git add packages/server/src/presets/qa-skills.json
git commit -m "feat(server): add 3 QA preset prompts (bug-repro/test-cases/regression-checklist)"
```

---

## Task 7：admin CLI `preset import` 子命令（含单测）

**Files:**

- Modify: `scripts/admin-cli.ts`
- Test: `packages/server/tests/unit/admin-cli.test.ts`

- [ ] **Step 7.1：写失败测试**

追加到 `packages/server/tests/unit/admin-cli.test.ts` 的 describe block 内：

```ts
it("preset import: inserts on first run, updates on second run (idempotent)", async () => {
  const db = createTestDb();
  // 制造 system 用户
  const { UserRepository } = await import("../../src/db/repositories/users.js");
  await new UserRepository(db).create("system", "!disabled");

  // 临时 JSON 文件
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "preset-test-"));
  const file = join(dir, "qa.json");
  writeFileSync(file, JSON.stringify([
    { slug: "qa-x", title: "X v1", description: "", tags: ["qa"], systemPrompt: "p1" }
  ]));

  const r1 = await runAdminCli(["preset", "import", file], { db });
  expect(r1.exitCode).toBe(0);
  expect(r1.stdout).toMatch(/inserted: 1/);
  expect(r1.stdout).toMatch(/updated: 0/);

  // 改 prompt 重跑
  writeFileSync(file, JSON.stringify([
    { slug: "qa-x", title: "X v2", description: "", tags: ["qa"], systemPrompt: "p2" }
  ]));
  const r2 = await runAdminCli(["preset", "import", file], { db });
  expect(r2.exitCode).toBe(0);
  expect(r2.stdout).toMatch(/inserted: 0/);
  expect(r2.stdout).toMatch(/updated: 1/);

  // DB 校验
  const { SkillsRepository } = await import("../../src/db/repositories/skills.js");
  const repo = new SkillsRepository(db);
  const list = await repo.listAvailableTo(0);  // listAvailableTo 看到 public skill
  // 注：listAvailableTo 需 author 或 public，preset 默认 isPublic=true
  // 上面的 import 没传 --public，默认 false。改测试 — preset 应公开
  // 我们决定默认 --public=true，因此期望可见
  // 但 `listAvailableTo(0)` 用了 userId=0，不存在的 user，过滤为 isPublic=1
  expect(list.find((s) => s.slug === "qa-x")?.title).toBe("X v2");
  expect(list.find((s) => s.slug === "qa-x")?.systemPrompt).toBe("p2");
});

it("preset import: rejects malformed JSON with clear error", async () => {
  const db = createTestDb();
  const { UserRepository } = await import("../../src/db/repositories/users.js");
  await new UserRepository(db).create("system", "!disabled");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "preset-bad-"));
  const file = join(dir, "bad.json");
  writeFileSync(file, JSON.stringify([
    { slug: "x", /* 缺 title */ description: "", systemPrompt: "p" }
  ]));
  const r = await runAdminCli(["preset", "import", file], { db });
  expect(r.exitCode).not.toBe(0);
  expect(r.stderr).toMatch(/title|invalid|required/i);
});
```

- [ ] **Step 7.2：跑测试确认失败**

```bash
npm -w @server-agent/server test -- admin-cli
```

Expected：2 个新 case fail（command not found）。

- [ ] **Step 7.3：实现 preset 子命令**

Modify `scripts/admin-cli.ts`：

在文件顶部 imports 区追加：

```ts
import { readFileSync } from "node:fs";
import { z } from "zod";
import { skillInputSchemaSchema, skillTagsSchema } from "@server-agent/shared";
import { SkillsRepository } from "../packages/server/src/db/repositories/skills.js";
```

在 commander 程序定义区（user / invite 命令后）追加：

```ts
const preset = program.command("preset");
preset.command("import")
  .argument("<file>", "JSON file with preset array")
  .option("--public", "publish presets immediately", true)
  .option("--no-public", "import as private")
  .action(async (file: string, opts: { public: boolean }) => {
    const presetItemSchema = z.object({
      slug: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
      title: z.string().trim().min(1).max(80),
      description: z.string().trim().max(280).optional(),
      systemPrompt: z.string().trim().min(1).max(8000),
      defaultProvider: z.string().optional(),
      defaultModel: z.string().optional(),
      inputSchema: skillInputSchemaSchema.nullable().optional(),
      tags: skillTagsSchema.optional()
    });
    const fileSchema = z.array(presetItemSchema).min(1).max(100);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) {
      err(`invalid preset file: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      throw new Error("preset file validation failed");
    }
    const users = new UserRepository(db);
    const sysUser = await users.findByUsername("system");
    if (!sysUser) throw new Error("system user not found; run db:migrate first");

    const skills = new SkillsRepository(db);
    let inserted = 0;
    let updated = 0;
    for (const item of parsed.data) {
      const existing = await skills.findBySlug?.(item.slug);  // 见下注
      // 没有 findBySlug helper，直接靠 upsertBySlug 内部检测
      const before = existing ? 1 : 0;
      await skills.upsertBySlug(sysUser.id, {
        slug: item.slug,
        title: item.title,
        description: item.description ?? "",
        systemPrompt: item.systemPrompt,
        defaultProvider: item.defaultProvider ?? null,
        defaultModel: item.defaultModel ?? null,
        inputSchema: item.inputSchema ?? null,
        tags: item.tags ?? [],
        isPublic: opts.public
      });
      if (before === 0) inserted++;
      else updated++;
    }
    out(`inserted: ${inserted}, updated: ${updated}`);
  });
```

注意上面的 `findBySlug?.(...)` —— 这个 helper 不存在，我们需要在 `SkillsRepository` 加一个简单查询，或在 admin CLI 里直接用 db 查。**直接用 db**，避免给 repo 加非业务用方法：

把 inserted/updated 计数逻辑改成：

```ts
import { eq } from "drizzle-orm";
import { skills as skillsTable } from "../packages/server/src/db/schema.js";
// ... 在 action 内：
const beforeRows = await db.select({ slug: skillsTable.slug }).from(skillsTable)
  .where(eq(skillsTable.slug, item.slug)).limit(1);
const before = beforeRows.length > 0 ? 1 : 0;
```

为了避免在 admin-cli.ts 顶部混 schema/orm import，更整洁的实现：在 SkillsRepository 加一个轻量 `findBySlug(slug)` 方法（只做存在性查询，不涉及业务规则）：

修补 `packages/server/src/db/repositories/skills.ts`，加：

```ts
async findBySlug(slug: string) {
  const [row] = await this.db.select().from(skills).where(eq(skills.slug, slug)).limit(1);
  return row ?? null;
}
```

然后 admin CLI 的 action 内：

```ts
const before = await skills.findBySlug(item.slug);
await skills.upsertBySlug(sysUser.id, { ... });
if (before) updated++;
else inserted++;
```

- [ ] **Step 7.4：跑测试确认通过**

```bash
npm -w @server-agent/shared run build  # 确保 skillInputSchemaSchema/skillTagsSchema 可 import
npm -w @server-agent/server test -- admin-cli
```

Expected：所有 admin-cli case 全过（含 2 新增）。

- [ ] **Step 7.5：commit**

```bash
git add scripts/admin-cli.ts packages/server/src/db/repositories/skills.ts packages/server/tests/unit/admin-cli.test.ts
git commit -m "feat(admin-cli): add 'preset import' subcommand with idempotent upsert by slug"
```

---

## Task 8：前端 API client 字段扩展

**Files:**

- Modify: `packages/web/src/lib/skills.ts`

- [ ] **Step 8.1：扩展 SkillInput**

Modify `packages/web/src/lib/skills.ts`：

把 `SkillInput` 改成（注意从 shared import `SkillInputField`）：

```ts
import type { SkillDto, SkillDraftDto, SkillInputField } from "@server-agent/shared";
import { ApiError, type ApiErrorBody } from "./api.js";

// ... request helper 不变 ...

export interface SkillInput {
  title: string;
  description?: string;
  systemPrompt: string;
  defaultProvider?: string;
  defaultModel?: string;
  isPublic?: boolean;
  inputSchema?: SkillInputField[] | null;
  tags?: string[];
}
```

`createSkill` / `updateSkill` 函数签名不变（仍接 SkillInput / Partial），自动支持新字段。

- [ ] **Step 8.2：build + typecheck**

```bash
npm -w @server-agent/shared run build
npm -w @server-agent/web run typecheck
```

Expected：通过。

- [ ] **Step 8.3：commit**

```bash
git add packages/web/src/lib/skills.ts
git commit -m "feat(web): SkillInput accepts inputSchema and tags"
```

---

## Task 9：SkillFormDialog 组件

**Files:**

- Create: `packages/web/src/routes/chat/SkillFormDialog.tsx`

- [ ] **Step 9.1：写组件**

Create `packages/web/src/routes/chat/SkillFormDialog.tsx`：

```tsx
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SkillDto, SkillInputField } from "@server-agent/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.js";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";
import { interpolate } from "../../lib/interpolate.js";

interface SkillFormDialogProps {
  open: boolean;
  skill: SkillDto | null;
  onOpenChange: (open: boolean) => void;
  onContinue: (skill: SkillDto, finalPrompt: string) => void;
}

export function SkillFormDialog({ open, skill, onOpenChange, onContinue }: SkillFormDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (open && skill) {
      setValues({});
      setPreviewOpen(false);
    }
  }, [open, skill]);

  const fields: SkillInputField[] = skill?.inputSchema ?? [];

  const finalPrompt = useMemo(
    () => (skill ? interpolate(skill.systemPrompt, values) : ""),
    [skill, values]
  );

  const requiredMissing = fields.some((f) => f.required && !values[f.name]?.trim());

  const submit = () => {
    if (!skill || requiredMissing) return;
    onContinue(skill, finalPrompt);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{skill ? `基于 Skill「${skill.title}」` : "Skill 表单"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {fields.map((field) => (
            <div key={field.name}>
              <label className="mb-1 block text-sm text-zinc-400">
                {field.label}
                {field.required ? <span className="ml-1 text-red-400">*</span> : null}
              </label>
              {field.type === "text" ? (
                <input
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                  value={values[field.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                />
              ) : field.type === "textarea" ? (
                <Textarea
                  rows={3}
                  value={values[field.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                />
              ) : (
                <select
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                  value={values[field.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                >
                  <option value="">请选择...</option>
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
            </div>
          ))}

          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
              onClick={() => setPreviewOpen((v) => !v)}
            >
              {previewOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Prompt 预览
            </button>
            {previewOpen ? (
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-300">
                {finalPrompt}
              </pre>
            ) : null}
          </div>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit} disabled={requiredMissing}>下一步：选模型</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 9.2：typecheck**

```bash
npm -w @server-agent/web run typecheck
```

Expected：通过。

- [ ] **Step 9.3：commit**

```bash
git add packages/web/src/routes/chat/SkillFormDialog.tsx
git commit -m "feat(web): SkillFormDialog renders inputSchema fields with live prompt preview"
```

---

## Task 10：NewConversationDialog 接 presetPrompt + ChatPage 串联

**Files:**

- Modify: `packages/web/src/routes/chat/NewConversationDialog.tsx`
- Modify: `packages/web/src/routes/chat/index.tsx`

- [ ] **Step 10.1：NewConversationDialog 加 presetPrompt prop**

Modify `packages/web/src/routes/chat/NewConversationDialog.tsx`：

把 props 改成：

```ts
interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { provider: ProviderId; model: string; systemPrompt?: string; skillId?: number }) => void;
  defaultProvider?: ProviderId;
  skill?: SkillDto | null;
  presetPrompt?: string | null;
}
```

修改 useEffect 优先级：

```tsx
useEffect(() => {
  if (!open) return;
  if (presetPrompt !== null && presetPrompt !== undefined) {
    // Phase 4: SkillFormDialog 完成后传入的最终文本
    const nextProvider = (skill && isProviderId(skill.defaultProvider))
      ? skill.defaultProvider
      : (defaultProvider ?? providers[0]);
    const allowedModels = PROVIDER_MODELS[nextProvider];
    const skillModel = skill?.defaultModel;
    const matched = skillModel ? allowedModels.find((item) => item.id === skillModel) : undefined;
    setProvider(nextProvider);
    setModel(matched?.id ?? allowedModels[0].id);
    setSystemPrompt(presetPrompt);
    return;
  }
  if (skill) {
    // Phase 3 路径：无 inputSchema 的 skill prefill
    const nextProvider = isProviderId(skill.defaultProvider) ? skill.defaultProvider : (defaultProvider ?? providers[0]);
    const allowedModels = PROVIDER_MODELS[nextProvider];
    const skillModel = skill.defaultModel;
    const matched = skillModel ? allowedModels.find((item) => item.id === skillModel) : undefined;
    setProvider(nextProvider);
    setModel(matched?.id ?? allowedModels[0].id);
    setSystemPrompt(skill.systemPrompt);
    return;
  }
  // 默认
  const nextProvider = defaultProvider ?? providers[0];
  setProvider(nextProvider);
  setModel(PROVIDER_MODELS[nextProvider][0].id);
  setSystemPrompt("");
}, [open, skill, defaultProvider, presetPrompt]);
```

- [ ] **Step 10.2：ChatPage 串联**

Modify `packages/web/src/routes/chat/index.tsx`：

把 imports 区加：

```ts
import { SkillFormDialog } from "./SkillFormDialog.js";
```

在现有 state 区追加：

```ts
const [skillFormOpen, setSkillFormOpen] = useState(false);
const [skillForForm, setSkillForForm] = useState<SkillDto | null>(null);
const [interpolatedPrompt, setInterpolatedPrompt] = useState<string | null>(null);
```

把 `handleUseSkill` 改造（保留 `setEditSkill` state，下面继续用）：

```tsx
const handleUseSkill = useCallback((skill: SkillDto) => {
  if (skill.inputSchema && skill.inputSchema.length > 0) {
    setSkillForForm(skill);
    setSkillFormOpen(true);
  } else {
    setSkillForNew(skill);
    setDialogOpen(true);
  }
}, []);

const handleFormContinue = useCallback((skill: SkillDto, finalPrompt: string) => {
  setSkillFormOpen(false);
  setSkillForForm(null);
  setSkillForNew(skill);
  setInterpolatedPrompt(finalPrompt);
  setDialogOpen(true);
}, []);
```

把 NewConversationDialog 调用改成（多传 presetPrompt + 关闭时清理）：

```tsx
<NewConversationDialog
  open={dialogOpen}
  onOpenChange={(value) => {
    setDialogOpen(value);
    if (!value) {
      setSkillForNew(null);
      setInterpolatedPrompt(null);
    }
  }}
  skill={skillForNew}
  presetPrompt={interpolatedPrompt}
  onCreate={(input) =>
    createMutation.mutate(input as { provider: ProviderId; model: string; systemPrompt?: string; skillId?: number })
  }
/>
```

在该 dialog 之后挂载 SkillFormDialog：

```tsx
<SkillFormDialog
  open={skillFormOpen}
  skill={skillForForm}
  onOpenChange={(value) => {
    setSkillFormOpen(value);
    if (!value) setSkillForForm(null);
  }}
  onContinue={handleFormContinue}
/>
```

- [ ] **Step 10.3：typecheck**

```bash
npm -w @server-agent/web run typecheck
npm run lint
```

Expected：通过。

- [ ] **Step 10.4：commit**

```bash
git add packages/web/src/routes/chat/NewConversationDialog.tsx packages/web/src/routes/chat/index.tsx
git commit -m "feat(web): chain SkillFormDialog -> NewConversationDialog with presetPrompt"
```

---

## Task 11：SkillsPanel chip filter + SkillItem isSystem 隐 dropdown

**Files:**

- Modify: `packages/web/src/routes/chat/SkillsPanel.tsx`
- Modify: `packages/web/src/routes/chat/SkillItem.tsx`

- [ ] **Step 11.1：SkillItem `isSystem` 时隐藏 dropdown**

Modify `packages/web/src/routes/chat/SkillItem.tsx`：

把现有 `{skill.isOwn && (...)}` 包装条件加上 not isSystem。但现在 isOwn 的语义是 "current user 是 author"，system preset 对所有 user 都 isOwn=false（因 author 是 system）。所以 system preset 自然走 isOwn=false 分支，**dropdown 已自动隐藏**。无需修改 SkillItem。

但为防止未来代码混淆，建议在 SkillItem 里加注释说明 system preset 的展示路径（不展示 dropdown 是 isOwn=false 自然结果）：

```tsx
// (在 isOwn dropdown 之前加注释)
{/* system preset 与他人公开 skill 都走 isOwn=false 分支，自然不显示 dropdown */}
{skill.isOwn && (
  <DropdownMenu>
    {/* ... */}
  </DropdownMenu>
)}
```

如果 spec §5.6 提到的"system preset 显示 🛡 hint"想加可视化提示，可在 author 名前加：

```tsx
{!skill.isOwn && (
  <span className="ml-1 text-xs text-zinc-500">
    {skill.isSystem ? "🛡 " : ""}@{skill.authorUsername}
  </span>
)}
```

可选；spec 说"先不加 🛡"，**保持当前不加**。

跳过此 step 修改，直接进 11.2。

- [ ] **Step 11.2：SkillsPanel 加 tag chip filter**

Modify `packages/web/src/routes/chat/SkillsPanel.tsx`：

把整个组件改成：

```tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SkillDto } from "@server-agent/shared";
import { deleteSkill, listSkills, updateSkill } from "../../lib/skills.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { SkillItem } from "./SkillItem.js";

interface SkillsPanelProps {
  onUseSkill: (skill: SkillDto) => void;
  onEditSkill: (skill: SkillDto) => void;
}

const ALL_TAG = "__all__";
const MAX_CHIPS = 6;

export function SkillsPanel({ onUseSkill, onEditSkill }: SkillsPanelProps) {
  const queryClient = useQueryClient();
  const skillsQuery = useQuery({ queryKey: ["skills"], queryFn: listSkills });
  const [activeTag, setActiveTag] = useState<string>(ALL_TAG);

  const togglePublic = useMutation({
    mutationFn: ({ skill }: { skill: SkillDto }) =>
      updateSkill(skill.id, { isPublic: !skill.isPublic }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills"] }),
    onError: () => toast.error("操作失败")
  });

  const removeSkill = useMutation({
    mutationFn: (id: number) => deleteSkill(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills"] }),
    onError: () => toast.error("删除失败")
  });

  const skills = skillsQuery.data?.skills ?? [];

  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of skills) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CHIPS).map(([t]) => t);
  }, [skills]);

  const filtered = useMemo(() => {
    if (activeTag === ALL_TAG) return skills;
    return skills.filter((s) => s.tags.includes(activeTag));
  }, [skills, activeTag]);

  if (skillsQuery.isLoading) {
    return (
      <div className="space-y-2 px-1">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-zinc-500">
        还没有 Skill。在对话里点「保存为 Skill」试试。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {topTags.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-1">
          <Button
            variant={activeTag === ALL_TAG ? "default" : "ghost"}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setActiveTag(ALL_TAG)}
          >
            全部
          </Button>
          {topTags.map((tag) => (
            <Button
              key={tag}
              variant={activeTag === tag ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setActiveTag(tag)}
            >
              {tag}
            </Button>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="px-2 py-4 text-sm text-zinc-500">该 tag 下没有 Skill</p>
      ) : (
        <div className="space-y-1 px-1">
          {filtered.map((skill) => (
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
      )}
    </div>
  );
}
```

- [ ] **Step 11.3：typecheck + lint**

```bash
npm -w @server-agent/web run typecheck
npm run lint
```

Expected：通过。

- [ ] **Step 11.4：commit**

```bash
git add packages/web/src/routes/chat/SkillsPanel.tsx packages/web/src/routes/chat/SkillItem.tsx
git commit -m "feat(web): SkillsPanel adds tag chip filter (top 6 by count, mutex select)"
```

---

## Task 12：完整 lint / typecheck / test / build + 本地 smoke

**Files:** —

- [ ] **Step 12.1：四件套全绿**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected：全过。如果 lint 报 unused / `any` / empty interface 等，按现有 commit 风格修。

- [ ] **Step 12.2：本地 smoke + preset import dry-run**

```bash
rm -f /tmp/phase4-smoke.db /tmp/phase4-smoke.db-shm /tmp/phase4-smoke.db-wal
DB_PATH=/tmp/phase4-smoke.db npm -w @server-agent/server run db:migrate
sqlite3 /tmp/phase4-smoke.db "SELECT id, username FROM users WHERE username='system';"
sqlite3 /tmp/phase4-smoke.db "PRAGMA table_info(skills);" | grep -E "input_schema|tags|slug"

# 跑 preset import（开发阶段可用直接命令）
DB_PATH=/tmp/phase4-smoke.db npm run admin -- preset import packages/server/src/presets/qa-skills.json
```

Expected：

```
1|system
12|input_schema|TEXT|0||0
13|tags|TEXT|1|'[]'|0
14|slug|TEXT|0||0
inserted: 3, updated: 0
```

再跑一次确认幂等：

```bash
DB_PATH=/tmp/phase4-smoke.db npm run admin -- preset import packages/server/src/presets/qa-skills.json
```

Expected：`inserted: 0, updated: 3`。

- [ ] **Step 12.3：起 server + curl 验证 GET /api/skills 含 preset**

需先建 invite + 注册一个测试用户（参考 Phase 3 e2e，因 WAL 模式不要直 sqlite3 插，用 admin CLI）：

```bash
DB_PATH=/tmp/phase4-smoke.db npm run admin -- invite create --uses 5 --note phase4-e2e
# 复制出来的 12 字符 invite code

DB_PATH=/tmp/phase4-smoke.db SESSION_COOKIE_SECRET=12345678901234567890123456789012 AIWOO_API_KEY=dummy AIWOO_BASE_URL=https://aiwoo.vip npm -w @server-agent/server start &
SERVER_PID=$!
sleep 2

INVITE="<上面输出的 code>"
curl -s -X POST http://127.0.0.1:8080/api/auth/register -H "content-type: application/json" \
  -d "{\"username\":\"alice\",\"password\":\"alicepass123\",\"inviteCode\":\"$INVITE\"}"
COOKIE=$(curl -s -i -X POST http://127.0.0.1:8080/api/auth/login -H "content-type: application/json" \
  -d '{"username":"alice","password":"alicepass123"}' | grep -i '^set-cookie:' | head -1 | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)

curl -s http://127.0.0.1:8080/api/skills -H "cookie: $COOKIE" | python3 -m json.tool | head -30

kill $SERVER_PID
```

Expected：返回的 `skills[]` 含 3 条 `isSystem: true`、`authorUsername: "system"`、`tags: ["qa"]` 的 preset。

- [ ] **Step 12.4：commit lint 修复（如有）**

```bash
git add -A
git commit -m "chore: fix lint after phase 4"
```

如无改动跳过此 step。

---

## Task 13：上线 + 浏览器手测 + AGENTS.md 沉淀

**Files:** `AGENTS.md`, `README.md`, `docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md`

按 AGENTS.md §6.8 dev-phase exemption，**直接 push 到 main**：

- [ ] **Step 13.1：push + 等部署**

```bash
git push origin main
gh run list --branch main --limit 1
```

等待最新 `deploy` run 状态变 `completed success`：

```bash
gh run watch <run-id> --exit-status
```

- [ ] **Step 13.2：生产 smoke**

```bash
curl -s https://aicoolyun.vip/api/health
curl -s https://aicoolyun.vip/api/version
```

Expected：health ok；version 含最新 git sha。

- [ ] **Step 13.3：跑 preset import on 生产**

```bash
ssh root@43.108.21.46 \
  'cd /opt/server_agent && sudo -u agent bash -c "set -a; . /etc/server-agent/agent.env; set +a; npm run admin -- preset import packages/server/src/presets/qa-skills.json"'
```

Expected：`inserted: 3, updated: 0`（首次）。

如果之前测过本地有 system 用户但生产没跑过 migration 0003，会先报 `system user not found`，说明 deploy 没跑 migration —— 检查 deploy-agent.sh 日志：

```bash
ssh root@43.108.21.46 'journalctl -u server-agent -n 50 --no-pager | tail -30'
```

确保 `db:migrate` 有跑过（log 里会有 0003 应用记录）。

- [ ] **Step 13.4：浏览器手测**

打开 `https://aicoolyun.vip`，登录已有账号：

1. Sidebar → Skills tab → 看到 3 条 `@system` preset，hover 没 dropdown menu
2. 点 `qa-bug-repro` → SkillFormDialog 弹出，5 字段（3 required）
3. 必填字段空时 "下一步" disabled
4. 全填后展开 Prompt 预览 → 占位符已替换为表单值
5. 点 "下一步：选模型" → NewConversationDialog 弹出，systemPrompt 是替换后的最终文本
6. 选 provider/model（aiwoo-claude / claude-opus-4-8）→ 创建 → 进会话 → 发一条消息（如 "open" 或 task 已隐含）→ LLM 真按 prompt 输出 4 节 Markdown
7. 回 Skills tab → 顶部 chip 行有 "全部 / qa"；点 qa → 仅 3 条 preset；点 全部 → 所有 skill 恢复
8. 创建一条带 tag "frontend" 的私有 skill，回 Skills tab → chip 行多了 "frontend" chip
9. 删除该 skill 后 chip "frontend" 消失

- [ ] **Step 13.5：把坑沉淀进 AGENTS.md（如有）**

如果手测发现 spec 没覆盖的 gotcha（如 `--public` flag 默认行为不直观、动态 form 在长 prompt 时 scroll 体验等），加 §6.11+：

```bash
# (修 AGENTS.md 后)
git add AGENTS.md
git commit -m "docs: phase 4 gotcha — <one-liner>"
git push origin main
```

如无新坑跳过此 step。

- [ ] **Step 13.6：roadmap + README 同步**

修 `docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md` §5：phase 4 状态 `next` → `done`，phase 5 → `next`。

修 `README.md` 路线图表 + 当前状态行（"Phase 4（QA-AGENT 模式）已上线"）。

修 `AGENTS.md` §0 当前 Phase 行 + §9 路线图。

```bash
git add AGENTS.md README.md docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md
git commit -m "docs: phase 4 done, sync README/AGENTS/roadmap"
git push origin main
```

---

## 收尾验收 checklist（对照 spec §9）

- [ ] lint / typecheck / test / build 全绿
- [ ] migration 0003 真实跑过、`PRAGMA table_info(skills)` 含 input_schema/tags/slug；users 含 `system` 行
- [ ] interpolate 6 case 全过；upsertBySlug 单测通过
- [ ] admin CLI `preset import` 幂等（连跑两次第二次 updated=3 inserted=0）
- [ ] 部署生产 + 手动 ssh 跑 preset import → inserted: 3
- [ ] 浏览器跑 §13.4 九步全过
- [ ] 关键坑写进 AGENTS.md §6（如有）
- [ ] roadmap §5 / README 当前 Phase 同步






