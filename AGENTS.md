# AGENTS.md — server_agent 项目操作手册

> 跨工具入口（Claude Code、Codex、Gemini CLI 都识别 AGENTS.md）。
> 用户视角入口看 [`README.md`](./README.md)；本文件聚焦 **agent 协作 / 运维 / 部署 / 坑**。

## 0. 30 秒速览

- 仓库：[`JqcFrankice/agent_qa`](https://github.com/JqcFrankice/agent_qa)，分支：`main`（生产单分支）
- 生产入口：`https://aicoolyun.vip`（Caddy v2 → React SPA + `/api/*` 反代 `127.0.0.1:8080`）
- 服务器：阿里云 ECS `root@43.108.21.46`（Ubuntu 24.04），systemd 跑 `server-agent.service`
- 当前 Phase：**4 QA-AGENT 模式已上线**（参数化 skill / 动态表单 / `{{var}}` 插值 / 3 条内置 QA preset / tag chip filter）
- 部署：push to `main` → GitHub Actions → SSH → `/usr/local/bin/deploy-agent`（pinned）
- 数据：SQLite 单文件 `/var/lib/server-agent/db/main.sqlite`，每天 02:00 自动备份

## 1. 仓库布局

```
packages/
  shared/   # zod schema、provider 模型白名单（@server-agent/shared）
  server/   # Fastify + Drizzle + better-sqlite3 + provider adapter
  web/      # React + Vite + Tailwind + TanStack Query
deploy/
  Caddyfile           # 生产 Caddy 配置
  agent.env.example   # /etc/server-agent/agent.env 模板
  server-agent.service
scripts/
  bootstrap-server.sh # 服务器一次性初始化（root 跑）
  deploy-agent.sh     # GH Actions 触发的 server-side 部署脚本
  admin-cli.ts        # 邀请码 / 用户管理
  write-build-info.mjs
docs/superpowers/
  specs/              # 每个 Phase 的设计文档
  plans/              # 每个 Phase 的实施计划
.claude/skills/       # 项目本地 superpowers skill（Claude Code 自动加载）
.github/workflows/
  deploy.yml          # build → SSH 触发 deploy-agent
```

## 2. 本地开发

### 2.1 环境

- Node 22（与服务器一致）
- npm workspaces，**根目录**跑命令：

```bash
npm install
npm run dev                 # 起 server :8080 + web 自动代理 /api
curl http://127.0.0.1:8080/api/health
```

### 2.2 最小本地 env（不要 commit）

```env
PORT=8080
HOST=127.0.0.1
NODE_ENV=development
LOG_LEVEL=info
DB_PATH=/tmp/server-agent-dev.sqlite
SESSION_COOKIE_SECRET=dev-secret-at-least-not-empty
ANTHROPIC_AUTH_TOKEN=...    # aiwoo claude key（开发可省，但发消息会失败）
OPENAI_API_KEY=...          # aiwoo codex key
AIWOO_BASE_URL=https://aiwoo.vip
DEFAULT_PROVIDER=aiwoo-claude
DEFAULT_MODEL=claude-opus-4-8
UPSTREAM_FIRST_BYTE_TIMEOUT_MS=30000
```

### 2.3 验证四件套（提交前必跑）

```bash
npm run lint          # 全 workspace eslint
npm run typecheck     # 全 workspace tsc --noEmit
npm test              # vitest（server 集成 + 单测、shared、web）
npm run build         # 全 workspace 构建
```

> CI（`.github/workflows/deploy.yml`）顺序：`npm ci → build:shared → lint → typecheck → test → build`。
> 任一环节失败，部署 job 不会触发。

## 3. 生产部署

### 3.1 自动部署（默认路径）

1. 改代码 → push 到 `main` → GitHub Actions 自动跑：
   - **build job**：`npm ci → build:shared → lint → typecheck → test → build`
   - **deploy job**：`ssh agent@43.108.21.46 "<sha>"` 触发 `/usr/local/bin/deploy-agent`
2. server-side `deploy-agent.sh` 顺序：
   ```
   git fetch + reset --hard <sha>
   npm ci
   npm run build:shared          # 必须早于 migrate（见 §6.1 坑）
   npm run db:migrate            # 注入 agent.env 的 DB_PATH
   npm run build --workspaces    # 含 web/dist
   sudo systemctl restart server-agent
   curl /api/health × 10 重试    # 失败则 rollback 到旧 sha
   ```
3. Caddy 直接服务 `/opt/server_agent/packages/web/dist`（不需要拷贝步骤）。

### 3.2 关键约束（务必遵守）

- **`/usr/local/bin/deploy-agent` 是 pinned 旧版**。`authorized_keys` 用 `command="/usr/local/bin/deploy-agent",no-pty,...`，强制 SSH 进来只跑这个 bin。
  - 修改 `scripts/deploy-agent.sh` 后必须在服务器 root 重装：
    ```bash
    cd /opt/server_agent
    sudo -u agent git pull
    install -o root -g root -m 0755 scripts/deploy-agent.sh /usr/local/bin/deploy-agent
    ```
  - 否则下次自动部署还是用旧版 bin，仓库里的修复不生效。

- **改 env 不会自动生效**。改完 `/etc/server-agent/agent.env` 必须手动 `systemctl restart server-agent`。

- **数据库迁移是 forward-only**。`packages/server/src/db/migrations/*.sql` 一旦 commit 就不能改名/删除（`__drizzle_migrations` 表按文件名记账）。

### 3.3 服务器一次性初始化（仅新机）

详见 [`README.md` §"一次性服务器初始化"](./README.md)。

## 4. 服务器结构（生产）

### 4.1 关键路径

| 路径 | 用途 |
|---|---|
| `/opt/server_agent` | git 仓库（agent 用户拥有），生产源码 |
| `/etc/server-agent/agent.env` | 环境变量（root:agent 0640） |
| `/var/lib/server-agent/db/main.sqlite` | 主数据库 |
| `/var/lib/server-agent/db/backups/` | 每天 02:00 自动备份 |
| `/usr/local/bin/deploy-agent` | pinned 部署脚本（root 拥有） |
| `/etc/systemd/system/server-agent.service` | systemd unit |
| `/etc/caddy/Caddyfile` | TLS + 反代配置 |
| `/home/agent/.ssh/authorized_keys` | GH Actions deploy key（command= 锁死） |

### 4.2 systemd 服务

- `server-agent.service` —— Fastify 进程，跑 `node packages/server/dist/server.js`
- `caddy.service` —— Caddy v2 在 80/443
- `server-agent-db-backup.timer` —— 每日 02:00 SQLite `.backup`

### 4.3 端口

| 端口 | 监听者 | 公网 |
|---|---|---|
| 80 | Caddy | 是（重定向到 443） |
| 443 | Caddy | 是 |
| 8080 | Fastify | **否**（已在阿里云安全组撤掉） |

## 5. 日常运维

### 5.1 健康检查

```bash
curl https://aicoolyun.vip/api/health    # {"status":"ok",...}
```

### 5.2 看日志

```bash
ssh root@43.108.21.46 'journalctl -u server-agent -f'
ssh root@43.108.21.46 'journalctl -u caddy -f'
```

### 5.3 admin CLI（在 server 上跑）

```bash
ssh root@43.108.21.46
cd /opt/server_agent
sudo -u agent bash -c '
  set -a; . /etc/server-agent/agent.env; set +a
  npm run admin -- invite create --uses 1 --note "for foo"
  npm run admin -- invite list
  npm run admin -- invite revoke <code>
  npm run admin -- user list
  npm run admin -- user reset-password <username>     # 交互式
  npm run admin -- user revoke-sessions <username>
  npm run admin -- user delete <username>
'
```

### 5.4 手动数据库备份

```bash
ssh root@43.108.21.46 'sudo -u agent sqlite3 /var/lib/server-agent/db/main.sqlite ".backup \"/var/lib/server-agent/db/backups/manual-$(date +%s).sqlite\""'
```

### 5.5 手动触发部署（不通过 GH Actions）

```bash
ssh root@43.108.21.46 'sudo -u agent /usr/local/bin/deploy-agent'    # 默认部署 origin/main
```

### 5.6 紧急关停自动部署

GitHub → 仓库 Settings → Actions → General → Disable actions。

## 6. 坑与约定（必读）

### 6.1 deploy-agent.sh 必须先 build:shared 再 migrate

**症状**：deploy job 在 `db:migrate` 报 `SyntaxError: does not provide an export named 'isKnownProviderModel'`。

**原因**：`db:migrate` = `tsx src/db/migrate.ts`，import 链 `migrate.ts → config.ts → @server-agent/shared`，shared 的 `package.json.exports` 指向 **`dist/`**。新 commit 给 config 加了 shared 新导出依赖时,旧 dist 还没 export,migrate 当场炸。`set -e` 导致脚本退出，不会走到 build/restart/health/rollback——好处是旧进程不被 restart 所以**线上不会挂**，坏处是看起来部署了但其实没上。

**约定**：deploy-agent.sh 与 bootstrap-server.sh 顺序必须是 `npm ci → build:shared → migrate → build --workspaces`。`npm run build --workspaces` 不会触发 root 的 `prebuild` hook，所以 `build:shared` 必须显式写。

### 6.2 aiwoo 模型：列在 /v1/models ≠ 实际可调用

**症状**：`claude-opus-4-7` 在 `GET /v1/models` 列表里，但 `POST /v1/messages` 返回 `permission_denied`。

**原因**：aiwoo key 绑分组（distributor），分组权限决定哪些模型可调用。/v1/models 是清单，不代表你的 key 能用。

**约定**：
- 默认模型用 **`claude-opus-4-8`**（已实测可用）。
- 加新模型到白名单（`packages/shared/src/providers/models.ts`）前，必须用真实 key `curl -X POST https://aiwoo.vip/v1/messages` 实测能流式返回。
- 报错信息里有 `under group <name>` 字样的就是分组拒。

### 6.3 aiwoo base URL：Claude 不带 /v1，Codex 带 /v1

| 用途 | base URL | 头 |
|---|---|---|
| `aiwoo-claude` adapter（POST `/v1/messages`） | `https://aiwoo.vip` | `x-api-key` + `anthropic-version: 2023-06-01` |
| `aiwoo-codex` adapter（POST `/v1/responses`） | `https://aiwoo.vip` | `Authorization: Bearer <key>` |
| 列模型清单（两个分组都要列） | `https://aiwoo.vip/v1/models` | 对应分组 key 头 |

如果给 Claude SDK / Codex CLI 配置时（不是本项目的 adapter,而是 `cc-switch` 之类），Claude 的 `ANTHROPIC_BASE_URL` **不带 `/v1`**（CLI 自己拼）；Codex 的 `base_url` **带 `/v1`**，且 `wire_api = "responses"`。

### 6.4 客户端断连必须监听 reply.raw 而不是 request.raw

**约束**：流式 SSE handler 里检测客户端断开必须用 `reply.raw.on("close", ...)`。

**原因**：POST 请求体在 handler 启动前已被 Fastify 完整读完,`request.raw.destroyed === true`，'close' 事件早就触发,加 listener 永远不会响应。`reply.raw` 是响应 socket，只在客户端主动断连时关闭。详见 `packages/server/src/routes/messages.ts` 与对应集成测试。

### 6.5 spec / plan 写完就 push

设计 / 实施计划写完立即 commit 到 `docs/superpowers/{specs,plans}/` 并 push 到 `main`。下次会话/不同工具直接 `git pull` 就有上下文，不依赖记忆。

### 6.6 deploy-agent 回滚演练放 main()，不要放 buildApp()

测自动 rollback 时,故意 `throw` 要放在 `packages/server/src/main.ts` 的 listen 之前，**不能**放在 `buildApp()` 里。否则本地 `npm test` 会跑 `buildApp()` 当场 fail,CI build 直接红，根本测不到"build 通过、运行时炸、自动 rollback"的真实场景。

### 6.7 commit 规范

- 一类 commit 做一件事：`feat(server): ...`、`fix(deploy): ...`、`test: ...`、`chore: ...`、`spec: ...`
- 每个 Phase 的 task 建议单独 commit（plan 里也是这么列的）
- PR 合并到 `main` 用 merge commit（保留分支历史），不要 squash

### 6.8 不要直接改 main 上的代码（开发阶段豁免中）

> **当前阶段豁免**（2026-06-14 起）：项目处于开发期，无真实生产用户压力，**默认直接在 main 上改 + push**，触发 GH Actions 自动部署。本节的 worktree+PR 流程仅在用户明确要求 / 大改动 / 切换到生产阶段时启用。

切换到生产阶段后再恢复以下流程：

```bash
git worktree add .claude/worktrees/<feature> -b worktree-<feature>
cd .claude/worktrees/<feature>
# ... 开发 + 自测
git push -u origin worktree-<feature>
gh pr create --title "..." --body "..."
gh pr merge <n> --merge
```

`.claude/worktrees/` 已默认被 git 忽略（`.claude/` 没 ignore 但 worktree 在内部不会污染主仓）。

无论哪种模式，仍要遵守：commit message 规范（§6.7）、push 前自测 lint/typecheck/test/build、不绕 hook、destructive 操作（force push、reset --hard）必须用户明确确认。

### 6.9 Drizzle schema 表声明顺序：被引用的表先声明

`packages/server/src/db/schema.ts` 里如果 A 表 `references(() => B.id)`，**必须** B 在 A 之前声明，否则只能写 lazy ref `(): any => B.id`，会触发 `@typescript-eslint/no-explicit-any` 让 lint 红。

实际顺序（遵守）：`users → sessions → inviteCodes → skills → conversations → messages`。

`conversations.skill_id` 引用 `skills.id`，`messages.conversation_id` 引用 `conversations.id`，按这个排就 OK。

### 6.10 WAL 模式下外部 sqlite3 CLI 写入对正在跑的 server 不可见

`openDatabase` 启了 `journal_mode = WAL`。如果 server 进程已经打开 DB 文件，再用 `sqlite3 /path/to/db "INSERT ..."` 命令行写入，**当前 server 进程读不到**这条新数据（cache miss + WAL coordination）。

本地 e2e 想给 server 塞个 invite code 时遇到过，会一直返回 `AUTH_INVITE_INVALID`。**重启 server 即可看到**。

生产部署不受影响（部署后 server 重启，migration 通过 `db:migrate` 在同一进程内应用）；只在本地 e2e 调试场景需注意。

替代：用 `npm run admin -- invite create ...`（生产服务器有此 script），让 admin CLI 在自己进程里跑完再退出，server 重新打开 DB 时就看到了。

### 6.11 ExitWorktree 后主仓 deps 需重装 + build:shared

退出 worktree 回主仓后（特别是合并完 Phase 工作），**主仓 `node_modules` 可能跟 worktree 不一致**：

```bash
# 主仓视角：
ExitWorktree --action=remove
# 之后回到主仓直接 db:migrate / typecheck 会报：
# Cannot find package 'better-sqlite3'
# Cannot find package '/.../@server-agent/shared/dist/index.js'
```

**修复**：

```bash
npm install                        # 主仓 deps
npm -w @server-agent/shared run build  # 重生成 shared/dist
```

然后 `db:migrate` / typecheck / test 才正常。这条跟 §6.1 是同一类问题（shared/dist 是 server tsx 运行时依赖），但触发时机是 worktree 切换边界。

### 6.12 Drizzle text 字段存 JSON 时 repo 层负责 stringify/parse

`packages/server/src/db/schema.ts` 用 `text("input_schema")` / `text("tags")` 存 JSON 内容时，**Drizzle 不会自动序列化 / 反序列化**。

正确做法：

```ts
// 写入（repo 层）
inputSchema: input.inputSchema ? JSON.stringify(input.inputSchema) : null,
tags: JSON.stringify(input.tags ?? []),

// 读出（route 的 toDto）
inputSchema: row.inputSchema ? JSON.parse(row.inputSchema) : null,
tags: JSON.parse(row.tags),
```

错误做法：直接 `set({ inputSchema: someArray })` 会被 better-sqlite3 拒绝（绑定 array 到 text 列），或者更糟：silently 落地为 `[object Object]` 字面量。

**默认值约定**：`tags` 列在 SQL 用 `DEFAULT '[]'`，确保历史行 / 不传该字段的新行也有合法 JSON，前端 `JSON.parse` 不会崩。

### 6.13 测试 fixture 与 migration 内建数据冲突时用 findOrCreate

某些 migration 会 `INSERT OR IGNORE` 引入约束性数据（如 `0003_qa_skills.sql` 的 `system` 用户）。测试 helper 直接 `users.create("system", "hash")` 会触发 unique 约束错。

**解决**：在测试 helper 里用 findOrCreate 模式：

```ts
async function user(db, name) {
  const repo = new UserRepository(db);
  const existing = await repo.findByUsername(name);
  if (existing) return existing;
  return repo.create(name, "hash");
}
```

这条让 test fixture 跟 migration baked-in 数据共存，不耦合"我建的 user 是不是已存在"的实现细节。

## 7. 依赖与版本

| 类目 | 版本/选择 |
|---|---|
| Node | 22 |
| TypeScript | 5.x ESM-only |
| Fastify | v4 |
| Drizzle ORM | 0.45.x |
| better-sqlite3 | 12.x |
| argon2 | 0.44.x（id 模式） |
| React | 18 + Vite + Tailwind |
| TanStack Query | v5 |
| react-markdown | 9 + remark-gfm + Shiki |

升级前必须先在 worktree 跑全套验证，再走 PR。锁版本，**不**用 `^` 或 `~` 之外的范围。

## 8. 测试 / 自测

### 8.1 测试矩阵

- `packages/shared/src/**/*.test.ts` — schema/白名单
- `packages/server/tests/unit/` — repo、provider adapter（含 503/4xx/timeout/abort 矩阵）
- `packages/server/tests/integration/` — 真 Fastify + 真 SQLite + 真 fetch（abort drill）
- `packages/web/src/lib/streamMessage.test.ts` — SSE reader

新功能必须先写测试再写实现（TDD）。Provider adapter 的真实 wire 格式必须用 SSH 在服务器上 `curl` 实测过。

### 8.2 验收 checklist（每个 Phase 收尾）

- [ ] lint / typecheck / test / build 全绿
- [ ] 真实上游（aiwoo）实测一次完整流式
- [ ] 部署到生产并 `curl https://aicoolyun.vip/api/health` 通过
- [ ] 浏览器手动跑一遍核心 user flow
- [ ] 关键修复写进本 AGENTS.md 的 §6 坑章节

## 9. 路线图

| Phase | 状态 | 内容 |
|---|---|---|
| 1 | done | 基础设施骨架（Fastify + systemd + Caddy + GH Actions 部署） |
| 2a | done | HTTPS + 账号系统 + 持久化（邀请码 + argon2 + cookie session） |
| 2b | **done** | 聊天核心 MVP（aiwoo claude/codex provider + SSE + /chat UI） |
| 3 | **done** | Skill 沉淀流水线：保存对话为 skill / 选用 skill 新建会话 / 个人+可发布存储 |
| 4 | **done** | QA-AGENT 模式：参数化 skill（input schema）+ 内置 QA preset |
| 5 | **next** | Skill 审核流：pending/approved + 版本管理 + admin UI |
| 6 | planned | 前端打磨 + provider 抽象通用化 |

每个 Phase 先 spec 后 plan 再代码，三件套都进 `docs/superpowers/`。
Phase 3-6 总览（含 Phase 3 详细 spec）：[`docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md`](docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md)。

## 10. 联系点

- 上游中转：`aiwoo.vip`（Claude Code & Codex 共用），HTTP 503 + `model_not_found` 是常见错误
- 域名 / TLS：Caddy 自管 Let's Encrypt，证书在 `/var/lib/caddy/.local/share/caddy/`
- DNS：`aicoolyun.vip` A 记录 → `43.108.21.46`
