# Phase 4 — QA-AGENT 模式 Design

**Spec 编号**：2026-06-14-phase-4-qa-agent-design
**目标项目**：[`server_agent`](https://github.com/JqcFrankice/agent_qa)
**作者**：Claude Opus 4.6（与 @JqcFrankice 协作）
**状态**：design 完整，含 D1-D5 决策 + 内置 preset 内容；下一步进入 writing-plans
**前置**：Phase 3 已上线（[`2026-06-06-phase-3-skills.md`](../plans/2026-06-06-phase-3-skills.md)），`skills` 表 + `conversations.skill_id` 已 baked-in
**roadmap 对照**：[`2026-05-30-phase-3-6-roadmap.md`](./2026-05-30-phase-3-6-roadmap.md) §2

---

## 0. 单句目标

让用户在 /chat sidebar 点一个内置 QA preset → 弹动态表单填字段 → interpolate 后塞进 system prompt → 用 LLM 输出结构化的 bug 复现 / 测试用例 / 回归 checklist。

---

## 1. 范围

### 1.1 必须交付

- 数据：`skills` 表加 `input_schema / tags / slug` 三列；users 表加一行 `username='system' password_hash='!disabled'` 的占位作者；migration `0003_qa_skills.sql`
- shared：`SkillInputField` zod discriminated union（text/textarea/select 三种 type）+ `SkillTagsSchema` + DTO 扩展
- server：
  - `SkillsRepository` 加 `upsertBySlug()`
  - `interpolate()` 工具（前端 + 后端各一份，30 行）
  - admin CLI 加 `preset import <json-file>` 子命令
  - JSON 文件 `packages/server/src/presets/qa-skills.json`，含 3 条 preset
- 前端：
  - 新组件 `SkillFormDialog`：根据 `skill.inputSchema` 动态渲染表单 + 实时 prompt 预览
  - 改造 `NewConversationDialog`：接受 `presetPrompt` prop（已 interpolate 后的最终文本）
  - 改造 `SkillsPanel`：顶部 tag chip filter
  - 改造 `SkillItem`：system preset 隐藏 dropdown menu
  - 改造 `ChatPage`：选 skill 时根据有无 inputSchema 决定先弹 form 还是直接 NewConversationDialog
- 测试：interpolate 单测（6 case）+ admin-cli preset import 单测 + skills repo upsertBySlug 单测
- 上线流程：部署后 ssh 跑一次 `preset import` 命令；后续改 prompt 重跑同命令

### 1.2 不做（YAGNI 边界）

- 用户 UI 编辑 inputSchema（add field / reorder / validate）→ Phase 5+
- LLM 自动生成 inputSchema → Phase 5+
- 数字 / 日期 / multi-select / conditional 字段 → 当前 yagni
- 跨 skill 编排（先调 A 再调 B）→ Phase 6+ tool calling
- preset 详情页 / 评分 / 收藏 / i18n
- 服务端 schema 校验（前端控制，schema 错走 fallback 路径）
- 仓库 [`Frankice-Jiang/game-qa-skill-system`](https://github.com/Frankice-Jiang/game-qa-skill-system) 集成（仓库不可访问，搁置；用 3 条手写 preset）

---

## 2. 关键决策（D1-D5）

### D1：input schema = 精简自定义 DSL

候选：（A）自定义 DSL；（B）JSON Schema draft-07 + ajv；（C）复用 zod schema

**选 A**：

- 仅 text/textarea/select 三种控件覆盖全部 Phase 4 需求（roadmap §2.2 + 本 spec §6 三条 preset 用例）
- 实现成本最低（约 100 行：shared zod 50 + 前端动态渲染 50）
- 不引入新依赖（vs ajv + react-jsonschema-form ≈ +200KB）
- TS discriminated union 让 type 字段强约束，IDE 补全友好
- Phase 5+ 加 number/conditional 是增量加 type，不破坏 schema

### D2：占位符 `{{var}}`

候选：（A）`{{var}}`；（B）`{var}`；（C）`${var}`

**选 A**：

- 与 Mustache/Handlebars/Jinja 一致，跳出 server_agent 也是行业惯例
- 不与 prompt 里常见的 JSON `{...}` 或 JS `${...}` 代码示例冲突
- 自写 30 行 `interpolate()` 即可，未替换字段保留原样（防御性 + 可预览）
- 不引入 mustache.js（避免一个为简单需求过度的依赖）

### D3：QA 模式切换 = tags 列 + chip filter

候选：（A）category enum 列；（B）标题前缀 `[QA]`；（C）tags JSON 列

**选 C**：

- 参考 GPT Store / Poe / Cursor，行业惯例是多 tag + chip filter
- forward-only：`ALTER TABLE skills ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`
- Phase 4 只用 tag `'qa'`；Phase 5+ 加 `'frontend'`、`'writing'` 等不需 schema 迁移
- 比 mode tab 更灵活（"全部 / qa / my-team" 多 chip 共存）

### D4：preset 导入 = admin CLI 幂等 upsert

候选：（A）seed migration；（B）admin CLI；（C）热装载

**选 B**：

- prompt 内容放仓库 JSON 文件，git 管控、PR review 友好
- 改 prompt 后部署完 ssh 跑一行 cli 即可（跟现有建邀请码 pattern 一致）
- 走真 skill 表：Phase 3 公开 / 选用 / extract / 软删保护逻辑天然兼容
- 比 seed migration 灵活（无需写 N 条 update migration）；比热装载干净（数据模型一致）
- skills 加 `slug TEXT` + partial unique index `WHERE slug IS NOT NULL` 当 upsert key

### D5：system 用户 = 真 users 行

候选：（A）真 users 行 username='system'；（B）虚拟 author_user_id=0/NULL；（C）独立 system_presets 表

**选 A**：

- FK / 引用完整性零修改：`skills.author_user_id NOT NULL REFERENCES users(id)` 不动
- `findManyByIds`、`toDto`、`SkillItem` 等所有现有查询零特殊分支
- preset 列表显示 `@system`，跟普通用户一致
- `password_hash='!disabled'` 不是合法 argon2 hash → login 路径自然 reject
- migration `INSERT OR IGNORE` 幂等
- 选 B 要 schema nullable + 全代码路径加 `if author_id == 0` 分支，污染严重

---

## 3. 数据模型

### 3.1 Migration `0003_qa_skills.sql`

```sql
-- 1. system 占位用户（不可登录）
INSERT OR IGNORE INTO users (username, password_hash, default_provider)
VALUES ('system', '!disabled', NULL);

-- 2. skills 加 3 列（forward-only，user 历史行 input_schema=NULL / tags='[]' / slug=NULL）
ALTER TABLE skills ADD COLUMN input_schema TEXT;
ALTER TABLE skills ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE skills ADD COLUMN slug TEXT;

-- 3. slug partial unique index（仅 NOT NULL 行参与去重）
CREATE UNIQUE INDEX idx_skills_slug ON skills (slug) WHERE slug IS NOT NULL;
```

### 3.2 Drizzle schema 增量

`packages/server/src/db/schema.ts` 中 `skills` 表加 3 列（systemPrompt 之后、isPublic 之前），加 partial unique index。

```ts
inputSchema: text("input_schema"),
tags: text("tags").notNull().default("[]"),
slug: text("slug"),
// (t) => ({...}) 中加：
bySlug: uniqueIndex("idx_skills_slug").on(t.slug).where(sql`${t.slug} IS NOT NULL`)
```

### 3.3 shared zod schemas（`packages/shared/src/schemas/skills.ts` 增量）

```ts
const baseField = {
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(80),
  required: z.boolean().optional()
};

export const skillInputFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...baseField, type: z.literal("text"), placeholder: z.string().max(200).optional() }),
  z.object({ ...baseField, type: z.literal("textarea"), placeholder: z.string().max(200).optional() }),
  z.object({ ...baseField, type: z.literal("select"),
    options: z.array(z.object({ value: z.string(), label: z.string() })).min(1).max(50) })
]);

export const skillInputSchemaSchema = z.array(skillInputFieldSchema).max(20);
export type SkillInputField = z.infer<typeof skillInputFieldSchema>;

export const skillTagsSchema = z.array(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)).max(8);

// createSkillRequestSchema 加：
//   inputSchema: skillInputSchemaSchema.nullable().optional()
//   tags: skillTagsSchema.optional()
//   (slug 不暴露给 user create，只 admin CLI 写)

export interface SkillDto {
  // ...原 Phase 3 字段
  inputSchema: SkillInputField[] | null;
  tags: string[];
  slug: string | null;
  isSystem: boolean;  // toDto 计算: row.authorUserId === SYSTEM_USER_ID
}
```

字段约束要点：
- `name` regex：避免 `{{2foo}}` 之类奇怪占位符
- `tags` regex：lowercase + hyphen，最多 8 个 tag / skill
- `inputSchema.max(20)`：单 skill 最多 20 个字段
- DTO 加 `isSystem` 让前端决定隐藏 dropdown，而不直接暴露 `authorUserId`

### 3.4 Phase 3 兼容

- 现有 user skill 行：`input_schema=NULL / tags='[]' / slug=NULL` → 前端走 Phase 3 prefill 路径
- conversations 表不动（system_prompt 快照 + skill_id 溯源已在 Phase 3 done）
- Phase 4 interpolate 后的最终文本进 conversations.system_prompt 快照，跟普通会话无差别 → 软删 skill 后旧会话仍可用

---

## 4. API + 后端工具

### 4.1 路由变化（最小化）

| 路由 | 变化 |
|---|---|
| `POST /api/skills` | 入参加 `inputSchema?` `tags?`；user 不能传 slug |
| `PATCH /api/skills/:id` | 入参加 `inputSchema?` `tags?`；system preset 自动 404（SkillsRepository.update 已 enforce author 隔离）|
| `DELETE /api/skills/:id` | 不变；system preset 自动 404 |
| `GET /api/skills` | 不变；DTO 多带 inputSchema/tags/slug/isSystem |
| `POST /api/conversations` | **不变**；前端把 interpolate 后的最终 prompt 通过 systemPrompt 字段传上来 |
| `POST /api/conversations/:id/extract-skill` | **不变**；不复制 inputSchema |

**新增 0 个路由**。

### 4.2 SkillsRepository 加 1 个方法

```ts
async upsertBySlug(authorUserId: number, input: {
  slug: string;
  title: string;
  description: string;
  systemPrompt: string;
  inputSchema?: SkillInputField[] | null;
  tags?: string[];
  isPublic?: boolean;
}) { /* INSERT ... ON CONFLICT(slug) DO UPDATE */ }
```

仅 admin CLI 调用，不挂路由。authorUserId 永远传 system 用户 id。

### 4.3 interpolate 工具

`packages/web/src/lib/interpolate.ts`：

```ts
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => values[key] ?? match);
}
```

未替换的占位符保留原样：

- 用户填 partial 表单也能预览
- schema/template 不一致时 LLM 看到字面 `{{var}}` 提示问询
- 不抛异常，防御性

测试 6 case：单字段 / 多字段 / 未提供保留 / 占位符前后内容 / 同字段多次 / 不匹配语法（`{var}`、`${var}`、`{{ var }}`）保持原样。

### 4.4 admin CLI `preset import`

```bash
npm run admin -- preset import packages/server/src/presets/qa-skills.json [--public]
```

CLI 行为：
1. 开 DB
2. 找 system 用户（理论上 migration 已建）
3. zod 校验 JSON 数组
4. 每条 `SkillsRepository.upsertBySlug(systemUser.id, item)`
5. 打印 `inserted: N, updated: M`

`--public` flag：默认 true。

### 4.5 测试增量

| 文件 | 用例 |
|---|---|
| `tests/unit/repositories/skills.test.ts` | upsertBySlug 第一次 insert / 第二次 update / 跨 author 同 slug 报约束错 |
| `tests/unit/admin-cli.test.ts`（已有，增） | preset import JSON 校验失败时 fail；导入后 list available 包含 inputSchema/tags/isSystem=true |
| `tests/unit/routes/skills.test.ts`（已有，增） | non-author PATCH system preset → 404 |
| 新 `tests/unit/lib/interpolate.test.ts` | 6 case |

### 4.6 server.ts / DI

不变（路由 deps 不动，admin CLI 走独立进程）。

---

## 5. 前端：动态表单 + 选用流程

### 5.1 用户视角流程

**Phase 3（无 inputSchema）**：
```
点击 skill → NewConversationDialog → 填 provider/model → 创建
```

**Phase 4（有 inputSchema）**：
```
点击 skill → SkillFormDialog（动态表单 + 实时预览）
        → 下一步 → NewConversationDialog（systemPrompt 已 interpolate）
        → 填 provider/model → 创建
```

interpolate 在前端做，Dialog 链式触发。NewConversationDialog 不感知 inputSchema 存在。

### 5.2 新组件 `SkillFormDialog`

`packages/web/src/routes/chat/SkillFormDialog.tsx`

```
┌── SkillFormDialog ─────────────────────┐
│ 基于 Skill「Bug 复现助手」                │
├────────────────────────────────────────┤
│ Bug 概述 *                              │
│ [textarea: 用户点击发送按钮没反应____]   │
│                                        │
│ 严重程度 *                              │
│ [select: P0 阻塞 ▾]                    │
├────────────────────────────────────────┤
│ ▾ Prompt 预览                           │
│  你是 QA 专家。Bug 概述: 用户点击...     │
├────────────────────────────────────────┤
│       [取消]    [下一步：选模型]        │
└────────────────────────────────────────┘
```

Props:
```ts
interface Props {
  open: boolean;
  skill: SkillDto | null;
  onOpenChange: (open: boolean) => void;
  onContinue: (skill: SkillDto, finalPrompt: string) => void;
}
```

行为：
- `useEffect` 在 `open + skill` 变化时 reset values
- 根据 `skill.inputSchema` map 渲染 input/textarea/select（共用现有 Textarea + 原生 input/select）
- "下一步" disabled when 任一 required 字段空
- 实时 `interpolate(skill.systemPrompt, values)` 显示在 Preview 区（折叠默认）
- 点"下一步" → `onContinue(skill, finalPrompt)`

### 5.3 NewConversationDialog 微调

加 prop `presetPrompt?: string`（来自 SkillFormDialog 的 onContinue）。useEffect 优先级：

1. `presetPrompt` 存在 → systemPrompt = presetPrompt
2. `skill` 且无 inputSchema → systemPrompt = skill.systemPrompt（Phase 3）
3. defaultProvider 路径 → systemPrompt = ""

NewConversationDialog 不渲染 form，保持职责单一；SkillFormDialog 未来 Phase 5/6 可独立复用（编辑 skill 预览 / 公开 skill 详情页体验）。

### 5.4 ChatPage 串联

新增 state：
```ts
const [skillFormOpen, setSkillFormOpen] = useState(false);
const [skillForForm, setSkillForForm] = useState<SkillDto | null>(null);
const [interpolatedPrompt, setInterpolatedPrompt] = useState<string | null>(null);
```

`handleUseSkill` 改造：
```ts
const handleUseSkill = useCallback((skill: SkillDto) => {
  if (skill.inputSchema && skill.inputSchema.length > 0) {
    setSkillForForm(skill);
    setSkillFormOpen(true);
  } else {
    setSkillForNew(skill);
    setDialogOpen(true);
  }
}, []);
```

`handleFormContinue`：
```ts
const handleFormContinue = useCallback((skill: SkillDto, finalPrompt: string) => {
  setSkillFormOpen(false);
  setSkillForForm(null);
  setSkillForNew(skill);
  setInterpolatedPrompt(finalPrompt);
  setDialogOpen(true);
}, []);
```

NewConversationDialog 关闭时清理 interpolatedPrompt（已有 `if (!v) setSkillForNew(null)` 模式，复用）。

挂载 SkillFormDialog 在 NewConversationDialog 同级。

### 5.5 SkillsPanel 加 tag chip filter

```
┌── Sidebar > Skills tab ────────────┐
│ [全部] [qa] [my-team]               │  ← 新加
│                                    │
│ 📋 qa-bug-repro    @system        │
│ 📋 my-react-rev    @alice         │
└────────────────────────────────────┘
```

实现：
- 从 `skills.flatMap(s => s.tags)` 收集所有出现的 tag、按 count 排序，最多显示 6 个
- "全部" chip 默认 active；mutex（只能一个 active）
- chip = `<Button variant={active ? "default" : "ghost"} size="sm">`，复用 Phase 3 风格

### 5.6 SkillItem 微调

- `skill.isSystem` 时不显示 dropdown menu（保护 preset 不被误删）
- 现有 `@authorUsername` 显示不变

### 5.7 SaveSkillDialog 不动

Phase 4 不让用户 UI 编辑 inputSchema（构造 schema UI 是另一个完整 feature → Phase 5+）。

### 5.8 测试

- interpolate.test.ts 已在 §4 提到（前后端共用，前端单独一份）
- SkillFormDialog 不写单测（UI 渲染靠 typecheck + 浏览器手测）
- e2e 流程：浏览器手测 5 步（点 preset → 弹 form → 填字段 → 预览展开 → 下一步进会话）

### 5.9 文件清单

新增：
- `packages/web/src/routes/chat/SkillFormDialog.tsx`
- `packages/web/src/lib/interpolate.ts` + `.test.ts`

修改：
- `packages/web/src/routes/chat/NewConversationDialog.tsx`（加 presetPrompt prop）
- `packages/web/src/routes/chat/index.tsx`（state + handlers）
- `packages/web/src/routes/chat/SkillsPanel.tsx`（chip filter）
- `packages/web/src/routes/chat/SkillItem.tsx`（system preset 隐 dropdown）
- `packages/web/src/lib/api.ts`（DTO 加 inputSchema/tags/slug/isSystem）

---

## 6. 内置 QA preset 内容

文件：`packages/server/src/presets/qa-skills.json`（git tracked）

### 6.1 `qa-bug-repro` — Bug 复现助手

inputSchema：
| name | type | required | label |
|---|---|---|---|
| bug_summary | textarea | ✓ | Bug 概述 |
| steps_known | textarea |  | 已知操作步骤（可空） |
| expected_actual | textarea | ✓ | 期望 vs 实际 |
| environment | text |  | 环境（OS / 浏览器 / 版本） |
| severity | select | ✓ | 严重程度（P0/P1/P2/P3）|

systemPrompt（详见 §6 末段示例）：role-play 锁定输出结构，输出 4 节 Markdown：标准复现步骤 / 关键观察点 / 边界用例（≤5 条）/ 优先验证项（3 条）。

### 6.2 `qa-test-cases` — 测试用例生成器

inputSchema：
| name | type | required | label |
|---|---|---|---|
| feature_spec | textarea | ✓ | Feature 描述 / 需求文档 |
| coverage_focus | select | ✓ | 覆盖侧重（功能/边界/安全/性能/全部）|
| out_of_scope | textarea |  | 不需要覆盖的部分 |

systemPrompt：输出 Markdown 表格（用例 ID / 模块 / 类别 / 前置 / 步骤 / 期望 / 优先级），至少覆盖 1 happy path + 2 边界 + 1 异常恢复；表格后给「未覆盖但建议讨论」≤3 条。

### 6.3 `qa-regression-checklist` — 回归 checklist

inputSchema：
| name | type | required | label |
|---|---|---|---|
| change_summary | textarea | ✓ | 改动概要（commit/PR）|
| affected_modules | text | ✓ | 直接改动模块（逗号分隔）|
| release_window | select | ✓ | 发布窗口（紧急 hotfix / 计划版本 / 大版本）|

systemPrompt：分四节输出 —— 直接受影响 / 间接受影响 / 共用基础设施（按 release_window 取舍）/ 优先级排序 checklist；最后给总耗时区间。

### 6.4 完整 systemPrompt 文本

> 实际 prompt 文本由 plan 阶段写入 `packages/server/src/presets/qa-skills.json`，本 spec 不复制全文以避免 spec 与 JSON 漂移。Plan 文件会包含三条 prompt 的完整内容。

### 6.5 验收

部署后浏览器跑：
1. 任意账号登录 → Skills tab → 看到 3 条 system preset，作者 `@system`，hover 不出现 dropdown
2. 点 `qa-bug-repro` → SkillFormDialog 弹出，5 个字段（3 个 required）
3. 填若干字段 → 展开 Prompt 预览 → 占位符已替换
4. 必填字段空时"下一步" disabled
5. 全部填完 → 下一步 → NewConversationDialog 弹出，systemPrompt 为最终文本
6. 选 provider/model → 创建 → 进会话 → 发消息 → LLM 真按 prompt 输出结构化结果
7. tag chip：点 `qa` → 三条 preset 留下，user skill 隐藏；点"全部" → 全恢复

---

## 7. 上线流程

### 7.1 部署常规路径（按 §6.8 dev-phase exemption）

直接 main + push → GH Actions → deploy-agent.sh：
1. `npm run build:shared`
2. `npm run db:migrate`（应用 0003）
3. `npm run build`
4. systemd reload

### 7.2 preset 导入（手动一次）

部署完跑：
```bash
ssh root@43.108.21.46 \
  'cd /opt/server_agent && sudo -u agent bash -c "set -a; . /etc/server-agent/agent.env; set +a; npm run admin -- preset import packages/server/src/presets/qa-skills.json --public"'
```

预期输出：`inserted: 3, updated: 0, skipped: 0`。后续改 prompt 重跑同命令：`inserted: 0, updated: 3`。

### 7.3 自动化（可选优化）

把 `preset import` 命令加到 `deploy-agent.sh` `db:migrate` 之后；Phase 4 plan 阶段决定是否做（YAGNI 倾向不做）。

---

## 8. 风险

- **R1：preset prompt 上线后效果不达预期**。缓解：所有 prompt 在 git，迭代成本低，重跑 cli 即生效；Phase 4 收尾时跑一遍真 LLM 验收。
- **R2：用户对动态表单 UX 不熟悉**。缓解：Prompt 预览实时显示让用户看到表单 → prompt 的映射；预览默认折叠避免干扰。
- **R3：tag chip 数量爆炸**。缓解：max 6 chip + 按 count 排序；超过的 tag 在 chip 行不显示但仍会被 filter 匹配（搜索框 Phase 5+ 加）。
- **R4：未替换占位符遗留进 LLM 调用**。设计上接受这一行为（防御性 + 帮助 LLM 提示用户）；不做硬校验。
- **R5：admin CLI 忘记跑 `preset import`**。缓解：写进部署 checklist；Phase 5 视情况自动化进 deploy-agent.sh。

---

## 9. 验收 checklist

- [ ] lint / typecheck / test / build 全绿
- [ ] migration 0003 真实跑过、`PRAGMA table_info(skills)` 含 input_schema/tags/slug；users 含 `system` 行
- [ ] interpolate 6 case 全过；upsertBySlug 单测通过
- [ ] admin CLI `preset import` 幂等（连跑两次第二次 updated=3 inserted=0）
- [ ] 部署生产 + 手动 ssh 跑 preset import
- [ ] 浏览器跑 §6.5 七步全过
- [ ] 关键坑写进 AGENTS.md §6（如有）

---

## 10. 不变量（Phase 4 不破坏的 Phase 3 设计）

- `conversations.system_prompt` 快照机制：Phase 4 interpolate 后的最终文本进快照，skill 软删后会话仍可用 ✓
- Provider-agnostic skill：`default_provider` / `default_model` 仍是可选 prefill，user 能改 ✓
- Forward-only migration：0003 只 ALTER ADD COLUMN + INSERT OR IGNORE，不改名不删 ✓
- 跨工具兼容：所有约定继续沉淀进 `AGENTS.md`（本 spec 不需要 §6 新条目，除非实施时遇到新坑）✓
