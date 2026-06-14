# server_agent 项目总结（Phase 1-4 已上线）

> 时间快照：2026-06-14
> 生产入口：[`https://aicoolyun.vip`](https://aicoolyun.vip)
> 仓库：[`JqcFrankice/agent_qa`](https://github.com/JqcFrankice/agent_qa)
> 协作 agent：Claude Code（Sonnet 4.6 / Opus 4.6）+ @JqcFrankice

---

## 0. 一句话定位

aicoolyun.vip 上多用户都能用的、内置 QA-AGENT 模式的、有 skill 商店雏形的 AI Agent 平台 —— 把对话 → 沉淀 skill → 复用 skill 这条链路做完整。

---

## 1. 19 天里程碑（2026-05-26 → 2026-06-14）

| 日期 | Phase | 上线 | 一句话产出 |
|---|---|---|---|
| 05-26~27 | Phase 1 | done | Fastify + systemd + Caddy + GH Actions push-to-main 部署骨架 |
| 05-28~30 | Phase 2a | done | HTTPS + 邀请码注册 + argon2 + cookie session + 持久化 |
| 05-30~06-06 | Phase 2b | done | 多会话聊天 UI + aiwoo claude/codex provider + SSE 流式 |
| 06-06~14 | Phase 3 | done | Skill 沉淀流水线（保存对话为 skill + 个人/公开可见性 + system_prompt 快照） |
| 06-14 | Phase 4 | done | QA-AGENT 模式（参数化 skill + `{{var}}` 插值 + 内置 3 条 QA preset + tag chip filter） |

**全程节奏**：每个 Phase 走「spec → plan → 13 task TDD 实施 → 部署 → AGENTS.md 沉淀坑」一致流水线，所有产物 git 管控，跨工具（Claude Code / Codex / Gemini）复用。

---

## 2. 架构总览

```
┌──────────────────  浏览器（aicoolyun.vip）─────────────────┐
│  React 18 + Vite + Tailwind + TanStack Query              │
│  /chat: Sidebar (tab 切换 + chip filter) + Composer + ... │
│  Dialogs: NewConversation / SaveSkill / SkillForm         │
└──────────────────────────┬────────────────────────────────┘
                           │ HTTPS (Caddy v2 自管 Let's Encrypt)
                           ↓ /api/* 反代
┌──────────────────  阿里云 ECS 43.108.21.46  ──────────────┐
│  Caddyfile → 127.0.0.1:8080 → systemd `server-agent`      │
│  Fastify 4 + better-sqlite3 + Drizzle + zod              │
│                                                            │
│  Routes: auth / health / version / conversations /         │
│          messages (SSE) / skills (CRUD + extract)          │
│  Provider: aiwoo-claude (Anthropic wire)                  │
│            aiwoo-codex (OpenAI wire) — adapter 模式        │
│  DB: SQLite WAL，每天 02:00 自动备份                        │
└──────────────────────────┬────────────────────────────────┘
                           │ HTTPS streaming
                           ↓
                     aiwoo.vip 中转（claude + codex 共用）
```

**三 package monorepo**（npm workspaces）：

- `packages/shared` — zod schema + 模型白名单（前后端共享 type 单一源）
- `packages/server` — Fastify + Drizzle + provider adapter
- `packages/web` — React + Vite

---

## 3. 数据模型演进（4 个 forward-only migration）

| Migration | 时机 | 加什么 |
|---|---|---|
| `0000_initial.sql` | Phase 2a | users / sessions / invite_codes |
| `0001_conversations_messages.sql` | Phase 2b | conversations / messages（id 用自定义 nanoid，外键 cascade） |
| `0002_skills.sql` | Phase 3 | skills 表 + conversations.skill_id 列 + 索引 |
| `0003_qa_skills.sql` | Phase 4 | skills 加 input_schema / tags / slug 三列 + system 占位用户 |

**约束**：所有改动 only ALTER ADD COLUMN / INSERT OR IGNORE / CREATE INDEX —— 永远不删列、不改名、不修历史 migration。新需求加新文件。

---

## 4. 技术决策回顾

| 选择 | 备选 | 为什么这样选 |
|---|---|---|
| SQLite (WAL) | Postgres / MySQL | 单租户运营够用 + 单文件备份方便 + better-sqlite3 同步 API 无 callback hell |
| Drizzle ORM | Prisma / 原生 SQL | TS 类型推导 + 不要 codegen 步骤 + 支持原生 SQL escape hatch |
| Fastify 4 | Express / Hono | 内置 schema 校验 + pino logger + plugin 模式适配 multi-route deps |
| zod | yup / io-ts | discriminated union + zod-validated env + 跨包共享 type |
| SSE | WebSocket / long-poll | LLM 单向流，SSE 比 WS 简单 + 自带 reconnect + 反代友好 |
| aiwoo 中转 | 直连 OpenAI/Anthropic | 单租户运营，aiwoo 把 Claude/Codex 包到一起，省一份合规 |
| argon2 | bcrypt / scrypt | 现代密码学推荐 + 抗 GPU 暴破 |
| invite code 自助注册 | 邮箱验证 / 手动加 | 启动期没邮件基建，邀请码够用 |
| systemd + Caddy | Docker / Kubernetes | 单机部署 over-engineer 没必要；Caddy 自动 TLS |
| GH Actions push-to-main | GitOps / 手动 SSH | 一次 commit 触发部署 + 自动 rollback 链路 |
| 精简 input schema DSL | JSON Schema / zod 直接 | YAGNI：3 widget 够用，不引入 200KB 依赖 |
| 占位符 `{{var}}` | `{var}` / `${var}` | Mustache 惯例，不与 JSON / JS 字符串冲突 |
| skill 公开 = is_public 字段（Phase 3）+ 审核 → Phase 5 | category 表 / 标签编码 | 等真有滥用风险再加 review_status，schema baked-in |
| preset = admin CLI 幂等 import JSON | seed migration / 热装载 | prompt 改动不写新 migration；走真 skill 表，复用所有逻辑 |
| system 用户 = 真 users 行 | author_user_id=NULL | FK 完整性零修改 + 全代码路径无特判 |

---

## 5. 关键不变量（跨 Phase 不破坏的设计）

1. **Provider-agnostic**：skill / preset / 模板永远不绑死某个 provider 或 wire 格式（aiwoo claude vs aiwoo codex 之间能相互替换）
2. **Forward-only migration**：每个 phase 加新表/新列只能 add，不删不改名
3. **system_prompt 快照**：会话创建时把 skill.system_prompt 快照到 conversations 表，**不运行时 join**。skill 后续被软删 / 改文本 / 切私有都不影响已存在会话
4. **跨工具兼容**：所有运维 / 规范沉淀在 `AGENTS.md`，项目本地 SKILL.md 只是 Claude Code 入口指针
5. **生产小步走**：每个 phase 收尾必须 deploy → `curl /api/health` → 浏览器跑核心 user flow

---

## 6. 沉淀的 13 个生产坑（AGENTS.md §6.1-§6.13）

| § | 坑 | 触发场景 |
|---|---|---|
| 6.1 | deploy-agent.sh 必须先 build:shared 再 db:migrate | shared 新增导出，旧 dist 缺 export → SyntaxError |
| 6.2 | aiwoo `/v1/models` 列出 ≠ 实际可调用 | key 绑分组（distributor）权限 |
| 6.3 | aiwoo Claude 不带 /v1，Codex 带 /v1 | wire_api 跟两个上游不一致 |
| 6.4 | SSE 断连必须监听 `reply.raw.on('close')` | request.raw 不可靠 |
| 6.5 | spec / plan 写完就 push（即使没动代码） | 跨工具/会话恢复上下文 |
| 6.6 | rollback 演练 throw 放 main() 不放 buildApp() | 否则本地 test/CI 提前拦截 |
| 6.7 | commit 规范 `feat\|fix\|test\|chore\|spec(scope): ...` | 一类 commit 一件事 |
| 6.8 | 开发阶段豁免：直接 main，无须 worktree+PR | 真生产用户出现时再恢复流程 |
| 6.9 | Drizzle schema 表声明顺序：被引用的表先声明 | 否则要 lazy ref + `: any` 触发 lint |
| 6.10 | WAL 模式下 sqlite3 CLI 写入对正在跑的 server 不可见 | 本地 e2e 想给 server 塞 invite 时 |
| 6.11 | ExitWorktree 后主仓 deps 需重装 + build:shared | better-sqlite3 / shared/dist missing |
| 6.12 | Drizzle text 字段存 JSON 时 repo 层负责 stringify/parse | input_schema / tags 列 |
| 6.13 | 测试 fixture 与 migration INSERT OR IGNORE 冲突时用 findOrCreate | system 用户 |

---

## 7. 数字（截至 2026-06-14）

- **94 commits** / **19 天活跃开发**
- **5448 LOC**（不含 dist 与 node_modules，含 .ts / .tsx / .sql）
- **111 个 source 文件** across 3 packages
- **94 个自动化测试**（server 80 / shared 6 / web 8）
  - 含 6 个 interpolate 用例 / 8 个 skills repo 用例 / 7 个 skills route 用例 / SSE parser / provider adapter 错误矩阵
- **4 个 migration** forward-only
- **5 个 phase spec + 5 个 plan**（Phase 3-6 总览 + 各自详 spec/plan）
- **2 次 git PR + 直接 main 推送 ~50 次**（按 dev-phase exemption）
- **1 个生产服务器** + **1 个生产域名** + **1 个 admin 账号**（Phase 4 收尾时重置）

---

## 8. 当前生产状态

| 项 | 值 |
|---|---|
| 部署 sha | `19411c5` |
| 服务运行 | systemd `server-agent.service` on `127.0.0.1:8080` |
| 健康检查 | `GET https://aicoolyun.vip/api/health` → 200 ok |
| 用户表 | 2 行（admin + system） |
| skill 表 | 3 条 system preset（qa-bug-repro / qa-test-cases / qa-regression-checklist）|
| 上游（已实测 2026-06-14） | aiwoo `claude-opus-4-8` / `claude-sonnet-4-6` 当前不可用，`gpt-5.5` (codex) 正常 |
| 备份 | 每天 02:00 自动备份 SQLite，保留 7 天 |

---

## 9. 路线图（剩余 Phase outline）

| Phase | 状态 | 触发条件 | 大致范围 |
|---|---|---|---|
| 5 — Skill 审核 UI | next | **真用户公开 skill 出现敏感内容** 或 **多用户量上来** | review_status (pending/approved) + version 管理 + admin 审核 UI + skill_versions 表 |
| 6 — 前端打磨 + provider 抽象 | planned | Phase 5 后 / 或 sub-project 单独启动 | 移动端 / 黑暗模式 / 搜索（FTS5）/ 多模态 / adapter registry / 多 key 轮询 / 用量统计 |

**Phase 5 启动门槛**（D3 决策）：MVP 期邀请用户少，问题出来再快速回滚 + 加审核位。schema 已经 baked-in `is_public` + `published_at`，Phase 5 加 `review_status` 不需 schema 迁移。

**Phase 6 拆 sub-project 后的可独立启动单元**：
- 黑暗模式默认 + 主题切换（小，纯 UI）
- 移动端响应式（中，需要 brainstorm 移动 first / desktop first）
- 消息全文搜索（中，FTS5 schema + 索引）
- 多模态（大，需要 provider 升级）
- adapter registry + 多 key 轮询（大，跨 phase 影响）

---

## 10. 协作模式回顾

**人类（@JqcFrankice）的角色**：
- 给方向 / 给授权（"听你的建议"）
- 关键决策的 review（D1-D5 之类）
- 真痛点反馈（部署后跑通 / 真用户体验）
- 提供生产秘密（aiwoo key、SSH 私钥）

**Claude Code 的角色**：
- 写 spec / plan / 实施代码
- 跑 lint / typecheck / test / build / smoke
- ssh + curl 验证生产部署
- 沉淀坑 + 文档同步

**节奏**：每个 phase 收尾后 commit + push，spec/plan 跟代码一样进 git，AGENTS.md 持续 append 经验，README 偏用户视角，文档矩阵清晰。

**遇到的协作摩擦**（已沉淀）：
- 网络层（aiwoo 503 / TLS handshake EOF）多次中断 subagent dispatch → 后期切 inline execution 更稳
- worktree 边界（切回主仓 deps 同步）首次没经验
- "听你的建议" 模式下，agent 需要主动判断"这一步真有真实价值还是 over-engineering"

---

## 11. 接下来你能做的（按性价比）

1. **5 分钟**：`https://aicoolyun.vip` 用 admin 账号登录，跑一遍 Skills tab → 选 preset → 进会话发消息（用 gpt-5.5）
2. **30 分钟**：邀请 2-3 位 QA 同事注册账号试用 preset，收集真痛点
3. **真痛点驱动下一步**：按反馈决定 Phase 5 / Phase 6 sub-project / preset 调优 / 或者这版就够用先稳一段时间

---

## 12. 文档矩阵

| 文件 | 视角 | 内容 |
|---|---|---|
| [`README.md`](../README.md) | 用户 | 项目能干嘛 / 当前状态 / 路线图 |
| [`AGENTS.md`](../AGENTS.md) | agent 协作 | 部署 / 运维 / 13 个坑 / 跨工具约定 |
| [`docs/superpowers/specs/*-design.md`](./superpowers/specs/) | spec | 每 Phase 的设计决策 |
| [`docs/superpowers/plans/*.md`](./superpowers/plans/) | plan | 每 Phase 的 task 拆分 + TDD step |
| [`.claude/skills/server-agent-ops/SKILL.md`](../.claude/skills/server-agent-ops/SKILL.md) | Claude Code | 项目本地 skill 入口指针 |
| 本文件 | 项目快照 | 截至 2026-06-14 的完整回顾 |

---

## 致谢

实施过程中用到的 superpowers skills（git-worktrees / writing-plans / brainstorming / executing-plans / subagent-driven-development / using-superpowers），让 spec → plan → implementation 的链路保持纪律性。

合作愉快。下个 Phase 见。
