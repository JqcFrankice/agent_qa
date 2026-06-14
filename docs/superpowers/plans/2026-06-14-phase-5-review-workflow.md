# Phase 5 — Skill 审核流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 skill 公开发布走人工审核：作者 publish → admin /admin/skills 看到 → approve/reject → public 列表只显示 approved；编辑 system_prompt/inputSchema 自动重审。

**Architecture:** SQLite migration 0004 给 users 加 role 列、skills 加 review_status/reject_reason/version/reviewed_at/reviewed_by 5 列；historical 行 grandfather 为 approved。新 requireAdmin middleware + `/api/admin/skills` 路由；admin CLI 加 grant-admin / approve / reject 子命令。前端 SkillItem 加 review badge，新 /admin/skills 路由（admin only）含 tab 切换 + approve/reject。

**Tech Stack:** TypeScript / Fastify 4 / better-sqlite3 + Drizzle / React 18 + react-router-dom + TanStack Query / Vite / Vitest / zod / commander

**前置上下文：**

- Spec：[`docs/superpowers/specs/2026-06-14-phase-5-review-workflow-design.md`](../specs/2026-06-14-phase-5-review-workflow-design.md)
- 当前 Phase 4 状态：skills 表已含 inputSchema/tags/slug/isPublic 字段，前端 SkillFormDialog + chip filter 已上线
- 必读约束：[`AGENTS.md`](../../../AGENTS.md) §3 部署 / §6.1 build:shared / §6.5 spec/plan 流程 / §6.8 dev-phase exemption / §6.9-6.13 (Drizzle 顺序 / WAL / 测试 fixture findOrCreate / JSON stringify)
- D1-D6 决策已定，本 plan 不再讨论替代方案

---

## File Structure

**新建：**

- `packages/server/src/db/migrations/0004_review_workflow.sql` — users.role + skills 5 列 + grandfather UPDATE
- `packages/server/src/middleware/admin.ts` — requireAdmin middleware
- `packages/server/src/routes/admin/skills.ts` — GET list / POST approve / POST reject
- `packages/server/tests/unit/middleware/admin.test.ts` — 3 case
- `packages/server/tests/unit/routes/admin-skills.test.ts` — 4+ case
- `packages/web/src/lib/admin.ts` — listAdminSkills / approveSkill / rejectSkill
- `packages/web/src/routes/admin/skills.tsx` — /admin/skills 页（路由组件）
- `packages/web/src/routes/admin/AdminSkillRow.tsx` — 单条审核 item（折叠/展开）
- `packages/web/src/routes/admin/RejectReasonDialog.tsx` — reject reason 输入

**修改：**

- `packages/server/src/db/schema.ts` — users.role + skills 5 列 + byReviewStatus index
- `packages/server/src/db/repositories/skills.ts` — listPending/listByReviewStatus/approve/reject 4 个新方法 + listAvailableTo/update/publish/upsertBySlug 4 处改造
- `packages/server/src/db/repositories/users.ts` — setRole 方法
- `packages/server/src/middleware/session.ts` — request.user 加 role 字段
- `packages/server/src/routes/auth/me.ts` — 返回加 role
- `packages/server/src/routes/skills.ts` — toDto 加 reviewStatus/rejectReason/version
- `packages/server/src/server.ts` — 注册 adminSkillRoutes
- `packages/server/tests/unit/repositories/skills.test.ts` — 5+ case 审核流
- `packages/server/tests/unit/routes/skills.test.ts` — author 看自己 rejected 可见
- `packages/server/tests/unit/admin-cli.test.ts` — 5 个新 case
- `scripts/admin-cli.ts` — user grant-admin/revoke-admin + skill list-pending/approve/reject 共 5 命令
- `packages/shared/src/schemas/skills.ts` — review schemas + DTO 加 3 字段
- `packages/shared/src/schemas/user.ts` (or auth.ts) — userRoleSchema + User interface 加 role
- `packages/web/src/lib/api.ts` — User.role
- `packages/web/src/main.tsx` — 注册 /admin/skills 路由
- `packages/web/src/routes/chat/Sidebar.tsx` — admin 入口 link
- `packages/web/src/routes/chat/SkillItem.tsx` — review badge
- `packages/web/src/routes/chat/SaveSkillDialog.tsx` — 公开发布 checkbox 加审核提示
- `AGENTS.md` / `README.md` / `docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md` — phase 5 done

**关键设计取舍**：

- 新增 `routes/admin/` 目录而不是 routes/admin-skills.ts —— 给 Phase 6+ admin/users / admin/audit 等留 namespace
- toDto 函数新增字段 reviewStatus/rejectReason/version 让前端能渲染 review badge
- preset import 走 upsertBySlug，需要支持传 reviewStatus='approved'（默认对 system 用户的 upsert 自动 approved）
- author 看自己的 rejected/pending skill 全可见；其他 user 看不到（listAvailableTo 过滤）

---

## Task 1：DB schema + Migration 0004

**Files:**

- Create: `packages/server/src/db/migrations/0004_review_workflow.sql`
- Modify: `packages/server/src/db/schema.ts`

- [ ] **Step 1.1：写 migration SQL**

Create `packages/server/src/db/migrations/0004_review_workflow.sql`：

```sql
-- 1. users 加 role 列
ALTER TABLE `users` ADD COLUMN `role` text DEFAULT 'user' NOT NULL;

-- 2. skills 加审核相关 5 列
ALTER TABLE `skills` ADD COLUMN `review_status` text DEFAULT 'pending' NOT NULL;
ALTER TABLE `skills` ADD COLUMN `reject_reason` text;
ALTER TABLE `skills` ADD COLUMN `version` integer DEFAULT 1 NOT NULL;
ALTER TABLE `skills` ADD COLUMN `reviewed_at` integer;
ALTER TABLE `skills` ADD COLUMN `reviewed_by` integer REFERENCES `users`(`id`);

-- 3. grandfather 现有 public skill 为 approved
UPDATE `skills` SET `review_status` = 'approved', `reviewed_at` = unixepoch()
WHERE `is_public` = 1;

-- 4. 索引：admin 查 pending 列表
CREATE INDEX `idx_skills_review_status` ON `skills` (`review_status`, `is_public`)
  WHERE `deleted_at` IS NULL;
```

- [ ] **Step 1.2：更新 Drizzle schema**

Modify `packages/server/src/db/schema.ts`：

users 表加 role 列（在 defaultProvider 之后）：
```ts
role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
```

skills 表加 5 列（在现有 slug 之后）：
```ts
reviewStatus: text("review_status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
rejectReason: text("reject_reason"),
version: integer("version").notNull().default(1),
reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
reviewedBy: integer("reviewed_by").references(() => users.id),
```

skills indexes 加（在 (t) => ({ ... }) 中追加）：
```ts
byReviewStatus: index("idx_skills_review_status").on(t.reviewStatus, t.isPublic).where(sql`${t.deletedAt} IS NULL`)
```

- [ ] **Step 1.3：跑 migration 验证**

```bash
rm -f /tmp/phase5.db /tmp/phase5.db-shm /tmp/phase5.db-wal
DB_PATH=/tmp/phase5.db npm -w @server-agent/server run db:migrate
sqlite3 /tmp/phase5.db "PRAGMA table_info(users);" | grep role
sqlite3 /tmp/phase5.db "PRAGMA table_info(skills);" | grep -E "review_status|reject_reason|version|reviewed_"
sqlite3 /tmp/phase5.db ".indexes skills" | grep review_status
```

Expected：

```
5|role|TEXT|1|'user'|0
15|review_status|TEXT|1|'pending'|0
16|reject_reason|TEXT|0||0
17|version|INTEGER|1|1|0
18|reviewed_at|INTEGER|0||0
19|reviewed_by|INTEGER|0||0
idx_skills_review_status
```

- [ ] **Step 1.4：跑 typecheck + lint + test**

```bash
npm -w @server-agent/server run typecheck
npm run lint
npm test
```

Expected：全过（迁移不破坏现有测试，因 review_status 默认 'pending' 但现有测试不查这个字段）。

> **注意**：现有测试如 `skills.test.ts` 的 `listAvailableTo(bob.id)` 期望返回 alice 的 public skill。Task 1 不改 listAvailableTo 逻辑，但 migration 把 alice 现有 public skill grandfather 为 approved（test fixture 中 publish() 默认 reviewStatus 还是 'pending'）。**这意味着现有测试可能 fail** —— 是预期，Task 3 实现 `listAvailableTo` 改造时同步修测试期待。本 step 接受这一中间状态。

如 test 真 fail：

```bash
npm -w @server-agent/server test 2>&1 | grep -E "FAIL|✗" | head
```

记下 fail 数量，Task 3 收尾时验证全部回绿。

- [ ] **Step 1.5：commit**

```bash
git add packages/server/src/db/migrations/0004_review_workflow.sql packages/server/src/db/schema.ts
git commit -m "feat(server): add review workflow columns + grandfather public skills (phase 5)"
```

---

## Task 2：shared schemas（review/role + DTO 扩展）

**Files:**

- Modify: `packages/shared/src/schemas/skills.ts`
- Modify: `packages/shared/src/schemas/user.ts`

- [ ] **Step 2.1：skills.ts 加 review schemas + DTO 字段**

Modify `packages/shared/src/schemas/skills.ts`：在 `extractSkillRequestSchema` 之前追加：

```ts
export const skillReviewStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const approveSkillRequestSchema = z.object({});

export const rejectSkillRequestSchema = z.object({
  reason: z.string().trim().min(1).max(280)
});
```

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
  reviewStatus: "pending" | "approved" | "rejected";
  rejectReason: string | null;
  version: number;
}
```

- [ ] **Step 2.2：user.ts 加 role schema + User interface**

读现有 `packages/shared/src/schemas/user.ts` 看现有结构：

```bash
cat packages/shared/src/schemas/user.ts
```

如果 `User` interface 在该文件，加 role 字段：
```ts
export const userRoleSchema = z.enum(["user", "admin"]);

export interface User {
  id: number;
  username: string;
  createdAt: string;
  role: "user" | "admin";
}
```

如果 User 不在 user.ts 而在 auth.ts，按现有位置改即可。**先 grep 确认**：

```bash
grep -rn "interface User\b\|export interface User" packages/shared/src/
```

把 User 加 role 字段。

- [ ] **Step 2.3：build shared + typecheck**

```bash
npm -w @server-agent/shared run build
npm -w @server-agent/shared test
npm -w @server-agent/server run typecheck
npm -w @server-agent/web run typecheck
```

Expected：shared build / test 通过；server 和 web typecheck 可能因 toDto / SkillItem / API client 缺字段红 —— **是预期**，Task 5/6/8 修。

- [ ] **Step 2.4：commit**

```bash
git add packages/shared/src/schemas
git commit -m "feat(shared): add review schemas and User.role; SkillDto adds review fields"
```

---

## Task 3：SkillsRepository 加方法 + 改造（TDD）

**Files:**

- Modify: `packages/server/src/db/repositories/skills.ts`
- Modify: `packages/server/tests/unit/repositories/skills.test.ts`

- [ ] **Step 3.1：写失败测试 — listPending / approve / reject / 过滤 / 触发重审**

追加到 `packages/server/tests/unit/repositories/skills.test.ts` 的 describe 块尾部：

```ts
  it("listPending returns only public+pending skills", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const s1 = await repo.create(alice.id, { title: "P1", systemPrompt: "p" });
    await repo.publish(s1.id, alice.id);  // pending
    const s2 = await repo.create(alice.id, { title: "P2", systemPrompt: "p" });
    // s2 not published, still private
    const pending = await repo.listPending();
    expect(pending.map((r) => r.id)).toEqual([s1.id]);
  });

  it("approve sets approved status, reviewedAt/By, increments version", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const adminUser = await user(db, "boss");
    const s = await repo.create(alice.id, { title: "T", systemPrompt: "p" });
    await repo.publish(s.id, alice.id);
    const before = await repo.findById(s.id, alice.id);
    expect(before?.version).toBe(1);
    const approved = await repo.approve(s.id, adminUser.id);
    expect(approved?.reviewStatus).toBe("approved");
    expect(approved?.reviewedAt).toBeInstanceOf(Date);
    expect(approved?.reviewedBy).toBe(adminUser.id);
    expect(approved?.version).toBe(2);
    expect(approved?.rejectReason).toBeNull();
  });

  it("reject sets rejected status with reason", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const adminUser = await user(db, "boss");
    const s = await repo.create(alice.id, { title: "T", systemPrompt: "p" });
    await repo.publish(s.id, alice.id);
    const rejected = await repo.reject(s.id, adminUser.id, "敏感词命中");
    expect(rejected?.reviewStatus).toBe("rejected");
    expect(rejected?.rejectReason).toBe("敏感词命中");
    expect(rejected?.reviewedBy).toBe(adminUser.id);
  });

  it("listAvailableTo: non-author only sees approved public skills", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const bob = await user(db, "bob");
    const adminUser = await user(db, "boss");
    const sPending = await repo.create(alice.id, { title: "Pending", systemPrompt: "p" });
    await repo.publish(sPending.id, alice.id);
    const sApproved = await repo.create(alice.id, { title: "OK", systemPrompt: "p" });
    await repo.publish(sApproved.id, alice.id);
    await repo.approve(sApproved.id, adminUser.id);
    const sRejected = await repo.create(alice.id, { title: "Bad", systemPrompt: "p" });
    await repo.publish(sRejected.id, alice.id);
    await repo.reject(sRejected.id, adminUser.id, "no");

    const bobList = await repo.listAvailableTo(bob.id);
    expect(bobList.map((r) => r.id)).toEqual([sApproved.id]);

    const aliceList = await repo.listAvailableTo(alice.id);
    expect(aliceList.length).toBe(3);
  });

  it("update with systemPrompt change resets review to pending", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const adminUser = await user(db, "boss");
    const s = await repo.create(alice.id, { title: "T", systemPrompt: "p1" });
    await repo.publish(s.id, alice.id);
    await repo.approve(s.id, adminUser.id);
    const updated = await repo.update(s.id, alice.id, { systemPrompt: "p2" });
    expect(updated?.reviewStatus).toBe("pending");
    expect(updated?.reviewedAt).toBeNull();
    expect(updated?.reviewedBy).toBeNull();
    expect(updated?.rejectReason).toBeNull();
  });

  it("update with only title change does NOT reset review", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const adminUser = await user(db, "boss");
    const s = await repo.create(alice.id, { title: "T", systemPrompt: "p" });
    await repo.publish(s.id, alice.id);
    await repo.approve(s.id, adminUser.id);
    const updated = await repo.update(s.id, alice.id, { title: "T2" });
    expect(updated?.reviewStatus).toBe("approved");
    expect(updated?.reviewedAt).toBeInstanceOf(Date);
  });

  it("publish resets review to pending and clears prior review fields", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const adminUser = await user(db, "boss");
    const s = await repo.create(alice.id, { title: "T", systemPrompt: "p" });
    await repo.publish(s.id, alice.id);
    await repo.reject(s.id, adminUser.id, "nope");
    const republished = await repo.publish(s.id, alice.id);
    expect(republished?.reviewStatus).toBe("pending");
    expect(republished?.rejectReason).toBeNull();
    expect(republished?.reviewedAt).toBeNull();
    expect(republished?.reviewedBy).toBeNull();
  });
```

注意：现有 Phase 3-4 case `includes public skills from other authors and excludes soft-deleted` 期望 bob 看到 `aPublic`，但 aPublic 现在是 pending（publish 后还没 approve），所以会 fail。**修该用例** ：在 publish 之后加 approve：

```ts
  it("includes public skills from other authors and excludes soft-deleted", async () => {
    const db = createTestDb();
    const repo = new SkillsRepository(db);
    const alice = await user(db, "alice");
    const bob = await user(db, "bob");
    const adminUser = await user(db, "boss");  // ← 新增
    const aPublic = await repo.create(alice.id, { title: "shared", systemPrompt: "x" });
    await repo.publish(aPublic.id, alice.id);
    await repo.approve(aPublic.id, adminUser.id);  // ← 新增：approve 后才对 bob 可见
    const aPrivate = await repo.create(alice.id, { title: "secret", systemPrompt: "y" });
    // ...rest unchanged
  });
```

同样修 `findAvailableForUse enforces ownership or public visibility` 用例：在 `await repo.publish(skill.id, alice.id);` 之后加 `await repo.approve(skill.id, (await user(db, "boss")).id);`，因 publish 后 status 是 pending，bob 不可见。

- [ ] **Step 3.2：跑测试确认失败**

```bash
npm -w @server-agent/server test -- skills.test
```

Expected：listPending/approve/reject 等新 case fail（method not found）；改造的现有 case 因加了 approve 步骤但 approve 不存在也 fail。

- [ ] **Step 3.3：实现 4 个新方法 + 改造**

Modify `packages/server/src/db/repositories/skills.ts`：

加 imports（保持现有）：
```ts
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
```

把 `listAvailableTo` 改成（非 author 加 review_status 过滤）：
```ts
async listAvailableTo(userId: number) {
  return this.db.select().from(skills).where(and(
    isNull(skills.deletedAt),
    or(
      eq(skills.authorUserId, userId),
      and(eq(skills.isPublic, 1), eq(skills.reviewStatus, "approved"))
    )
  )).orderBy(desc(skills.updatedAt));
}
```

把 `findAvailableForUse` 改成（同理，但限定到单条 id）：
```ts
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
```

把 `update` 改成（语义重要字段触发重审）：
```ts
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
```

把 `publish` 改成（每次 publish 重置 review）：
```ts
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
```

加 4 个新方法（在 softDelete 之后、upsertBySlug 之前）：

```ts
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
```

把 `upsertBySlug` 改成支持传 reviewStatus：

```ts
interface UpsertSkillInput {
  // ...existing fields
  reviewStatus?: "pending" | "approved" | "rejected";
}

// 在 values 内加：
reviewStatus: input.reviewStatus ?? "pending",
reviewedAt: input.reviewStatus === "approved" ? now : null,
```

- [ ] **Step 3.4：跑测试**

```bash
npm -w @server-agent/server test -- skills.test
```

Expected：所有 case（含原 5 + 新 7 + 改造 2 = 14 case）全过。

- [ ] **Step 3.5：commit**

```bash
git add packages/server/src/db/repositories/skills.ts packages/server/tests/unit/repositories/skills.test.ts
git commit -m "feat(server): SkillsRepository review workflow methods + listAvailableTo filter

- listPending / listByReviewStatus / approve / reject 4 个新方法
- listAvailableTo / findAvailableForUse 对非 author 加 review_status='approved' 过滤
- update 改 systemPrompt/inputSchema 自动重审
- publish 重置 review 字段（每次 publish 重审）
- upsertBySlug 支持传 reviewStatus（admin CLI preset import 用）"
```

---

## Task 4：sessionMiddleware load role + me() 返 role

**Files:**

- Modify: `packages/server/src/middleware/session.ts`
- Modify: `packages/server/src/routes/auth/me.ts`

- [ ] **Step 4.1：sessionMiddleware 加 role 字段**

Modify `packages/server/src/middleware/session.ts`：

把 declare module 改成：
```ts
declare module "fastify" {
  interface FastifyRequest {
    user?: {
      id: number;
      username: string;
      createdAt: Date;
      role: "user" | "admin";
    };
  }
}
```

把 `sessionMiddleware` 内 `request.user = {...}` 改成：
```ts
request.user = {
  id: row.user.id,
  username: row.user.username,
  createdAt: row.user.createdAt,
  role: row.user.role
};
```

`SessionRepository.findValid` 已 select `users` 表全部字段（看 `sessions.ts:31-34`），role 字段自动可读。

- [ ] **Step 4.2：me() route 返回加 role**

读 `packages/server/src/routes/auth/me.ts`：

```bash
cat packages/server/src/routes/auth/me.ts
```

把返回的 user object 加 role 字段。例如原来：
```ts
return { user: { id: user.id, username: user.username, createdAt: user.createdAt.toISOString() } };
```

改成：
```ts
return { user: { id: user.id, username: user.username, createdAt: user.createdAt.toISOString(), role: user.role } };
```

- [ ] **Step 4.3：跑 typecheck + 现有 test**

```bash
npm -w @server-agent/server run typecheck
npm -w @server-agent/server test
```

Expected：typecheck 全过；现有 me.test 可能 fail（返回 shape 多了字段），按现有断言风格修：

如果 `tests/unit/routes/auth/me.test.ts` 断言 `expect(res.json().user).toEqual({...})`，加上 `role: "user"`。如果是 `toMatchObject`，加不加都过。

- [ ] **Step 4.4：commit**

```bash
git add packages/server/src/middleware/session.ts packages/server/src/routes/auth/me.ts packages/server/tests/unit/routes/auth/me.test.ts
git commit -m "feat(server): sessionMiddleware loads user.role; me() returns role"
```

---

## Task 5：requireAdmin middleware（TDD）

**Files:**

- Create: `packages/server/src/middleware/admin.ts`
- Create: `packages/server/tests/unit/middleware/admin.test.ts`

- [ ] **Step 5.1：写失败测试**

Create `packages/server/tests/unit/middleware/admin.test.ts`：

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { InviteRepository } from "../../../src/db/repositories/invites.js";
import { UserRepository } from "../../../src/db/repositories/users.js";
import { buildApp } from "../../../src/server.js";

let appBuilder: typeof buildApp;
beforeAll(async () => {
  process.env.PORT = "8080";
  process.env.HOST = "127.0.0.1";
  process.env.NODE_ENV = "test";
  ({ buildApp: appBuilder } = await import("../../../src/server.js"));
});

const INVITE_CODE = "ADMINMWTEST1";

async function loginAs(username: string, role: "user" | "admin" = "user") {
  const db = createTestDb();
  await new InviteRepository(db).create({ code: INVITE_CODE, usesRemaining: 5, createdBy: "test" });
  const app = await appBuilder({ db });
  await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username, password: "password123", inviteCode: INVITE_CODE }
  });
  if (role === "admin") {
    await new UserRepository(db).setRole(username, "admin");
  }
  const login = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { username, password: "password123" }
  });
  const cookie = ((login.headers["set-cookie"] as string) ?? "").split(";")[0];
  return { app, cookie };
}

describe("requireAdmin middleware via /api/admin/skills", () => {
  it("returns 401 when not logged in", async () => {
    const db = createTestDb();
    const app = await appBuilder({ db });
    const res = await app.inject({ method: "GET", url: "/api/admin/skills" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 when logged in as user role", async () => {
    const { app, cookie } = await loginAs("alice", "user");
    const res = await app.inject({ method: "GET", url: "/api/admin/skills", headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("ADMIN_FORBIDDEN");
    await app.close();
  });

  it("passes when logged in as admin role", async () => {
    const { app, cookie } = await loginAs("boss", "admin");
    const res = await app.inject({ method: "GET", url: "/api/admin/skills", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().skills)).toBe(true);
    await app.close();
  });
});
```

注意：测试依赖 `UserRepository.setRole`（Task 7 会加，但 admin route 也依赖该 method）。**先在这个 task 里同时给 UserRepository 加 setRole** —— 一个小函数，跨 Task 6/7 共用：

Modify `packages/server/src/db/repositories/users.ts`：在最后加：

```ts
async setRole(username: string, role: "user" | "admin") {
  await this.db.update(users).set({ role }).where(eq(users.username, username));
}
```

- [ ] **Step 5.2：跑测试确认失败**

```bash
mkdir -p packages/server/tests/unit/middleware
npm -w @server-agent/server test -- admin.test
```

Expected：fail（middleware 不存在 + admin route 不存在）。

- [ ] **Step 5.3：实现 requireAdmin middleware**

Create `packages/server/src/middleware/admin.ts`：

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, errorBody } from "../errors.js";
import { requireUser } from "./session.js";

export function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = requireUser(request, reply);
  if (!user) return null;
  if (user.role !== "admin") {
    const error = new AppError(403, "ADMIN_FORBIDDEN", "需要管理员权限");
    void reply.code(error.statusCode).send(errorBody(error));
    return null;
  }
  return user;
}
```

不实现 admin skill route — Task 6 做。Task 5 仅完成 middleware + setRole。

- [ ] **Step 5.4：跑 setRole 验证**

写一个 inline test 临时验证 setRole 能跑（也可以等 Task 6 admin route 实现后再统一跑）：

```bash
# 验证 setRole 可调用
cd /Users/jiangqichao/Documents/workspace/server_agent
DB_PATH=/tmp/setrole-test.db npm -w @server-agent/server run db:migrate 2>&1 | tail -2
node -e "
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
process.env.DB_PATH = '/tmp/setrole-test.db';
import('./packages/server/src/db/repositories/users.js').then(async ({ UserRepository }) => {
  const sqlite = new Database('/tmp/setrole-test.db');
  const db = drizzle(sqlite);
  const repo = new UserRepository(db);
  const u = await repo.create('admin-test', 'hash');
  await repo.setRole('admin-test', 'admin');
  const role = sqlite.prepare('SELECT role FROM users WHERE id=?').get(u.id).role;
  console.log('role:', role);
  sqlite.close();
});
" 2>&1 | tail -3
```

跳过这个 inline 验证；Task 6 写完 route 测试时会间接验证 setRole。直接进 5.5。

- [ ] **Step 5.5：commit**

```bash
git add packages/server/src/middleware/admin.ts packages/server/src/db/repositories/users.ts
git commit -m "feat(server): requireAdmin middleware + UserRepository.setRole"
```

注：admin.test.ts 留到 Task 6 一起 commit（因为它依赖 admin route 实现才能跑通 200 case）。

---

## Task 6：admin route /api/admin/skills（TDD）

**Files:**

- Create: `packages/server/src/routes/admin/skills.ts`
- Create: `packages/server/tests/unit/routes/admin-skills.test.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 6.1：写失败测试**

Create `packages/server/tests/unit/routes/admin-skills.test.ts`：

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { InviteRepository } from "../../../src/db/repositories/invites.js";
import { UserRepository } from "../../../src/db/repositories/users.js";
import { SkillsRepository } from "../../../src/db/repositories/skills.js";
import type { AppDb } from "../../../src/db/client.js";
import { buildApp } from "../../../src/server.js";

let appBuilder: typeof buildApp;
beforeAll(async () => {
  process.env.PORT = "8080";
  process.env.HOST = "127.0.0.1";
  process.env.NODE_ENV = "test";
  ({ buildApp: appBuilder } = await import("../../../src/server.js"));
});

const INVITE_CODE = "ADMINSKILLTEST";

async function login(db: AppDb, username: string, role: "user" | "admin"): Promise<string> {
  const invites = new InviteRepository(db);
  if (!(await invites.list()).some((i) => i.code === INVITE_CODE)) {
    await invites.create({ code: INVITE_CODE, usesRemaining: 99, createdBy: "test" });
  }
  const app = await appBuilder({ db });
  await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username, password: "password123", inviteCode: INVITE_CODE }
  });
  if (role === "admin") await new UserRepository(db).setRole(username, "admin");
  const r = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { username, password: "password123" }
  });
  await app.close();
  return ((r.headers["set-cookie"] as string) ?? "").split(";")[0];
}

async function setupCommonDb() {
  const db = createTestDb();
  const adminCookie = await login(db, "boss", "admin");
  const userCookie = await login(db, "alice", "user");
  const aliceId = (await new UserRepository(db).findByUsername("alice"))!.id;
  const bossId = (await new UserRepository(db).findByUsername("boss"))!.id;
  return { db, adminCookie, userCookie, aliceId, bossId };
}

describe("admin skills routes", () => {
  it("GET /api/admin/skills?status=pending returns pending list with author username", async () => {
    const { db, adminCookie, aliceId } = await setupCommonDb();
    const skillsRepo = new SkillsRepository(db);
    const s = await skillsRepo.create(aliceId, { title: "P", systemPrompt: "p" });
    await skillsRepo.publish(s.id, aliceId);
    const app = await appBuilder({ db });
    const res = await app.inject({ method: "GET", url: "/api/admin/skills?status=pending", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skills.length).toBe(1);
    expect(body.skills[0].title).toBe("P");
    expect(body.skills[0].authorUsername).toBe("alice");
    expect(body.skills[0].reviewStatus).toBe("pending");
    await app.close();
  });

  it("POST /api/admin/skills/:id/approve sets approved status", async () => {
    const { db, adminCookie, aliceId } = await setupCommonDb();
    const skillsRepo = new SkillsRepository(db);
    const s = await skillsRepo.create(aliceId, { title: "P", systemPrompt: "p" });
    await skillsRepo.publish(s.id, aliceId);
    const app = await appBuilder({ db });
    const res = await app.inject({ method: "POST", url: `/api/admin/skills/${s.id}/approve`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const after = await skillsRepo.findById(s.id, aliceId);
    expect(after?.reviewStatus).toBe("approved");
    await app.close();
  });

  it("POST /api/admin/skills/:id/reject requires reason", async () => {
    const { db, adminCookie, aliceId } = await setupCommonDb();
    const skillsRepo = new SkillsRepository(db);
    const s = await skillsRepo.create(aliceId, { title: "P", systemPrompt: "p" });
    await skillsRepo.publish(s.id, aliceId);
    const app = await appBuilder({ db });
    const noReason = await app.inject({
      method: "POST", url: `/api/admin/skills/${s.id}/reject`,
      headers: { cookie: adminCookie }, payload: {}
    });
    expect(noReason.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST", url: `/api/admin/skills/${s.id}/reject`,
      headers: { cookie: adminCookie }, payload: { reason: "敏感词" }
    });
    expect(ok.statusCode).toBe(200);
    const after = await skillsRepo.findById(s.id, aliceId);
    expect(after?.reviewStatus).toBe("rejected");
    expect(after?.rejectReason).toBe("敏感词");
    await app.close();
  });

  it("non-admin user gets 403 on admin routes", async () => {
    const { db, userCookie } = await setupCommonDb();
    const app = await appBuilder({ db });
    const res = await app.inject({ method: "GET", url: "/api/admin/skills", headers: { cookie: userCookie } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] **Step 6.2：跑测试确认失败**

```bash
mkdir -p packages/server/src/routes/admin
npm -w @server-agent/server test -- admin-skills.test
```

Expected：fail（404 或 module 未注册）。

- [ ] **Step 6.3：实现 admin skills route**

Create `packages/server/src/routes/admin/skills.ts`：

```ts
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
```

- [ ] **Step 6.4：注册到 server.ts**

Modify `packages/server/src/server.ts`：

加 import：
```ts
import adminSkillRoutes from "./routes/admin/skills.js";
```

在 `app.register(skillsRoutes, ...)` 之后加：
```ts
await app.register(adminSkillRoutes, { prefix: "/api/admin", db });
```

- [ ] **Step 6.5：跑全套测试**

```bash
npm -w @server-agent/shared run build
npm -w @server-agent/server test
npm run lint
```

Expected：admin-skills 4 case + admin middleware 3 case + 现有全部 通过。

- [ ] **Step 6.6：commit**

```bash
git add packages/server/src/routes/admin/skills.ts packages/server/src/server.ts packages/server/tests/unit/middleware/admin.test.ts packages/server/tests/unit/routes/admin-skills.test.ts
git commit -m "feat(server): /api/admin/skills routes + requireAdmin tests

- GET /api/admin/skills?status=pending|approved|rejected
- POST /api/admin/skills/:id/approve
- POST /api/admin/skills/:id/reject (body: {reason})
- 全部 require admin role；non-admin → 403
- 4 个 route 测试 + 3 个 middleware 测试"
```

---

## Task 7：admin CLI 加 5 子命令（TDD）

**Files:**

- Modify: `scripts/admin-cli.ts`
- Modify: `packages/server/tests/unit/admin-cli.test.ts`

- [ ] **Step 7.1：写失败测试**

追加到 `packages/server/tests/unit/admin-cli.test.ts` 的 describe block 内：

```ts
  it("user grant-admin sets role to admin; revoke-admin sets back to user", async () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    await users.create("alice", "hash");
    const grant = await runAdminCli(["user", "grant-admin", "alice"], { db });
    expect(grant.exitCode).toBe(0);
    expect(grant.stdout).toMatch(/granted|admin/i);
    expect((await users.findByUsername("alice"))?.role).toBe("admin");

    const revoke = await runAdminCli(["user", "revoke-admin", "alice"], { db });
    expect(revoke.exitCode).toBe(0);
    expect((await users.findByUsername("alice"))?.role).toBe("user");
  });

  it("skill list-pending prints id, title, author for pending skills", async () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    const alice = await users.create("alice", "hash");
    const skillsRepo = new SkillsRepository(db);
    const s = await skillsRepo.create(alice.id, { title: "Pending Skill", systemPrompt: "p" });
    await skillsRepo.publish(s.id, alice.id);

    const r = await runAdminCli(["skill", "list-pending"], { db });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(String(s.id));
    expect(r.stdout).toContain("Pending Skill");
    expect(r.stdout).toContain("alice");
  });

  it("skill approve <id> sets approved", async () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    const alice = await users.create("alice", "hash");
    const boss = await users.create("boss", "hash");
    await users.setRole("boss", "admin");
    const skillsRepo = new SkillsRepository(db);
    const s = await skillsRepo.create(alice.id, { title: "P", systemPrompt: "p" });
    await skillsRepo.publish(s.id, alice.id);

    const r = await runAdminCli(["skill", "approve", String(s.id)], { db });
    expect(r.exitCode).toBe(0);
    const after = await skillsRepo.findById(s.id, alice.id);
    expect(after?.reviewStatus).toBe("approved");
  });

  it("skill reject <id> --reason '...' sets rejected", async () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    const alice = await users.create("alice", "hash");
    await users.create("boss", "hash");
    await users.setRole("boss", "admin");
    const skillsRepo = new SkillsRepository(db);
    const s = await skillsRepo.create(alice.id, { title: "P", systemPrompt: "p" });
    await skillsRepo.publish(s.id, alice.id);

    const r = await runAdminCli(["skill", "reject", String(s.id), "--reason", "敏感词命中"], { db });
    expect(r.exitCode).toBe(0);
    const after = await skillsRepo.findById(s.id, alice.id);
    expect(after?.reviewStatus).toBe("rejected");
    expect(after?.rejectReason).toBe("敏感词命中");
  });
```

注：上面 `skill approve` / `skill reject` case 创建了 boss admin 但没用 admin 身份调用 — 因为 admin CLI 跑的是 ssh 直接走 DB，**不经过 HTTP middleware**，无 admin 校验。CLI 永远是"超级用户"路径，由 ssh 权限本身保护。`reviewedBy` 从哪取？解决方法：CLI 子命令自动以一个 admin user（默认找 username='admin' 或 fallback 第一个 role='admin' 的）作为审核人；如找不到 admin 用户则报错或用 system 用户充数。**简化**：admin CLI approve/reject 直接写 `reviewedBy = NULL`（表示 CLI 操作），UI 不显示 reviewedBy 时 fallback "admin CLI"。

更新 case 期待：reject case 不验证 reviewedBy（因为是 NULL）；approve case 也不验证 reviewedBy。

- [ ] **Step 7.2：跑测试确认失败**

```bash
npm -w @server-agent/server test -- admin-cli
```

Expected：5 个新 case fail（command not found）。

- [ ] **Step 7.3：实现 5 个子命令**

Modify `scripts/admin-cli.ts`：

import 加：
```ts
import { rejectSkillRequestSchema } from "@server-agent/shared";
```

在现有 `user delete` 之后追加：

```ts
  user.command("grant-admin").argument("<username>").action(async (username: string) => {
    const repo = new UserRepository(db);
    const u = await repo.findByUsername(username);
    if (!u) throw new Error("user not found");
    await repo.setRole(username, "admin");
    out(`admin role granted to ${username}`);
  });

  user.command("revoke-admin").argument("<username>").action(async (username: string) => {
    const repo = new UserRepository(db);
    const u = await repo.findByUsername(username);
    if (!u) throw new Error("user not found");
    await repo.setRole(username, "user");
    out(`admin role revoked from ${username}`);
  });
```

在 `preset import` 之后追加 skill 子命令：

```ts
  const skill = program.command("skill");

  skill.command("list-pending").action(async () => {
    const skillsRepo = new SkillsRepository(db);
    const userRepo = new UserRepository(db);
    const rows = await skillsRepo.listPending();
    const authorIds = Array.from(new Set(rows.map((r) => r.authorUserId)));
    const usersById = await userRepo.findManyByIds(authorIds);
    if (rows.length === 0) {
      out("(no pending skills)");
      return;
    }
    for (const r of rows) {
      const author = usersById.get(r.authorUserId)?.username ?? "?";
      out(`${r.id}\t${r.title}\t@${author}\tpublished=${r.publishedAt?.toISOString() ?? "-"}`);
    }
  });

  skill.command("approve").argument("<id>").action(async (idStr: string) => {
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id)) throw new Error("id must be integer");
    const skillsRepo = new SkillsRepository(db);
    // adminUserId = 0 表示 CLI 操作（DB 里 reviewedBy 留 NULL，因为 0 不是合法 FK）
    // 实际写入 NULL via 直接 set
    const row = await skillsRepo.approve(id, 0).catch(async () => {
      // FK 约束失败 fallback：用第一个 admin 用户
      const adminUser = (await new UserRepository(db).list()).find((u) => u.role === "admin");
      if (!adminUser) throw new Error("no admin user found; create one with grant-admin first");
      return skillsRepo.approve(id, adminUser.id);
    });
    if (!row) throw new Error("skill not found");
    out(`approved skill ${id}`);
  });

  skill.command("reject")
    .argument("<id>")
    .requiredOption("--reason <reason>", "rejection reason")
    .action(async (idStr: string, opts: { reason: string }) => {
      const id = Number.parseInt(idStr, 10);
      if (!Number.isFinite(id)) throw new Error("id must be integer");
      const parsed = rejectSkillRequestSchema.safeParse({ reason: opts.reason });
      if (!parsed.success) throw new Error("reason: " + parsed.error.issues[0].message);
      const skillsRepo = new SkillsRepository(db);
      const row = await skillsRepo.reject(id, 0, parsed.data.reason).catch(async () => {
        const adminUser = (await new UserRepository(db).list()).find((u) => u.role === "admin");
        if (!adminUser) throw new Error("no admin user; grant-admin first");
        return skillsRepo.reject(id, adminUser.id, parsed.data.reason);
      });
      if (!row) throw new Error("skill not found");
      out(`rejected skill ${id}: ${parsed.data.reason}`);
    });
```

但上面 catch FK 失败 fallback 不优雅 —— `skillsRepo.approve(id, 0)` 在 SQLite FK ON 时会 throw integrity error，try/catch 能 catch 到但污染语义。更干净：**先查 admin 用户**：

简化版（替换上面 approve/reject 实现）：

```ts
  async function getAdminActorId(): Promise<number> {
    const adminUser = (await new UserRepository(db).list()).find((u) => u.role === "admin");
    if (!adminUser) throw new Error("no admin user; create one with grant-admin first");
    return adminUser.id;
  }

  skill.command("approve").argument("<id>").action(async (idStr: string) => {
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id)) throw new Error("id must be integer");
    const adminId = await getAdminActorId();
    const row = await new SkillsRepository(db).approve(id, adminId);
    if (!row) throw new Error("skill not found");
    out(`approved skill ${id}`);
  });

  skill.command("reject")
    .argument("<id>")
    .requiredOption("--reason <reason>", "rejection reason")
    .action(async (idStr: string, opts: { reason: string }) => {
      const id = Number.parseInt(idStr, 10);
      if (!Number.isFinite(id)) throw new Error("id must be integer");
      const parsed = rejectSkillRequestSchema.safeParse({ reason: opts.reason });
      if (!parsed.success) throw new Error("reason: " + parsed.error.issues[0].message);
      const adminId = await getAdminActorId();
      const row = await new SkillsRepository(db).reject(id, adminId, parsed.data.reason);
      if (!row) throw new Error("skill not found");
      out(`rejected skill ${id}: ${parsed.data.reason}`);
    });
```

这要求 admin CLI approve/reject 之前必须有至少一个 admin 用户。流程：先 `grant-admin admin` → 然后才能用 `skill approve`。这是合理约束（CLI 是 fallback，主要靠 Web admin UI）。

更新 Step 7.1 测试：每个 approve/reject case 在 publish 之后加 `await users.setRole("boss", "admin");` —— 已经写了。✓

- [ ] **Step 7.4：跑测试**

```bash
npm -w @server-agent/server test -- admin-cli
```

Expected：原 4 case + 4 新 case = 8 case 全过。

- [ ] **Step 7.5：commit**

```bash
git add scripts/admin-cli.ts packages/server/tests/unit/admin-cli.test.ts
git commit -m "feat(admin-cli): 5 review-flow subcommands

- user grant-admin / revoke-admin
- skill list-pending: 列出 id\\ttitle\\t@author
- skill approve <id>
- skill reject <id> --reason <text>
- approve/reject 用第一个 admin 用户作为 reviewedBy"
```

---

## Task 8：server route toDto + skills.test 改造

**Files:**

- Modify: `packages/server/src/routes/skills.ts`
- Modify: `packages/server/tests/unit/routes/skills.test.ts`

- [ ] **Step 8.1：toDto 加 reviewStatus/rejectReason/version**

Modify `packages/server/src/routes/skills.ts`：

把 `SkillRow` interface 加：
```ts
reviewStatus: "pending" | "approved" | "rejected";
rejectReason: string | null;
version: number;
reviewedAt: Date | null;
reviewedBy: number | null;
```

把 `toDto` 加 3 字段：
```ts
return {
  ...原字段,
  reviewStatus: row.reviewStatus,
  rejectReason: row.rejectReason,
  version: row.version
};
```

- [ ] **Step 8.2：现有 skills.test.ts 适配审核流**

读 `packages/server/tests/unit/routes/skills.test.ts`，修改：

`GET /api/skills lists own + public skills` 用例 — 现在 alice 创建 public skill 但**未 approve**，bob 看不到。修法：直接通过 DB 设 reviewStatus='approved'，或加 `users.setRole("boss", "admin")` 然后通过 admin route approve。最简单：**直接给 SkillsRepository.create 测试 path 提供一个 approved 的捷径**：

实际上最简洁是在测试里加一个 helper：

```ts
async function publishAndApprove(db: AppDb, skillId: number, authorId: number) {
  const repo = new SkillsRepository(db);
  await repo.publish(skillId, authorId);
  // approve as a virtual admin（用 system 用户充当 reviewedBy）
  const sys = await new UserRepository(db).findByUsername("system");
  if (!sys) throw new Error("system user missing");
  await repo.approve(skillId, sys.id);
}
```

把 `GET /api/skills lists own + public skills` 用例改造：alice 创建 skill 后调 `publishAndApprove`，再让 bob 列表能看到。

PATCH 用例不动（PATCH 路径不依赖 review）。

新增一个用例 — author 看自己 rejected skill：

```ts
  it("author can see own rejected skills via GET /api/skills", async () => {
    const { app, db, cookie } = await buildLoggedInApp("alice");
    const aliceId = (await new UserRepository(db).findByUsername("alice"))!.id;
    const repo = new SkillsRepository(db);
    const sys = await new UserRepository(db).findByUsername("system");
    const s = await repo.create(aliceId, { title: "MyRejected", systemPrompt: "p" });
    await repo.publish(s.id, aliceId);
    await repo.reject(s.id, sys!.id, "test rejection");
    const list = await app.inject({ method: "GET", url: "/api/skills", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const found = list.json().skills.find((sk: { id: number }) => sk.id === s.id);
    expect(found).toBeDefined();
    expect(found.reviewStatus).toBe("rejected");
    expect(found.rejectReason).toBe("test rejection");
    await app.close();
  });
```

- [ ] **Step 8.3：跑全套测试**

```bash
npm -w @server-agent/shared run build
npm -w @server-agent/server test
```

Expected：全过（原 5 + 新 1 = 6 case）。

- [ ] **Step 8.4：commit**

```bash
git add packages/server/src/routes/skills.ts packages/server/tests/unit/routes/skills.test.ts
git commit -m "feat(server): toDto exposes review fields; tests adapt to approval gate"
```

---

## Task 9：前端 API client + me() User type 加 role

**Files:**

- Create: `packages/web/src/lib/admin.ts`
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 9.1：api.ts User 加 role**

Modify `packages/web/src/lib/api.ts`：

把 `User` 改成：
```ts
export interface User {
  id: number;
  username: string;
  createdAt: string;
  role: "user" | "admin";
}
```

- [ ] **Step 9.2：写 admin client**

Create `packages/web/src/lib/admin.ts`：

```ts
import type { SkillInputField } from "@server-agent/shared";
import { ApiError, type ApiErrorBody } from "./api.js";

export interface AdminSkillDto {
  id: number;
  title: string;
  description: string;
  systemPrompt: string;
  inputSchema: SkillInputField[] | null;
  tags: string[];
  slug: string | null;
  version: number;
  reviewStatus: "pending" | "approved" | "rejected";
  rejectReason: string | null;
  publishedAt: string | null;
  createdAt: string;
  authorUsername: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init.headers }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = body as ApiErrorBody;
    throw new ApiError(error.error?.code ?? "INTERNAL", error.error?.message ?? "请求失败", res.status);
  }
  return body as T;
}

export function listAdminSkills(status: "pending" | "approved" | "rejected" = "pending") {
  return request<{ skills: AdminSkillDto[] }>(`/api/admin/skills?status=${status}`);
}

export function approveSkill(id: number) {
  return request<{ ok: true }>(`/api/admin/skills/${id}/approve`, { method: "POST" });
}

export function rejectSkill(id: number, reason: string) {
  return request<{ ok: true }>(`/api/admin/skills/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}
```

- [ ] **Step 9.3：typecheck**

```bash
npm -w @server-agent/web run typecheck
```

- [ ] **Step 9.4：commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/admin.ts
git commit -m "feat(web): admin api client + User type adds role"
```

---

## Task 10：前端 SkillItem review badge + SaveSkillDialog 文案

**Files:**

- Modify: `packages/web/src/routes/chat/SkillItem.tsx`
- Modify: `packages/web/src/routes/chat/SaveSkillDialog.tsx`

- [ ] **Step 10.1：SkillItem 加 review badge**

读现有 `packages/web/src/routes/chat/SkillItem.tsx`，在 lock/globe icon 之后插入 `<ReviewBadge skill={skill} />`。

把整个文件改成（替换原内容）：

```tsx
import { CheckCircle2, Clock, Globe, Lock, MoreVertical, Pencil, Trash2, XCircle } from "lucide-react";
import type { SkillDto } from "@server-agent/shared";
import { Button } from "../../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../components/ui/dropdown-menu.js";

interface SkillItemProps {
  skill: SkillDto;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePublic: () => void;
}

function ReviewBadge({ skill }: { skill: SkillDto }) {
  if (!skill.isPublic) return null;
  if (skill.reviewStatus === "approved") {
    return <CheckCircle2 className="inline h-3 w-3 text-green-500" aria-label="已通过审核" />;
  }
  if (skill.reviewStatus === "pending") {
    return <Clock className="inline h-3 w-3 text-yellow-500" aria-label="审核中" />;
  }
  return (
    <XCircle
      className="inline h-3 w-3 text-red-500"
      aria-label="审核未通过"
      title={skill.rejectReason ?? "审核未通过"}
    />
  );
}

export function SkillItem({ skill, onUse, onEdit, onDelete, onTogglePublic }: SkillItemProps) {
  return (
    <div className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-800">
      <button
        className="min-w-0 flex-1 truncate text-left text-sm"
        onClick={onUse}
        title={skill.description || skill.title}
      >
        <span className="mr-1 inline-flex items-center gap-0.5">
          {skill.isPublic ? (
            <Globe className="inline h-3 w-3" />
          ) : (
            <Lock className="inline h-3 w-3" />
          )}
          <ReviewBadge skill={skill} />
        </span>
        {skill.title}
        {!skill.isOwn && (
          <span className="ml-1 text-xs text-zinc-500">@{skill.authorUsername}</span>
        )}
      </button>
      {skill.isOwn && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Skill 操作"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="h-3 w-3" /> 编辑
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onTogglePublic}>
              {skill.isPublic ? "设为私有" : "公开发布"}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-red-400" onSelect={onDelete}>
              <Trash2 className="h-3 w-3" /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
```

- [ ] **Step 10.2：SaveSkillDialog 加审核提示**

Modify `packages/web/src/routes/chat/SaveSkillDialog.tsx`：

找到 isPublic checkbox 的 label 块，在它之后追加：

```tsx
{isPublic && (
  <p className="ml-6 text-xs text-zinc-500">
    将提交人工审核。审核通过后才会进入公开列表。
  </p>
)}
```

- [ ] **Step 10.3：typecheck + lint**

```bash
npm -w @server-agent/web run typecheck
npm run lint
```

- [ ] **Step 10.4：commit**

```bash
git add packages/web/src/routes/chat/SkillItem.tsx packages/web/src/routes/chat/SaveSkillDialog.tsx
git commit -m "feat(web): SkillItem review badge + SaveSkillDialog audit notice"
```

---

## Task 11：/admin/skills 页 + AdminSkillRow + RejectReasonDialog

**Files:**

- Create: `packages/web/src/routes/admin/skills.tsx`
- Create: `packages/web/src/routes/admin/AdminSkillRow.tsx`
- Create: `packages/web/src/routes/admin/RejectReasonDialog.tsx`
- Modify: `packages/web/src/main.tsx`

- [ ] **Step 11.1：写 RejectReasonDialog**

Create `packages/web/src/routes/admin/RejectReasonDialog.tsx`：

```tsx
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.js";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  isSubmitting: boolean;
}

export function RejectReasonDialog({ open, onOpenChange, onSubmit, isSubmitting }: Props) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>拒绝原因</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            rows={4}
            maxLength={280}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="说明拒绝原因，作者会看到（最多 280 字）"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button
              onClick={() => onSubmit(reason.trim())}
              disabled={isSubmitting || reason.trim().length === 0}
            >
              确认拒绝
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 11.2：写 AdminSkillRow**

Create `packages/web/src/routes/admin/AdminSkillRow.tsx`：

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AdminSkillDto } from "../../lib/admin.js";
import { Button } from "../../components/ui/button.js";

interface Props {
  skill: AdminSkillDto;
  onApprove: () => void;
  onReject: () => void;
  busy?: boolean;
}

export function AdminSkillRow({ skill, onApprove, onReject, busy }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-zinc-800 p-3">
      <div className="flex items-start gap-2">
        <button
          className="mt-1 text-zinc-400 hover:text-zinc-200"
          onClick={() => setExpanded((v) => !v)}
          aria-label="展开"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">#{skill.id}</span>
            <span className="truncate">{skill.title}</span>
            <span className="text-xs text-zinc-500">@{skill.authorUsername}</span>
            <span className="text-xs text-zinc-500">v{skill.version}</span>
          </div>
          <p className="truncate text-xs text-zinc-400">
            {skill.description || "（无描述）"}
          </p>
          {skill.reviewStatus === "rejected" && skill.rejectReason ? (
            <p className="mt-1 text-xs text-red-400">已拒绝：{skill.rejectReason}</p>
          ) : null}
        </div>
        {skill.reviewStatus === "pending" ? (
          <div className="flex gap-1">
            <Button size="sm" onClick={onApprove} disabled={busy}>通过</Button>
            <Button size="sm" variant="destructive" onClick={onReject} disabled={busy}>拒绝</Button>
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div className="mt-3 space-y-2 pl-6 text-xs">
          <div>
            <p className="text-zinc-400 mb-1">System Prompt</p>
            <pre className="whitespace-pre-wrap rounded bg-zinc-900 p-2 text-zinc-300">{skill.systemPrompt}</pre>
          </div>
          {skill.inputSchema && skill.inputSchema.length > 0 ? (
            <div>
              <p className="text-zinc-400 mb-1">Input Schema（{skill.inputSchema.length} 个字段）</p>
              <ul className="space-y-1">
                {skill.inputSchema.map((f) => (
                  <li key={f.name} className="text-zinc-300">
                    <span className="font-mono">{f.name}</span>
                    <span className="text-zinc-500"> · {f.type}</span>
                    {f.required ? <span className="ml-1 text-red-400">*</span> : null}
                    <span className="ml-2 text-zinc-400">{f.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {skill.tags.length > 0 ? (
            <div>
              <p className="text-zinc-400 mb-1">Tags</p>
              <div className="flex gap-1">
                {skill.tags.map((t) => (
                  <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{t}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 11.3：写 AdminSkillsPage**

Create `packages/web/src/routes/admin/skills.tsx`：

```tsx
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { me } from "../../lib/api.js";
import { listAdminSkills, approveSkill, rejectSkill } from "../../lib/admin.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { AdminSkillRow } from "./AdminSkillRow.js";
import { RejectReasonDialog } from "./RejectReasonDialog.js";

type Status = "pending" | "approved" | "rejected";

export function AdminSkillsPage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ["me"], queryFn: me, retry: false });
  const [status, setStatus] = useState<Status>("pending");
  const [rejectingId, setRejectingId] = useState<number | null>(null);

  const skillsQuery = useQuery({
    queryKey: ["admin-skills", status],
    queryFn: () => listAdminSkills(status),
    enabled: meQuery.data?.user.role === "admin"
  });

  const approveMutation = useMutation({
    mutationFn: approveSkill,
    onSuccess: () => {
      toast.success("已通过");
      void queryClient.invalidateQueries({ queryKey: ["admin-skills"] });
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: () => toast.error("操作失败")
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => rejectSkill(id, reason),
    onSuccess: () => {
      toast.success("已拒绝");
      setRejectingId(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-skills"] });
      void queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: () => toast.error("操作失败")
  });

  if (meQuery.isLoading) return <main className="p-8 text-zinc-100">加载中...</main>;
  if (meQuery.isError || !meQuery.data) return <Navigate to="/login" replace />;
  if (meQuery.data.user.role !== "admin") return <Navigate to="/chat" replace />;

  const skills = skillsQuery.data?.skills ?? [];

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex items-center gap-3">
          <Link to="/chat" className="text-zinc-400 hover:text-zinc-200">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-semibold">Skill 审核</h1>
        </div>

        <div className="mb-3 flex gap-1">
          {(["pending", "approved", "rejected"] as Status[]).map((s) => (
            <Button
              key={s}
              variant={status === s ? "default" : "ghost"}
              size="sm"
              onClick={() => setStatus(s)}
            >
              {s === "pending" ? "待审" : s === "approved" ? "已通过" : "被拒"}
            </Button>
          ))}
        </div>

        {skillsQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : skills.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            {status === "pending" ? "没有待审 skill" : status === "approved" ? "没有已通过 skill" : "没有被拒 skill"}
          </p>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <AdminSkillRow
                key={skill.id}
                skill={skill}
                onApprove={() => approveMutation.mutate(skill.id)}
                onReject={() => setRejectingId(skill.id)}
                busy={approveMutation.isPending || rejectMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      <RejectReasonDialog
        open={rejectingId !== null}
        onOpenChange={(v) => { if (!v) setRejectingId(null); }}
        isSubmitting={rejectMutation.isPending}
        onSubmit={(reason) => {
          if (rejectingId !== null) rejectMutation.mutate({ id: rejectingId, reason });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 11.4：注册路由**

Modify `packages/web/src/main.tsx`：

读现有：
```bash
cat packages/web/src/main.tsx
```

import + 路由 加：

```tsx
import { AdminSkillsPage } from "./routes/admin/skills.js";
// ...
<Route path="/admin/skills" element={<AdminSkillsPage />} />
```

放在现有 `/chat` route 之后即可。

- [ ] **Step 11.5：typecheck + lint**

```bash
npm -w @server-agent/web run typecheck
npm run lint
```

- [ ] **Step 11.6：commit**

```bash
git add packages/web/src/routes/admin packages/web/src/main.tsx
git commit -m "feat(web): /admin/skills page with tab + approve/reject + reject dialog"
```

---

## Task 12：Sidebar 加 admin 入口 + 完整四件套 + 本地 smoke

**Files:**

- Modify: `packages/web/src/routes/chat/Sidebar.tsx`

- [ ] **Step 12.1：Sidebar 加 admin link**

读 `packages/web/src/routes/chat/Sidebar.tsx`，找到底部 username row。把 `username` prop 类型从 `string` 升级 — 改为 `me?: { username: string; role: "user" | "admin" }`。

注意现有 ChatPage 调用 Sidebar 是 `username={meQuery.data.user.username}`，要同步改为 `me={meQuery.data.user}`。

最简改动：保留 `username` prop，加新 prop `userRole?: "user" | "admin"`：

```tsx
interface SidebarProps {
  // 已有...
  userRole?: "user" | "admin";
}
```

底部 username row 加：

```tsx
import { Link } from "react-router-dom";
// ...
<div className="flex items-center justify-between border-t border-zinc-800 p-3">
  <div className="flex items-center gap-2 truncate">
    <span className="truncate text-sm text-zinc-400">{username}</span>
    {userRole === "admin" ? (
      <Link to="/admin/skills" className="text-xs text-zinc-500 hover:text-zinc-300">
        审核中心
      </Link>
    ) : null}
  </div>
  <Button variant="ghost" size="icon" aria-label="登出" onClick={onLogout}>
    <LogOut className="h-4 w-4" />
  </Button>
</div>
```

ChatPage 端把 `userRole={meQuery.data.user.role}` 加到 Sidebar 调用。

- [ ] **Step 12.2：四件套**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected：全过。

- [ ] **Step 12.3：本地 smoke**

```bash
rm -f /tmp/phase5-smoke.db /tmp/phase5-smoke.db-shm /tmp/phase5-smoke.db-wal
DB_PATH=/tmp/phase5-smoke.db npm -w @server-agent/server run db:migrate 2>&1 | tail -2

echo "=== migration 0004 验证 ==="
sqlite3 /tmp/phase5-smoke.db "PRAGMA table_info(users);" | grep role
sqlite3 /tmp/phase5-smoke.db "PRAGMA table_info(skills);" | grep -E "review_status|reject_reason|version"

echo "=== preset import 后 system preset 应自动 approved ==="
DB_PATH=/tmp/phase5-smoke.db npm run admin -- preset import packages/server/src/presets/qa-skills.json 2>&1 | tail -2
sqlite3 /tmp/phase5-smoke.db "SELECT slug, review_status FROM skills WHERE slug IS NOT NULL;"
```

期望 preset import 后 review_status='approved'（**这要求 admin CLI preset import 给 upsertBySlug 传 reviewStatus='approved'**，看 Task 7 是否做了这个改造 — 没做的话现在 review_status 会是 'pending'）。

如果 preset 全是 'pending'，**修 admin-cli.ts 的 preset import action**：

```ts
await skills.upsertBySlug(sysUser.id, {
  // ... existing fields
  isPublic: opts.public,
  reviewStatus: "approved"  // ← 新增
});
```

- [ ] **Step 12.4：commit**

```bash
git add packages/web/src/routes/chat/Sidebar.tsx packages/web/src/routes/chat/index.tsx scripts/admin-cli.ts
git commit -m "feat(web): Sidebar admin link; preset import auto-approves system skills"
```

---

## Task 13：上线 + grant admin + 浏览器验收 + 文档同步

**Files:** `AGENTS.md`, `README.md`, `docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md`

按 §6.8 dev-phase exemption 直接 push 到 main。

- [ ] **Step 13.1：push + 等部署**

```bash
git push origin main
gh run list --branch main --limit 1
```

等 deploy 完成（约 1m30s）：

```bash
gh run watch <run-id> --exit-status
```

- [ ] **Step 13.2：生产 schema 验证**

```bash
ssh root@43.108.21.46 'sudo -u agent sqlite3 $(grep "^DB_PATH=" /etc/server-agent/agent.env | cut -d= -f2 | tr -d "\"") "PRAGMA table_info(skills);" | grep -E "review_status|reject_reason|version"'

ssh root@43.108.21.46 'sudo -u agent sqlite3 $(grep "^DB_PATH=" /etc/server-agent/agent.env | cut -d= -f2 | tr -d "\"") "SELECT username, role FROM users;"'

# grandfather 验证
ssh root@43.108.21.46 'sudo -u agent sqlite3 $(grep "^DB_PATH=" /etc/server-agent/agent.env | cut -d= -f2 | tr -d "\"") "SELECT slug, is_public, review_status FROM skills WHERE is_public=1;"'
```

期望：所有现有 isPublic=1 的 skill review_status='approved'（包含 3 条 system preset）。

- [ ] **Step 13.3：grant admin role**

```bash
ssh root@43.108.21.46 'cd /opt/server_agent && sudo -u agent bash -c "set -a; . /etc/server-agent/agent.env; set +a; npm run admin -- user grant-admin admin"'
```

期望：`admin role granted to admin`。

验证：

```bash
ssh root@43.108.21.46 'sudo -u agent sqlite3 $(grep "^DB_PATH=" /etc/server-agent/agent.env | cut -d= -f2 | tr -d "\"") "SELECT username, role FROM users WHERE role=\"admin\";"'
```

期望：`admin|admin`。

- [ ] **Step 13.4：API smoke**

```bash
BASE=https://aicoolyun.vip
# admin 登录
COOKIE=$(curl -s -i -X POST "$BASE/api/auth/login" -H "content-type: application/json" \
  -d '{"username":"admin","password":"Phase4Admin#2026!"}' \
  | grep -i '^set-cookie:' | head -1 | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)

# me 应返回 role=admin
curl -s "$BASE/api/auth/me" -H "cookie: $COOKIE" | python3 -m json.tool

# /api/admin/skills?status=pending 应返 200（首次部署应为空）
curl -s "$BASE/api/admin/skills?status=pending" -H "cookie: $COOKIE" | python3 -m json.tool

# /api/admin/skills?status=approved 应见 3 条 system preset
curl -s "$BASE/api/admin/skills?status=approved" -H "cookie: $COOKIE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'approved count: {len(d[\"skills\"])}'); [print(f'  - {s[\"slug\"]}: @{s[\"authorUsername\"]}') for s in d['skills']]"
```

- [ ] **Step 13.5：浏览器手测**

打开 https://aicoolyun.vip 用 admin 账号登录：
1. Sidebar 底部应见 "审核中心" 链接
2. 点链接进 /admin/skills，tab 切到"已通过"看到 3 条 system preset（@system / v1）
3. 用 admin 账号自己创建一个公开 skill（任意 systemPrompt），保存
4. 切到 Sidebar Skills tab → 自己的新 skill 显示黄沙漏（pending）
5. 切到 /admin/skills 待审 tab → 应见自己刚创建的 skill
6. 点"通过" → 该 skill 在 Skills tab 黄沙漏变绿勾，被其他 user 在 public 列表见到
7. 创建第二个公开 skill → admin tab 见 → 点"拒绝"输入"测试拒绝原因" → Skills tab 红叉，hover 见 reason

如非 admin 账号登录（注册一个邀请用户）：
8. Sidebar 底部 **无** "审核中心"链接
9. 直接访问 /admin/skills URL → 自动重定向到 /chat
10. 直接 curl `/api/admin/skills` → 403

- [ ] **Step 13.6：roadmap + README + AGENTS 同步**

修改：
- `docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md` §5 phase 5 → done，phase 6 → next
- `README.md` 当前状态行 + 路线图表 phase 5 done
- `AGENTS.md` §0 当前 Phase 行 + §9 路线图

```bash
git add AGENTS.md README.md docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md
git commit -m "docs: phase 5 done, sync README/AGENTS/roadmap"
git push origin main
```

- [ ] **Step 13.7：把坑沉淀进 AGENTS.md（如有）**

如手测发现新坑（例如 Sidebar 链接被 dropdown 遮挡 / admin route prefix 跟现有 conv 路由冲突 / migration 时长警告），加 §6.14+：

```bash
git add AGENTS.md
git commit -m "docs: phase 5 gotcha — <one-liner>"
git push origin main
```

如无新坑跳过。

---

## 收尾验收 checklist（对照 spec §8）

- [ ] lint / typecheck / test / build 全绿
- [ ] migration 0004 真实跑过、PRAGMA 含 5 列；users.role 含
- [ ] grandfather UPDATE 把 isPublic=1 全转 approved（生产 SQL 验证）
- [ ] interpolate / upsertBySlug / repository 全部测试通过
- [ ] admin CLI grant-admin / list-pending / approve / reject 跑通（生产实测）
- [ ] 部署生产 + ssh grant admin 角色（admin 用户可以登录 + 进 /admin/skills）
- [ ] 浏览器手测 7 步全过
- [ ] 关键坑写进 AGENTS.md §6（如有）
- [ ] roadmap §5 / README 当前 Phase 同步




