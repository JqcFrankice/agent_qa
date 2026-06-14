## Phase 3-6 路线图（roadmap）

**Spec 编号**：2026-05-30-phase-3-6-roadmap
**目标项目**：[`server_agent`](https://github.com/JqcFrankice/agent_qa)
**作者**：Claude Sonnet 4.6（与 @JqcFrankice 协作）
**状态**：roadmap 草稿，覆盖 Phase 3 详细 spec + Phase 4-6 outline；每个 phase 之后还会单独写 `<date>-phase-N-<topic>-design.md` 详 spec
**前置**：Phase 2b 已上线（[`2026-05-28-phase-2b-chat-core-design.md`](./2026-05-28-phase-2b-chat-core-design.md)）

---

## 0. 北极星 & 设计取舍

最终交付物（Phase 6 收尾时）：**aicoolyun.vip 上多用户都能用的、内置 QA-AGENT 模式的、有 skill 商店的 AI Agent 平台**。Phase 3-6 把这条路径切成 4 段：

| Phase | 单句概括 | 兑现 README §0 哪条期望 |
|---|---|---|
| 3 | 让用户把对话沉淀成可复用 skill | "对话→skill 流水线" |
| 4 | 把 QA 工作流做成 first-class 模式 | "QA-AGENT" |
| 5 | skill 在用户间公开/复用要有审核 | "Skill 审核 UI" |
| 6 | 前端打磨 + provider 抽象通用化 | "前端打磨 / provider 抽象" |

跨 Phase 的硬约束（不会变的几条）：

- **Provider-agnostic**：skill / preset / 模板永远不绑死某个 provider 或 wire 格式（aiwoo claude vs aiwoo codex 之间能相互替换）
- **Forward-only migration**：每个 phase 加新表/新列只能 add，不删不改名
- **跨工具兼容**：所有运维/规范沉淀在 `AGENTS.md`（Claude Code、Codex CLI、Gemini CLI 都识别），项目本地 SKILL.md 只是 Claude Code 入口指针
- **生产小步走**：每个 phase 收尾必须 deploy → `curl /api/health` → 浏览器跑核心 user flow

---

## 1. Phase 3 — Skill 沉淀流水线（详细 spec）

### 1.1 范围（Phase 3 必须交付）

**核心 user story：**
> 用户在 /chat 跟 AI 聊出一段满意的 prompt（比如"分析 React 组件的潜在 re-render 问题"），点"保存为 Skill"。下次新建会话时，从 sidebar 选这个 skill，prompt 自动塞到首条 system message，开聊。

**交付清单：**

- 新表 `skills`（schema 见 §1.4），一条前向 migration `0002_skills.sql`
- API：
  - `GET /api/skills` — 列当前用户的 skill + `is_public=1` 的全部 skill
  - `POST /api/skills` — 新建（来源：手填 / 从 conversation 提取）
  - `PATCH /api/skills/:id` — 改名 / 改提示词 / 切 is_public
  - `DELETE /api/skills/:id` — 软删（`deleted_at`）
  - `POST /api/conversations/:id/extract-skill` — 把指定会话/指定区段抽成 skill 草稿（不直接保存，前端 review 后再 POST /api/skills）
- conversations 加列 `skill_id INTEGER NULL REFERENCES skills(id)`：记录这个会话是不是某 skill 的实例（用于"用了多少次"统计）
- /chat sidebar 加 "Skills" tab：列出可用 skill；点击 → 新建会话时把 `skill.system_prompt` 注入首条 system message
- "保存为 Skill" 按钮（chat 输入框旁）：弹 modal，预填标题（来自首条 user msg 前 40 字）+ 完整 system prompt（来自整段对话的合并 user prompt，可编辑）
- skill 列表前端简化版：标题、描述、is_public 标识、作者用户名（自己的 skill 显示"我"）
- 沿用 2a 鉴权 + 跨用户隔离；公开 skill 由 author 控制（`is_public` 字段）
- 演练（drill）：跨用户访问别人私有 skill → 403；导入已删除 skill → 404；公开后再私有不影响已存在的 conversation

### 1.2 非范围（明确不做，留给后续 Phase）

- skill 参数化（输入 schema、表单注入）— Phase 4（QA preset 顺势带）
- skill 版本管理（version, draft）— Phase 5 审核流时一起做
- skill 公开后审核流（敏感词、人工审核）— Phase 5
- skill 评分 / 评论 / 收藏 — 暂未规划
- skill 调用统计 dashboard — Phase 5/6
- 多语言 skill 元数据 — 不做，统一中文/英文 mix
- skill 触发 tool calling — 暂未规划

### 1.3 关键决策

**D1：保存模式 = 手动按钮，不做"自动总结"**
- 选项 A（自动总结）：会话结束/N 轮后大模型 summarize → 弹气泡询问保存
- 选项 B（手动按钮）：用户主动点
- 选 B：自动总结要再消耗 token、要能 abort、要存"summary draft"，跟 Phase 2b 的 SSE 抽象耦合得太重；MVP 阶段简单点。Phase 4/5 再回来加自动化。

**D2：skill 等于"prompt 模板"，不带参数化输入**
- 选项 A（参数化）：skill 声明 input schema，前端弹表单填值再注入
- 选项 B（纯模板）：skill 的 system_prompt 是一段定死文字，加载后就当 system message 用
- 选 B：参数化 = 表单 + schema 验证 + 前端 widget，至少 1 周；MVP 验证"能存能用"足矣。Phase 4 QA preset 时如果发现确实需要再升 schema。

**D3：可发布 skill = `is_public` 字段，先无审核**
- 用户结论："2. 个人 + 可发布"
- Phase 3 就把 schema 字段（`is_public`、`published_at`）做出来，但 UI 上不暴露 publish 流程审核，作者改 `is_public=true` 立即对所有人可见
- Phase 5 在此之上加审核位（`review_status: pending|approved|rejected`），不需要 schema 迁移
- 风险：Phase 3 上线后如果有人公开恶意 prompt，目前没拦截；缓解 = MVP 期只有少数邀请用户，issue 出来再快速回滚 + 加审核

**D4：从 conversation 提取 skill 用「拼接现有 system + user 消息」做草稿，不调大模型**
- 选项 A（大模型 summarize）：抽 skill 时调一次 LLM 总结成"通用 prompt"
- 选项 B（机械拼接）：把 conversation 里所有 system + user 内容拼起来，前端 modal 让用户改
- 选 B：MVP 不依赖 LLM 副作用；Phase 4/5 加 "Polish with AI" 按钮再切 A

**D5：skill 不绑 provider/model**
- skill 只存 `system_prompt`（文本）；会话用什么 provider/model 跟 skill 无关
- 如果用户想"这个 skill 默认用 claude"，加可选字段 `default_provider`、`default_model`，新会话载入时 prefill 但用户能改
- 这条就是为后面 QA-AGENT、跨工具复用打的预备

### 1.4 数据模型

```sql
-- 0002_skills.sql
CREATE TABLE skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,                          -- max 80 chars
  description TEXT NOT NULL DEFAULT '',         -- max 280 chars，列表卡片用
  system_prompt TEXT NOT NULL,                  -- 主体内容
  default_provider TEXT,                        -- 'aiwoo-claude' | 'aiwoo-codex' | NULL
  default_model TEXT,                           -- 模型 id，NULL 表示用全局 DEFAULT_MODEL
  is_public INTEGER NOT NULL DEFAULT 0,         -- 0/1
  published_at TEXT,                            -- ISO 8601，is_public=1 时设
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT                               -- 软删
);
CREATE INDEX idx_skills_author ON skills(author_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_skills_public ON skills(is_public, published_at DESC) WHERE is_public = 1 AND deleted_at IS NULL;

ALTER TABLE conversations ADD COLUMN skill_id INTEGER REFERENCES skills(id);
CREATE INDEX idx_conversations_skill ON conversations(skill_id) WHERE skill_id IS NOT NULL;
```

> 注：`is_public` + `published_at` 一起改（事务），方便 Phase 5 加 `review_status` 时不改这两列。

### 1.5 验收 checklist（Phase 3 收尾）

- [ ] lint / typecheck / test / build 全绿
- [ ] 自测：
  - [ ] 用户 A 创建私有 skill，用户 B 列表里看不到
  - [ ] 用户 A 把 skill 改成 public，用户 B 列表能看到、能基于它新建会话
  - [ ] skill 软删后 sidebar 不再列；已经基于它的 conversation 不报错（skill_id 还指向，但加载时 fallback 不注入 system msg）
  - [ ] 从 conversation 提取 skill：抽出来的 draft 系统提示词是预期的拼接结果
- [ ] 真实上游（aiwoo claude）跑一次 skill 注入会话
- [ ] 部署到生产 + 浏览器手测三个动作（保存/选用/删除）
- [ ] 关键坑写进 `AGENTS.md §6`

### 1.6 Phase 3 风险

- **R1：skill 数量爆炸 sidebar 过载**。MVP 期不做搜索/分组，>50 时体验差。缓解：Phase 3 末统计 max 数，Phase 4 视情况补"搜索框 + 分组"
- **R2：可发布 skill 没审核 → 用户互相看到敏感内容**。缓解：MVP 期用户少；后端日志记 `is_public=1` 操作；Phase 5 审核位接上
- **R3：skill 跟 conversation 软耦合（fallback 行为）**容易写错。缓解：在 messages route 里写一条单测：skill 被软删后载入会话不抛错

---

## 2. Phase 4 — QA-AGENT 模式（outline）

### 2.1 单句目标

把 game-qa-skill-system 的核心工作流（bug 复现 → 用例生成 → 回归清单）固化成一个 first-class 的 chat 模式，**带参数化输入**。

### 2.2 大致范围

- `skills.input_schema` 字段（JSON Schema 或精简 zod 描述）：声明 skill 需要哪些字段
- 前端 skill modal 升级：load skill 时如果有 schema 就弹表单，把表单值塞进 prompt 模板（`{{bug_id}}` 占位符 → 实参）
- 内置预设 QA skills（用 §1 的 skill 表存，作者 = system 用户）：
  - `qa-bug-repro`：输入 = bug 描述 / 已知步骤 / 期望，输出 = 标准化复现步骤 + 边界用例
  - `qa-test-case-generator`：输入 = feature spec，输出 = test case table（Markdown）
  - `qa-regression-checklist`：输入 = 改动概要 + 模块，输出 = 回归 checklist
- "QA 模式" 模式切换：sidebar 加 mode tab，QA 模式只显示 QA 类 skill；非 QA 模式显示用户私有 + 公开通用
- 集成 game-qa-skill-system 的 schema/prompt（仓库 [`Frankice-Jiang/game-qa-skill-system`](https://github.com/Frankice-Jiang/game-qa-skill-system) 还是新仓库，开 phase 4 spec 时定）

### 2.3 关键决策（待 Phase 4 spec 时定）

- 输入 schema 用 JSON Schema vs 精简自定义 DSL
- 模板插值用 `{{var}}` 还是 `{var}`
- QA preset 是 seed migration 还是 admin CLI 一次性导入
- "system 用户" 是真用户行还是虚拟 author_user_id=0

### 2.4 不做

- LLM-aided 自动生成 schema（"AI 帮我推断 input"）
- 跨 skill 编排（先调 A 再调 B）— 需要 tool call，Phase 6+

---

## 3. Phase 5 — Skill 审核 UI（outline）

### 3.1 单句目标

skill 公开发布走人工 review，社区里浮上来的是被审过的，且支持版本。

### 3.2 大致范围

- `skills.review_status` 列：`pending|approved|rejected`，作者 publish 时变 pending
- `skills.version` + `skill_versions` 表：每次 publish 后 immutable 一份；旧版仍可用
- /admin 路径：管理员看 pending 列表 → 通过/拒绝（带备注）；管理员判定权由 `users.role='admin'` 列驱动
- public 列表只列 `review_status='approved'` 的最新 version
- skill 详情页：显示版本历史 + 作者
- 邮件/in-app 通知作者审核结果（in-app 优先，邮件 Phase 6 if needed）

### 3.3 关键决策（待 spec 时定）

- 拒绝是否软删（保留作者可见）
- 同一 skill 同时只允许一个 pending 版本？
- 管理员如何指派（自己 SQL update 用户 role 还是 admin CLI）

### 3.4 不做

- 自动审核（敏感词/LLM 审核）
- 用户举报 / 评分

---

## 4. Phase 6 — 前端打磨 + provider 抽象（outline）

### 4.1 单句目标

把 Phase 2b 留下的"够用但糙"的部分都补圆，并把 provider 抽象推到能加新厂商（不改路由，只加 adapter 实现）的程度。

### 4.2 大致范围

**前端：**
- 移动端响应式 + 黑暗模式默认 + 主题切换
- 消息流的虚拟滚动（>500 条时不卡）
- 多模态：图片上传（aiwoo claude 支持）+ 文件附件（codex 支持）
- 搜索：消息全文 + skill 全文（FTS5）
- 拖动排序 / 多选批量删除 / 标签

**provider 抽象：**
- adapter 注册表：`registerAdapter('aiwoo-claude', AiwooClaudeAdapter)`，新增 provider 不改 routes
- 模型白名单元数据扩展：`{ id, label, provider, supports: { vision, attachments, tool_call } }`
- /api/providers GET：返回当前配置 + 可用模型，前端动态渲染下拉
- 多 key 轮询 + 用量统计：`provider_keys` 表 + `usage_logs` 表（仅落 token 数，不落具体内容）
- token 估算 + context window 截断：进 chat 路由前检查 token，超长截前面（保留首条 system + 最近 N 轮）

### 4.3 不做

- 自建 provider（不走中转直连 OpenAI/Anthropic）— 成本/合规未决，留给以后
- 工具调用 / function calling — 跟 Phase 4 QA-AGENT 的"AI-aided generation"绑一起再说
- 计费 / 余额 / 订阅 — 单租户运营阶段不需要

---

## 5. 路线图汇总（更新版）

| Phase | 状态 | 单句产出 |
|---|---|---|
| 1 | done | Fastify + systemd + Caddy + GH Actions 部署骨架 |
| 2a | done | HTTPS + 邀请码注册 + argon2 + cookie session + 持久化 |
| 2b | done | 多会话聊天 UI + aiwoo claude/codex provider + SSE 流式 |
| **3** | done | skill 表 + 保存为 skill / 选用 skill 流水线 + 个人+可发布存储 |
| **4** | done | 参数化 skill (input schema + tags) + 3 条内置 QA preset + admin CLI preset import |
| **5** | **done** | skill 审核流（pending/approved + 版本号 + admin UI） |
| 6 | **next** | 前端打磨（响应式/搜索/多模态）+ provider 抽象通用化 |

---

## 6. 接下来要做的（可执行 next steps）

1. 把本 roadmap commit + push 到 `main`（路线图先落地，方便跨工具读到）
2. README §"路线图"表格按 §5 更新（Phase 2b 仍 done，Phase 3 路径展开成两行）
3. **休息一下**（用户原话）；下次回来选一项：
   - a. Phase 2b 端到端验收 + 任何补漏（推荐先做，作为 Phase 3 的稳固基线）
   - b. 直接起 Phase 3 详细 spec（基于 §1 展开为完整 design 文档）
   - c. 调整路线图（如果 §1 D1-D5 决策有想反悔的）
