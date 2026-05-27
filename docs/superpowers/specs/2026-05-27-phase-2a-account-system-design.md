# Phase 2a — HTTPS、账号系统、持久化基线 设计文档

**Spec 编号**：2026-05-27-phase-2a-account-system
**目标项目**：[`server_agent`](https://github.com/JqcFrankice/agent_qa)
**作者**：Claude Opus 4.6（与 @JqcFrankice 协作 brainstorm）
**状态**：已通过设计评审，待落地为 plan

---

## 0. 全局背景

最终目标是在阿里云上构建一个**多用户 AI Agent 平台**（详见 Phase 1 spec §0）。Phase 2 在 Phase 1 spec 中原本被描述为"账号系统 + 对话内核 MVP"，本次 brainstorm 决定**把 Phase 2 拆成 2a + 2b**：

| 子 Phase | 范围 | 价值里程碑 |
|---|---|---|
| **Phase 2a（本 spec）** | HTTPS + 账号系统 + 持久化基线 | `https://aicoolyun.vip` 可注册/登录，DB 落地 |
| Phase 2b | 对话内核 MVP（Claude/Codex provider 抽象 + SSE 流式 + 历史） | 用户能在 UI 里跟 AI 对话 |

**拆分理由**：账号 + 持久化是"基础工程"，与对话内核的"产品价值"关注点完全不同；分两步交付能让每个 spec 聚焦、回归窗口小、用户能更早看到一个里程碑。

Phase 2a 完成后，Phase 1 spec §8.L1（HTTPS / 域名）和 §8.L3（secrets 升级评估）的承诺被部分兑现：HTTPS 上线，secrets 决定继续用 EnvironmentFile（理由见 §10 ADR-13）。

---

## 1. 范围与非范围

### 范围（Phase 2a 必须交付）

- 域名 `aicoolyun.vip` 解析到 ECS（DNS 已配置，本 spec 撰写时已生效）
- Caddy v2 反向代理 + 自动 Let's Encrypt 证书，HTTP→HTTPS 强跳，HSTS
- Fastify 监听切到 `127.0.0.1:8080`，安全组撤 8080 / 放行 80+443
- SQLite + Drizzle ORM + 三张表（users / sessions / invite_codes）+ migration 流水线
- 账号注册、登录、登出、`/api/auth/me`
- Cloudflare Turnstile 反机器人 + 邀请码门槛
- argon2id 密码哈希、cookie session（HttpOnly Secure SameSite=Lax）
- 登录暴力 / 注册滥用 rate limit
- Admin CLI（`npm run admin -- ...`）：发邀请码、列用户、撤会话、删用户
- 仓库重构为 npm workspaces：`packages/{server, web, shared}`
- React + Vite + Tailwind 三页面（登录 / 注册 / 登录后占位）
- DB migration 失败 abort 演练 + 兼容旧的 Phase 1 自动回滚演练
- 升级 deploy-agent / bootstrap-server / GitHub Actions workflow 适配新结构

### 非范围（明确不做，留给 Phase 2b 及之后）

- 任何与 Claude / Codex / aiwoo 的对话集成
- 对话历史表、消息表、provider 抽象
- 忘记密码 / 邮箱验证（admin CLI 重置代替）
- 用户角色（admin / user 角色字段）— admin 全靠服务器 SSH + CLI
- 多因素认证（TOTP）
- OAuth2 / 第三方登录
- 监控告警（Phase 后期）
- SOPS / age secrets 加密入库（继续 EnvironmentFile）
- 单页应用以外的 SSR / SEO 优化

---

## 2. 仓库结构（重构后）

Phase 1 的扁平结构升级为 npm workspaces 三包结构。代码物理迁移在 plan 段 A 一次完成。

```
server_agent/                                 # = github.com/JqcFrankice/agent_qa
├── package.json                              # workspaces=[packages/*]
├── tsconfig.base.json                        # 共享 ts 配置
├── packages/
│   ├── shared/                               # zod schema、类型、常量（仅依赖 zod）
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── schemas/
│   │       │   ├── user.ts                   # usernameSchema, passwordSchema
│   │       │   ├── auth.ts                   # registerRequest, loginRequest
│   │       │   └── index.ts
│   │       └── index.ts
│   ├── server/                               # Fastify 应用（Phase 1 src/ 整体迁过来）
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   ├── src/
│   │   │   ├── server.ts                     # 入口
│   │   │   ├── config.ts
│   │   │   ├── logger.ts
│   │   │   ├── build-info.ts
│   │   │   ├── db/
│   │   │   │   ├── schema.ts                 # Drizzle 表
│   │   │   │   ├── client.ts                 # better-sqlite3 + drizzle 单例
│   │   │   │   ├── migrations/               # drizzle-kit 输出（commit 进仓库）
│   │   │   │   │   └── 0000_initial.sql
│   │   │   │   └── repositories/
│   │   │   │       ├── users.ts
│   │   │   │       ├── sessions.ts
│   │   │   │       └── invites.ts
│   │   │   ├── crypto/
│   │   │   │   ├── argon2.ts                 # 密码哈希封装
│   │   │   │   ├── session-id.ts             # 32 字节随机 + base64url
│   │   │   │   └── invite-code.ts            # 12 位 base32（剔除 0/O/I/L）
│   │   │   ├── middleware/
│   │   │   │   ├── session.ts                # cookie → req.user
│   │   │   │   ├── rate-limit.ts             # IP + username 双维度
│   │   │   │   └── turnstile.ts              # Cloudflare verify
│   │   │   ├── routes/
│   │   │   │   ├── health.ts                 # /api/health
│   │   │   │   ├── version.ts                # /api/version
│   │   │   │   └── auth/
│   │   │   │       ├── register.ts           # POST /api/auth/register
│   │   │   │       ├── login.ts              # POST /api/auth/login
│   │   │   │       ├── logout.ts             # POST /api/auth/logout
│   │   │   │       ├── me.ts                 # GET  /api/auth/me
│   │   │   │       └── index.ts
│   │   │   └── errors.ts                     # AppError + code 常量
│   │   └── tests/
│   │       ├── unit/
│   │       │   ├── crypto/
│   │       │   ├── middleware/
│   │       │   └── repositories/
│   │       ├── integration/
│   │       │   └── auth/
│   │       └── helpers/
│   │           ├── test-db.ts
│   │           └── mocks/
│   └── web/                                  # Vite + React SPA
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── routes/
│           │   ├── login.tsx
│           │   ├── register.tsx
│           │   └── home.tsx
│           ├── lib/
│           │   ├── api.ts                    # fetch wrapper（credentials: include）
│           │   └── queryClient.ts
│           └── components/
│               ├── Form.tsx
│               └── TurnstileWidget.tsx
├── deploy/
│   ├── server-agent.service                  # systemd unit（Phase 2a 修订）
│   ├── Caddyfile                             # 新增
│   └── agent.env.example                     # 加 SESSION_COOKIE_SECRET 等
├── scripts/
│   ├── deploy-agent.sh                       # 修订：先 migrate 后 build
│   ├── bootstrap-server.sh                   # 升级：装 caddy、SQLite 目录、扩 sudoers
│   ├── write-build-info.mjs                  # 输出位置改 packages/server/dist
│   └── admin-cli.ts                          # 新增 admin CLI
├── docs/
│   └── superpowers/
│       ├── specs/
│       │   ├── 2026-05-27-phase-1-infrastructure-design.md
│       │   └── 2026-05-27-phase-2a-account-system-design.md   ← 本文件
│       └── plans/
│           ├── 2026-05-27-phase-1-infrastructure-plan.md
│           └── 2026-05-27-phase-2a-account-system-plan.md     ← 下一步生成
├── .github/
│   └── workflows/
│       └── deploy.yml                        # 修订：build --workspaces，先 migrate
└── .gitignore
```

### 关键约束

- `packages/shared` **只依赖 zod**，禁止引入 fastify、better-sqlite3 等运行时库。让 web 能干净 import。
- 所有 SQL migration 在 `packages/server/src/db/migrations/` 目录下，**前向 only**（不写 down），commit 进仓库。
- 仓库不放 secret；新增 secret 在服务器 `/etc/server-agent/agent.env`，仓库只有 `.example`。
- Caddyfile 在仓库内，bootstrap 脚本把它 install 到 `/etc/caddy/Caddyfile`。

---

## 3. 服务器侧布局（Phase 1 → Phase 2a 增量）

| 项 | Phase 1 | Phase 2a |
|---|---|---|
| 系统用户 | `agent` | （不变） |
| 代码目录 | `/opt/server_agent` | （不变，目录结构变化由 git 管理） |
| 配置目录 | `/etc/server-agent/`（root:agent, 0750） | （不变） |
| Env 文件 | `/etc/server-agent/agent.env`（root:agent, 0640） | 新增字段：见 §6 |
| 数据目录 | — | `/var/lib/server-agent/db/`（agent:agent, 0750） |
| 备份目录 | — | `/var/lib/server-agent/db/backups/`（同上） |
| systemd unit | `server-agent.service` | + `ReadWritePaths=/var/lib/server-agent/db`<br>HOST 改在 env 文件里（`/etc/server-agent/agent.env`），unit 自身仍只 `EnvironmentFile=` 引用 |
| 监听 | `0.0.0.0:8080` | `127.0.0.1:8080`（仅本机） |
| 入站端口 | 8080 | 80 + 443（撤 8080） |
| Caddy | — | apt 装、`/etc/caddy/Caddyfile`、systemd 自启 |
| Sudoers | `agent` 可 restart server-agent | + `agent` 可 reload caddy（用于 deploy 时刷新静态资源缓存） |
| Backup cron | — | systemd timer 每天 02:00 跑 `sqlite3 .backup` |

### Bootstrap 顺序变化

`scripts/bootstrap-server.sh` 在 Phase 2a 修订后做这些事（增量）：

1. `apt install caddy`
2. install `deploy/Caddyfile` → `/etc/caddy/Caddyfile`，`systemctl enable --now caddy`
3. 创建 `/var/lib/server-agent/db/{,/backups}` 目录，owner agent
4. 安装 backup systemd timer + service unit
5. 扩展 sudoers：增加 `caddy reload` 权限
6. 重新安装 systemd unit（含新 ReadWritePaths）

人工步骤减少（Phase 1 的"放行 8080"变成"放行 80+443、撤 8080"，DNS 已就绪不需要操作）。

---

## 4. Caddy 配置（HTTPS 终结）

### `deploy/Caddyfile`

```
{
    email admin@aicoolyun.vip
}

aicoolyun.vip {
    encode zstd gzip

    # 安全 headers（先在 Caddy 层加，前端 fetch 不需要重复）
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "geolocation=(),microphone=(),camera=()"
        Content-Security-Policy "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; img-src 'self' data:"
        # 移除 server 标识
        -Server
    }

    # API 反代到 Fastify
    handle /api/* {
        reverse_proxy 127.0.0.1:8080
    }

    # SPA 静态资源
    handle {
        root * /opt/server_agent/packages/web/dist
        try_files {path} /index.html
        file_server
    }
}

# www 子域统一跳转到裸域（canonical），避免 cookie 在两个域上分裂
www.aicoolyun.vip {
    redir https://aicoolyun.vip{uri} permanent
}

# 强制 HTTP → HTTPS
http://aicoolyun.vip, http://www.aicoolyun.vip {
    redir https://aicoolyun.vip{uri} permanent
}
```

### 自动证书

Caddy 默认走 ACME http-01 challenge（需 80 端口可达）。证书自动续签、OCSP stapling 自动开启。

### 错误处理

- 80 / 443 任一不可达 → ACME 失败 → Caddy 不停 retry，但 HTTPS 不可用。Phase 2a 验收时如果证书签不下来要看 `journalctl -u caddy` 排查
- Caddy 进程挂 → systemd `Restart=on-failure` 拉起
- 安全组若误删入站规则 → ACME 续签失败，告警靠 Caddy 日志（Phase 后期补监控）

---

## 5. 数据模型

### 5.1 Drizzle schema (`packages/server/src/db/schema.ts`)

```ts
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  defaultProvider: text("default_provider"),  // 留 hook 给 Phase 2b
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),  // 32-byte random base64url
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
}, (t) => ({
  byUser: index("idx_sessions_user_id").on(t.userId),
  byExpires: index("idx_sessions_expires").on(t.expiresAt),
}));

export const inviteCodes = sqliteTable("invite_codes", {
  code: text("code").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  usesRemaining: integer("uses_remaining").notNull().default(1),
  createdBy: text("created_by").notNull(),
  note: text("note"),
});
```

### 5.2 关键约定

| 约定 | 值 |
|---|---|
| Username | `^[a-zA-Z0-9_-]{3,32}$` |
| 密码强度 | length ≥ 10，含数字 + 字母（zod regex） |
| Argon2id 参数 | `memoryCost=65536 (64MB), timeCost=3, parallelism=1` |
| Session ID | `crypto.randomBytes(32)` → base64url（~43 字符） |
| Cookie 名 | `sa_sid` |
| Cookie 属性 | `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` |
| Session 过期 | `created_at + 30d`；若 `now - last_seen_at > 7d` 也视为失效 |
| 邀请码字符集 | base32 去掉 0/O/I/L → 28 字母 |
| 邀请码长度 | 12 位（28^12 ≈ 2^57 安全空间） |
| Turnstile verify endpoint | `https://challenges.cloudflare.com/turnstile/v0/siteverify` |
| Turnstile 超时 | 5 秒；超时视为校验失败（fail closed） |

### 5.3 Migration 流水线

- 开发：`packages/server $ npm run db:generate`（drizzle-kit 比对 schema.ts vs latest migration，输出 `0001_*.sql`）
- 部署：`deploy-agent.sh` 在 `npm run build` 之前先跑 `npm run db:migrate`（drizzle-kit 顺序应用未应用的 migration 文件）
- Migration 失败：deploy-agent.sh exit 非 0，**不进 systemctl restart**。运行中的旧版本继续工作。
- 不写 down migration（要回退就写新 migration 或人工 SQL）

---

## 6. 服务（Fastify）实现轮廓

### 6.1 入口 `packages/server/src/server.ts`（修订自 Phase 1）

```ts
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { migrate } from "./db/client.js";
import healthRoute from "./routes/health.js";
import versionRoute from "./routes/version.js";
import authRoutes from "./routes/auth/index.js";
import { sessionMiddleware } from "./middleware/session.js";

export async function buildApp() {
  const config = loadConfig();
  const app = Fastify({ logger });

  await app.register(fastifyCookie, {
    secret: config.sessionCookieSecret,  // 用于 Cookie 签名（Phase 2a 仅签 sid）
  });
  app.addHook("onRequest", sessionMiddleware);

  await app.register(healthRoute, { prefix: "/api" });
  await app.register(versionRoute, {
    prefix: "/api",
    gitSha: config.gitSha,
    buildTime: config.buildTime,
    nodeEnv: config.nodeEnv,
  });
  await app.register(authRoutes, { prefix: "/api/auth" });

  return app;
}
```

### 6.2 `loadConfig` 新增字段

```
PORT=8080
HOST=127.0.0.1                         # ← Phase 2a 改
NODE_ENV=production
LOG_LEVEL=info
DB_PATH=/var/lib/server-agent/db/main.sqlite
SESSION_COOKIE_SECRET=<32 字节 base64>   # 新增
TURNSTILE_SECRET_KEY=0x4...             # 新增（Cloudflare 后台获取）
TURNSTILE_SITE_KEY=0x4...               # 新增（前端用，可公开但走 env 注入）
```

`config.ts` 用 zod 校验全部 env，缺一即 fail-fast。

### 6.3 路由 API 契约

| 方法 | 路径 | Body / Header | 200 / 201 | 错误 |
|---|---|---|---|---|
| POST | `/api/auth/register` | `{username, password, inviteCode, turnstileToken}` | 201 `{ok:true}` | 400/409/423 |
| POST | `/api/auth/login` | `{username, password}` | 200 `{ok:true, user:{id,username}}` + Set-Cookie | 401/429 |
| POST | `/api/auth/logout` | （cookie） | 200 `{ok:true}` + Clear-Cookie | 401 |
| GET | `/api/auth/me` | （cookie） | 200 `{user:{id,username,createdAt}}` | 401 |
| GET | `/api/health` | — | 200 `{status:"ok",uptimeSec}` | — |
| GET | `/api/version` | — | 200 `{gitSha,buildTime,nodeEnv}` | — |

### 6.4 错误统一格式

```json
{
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "用户名或密码不正确"
  }
}
```

| code | HTTP | 触发 |
|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | 401 | login 失败（**不区分**用户名是否存在，避免 username 枚举攻击） |
| `AUTH_RATE_LIMITED` | 429 | login / register 超频 |
| `AUTH_USERNAME_TAKEN` | 409 | register 重复用户名（注册侧**必须**告知，否则用户无法理解失败原因；username 枚举风险在注册侧由 Turnstile + IP rate limit 兜底） |
| `AUTH_INVITE_INVALID` | 400 | 邀请码不存在/已用完/已过期 |
| `AUTH_TURNSTILE_FAILED` | 423 | Turnstile token 校验失败或超时 |
| `AUTH_VALIDATION` | 400 | username/password 格式不合法（zod） |
| `AUTH_NOT_AUTHENTICATED` | 401 | 受保护路由没 cookie 或 session 失效 |
| `INTERNAL` | 500 | 兜底，不暴露细节 |

### 6.5 Rate limit 设计

- 实现：SQLite 临时表 `rate_limit_buckets(key, count, window_start)`，每次写入前清理过期窗口
- login：每 IP 5 次/小时；每 username 5 次/小时；先到先 lock；锁后 30 分钟
- register：每 IP 3 次/小时
- 不依赖 Redis（最小化外部依赖）

### 6.6 Admin CLI (`scripts/admin-cli.ts`)

```bash
npm run admin -- invite create --uses 5 --expires 7d --note "for jira team"
npm run admin -- invite list
npm run admin -- invite revoke <code>
npm run admin -- user list
npm run admin -- user revoke-sessions <username>
npm run admin -- user reset-password <username>      # 交互式输入新密码
npm run admin -- user delete <username>
```

实现：直接 import `db/repositories`，`commander` 解析参数；以 `agent` 用户身份在服务器上跑（`sudo -u agent /opt/server_agent && npm run admin ...`）。

---

## 7. 前端（Vite + React + Tailwind）

### 7.1 路由

| 路径 | 内容 | 鉴权 |
|---|---|---|
| `/` | 已登录 → 重定向 `/home`；未登录 → 重定向 `/login` | 任意 |
| `/login` | 登录表单（username + password） | 未登录 only |
| `/register` | 注册表单（username + password + invite_code + Turnstile） | 未登录 only |
| `/home` | 占位页面：`Hello {username}` + 登出按钮 | 必须登录 |

### 7.2 状态管理

- `@tanstack/react-query`：`useMe()` 用 `GET /api/auth/me` 拿当前用户；`useLogin()` `useRegister()` `useLogout()` 是 mutation
- 不引 Redux / Zustand
- Form：`react-hook-form` + `zodResolver(loginRequestSchema)`（schema 来自 `@server-agent/shared`）

### 7.3 样式

- Tailwind CSS（已配置 `tailwind.config.ts`）
- 不引入 UI library；Phase 2b 视聊天 UI 复杂度决定是否引 shadcn/ui

### 7.4 部署形态

- `npm run build --workspace=@server-agent/web` 输出 `packages/web/dist/`
- Caddy 直接 serve（不经 Fastify），SPA fallback 到 `index.html`
- 环境变量注入：Vite 的 `VITE_TURNSTILE_SITE_KEY` build 时编译进 bundle（site key 公开，无安全风险）

---

## 8. 部署管道（Phase 1 → Phase 2a 增量）

### 8.1 GitHub Actions workflow 修订

`.github/workflows/deploy.yml`：

```yaml
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci                              # workspaces 自动一并装
      - run: npm run lint --workspaces --if-present
      - run: npm run typecheck --workspaces --if-present
      - run: npm run test --workspaces --if-present
      - run: npm run build --workspaces --if-present
  deploy:
    # 与 Phase 1 相同：ssh agent@..., command lock 触发 deploy-agent
```

### 8.2 `deploy-agent.sh` 修订（增量）

```bash
# Phase 1 流程：fetch → reset → npm ci → npm run build → systemctl restart → health
# Phase 2a 在 npm ci 之后、npm run build 之前插入：
npm run db:migrate --workspace=@server-agent/server
# 失败立即 exit 非 0（不重启服务，不回滚——回滚仍走 git reset 旧 sha 路径）
```

### 8.3 健康检查 URL 改 `/api/health`

deploy-agent.sh 的 `health_ok` 函数：`curl -fsS http://127.0.0.1:${PORT:-8080}/api/health`。

### 8.4 回滚演练 v2

| 演练 | 触发 | 期望 |
|---|---|---|
| **代码挂**（沿用 Phase 1） | `main()` 里 throw | systemctl restart loop → health 10×1s 失败 → reset 旧 sha → restart → 通 |
| **Migration 挂**（新增） | 新增一个故意失败的 migration（如 `ALTER TABLE users ADD COLUMN ... FOREIGN KEY (nonexistent)`） | deploy-agent 在 `db:migrate` 阶段 exit 非 0；**不会** systemctl restart；旧服务继续跑旧 schema |

---

## 9. 验收标准

### 9.1 自动化测试矩阵

- 单元测试：`crypto/argon2`、`crypto/session-id`、`crypto/invite-code`、`middleware/rate-limit`
- 集成测试（vitest + fastify.inject + in-memory SQLite）：每个 auth 路由覆盖成功 + 至少一种失败路径
- 总用例数预估：约 25 个，按段拆到 plan 各阶段
- CI 强制 lint + typecheck + test 全过，否则 deploy job 不触发

### 9.2 端到端验收清单

| # | 项 | 验证 |
|---|---|---|
| 1 | `https://aicoolyun.vip/` 返回 React 登录页 | 浏览器 |
| 2 | 证书有效（Let's Encrypt 链） | `curl -vI https://aicoolyun.vip` |
| 3 | HTTP→HTTPS 强跳 | `curl -I http://aicoolyun.vip` 应 301 |
| 4 | HSTS 头 | `Strict-Transport-Security: max-age=31536000` |
| 5 | `/api/health` 200 | `curl https://aicoolyun.vip/api/health` |
| 6 | `/api/version.gitSha` = HEAD 短 hash | `curl https://aicoolyun.vip/api/version` |
| 7 | 注册流程 | admin CLI 发码 → 浏览器注册 → 跳 `/login` |
| 8 | 登录持久化 | 登录后关闭浏览器、重开仍登录（30 天 cookie） |
| 9 | `/api/auth/me` 鉴权 | 无 cookie 401，有 cookie 200 |
| 10 | 登出 | 登出后 `/api/auth/me` 401 |
| 11 | 邀请码用尽 | 同码用完后第 N+1 次注册 `AUTH_INVITE_INVALID` |
| 12 | Turnstile 失败 | 不带 token 注册返回 423 |
| 13 | 暴力被锁 | 6 次错密码后 429 + Retry-After |
| 14 | Migration 失败 abort | 故意失败 migration push → deploy-agent 在 migrate 阶段 exit 非 0 |
| 15 | Phase 1 自动回滚仍生效 | drill：`main()` throw → 老路径回滚 |
| 16 | DB 备份生成 | `ls /var/lib/server-agent/db/backups/` 至少有 1 个 .sqlite 文件，文件大小 > 0 |
| 17 | spec + plan 已 push | GitHub 上能看到本 spec 与对应 plan |

### 9.3 性能 / 容量声明（不强测）

- 1k 用户 + 5k session：`/api/auth/me` p95 < 20ms
- Caddy + Fastify + SQLite 三进程总内存 < 300MB（Phase 1 是 25 MB；Phase 2a 多了 Caddy ~30 MB + SQLite 约 10 MB）

---

## 10. 决策记录（ADR）

| # | 决策 | 替代 | 理由 |
|---|---|---|---|
| ADR-09 | Phase 2 拆 2a + 2b | 一个大 Phase 2 | 关注点分离、每个 spec 聚焦、可见里程碑 |
| ADR-10 | 反代 = Caddy v2 | Nginx + certbot、Fastify 直管 TLS | LE 证书全自动；Caddyfile 极简；进程隔离 |
| ADR-11 | TLS 证书 = Let's Encrypt（ACME http-01） | Cloudflare Origin Cert、自签 | 免费、自动续签、无 Cloudflare 强依赖 |
| ADR-12 | 持久化 = SQLite + Drizzle ORM | Postgres、Prisma、Knex | Phase 2a-5 容量够；单文件备份；TS 一等公民 |
| ADR-13 | Secrets 仍 EnvironmentFile，不上 SOPS | SOPS/age、Vault | Phase 2a 仅新增 2-3 个 secret，不入 git，无收益 |
| ADR-14 | 注册门槛 = 邀请码 + Turnstile（双层） | 仅 Turnstile、邮箱验证 | 双层防垃圾；不引邮件基础设施 |
| ADR-15 | Session = DB session + Cookie | JWT、OAuth2 | 撤销简单；XSS 防御天然（HttpOnly）；SSE 兼容 |
| ADR-16 | 密码哈希 = argon2id | bcrypt、scrypt | OWASP 2024 推荐 #1，GPU 攻击成本最高 |
| ADR-17 | 仓库布局 = npm workspaces | 单仓平铺、独立仓 | shared schema 互通；CI 不变；解耦成本可控 |
| ADR-18 | 前端 = Vite + React + Tailwind | htmx + SSR、原生 fetch | Phase 2b 聊天 UI 复用度高；生态最厚 |
| ADR-19 | Admin = CLI（不开 HTTP admin 路由） | `/api/admin/*` + admin token | 减少攻击面；操作频率极低 |
| ADR-20 | API 前缀 = `/api`（无版本号） | `/v1`、`/api/v1` | YAGNI；真破坏性变更时再加 |
| ADR-21 | Migration 失败策略 = abort，不回滚 | migration down、自动 git reset | down migration 风险大；回滚走 git reset 路径已有 |

---

## 11. 风险与遗留

### 11.1 风险

- **R4 邀请码泄漏**：邀请码 28^12 ≈ 2^57 抗暴力枚举（每秒 1 万次猜需 4 万年），但泄漏个人邀请等于让人随便注册。Mitigation：`uses_remaining` 默认 1；admin 后台可 `revoke`。
- **R5 Turnstile 中国大陆访问**：Cloudflare CDN 在国内偶尔慢/不稳。Mitigation：Phase 2a 用户少；Phase 4-5 真有大量国内用户时再考虑切换 hCaptcha 或加阿里云人机验证 fallback。
- **R6 SQLite 单点**：单文件 corrupt 即丢全数据。Mitigation：daily backup（保留 14 天）+ WAL mode；Phase 4-5 容量增长再考虑迁 Postgres。
- **R7 Caddy ACME 失败**：80 端口被防火墙挡 / 域名解析问题 → 证书签不下来，HTTPS 不可用。Mitigation：bootstrap 时打印检查清单；监控告警留 Phase 后期。
- **R8 Cookie 跨子域**：未来 Phase 加 `api.aicoolyun.vip` 时，cookie 需要 `Domain=.aicoolyun.vip` 而不是当前实现的"无 Domain（自动绑当前域）"。Mitigation：Phase 2a 不引子域；切换时显式改 cookie 配置 + 增加 migration（清空已有 session 强制重登）。

### 11.2 遗留（推到后续 Phase）

- **L5 忘记密码 / 邮箱验证** — Phase 4-5 真公开时
- **L6 多因素认证（TOTP / WebAuthn）** — Phase 4-5
- **L7 SOPS / age 加密 secrets** — Phase 4-5 多团队多 secret 时
- **L8 监控告警**（journalctl alert、uptime check） — Phase 后期
- **L9 子域支持 + cookie 配置修订** — 引入 `api.` `qa.` 子域时
- **L10 Caddy WAF / 限速插件** — 抓到第一波恶意流量时

---

## 12. 升级 / 演进路径（信息性）

| Phase | 在 Phase 2a 基础上叠加 | 对本 spec 的破坏性更改 |
|---|---|---|
| 2b | conversations / messages 表；provider 抽象层；SSE 流式接 aiwoo Claude/Codex | 增表；可能扩 cookie session 字段；前端加聊天页 |
| 3 | conversation_summaries / skills 表；后台总结 task | 增表 + 后台定时任务 unit |
| 4 | qa_runs / qa_artifacts 表；引 game-qa-skill-system 仓库（git submodule） | 增表 + 子模块结构 |
| 5 | skill_reviews 表；前端审核 UI；新角色 reviewer | users.role 列；新前端路由 |
| 6 | provider 配置抽象；多 provider key 管理 | secrets 升级到 SOPS/age |

---

## 13. 下一步

本 spec 通过用户评审后：

1. 调用 `superpowers:writing-plans` skill，将本 spec 转为可逐步执行的 plan
2. plan 文件路径：`docs/superpowers/plans/2026-05-27-phase-2a-account-system-plan.md`
3. plan 按 5 段验收：
   - **段 A**：仓库重构（workspaces）+ Caddy + HTTPS
   - **段 B**：SQLite + Drizzle + migration + admin CLI
   - **段 C**：auth 路由 + middleware + rate limit + Turnstile
   - **段 D**：前端 React 三页面
   - **段 E**：drill 演练 + 验收清单
4. spec + plan 一并 commit & push 到 `origin/main`
5. 实施在后续会话中按 plan 推进
