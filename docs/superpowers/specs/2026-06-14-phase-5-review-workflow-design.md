# Phase 5 — Skill 审核流 Design

**Spec 编号**：2026-06-14-phase-5-review-workflow-design
**目标项目**：[`server_agent`](https://github.com/JqcFrankice/agent_qa)
**作者**：Claude Opus 4.6（与 @JqcFrankice 协作）
**状态**：design 完整，含 D1-D6 决策；下一步进入 writing-plans
**前置**：Phase 4 已上线（[`2026-06-14-phase-4-qa-agent-design.md`](./2026-06-14-phase-4-qa-agent-design.md)），skills 表已含 inputSchema/tags/slug/isPublic/publishedAt 等
**roadmap 对照**：[`2026-05-30-phase-3-6-roadmap.md`](./2026-05-30-phase-3-6-roadmap.md) §3

---

## 0. 单句目标

让作者公开发布 skill 时走人工 review；admin 在 /admin/skills 通过/拒绝；public 列表只显示 approved 内容；作者编辑 system_prompt 自动重审，避免"绕过审核"安全漏洞。

---

## 1. 范围

### 1.1 必须交付

- 数据：migration 0004 给 users 加 role 列、skills 加 review_status/reject_reason/version/reviewed_at/reviewed_by 5 列；historical user public skill + system preset 一次性 grandfather 为 approved
- shared：SkillDto 加 reviewStatus/rejectReason/version；User 加 role；新 approveSkill/rejectSkill request schemas
- server：
  - SkillsRepository 加 listPending / approve / reject 方法 + listAvailableTo / update / publish 改造
  - 新 requireAdmin middleware
  - 新 admin route `/api/admin/skills` (list / approve / reject)
  - sessionMiddleware load user.role
  - admin CLI 加 5 个子命令：user grant-admin / revoke-admin / skill list-pending / approve / reject
- 前端：
  - SkillItem 加 review badge（绿✓/黄⏳/红✗ 仅对 author 自己 visible）
  - SaveSkillDialog 公开发布 checkbox 加审核提示文案
  - 新 /admin/skills 页面（admin only，含 tab：待审/已通过/被拒，approve/reject 按钮，reject 弹 reason dialog）
  - Sidebar 底部 admin 入口链接（仅 admin role 可见）
  - me() User type 加 role
- 测试：repo 5+ case / admin route 4+ case / requireAdmin middleware 3 case / admin-cli 5 case
- 上线流程：
  1. 部署 0004 migration（grandfather UPDATE 把现有 isPublic=1 都标 approved）
  2. ssh 跑 `npm run admin -- user grant-admin admin` 提升你的 admin 账号

### 1.2 不做（YAGNI 边界）

- skill_versions 表（仅加 version 列，不存历史快照）
- in-app 通知中心 / 邮件通知 → Phase 6+
- 自动审核（敏感词扫描 / LLM 审核）→ 永远不做
- 用户举报 / 评分
- skill 编辑 UI（Phase 5 仍由 SaveSkillDialog 充当）—— 编辑路径目前靠 toggle public + admin CLI
- admin 撤销操作（admin 撤回已批准的 skill）—— admin CLI 直接 SQL update 即可

---

## 2. 关键决策（D1-D6）

### D1：版本管理 = 仅加 version 列，不加 versions 表

候选：（A）只加 version 列；（B）skill_versions 表存 immutable 快照；（C）不做版本

**选 A**：

- YAGNI：Phase 5 核心是审核，不是 skill 市场。版本历史 / 回滚 / 指定 version 这些"做了没人用"
- 配合 Phase 3 系统快照机制完美：`conversations.system_prompt` 已快照，作者改 skill 不影响旧会话 — 等于天然有"旧 version 仍可用"的效果
- Phase 6+ 真要做 versions 表，也是 forward-only ALTER + 新表，不破坏现有

### D2：拒绝后状态 = 作者可见 + public 列表自动隐藏 + 需手动重提

候选：（A）作者可见，public 隐藏；（B）拒绝后自动 isPublic=0；（C）隔离状态禁用

**选 A**：

- 状态最清晰：作者明确知道"我的 skill 被拒，原因是 X"
- 选择权交给作者：可以接受拒绝（删除 / 改私有）或继续改后重提
- 不"自动转私有"的隐式行为
- 实现简单：`listAvailableTo` 对非 author 加 `review_status='approved'` 条件

### D3：作者编辑 approved skill 自动重审

仅 `systemPrompt` / `inputSchema` 变化触发；`title` / `description` / `tags` 改动不触发（不影响 LLM 行为）。

`PATCH /api/skills/:id` 的 `update()` 检测语义重要字段改动 → repo 层自动设 `review_status='pending'` + 清空 reviewedAt/reviewedBy/rejectReason。

避免"作者偷偷改成恶意 prompt 但仍 public"的安全漏洞。

### D4：system preset 跳过审核

admin CLI `preset import` 调 `upsertBySlug` 时直接传 `reviewStatus='approved'`，不走状态机。来源已可信（git PR 审过）。

### D5：Admin 身份 = users.role 列 + admin CLI grant + /admin Web 页

候选：（A）role + CLI + Web；（B）仅 CLI 不做 Web；（C）2FA + 隔离会话

**选 A**：

- users.role 是 Phase 6+ 复用基础（admin user mgmt / 全局通知 / 用量上限）
- admin CLI grant：ssh 操作明确、与现有 invite create 同套路、安全可审计
- /admin Web 页是日常审核工具，纯 CLI 太繁琐
- middleware `requireAdmin` 基于 session.user.role

### D6：通知机制 = YAGNI

作者下次开 sidebar 就看到 SkillItem 上的 review badge（rejected hover 看 reason） —— 不做 in-app 通知中心。邮件推到 Phase 6+。

---

## 3. 数据模型

### 3.1 Migration `0004_review_workflow.sql`

```sql
-- 1. users 加 role 列
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- 2. skills 加审核相关 5 列
ALTER TABLE skills ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE skills ADD COLUMN reject_reason TEXT;
ALTER TABLE skills ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE skills ADD COLUMN reviewed_at INTEGER;
ALTER TABLE skills ADD COLUMN reviewed_by INTEGER REFERENCES users(id);

-- 3. grandfather 现有 public skill 为 approved
UPDATE skills SET review_status = 'approved', reviewed_at = unixepoch()
WHERE is_public = 1;

-- 4. 索引：admin 查 pending 列表
CREATE INDEX idx_skills_review_status ON skills (review_status, is_public)
  WHERE deleted_at IS NULL;
```

**关键设计**：

- **grandfather 策略**：现有 isPublic=1 的 user skill + Phase 4 system preset 全部一次性 approved，不让历史卡 pending
- `reviewed_by` 外键 users（追溯审核责任）
- `version` 默认 1，每次 approve +1
- partial index：`WHERE deleted_at IS NULL` 让索引大小 ≪ 全表

### 3.2 Drizzle schema 增量

`packages/server/src/db/schema.ts`：

users 表加 `role: text("role", { enum: ["user", "admin"] }).notNull().default("user")`

skills 表加：
```ts
reviewStatus: text("review_status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
rejectReason: text("reject_reason"),
version: integer("version").notNull().default(1),
reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
reviewedBy: integer("reviewed_by").references(() => users.id),
```

skills 索引加 `byReviewStatus: index("idx_skills_review_status").on(t.reviewStatus, t.isPublic).where(sql\`${t.deletedAt} IS NULL\`)`

### 3.3 shared zod schemas 增量

```ts
// schemas/skills.ts
export const skillReviewStatusSchema = z.enum(["pending", "approved", "rejected"]);
export const approveSkillRequestSchema = z.object({});
export const rejectSkillRequestSchema = z.object({
  reason: z.string().trim().min(1).max(280)
});

// SkillDto 加：
//   reviewStatus: "pending" | "approved" | "rejected";
//   rejectReason: string | null;
//   version: number;

// schemas/user.ts
export const userRoleSchema = z.enum(["user", "admin"]);

// User interface 加：
//   role: "user" | "admin";
```

`createSkillRequestSchema` / `updateSkillRequestSchema` **不加** review 字段 —— 用户不能自己设审核状态。

### 3.4 与 Phase 3-4 兼容

- 现有 user 行：role 默认 'user'
- system 用户：role 仍 'user'（不审核别人的 skill）
- 现有 admin 用户：默认 'user'，**Phase 5 上线后需 ssh 跑 grant-admin** 才能用 /admin
- 现有 conversations 表不动：systemPrompt 仍是快照，旧会话不受改动影响

### 3.5 状态机

```
作者 publish (isPublic=1)        admin /admin/skills
新建 ──────────────────→ pending ─────────────────→ approved (version+1)
                            │                        │
                            └─→ rejected (reject_reason) ←┘
                                       │
                                       ↓
                            作者改 system_prompt → 重新 pending
                            作者 isPublic=0 → 静默回私有（status 不变）
```

---

## 4. API + 后端工具

### 4.1 路由变化

| 路由 | 变化 |
|---|---|
| `POST /api/skills` | isPublic=true 时自动 review_status='pending' |
| `PATCH /api/skills/:id` | 改 systemPrompt/inputSchema 自动转 pending |
| `GET /api/skills` | 非 author 加 review_status='approved' 过滤 |
| `GET /api/auth/me` | 返回加 role |
| **`GET /api/admin/skills?status=pending`** | 新增，admin only |
| **`POST /api/admin/skills/:id/approve`** | 新增，admin only |
| **`POST /api/admin/skills/:id/reject`** | 新增，admin only，body {reason} |

新增 1 文件 `packages/server/src/routes/admin/skills.ts`，prefix `/api/admin`。

### 4.2 SkillsRepository 加方法

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

`listAvailableTo` 改造（非 author 加 review_status 过滤）：

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

`update` 改造（语义重要字段改动触发重审）：

```ts
async update(id, userId, patch) {
  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  // ... 原字段
  const needsReReview = patch.systemPrompt !== undefined || patch.inputSchema !== undefined;
  if (needsReReview) {
    setValues.reviewStatus = "pending";
    setValues.reviewedAt = null;
    setValues.reviewedBy = null;
    setValues.rejectReason = null;
  }
  // ... where + returning
}
```

`publish` 改造（每次 publish 都重审）：

```ts
async publish(id, userId) {
  // 加 reviewStatus: "pending", reviewedAt/By 清空, rejectReason: null
}
```

`upsertBySlug` 改造（preset 支持 reviewStatus 入参）：让 admin CLI 能传 `reviewStatus: 'approved'` 跳过审核。

### 4.3 requireAdmin middleware

`packages/server/src/middleware/admin.ts`：

```ts
export function requireAdmin(request, reply) {
  const user = requireUser(request, reply);
  if (!user) return null;
  if (user.role !== "admin") {
    const error = new AppError(403, "ADMIN_FORBIDDEN", "需要管理员权限");
    reply.code(error.statusCode).send(errorBody(error));
    return null;
  }
  return user;
}
```

依赖 `requireUser` 返回的 user 含 role 字段（sessionMiddleware 改造）。

### 4.4 admin CLI 加 5 个子命令

```bash
npm run admin -- user grant-admin <username>
npm run admin -- user revoke-admin <username>
npm run admin -- skill list-pending
npm run admin -- skill approve <id>
npm run admin -- skill reject <id> --reason "敏感词命中"
```

`UserRepository` 加 `setRole(username, role)`。

### 4.5 admin route 文件

`packages/server/src/routes/admin/skills.ts` —— 3 个 handler：GET list / POST approve / POST reject。每个都先 `requireAdmin`，404/400 错误统一 errorBody 模式。

### 4.6 测试增量（约 12 case）

- `repositories/skills.test.ts`：listPending 仅 isPublic=1+pending；approve 设 reviewedAt/By；listAvailableTo 非 author 过滤；update 改 system_prompt 触发重审；改 title 不触发
- `routes/admin-skills.test.ts` (新)：admin approve/reject 200；non-admin 403；reject 缺 reason 400
- `middleware/admin.test.ts` (新)：未登录 401；user role 403；admin role pass
- `admin-cli.test.ts`：grant-admin / revoke-admin / skill list-pending / approve / reject

### 4.7 sessionMiddleware 加载 role

`SessionRepository.findValid` 已 select * 自动包含 role 字段；只需更新 SessionUser type 加 role。

### 4.8 server.ts 注入

```ts
import adminSkillRoutes from "./routes/admin/skills.js";
await app.register(adminSkillRoutes, { prefix: "/api/admin", db });
```

---

## 5. 前端

### 5.1 review badge UI（SkillItem）

```
🔒 ✓ My Skill            ⋯              ← 私有：原 lock，无 review badge
🌐 ✓ Public Approved      @alice         ← public + approved：绿勾
🌐 ⏳ Public Pending  @alice (审核中)     ← author 自己的 pending：黄沙漏
🌐 ✗ Public Rejected  @alice (被拒)      ← author 自己的 rejected：红叉，hover 看 reason
```

非 author user 只能看到 approved skill（后端已过滤），所以 badge 状态实际只在 author 视角出现。

### 5.2 SaveSkillDialog 加审核提示

```tsx
{isPublic && (
  <p className="ml-6 text-xs text-zinc-500">
    将提交人工审核。审核通过后才会进入公开列表。
  </p>
)}
```

### 5.3 /admin/skills 页面

新文件 `packages/web/src/routes/admin/skills.tsx`：tab 切换（待审/已通过/被拒），AdminSkillRow 折叠展开看完整 systemPrompt + inputSchema，[通过]/[拒绝] 按钮。reject 时弹 RejectReasonDialog。

非 admin 路由首行 Navigate 到 /chat。

### 5.4 ChatPage Sidebar 加 Admin 入口

底部 username 行旁加：

```tsx
{meQuery.data.user.role === "admin" && (
  <Link to="/admin/skills" className="text-xs text-zinc-500 hover:text-zinc-300">
    审核中心
  </Link>
)}
```

### 5.5 前端 API client

新文件 `packages/web/src/lib/admin.ts`：listAdminSkills / approveSkill / rejectSkill。

`api.ts` 现有 User interface 加 `role: "user" | "admin"`。

### 5.6 文件清单

**新增**：
- `packages/server/src/db/migrations/0004_review_workflow.sql`
- `packages/server/src/middleware/admin.ts`
- `packages/server/src/routes/admin/skills.ts`
- `packages/server/tests/unit/middleware/admin.test.ts`
- `packages/server/tests/unit/routes/admin-skills.test.ts`
- `packages/web/src/lib/admin.ts`
- `packages/web/src/routes/admin/skills.tsx`
- `packages/web/src/routes/admin/AdminSkillRow.tsx`
- `packages/web/src/routes/admin/RejectReasonDialog.tsx`

**修改**：
- `packages/server/src/db/schema.ts` (users.role + skills 5 列 + index)
- `packages/server/src/db/repositories/skills.ts` (5 个新方法 + listAvailableTo/update/publish 改造)
- `packages/server/src/db/repositories/users.ts` (setRole 方法)
- `packages/server/src/db/repositories/sessions.ts` (findValid 选 role)
- `packages/server/src/middleware/session.ts` (SessionUser 加 role)
- `packages/server/src/routes/auth/me.ts` (返回加 role)
- `packages/server/src/routes/skills.ts` (toDto 加 reviewStatus/rejectReason/version)
- `packages/server/src/server.ts` (注册 adminSkillRoutes)
- `scripts/admin-cli.ts` (5 个新子命令)
- `packages/server/tests/unit/repositories/skills.test.ts` (审核流 case)
- `packages/server/tests/unit/admin-cli.test.ts` (5 个新 case)
- `packages/shared/src/schemas/skills.ts` (review schemas + DTO 字段)
- `packages/shared/src/schemas/user.ts` (role schema + User 字段)
- `packages/web/src/lib/api.ts` (User.role)
- `packages/web/src/main.tsx` (新路由 /admin/skills)
- `packages/web/src/routes/chat/Sidebar.tsx` (admin link)
- `packages/web/src/routes/chat/SkillItem.tsx` (review badge)
- `packages/web/src/routes/chat/SaveSkillDialog.tsx` (审核提示文案)
- `AGENTS.md` (Phase 5 沉淀坑，如有)
- `README.md` / roadmap (phase 5 done)

---

## 6. 上线流程

### 6.1 部署

按 §6.8 dev-phase exemption 直接 main + push → GH Actions：
1. `npm run build:shared`
2. `npm run db:migrate`（应用 0004，含 grandfather UPDATE）
3. `npm run build`
4. systemd reload

### 6.2 grant admin

部署完后 ssh：

```bash
ssh root@43.108.21.46 'cd /opt/server_agent && sudo -u agent bash -c "set -a; . /etc/server-agent/agent.env; set +a; npm run admin -- user grant-admin admin"'
```

预期：`admin role granted to admin`。

### 6.3 验证

- `curl /api/version` 返新 sha
- 登录 admin 账号 → Sidebar 应见"审核中心"链接 → 点进 /admin/skills 看到 pending 列表（首次部署应为空，因 grandfather 把所有 isPublic=1 都设 approved）
- 创建一个 user skill 公开 → admin 列表出现 → approve → user 端能在 public 看见

---

## 7. 风险

- **R1：grandfather UPDATE 误标 unsafe 旧数据**。缓解：MVP 期 user skill 只有几条，admin 可手动 reject 把不该 approved 的拉下来。
- **R2：作者改 description 也想触发重审**。spec 决定不触发，admin 可显式 reject 强迫重提；如果反馈不符合预期，Phase 5.x 调字段集。
- **R3：admin role 滥用**。当前 grant-admin 走 ssh，唯一持有人是项目作者；中长期可加 audit log。
- **R4：版本号语义不一致**。version+1 仅在 approve 时；如果作者修改后又自己 unpublish 又 publish，会触发 N 次 approve N 次 +1，对作者无 confusing 但 admin 看到大版本号要心里有数。
- **R5：reviewed_by 用户被删**。FK 无 cascade，admin 用户被删后已 reject 的 skill 还指向 dead id；当前 admin 不会被删，留待 Phase 6+ 加 NULL on delete。

---

## 8. 验收 checklist

- [ ] lint / typecheck / test / build 全绿
- [ ] migration 0004 真实跑过、`PRAGMA table_info(skills)` 含 5 新列；users.role 含
- [ ] grandfather UPDATE 把 isPublic=1 全转 approved
- [ ] 单测覆盖：listPending / approve / reject / listAvailableTo 过滤 / update 触发重审 / requireAdmin
- [ ] admin CLI grant-admin / list-pending / approve / reject 跑通
- [ ] 部署生产 + ssh grant admin 角色
- [ ] 浏览器手测：admin 登录见审核中心；user 创公开 skill 走完审核循环
- [ ] 关键坑写进 AGENTS.md §6（如有）

---

## 9. 不变量（Phase 5 不破坏的设计）

- `conversations.system_prompt` 快照机制：作者改 skill 不影响旧会话（Phase 3 不变量）
- Provider-agnostic skill：default_provider/Model 仍是可选 prefill
- Forward-only migration：0004 只 ALTER ADD COLUMN + UPDATE，不改名不删
- 跨工具兼容：约定继续在 AGENTS.md
- 测试 fixture findOrCreate 模式（§6.13）：role 字段不影响现有 helper
