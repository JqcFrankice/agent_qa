# Phase 1 — 基础设施骨架与自动部署管道 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `JqcFrankice/agent_qa` 仓库里搭出一个可对外访问、push-to-main 自动部署到阿里云 ECS、健康检查失败自动回滚的最小 Fastify 服务，作为后续所有 Phase 的运行时载体。

**Architecture:** Node.js 22 + TypeScript + Fastify 编写 `/health` `/version` `/` 三个端点；GitHub Actions 监听 `push main`，先在 ubuntu-latest 上 build/test，再用 SSH 私钥通过 `agent` 用户登入阿里云 ECS，由 `authorized_keys` 的 `command=` 锁定指向 `/usr/local/bin/deploy-agent`，脚本完成 `git reset --hard` + `npm ci` + `build` + `systemctl restart` + 健康检查；失败则 git reset 回上一个 commit 重启。

**Tech Stack:** Node.js 22, TypeScript 5, Fastify 4, @fastify/static, pino, zod, vitest, eslint, GitHub Actions, systemd, ssh, flock, sudo

**Spec:** `docs/superpowers/specs/2026-05-27-phase-1-infrastructure-design.md`

---

## 总体执行约束

- **TDD 严格度**：路由/配置代码走 TDD（先红后绿）；脚本类（bash/yml）走"小步写完即手动验证"的方式（无单测但每步要给可观测验证命令）
- **提交频率**：每个 Task 末尾必有一次 commit；不要积攒多 Task 一起提交
- **边界**：本计划只产出代码与文档；首次部署所需的"服务器 bootstrap、安全组放行、把 deploy key 的公钥放进 agent 用户的 authorized_keys、把私钥放入 GitHub Secrets" 是**人工运维步骤**，由 README 在 Task 12 中固化为操作手册，**本计划不在执行期触碰生产服务器**
- **每个 Task 完成 = 本地验证通过 + commit**；远端 push 在所有 Task 完成后由 Task 13 集中处理
- **若中途破坏 build / lint / typecheck**：必须在该 Task 内修复后再进下一个 Task

---

## Task 1：工程脚手架（package.json / tsconfig / eslint / vitest / gitignore）

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `vitest.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1：写 `package.json`**

```json
{
  "name": "server-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p . && node scripts/write-build-info.mjs",
    "start": "node dist/server.js",
    "test": "vitest run",
    "lint": "eslint src tests",
    "typecheck": "tsc -p . --noEmit"
  },
  "dependencies": {
    "@fastify/static": "^7.0.4",
    "fastify": "^4.28.1",
    "pino": "^9.4.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "@typescript-eslint/eslint-plugin": "^8.8.0",
    "@typescript-eslint/parser": "^8.8.0",
    "eslint": "^9.11.1",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2：写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3：写 `eslint.config.js`**

```javascript
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" }
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }]
    }
  }
];
```

- [ ] **Step 4：写 `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false
  }
});
```

- [ ] **Step 5：覆盖 `.gitignore`**

```
node_modules/
dist/
*.local
.env
.env.*
!.env.example
.DS_Store
```

- [ ] **Step 6：装依赖并验证 lint/typecheck 可跑（即使没有源文件）**

Run:
```bash
npm install
npm run lint || true     # 没文件可能 0 输出，确认命令本身能跑
npm run typecheck
```

Expected：`npm install` 完成无报错；`npm run typecheck` 退出码 0（没有 .ts 文件时 tsc 也返回 0）。

- [ ] **Step 7：Commit**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.js vitest.config.ts .gitignore
git commit -m "chore: scaffold node/typescript/fastify project"
```

---

## Task 2：Logger 模块（pino 单例）

**Files:**
- Create: `src/logger.ts`

- [ ] **Step 1：写 `src/logger.ts`**

```typescript
import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level,
  base: { service: "server-agent" },
  timestamp: pino.stdTimeFunctions.isoTime
});
```

- [ ] **Step 2：跑 typecheck 校验**

Run: `npm run typecheck`
Expected：退出码 0，无报错

- [ ] **Step 3：Commit**

```bash
git add src/logger.ts
git commit -m "feat(logger): add pino logger singleton"
```

---

## Task 3：Config 模块（zod 校验 env + 读 build-info）

**Files:**
- Create: `src/build-info.ts`
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1：写测试 `tests/config.test.ts`（先红）**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("config", () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it("loads valid env with defaults", async () => {
    process.env.PORT = "8080";
    process.env.HOST = "0.0.0.0";
    process.env.NODE_ENV = "production";
    delete process.env.LOG_LEVEL;
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig();
    expect(cfg.port).toBe(8080);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.nodeEnv).toBe("production");
    expect(cfg.logLevel).toBe("info");
  });

  it("throws on invalid PORT", async () => {
    process.env.PORT = "not-a-number";
    process.env.HOST = "0.0.0.0";
    process.env.NODE_ENV = "production";
    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow();
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `npx vitest run tests/config.test.ts`
Expected：FAIL，原因是 `Cannot find module '../src/config.js'`

- [ ] **Step 3：写 `src/build-info.ts`**

```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

interface BuildInfo {
  gitSha: string;
  buildTime: string;
}

const FALLBACK: BuildInfo = { gitSha: "unknown", buildTime: "unknown" };

export function loadBuildInfo(): BuildInfo {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, "build-info.json");
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as BuildInfo;
  } catch {
    return FALLBACK;
  }
}
```

- [ ] **Step 4：写 `src/config.ts`**

```typescript
import { z } from "zod";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBuildInfo } from "./build-info.js";

const schema = z.object({
  PORT: z.coerce.number().int().positive(),
  HOST: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info")
});

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  publicDir: string;
  gitSha: string;
  buildTime: string;
}

export function loadConfig(): AppConfig {
  const parsed = schema.parse(process.env);
  const here = dirname(fileURLToPath(import.meta.url));
  const publicDir = resolve(here, "..", "public");
  const buildInfo = loadBuildInfo();
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    publicDir,
    gitSha: buildInfo.gitSha,
    buildTime: buildInfo.buildTime
  };
}
```

- [ ] **Step 5：跑测试，确认通过**

Run: `npx vitest run tests/config.test.ts`
Expected：2 个用例都 PASS

- [ ] **Step 6：lint + typecheck**

Run:
```bash
npm run lint
npm run typecheck
```
Expected：两条都退出码 0

- [ ] **Step 7：Commit**

```bash
git add src/build-info.ts src/config.ts tests/config.test.ts
git commit -m "feat(config): zod-validated env + build-info loader"
```

---

## Task 4：`/health` 路由

**Files:**
- Create: `src/routes/health.ts`
- Create: `tests/routes/health.test.ts`

- [ ] **Step 1：写测试（先红）**

```typescript
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import healthRoute from "../../src/routes/health.js";

describe("GET /health", () => {
  it("returns ok with uptimeSec", async () => {
    const app = Fastify();
    await app.register(healthRoute);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptimeSec).toBe("number");
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
    await app.close();
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `npx vitest run tests/routes/health.test.ts`
Expected：FAIL，找不到 `../../src/routes/health.js`

- [ ] **Step 3：实现 `src/routes/health.ts`**

```typescript
import type { FastifyPluginAsync } from "fastify";

const healthRoute: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    uptimeSec: Math.round(process.uptime())
  }));
};

export default healthRoute;
```

- [ ] **Step 4：跑测试，确认通过**

Run: `npx vitest run tests/routes/health.test.ts`
Expected：PASS

- [ ] **Step 5：Commit**

```bash
git add src/routes/health.ts tests/routes/health.test.ts
git commit -m "feat(routes): add GET /health"
```

---

## Task 5：`/version` 路由 + build-info 写入脚本

**Files:**
- Create: `src/routes/version.ts`
- Create: `tests/routes/version.test.ts`
- Create: `scripts/write-build-info.mjs`

- [ ] **Step 1：写测试（先红）**

```typescript
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import versionRoute from "../../src/routes/version.js";

describe("GET /version", () => {
  it("returns gitSha, buildTime, nodeEnv", async () => {
    const app = Fastify();
    await app.register(versionRoute, {
      gitSha: "abc1234",
      buildTime: "2026-05-27T00:00:00Z",
      nodeEnv: "production"
    });
    const res = await app.inject({ method: "GET", url: "/version" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      gitSha: "abc1234",
      buildTime: "2026-05-27T00:00:00Z",
      nodeEnv: "production"
    });
    await app.close();
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `npx vitest run tests/routes/version.test.ts`
Expected：FAIL，找不到模块

- [ ] **Step 3：实现 `src/routes/version.ts`**

```typescript
import type { FastifyPluginAsync } from "fastify";

interface VersionOpts {
  gitSha: string;
  buildTime: string;
  nodeEnv: string;
}

const versionRoute: FastifyPluginAsync<VersionOpts> = async (app, opts) => {
  app.get("/version", async () => ({
    gitSha: opts.gitSha,
    buildTime: opts.buildTime,
    nodeEnv: opts.nodeEnv
  }));
};

export default versionRoute;
```

- [ ] **Step 4：跑测试，确认通过**

Run: `npx vitest run tests/routes/version.test.ts`
Expected：PASS

- [ ] **Step 5：写 `scripts/write-build-info.mjs`**

```javascript
#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const target = resolve(process.cwd(), "dist", "build-info.json");
const payload = {
  gitSha: gitSha(),
  buildTime: new Date().toISOString()
};

mkdirSync(resolve(process.cwd(), "dist"), { recursive: true });
writeFileSync(target, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`wrote ${target}: ${JSON.stringify(payload)}`);
```

- [ ] **Step 6：本机干跑构建，确认产物**

Run:
```bash
npm run build
cat dist/build-info.json
```
Expected：`dist/build-info.json` 存在且包含 `gitSha`（短 hash）+ `buildTime`（ISO 字符串）

- [ ] **Step 7：Commit**

```bash
git add src/routes/version.ts tests/routes/version.test.ts scripts/write-build-info.mjs
git commit -m "feat(routes): add GET /version + build-info writer"
```

---

## Task 6：静态首页 + `/` 路由

**Files:**
- Create: `public/index.html`
- Create: `src/routes/index.ts`

> 这一个 Task 不写自动化测试 — `@fastify/static` 自身覆盖度足够，且要测 sendFile 还得绕 fs 路径，性价比低。改用"启动后 curl 验证"。

- [ ] **Step 1：写 `public/index.html`**

```html
<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <title>server-agent</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; max-width: 640px; margin: 4rem auto; padding: 0 1rem; color: #222; }
    code { background: #f4f4f4; padding: 0 0.3em; border-radius: 3px; }
    .row { margin: 0.5rem 0; }
  </style>
</head>
<body>
  <h1>server-agent online</h1>
  <p>Phase 1 infrastructure skeleton</p>
  <div class="row">commit: <code id="sha">…</code></div>
  <div class="row">built: <code id="built">…</code></div>
  <div class="row">env: <code id="env">…</code></div>
  <script>
    fetch("/version").then(r => r.json()).then(v => {
      document.getElementById("sha").textContent = v.gitSha;
      document.getElementById("built").textContent = v.buildTime;
      document.getElementById("env").textContent = v.nodeEnv;
    }).catch(e => {
      document.getElementById("sha").textContent = "fetch failed: " + e.message;
    });
  </script>
</body>
</html>
```

- [ ] **Step 2：写 `src/routes/index.ts`**

```typescript
import type { FastifyPluginAsync } from "fastify";

const indexRoute: FastifyPluginAsync = async (app) => {
  app.get("/", async (_req, reply) => {
    return reply.sendFile("index.html");
  });
};

export default indexRoute;
```

> `reply.sendFile` 由 `@fastify/static` plugin 注册到 reply 上；它会用注册时传入的 `root` 来定位文件，所以这里不必再传一次。

- [ ] **Step 3：lint + typecheck**

Run:
```bash
npm run lint
npm run typecheck
```
Expected：退出码 0

- [ ] **Step 4：Commit**

```bash
git add public/index.html src/routes/index.ts
git commit -m "feat(routes): add static index page with version display"
```

---

## Task 7：装配 server.ts 入口

**Files:**
- Create: `src/server.ts`
- Create: `tests/server.smoke.test.ts`

- [ ] **Step 1：写一个最小 smoke test（先红）**

```typescript
import { describe, it, expect, beforeAll } from "vitest";

let buildApp: typeof import("../src/server.js").buildApp;

beforeAll(async () => {
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.NODE_ENV = "test";
  ({ buildApp } = await import("../src/server.js"));
});

describe("buildApp", () => {
  it("registers /health and returns ok", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    await app.close();
  });

  it("registers /version and returns build info shape", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/version" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.gitSha).toBe("string");
    expect(typeof body.buildTime).toBe("string");
    expect(body.nodeEnv).toBe("test");
    await app.close();
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `npx vitest run tests/server.smoke.test.ts`
Expected：FAIL，找不到 `../src/server.js`

- [ ] **Step 3：实现 `src/server.ts`**

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import healthRoute from "./routes/health.js";
import versionRoute from "./routes/version.js";
import indexRoute from "./routes/index.js";

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({ loggerInstance: logger });

  await app.register(fastifyStatic, {
    root: config.publicDir,
    serve: false  // 我们手动用 sendFile，不让它自动 mount /
  });
  await app.register(healthRoute);
  await app.register(versionRoute, {
    gitSha: config.gitSha,
    buildTime: config.buildTime,
    nodeEnv: config.nodeEnv
  });
  await app.register(indexRoute);

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp();

  const close = async (sig: string): Promise<void> => {
    logger.info({ sig }, "shutdown");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void close("SIGTERM"));
  process.on("SIGINT", () => void close("SIGINT"));

  await app.listen({ host: config.host, port: config.port });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, "fatal");
    process.exit(1);
  });
}
```

- [ ] **Step 4：跑全套测试**

Run: `npm test`
Expected：所有 vitest 用例都 PASS（config + health + version + smoke）

- [ ] **Step 5：本机端到端启动**

Run:
```bash
npm run build
PORT=8080 HOST=127.0.0.1 NODE_ENV=development npm start &
SERVER_PID=$!
sleep 1
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/version
curl -fsS http://127.0.0.1:8080/ | head -5
kill $SERVER_PID
```
Expected：health 输出 `{"status":"ok",...}`；version 含 gitSha；首页 HTML 第一行是 `<!doctype html>`

- [ ] **Step 6：Commit**

```bash
git add src/server.ts tests/server.smoke.test.ts
git commit -m "feat(server): wire up app entrypoint with all routes"
```

---

## Task 8：systemd unit + env 模板

**Files:**
- Create: `deploy/server-agent.service`
- Create: `deploy/agent.env.example`

- [ ] **Step 1：写 `deploy/server-agent.service`**

```ini
[Unit]
Description=server-agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=agent
Group=agent
WorkingDirectory=/opt/server_agent
EnvironmentFile=/etc/server-agent/agent.env
ExecStart=/usr/bin/node /opt/server_agent/dist/server.js
Restart=on-failure
RestartSec=3

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/server_agent
MemoryMax=512M

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2：写 `deploy/agent.env.example`**

```
# Phase 1 minimal env. Copy to /etc/server-agent/agent.env on the server.
PORT=8080
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info
```

- [ ] **Step 3：本机用 `systemd-analyze verify` 校验 unit（如果可用）**

> macOS 没有 systemd，这一步会报"command not found"。允许跳过；服务器侧 bootstrap 时再校验。

Run:
```bash
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify deploy/server-agent.service
else
  echo "systemd-analyze not present (likely macOS) — skipping; will validate on server"
fi
```
Expected：要么 `systemd-analyze` 输出 0 错误，要么打印跳过信息

- [ ] **Step 4：Commit**

```bash
git add deploy/server-agent.service deploy/agent.env.example
git commit -m "chore(deploy): add systemd unit and env example"
```

---

## Task 9：服务器侧 `deploy-agent.sh`

**Files:**
- Create: `scripts/deploy-agent.sh`

- [ ] **Step 1：写 `scripts/deploy-agent.sh`**

```bash
#!/usr/bin/env bash
# deploy-agent — server-side deploy/rollback script.
# Triggered by GH Actions via SSH; pinned by authorized_keys command=.
# Reads target commit from $SSH_ORIGINAL_COMMAND (defaults to origin/main).

set -euo pipefail

REPO_DIR="/opt/server_agent"
ENV_FILE="/etc/server-agent/agent.env"
LOCK_FILE="${REPO_DIR}/.deploy.lock"
HEALTH_RETRIES=10
HEALTH_DELAY_SEC=1

log() { echo "[deploy-agent] $*"; }

# Single-instance lock — bail out fast on concurrent deploy
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  log "another deploy in progress, exiting"
  exit 75
fi

# Load service env so PORT matches what the running service uses
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi
PORT="${PORT:-8080}"

cd "${REPO_DIR}"

RECORD_OLD_SHA="$(git rev-parse HEAD)"
TARGET_REF="${SSH_ORIGINAL_COMMAND:-origin/main}"
log "old=${RECORD_OLD_SHA} target=${TARGET_REF}"

deploy_commit() {
  local ref="$1"
  log "fetching"
  git fetch --quiet origin main
  log "checking out ${ref}"
  git reset --hard "${ref}"
  log "npm ci"
  npm ci --no-audit --no-fund
  log "npm run build"
  npm run build
  log "systemctl restart server-agent"
  sudo /bin/systemctl restart server-agent
}

health_ok() {
  local i
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
      return 0
    fi
    sleep "${HEALTH_DELAY_SEC}"
  done
  return 1
}

# === Forward roll ===
deploy_commit "${TARGET_REF}"
if health_ok; then
  log "deploy ok @ $(git rev-parse --short HEAD)"
  exit 0
fi
log "health check failed after deploying ${TARGET_REF}"

# === Rollback ===
log "rolling back to ${RECORD_OLD_SHA}"
deploy_commit "${RECORD_OLD_SHA}"
if health_ok; then
  log "rolled back to ${RECORD_OLD_SHA}; failing CI to alert"
  exit 1
fi

log "rollback also failed; service may be broken"
exit 2
```

- [ ] **Step 2：chmod +x 并用 `bash -n` + `shellcheck`（若装了）静态校验**

Run:
```bash
chmod +x scripts/deploy-agent.sh
bash -n scripts/deploy-agent.sh && echo "syntax OK"
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck scripts/deploy-agent.sh
else
  echo "shellcheck not installed — skipping (recommended to install via brew)"
fi
```
Expected：`syntax OK` 打印；shellcheck 若可用应无 error 级问题（warning 可接受）

- [ ] **Step 3：Commit**

```bash
git add scripts/deploy-agent.sh
git commit -m "feat(deploy): add server-side deploy-agent script with rollback"
```

---

## Task 10：服务器 bootstrap 脚本

**Files:**
- Create: `scripts/bootstrap-server.sh`

- [ ] **Step 1：写 `scripts/bootstrap-server.sh`**

```bash
#!/usr/bin/env bash
# bootstrap-server — one-shot server initializer.
# Run as root on the Aliyun ECS the FIRST time. Idempotent on re-runs.
#
# What it does:
#   1. creates `agent` user + ~/.ssh dir
#   2. clones the repo into /opt/server_agent (or fetches if already there)
#   3. installs deploy-agent, systemd unit, sudoers fragment, env example
#   4. initial npm ci + build so the service can start cold
#   5. enables systemd unit
#
# What it does NOT do (manual steps, see README):
#   - opening Aliyun security group port
#   - placing the deploy public key into /home/agent/.ssh/authorized_keys
#   - filling /etc/server-agent/agent.env with real values

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/JqcFrankice/agent_qa.git}"
REPO_DIR="/opt/server_agent"
AGENT_USER="agent"
ENV_DIR="/etc/server-agent"
ENV_FILE="${ENV_DIR}/agent.env"
DEPLOY_BIN="/usr/local/bin/deploy-agent"
UNIT_FILE="/etc/systemd/system/server-agent.service"
SUDOERS_FILE="/etc/sudoers.d/server-agent"

log() { echo "[bootstrap] $*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "must run as root" >&2
  exit 1
fi

# 1. agent user
if ! id -u "${AGENT_USER}" >/dev/null 2>&1; then
  log "creating user ${AGENT_USER}"
  useradd -m -s /bin/bash "${AGENT_USER}"
fi
install -d -o "${AGENT_USER}" -g "${AGENT_USER}" -m 0700 "/home/${AGENT_USER}/.ssh"
touch "/home/${AGENT_USER}/.ssh/authorized_keys"
chown "${AGENT_USER}:${AGENT_USER}" "/home/${AGENT_USER}/.ssh/authorized_keys"
chmod 0600 "/home/${AGENT_USER}/.ssh/authorized_keys"

# 2. clone or fetch repo
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  log "cloning ${REPO_URL} into ${REPO_DIR}"
  install -d -o "${AGENT_USER}" -g "${AGENT_USER}" -m 0755 "${REPO_DIR}"
  sudo -u "${AGENT_USER}" git clone "${REPO_URL}" "${REPO_DIR}"
else
  log "repo already present at ${REPO_DIR}; fetching latest main"
  sudo -u "${AGENT_USER}" git -C "${REPO_DIR}" fetch origin main
  sudo -u "${AGENT_USER}" git -C "${REPO_DIR}" reset --hard origin/main
fi

# 3a. deploy-agent
log "installing ${DEPLOY_BIN}"
install -o root -g root -m 0755 "${REPO_DIR}/scripts/deploy-agent.sh" "${DEPLOY_BIN}"

# 3b. systemd unit
log "installing ${UNIT_FILE}"
install -o root -g root -m 0644 "${REPO_DIR}/deploy/server-agent.service" "${UNIT_FILE}"
systemctl daemon-reload
systemd-analyze verify "${UNIT_FILE}"

# 3c. sudoers fragment
log "installing ${SUDOERS_FILE}"
cat >"${SUDOERS_FILE}" <<'SUDO'
agent ALL=(root) NOPASSWD: /bin/systemctl restart server-agent, /bin/systemctl status server-agent
SUDO
chmod 0440 "${SUDOERS_FILE}"
visudo -cf "${SUDOERS_FILE}"

# 3d. env dir + example
log "preparing ${ENV_DIR}"
install -d -o root -g "${AGENT_USER}" -m 0750 "${ENV_DIR}"
if [[ ! -f "${ENV_FILE}" ]]; then
  install -o root -g "${AGENT_USER}" -m 0640 "${REPO_DIR}/deploy/agent.env.example" "${ENV_FILE}"
  log "wrote default ${ENV_FILE} — REVIEW AND EDIT IF NEEDED"
else
  log "${ENV_FILE} already exists, leaving alone"
fi

# 4. initial build as agent
log "running initial npm ci + build as ${AGENT_USER}"
sudo -u "${AGENT_USER}" bash -c "cd '${REPO_DIR}' && npm ci --no-audit --no-fund && npm run build"

# 5. enable + start
log "enabling and starting server-agent.service"
systemctl enable --now server-agent.service
sleep 2
systemctl --no-pager status server-agent.service || true

cat <<'POST'

============================================================
bootstrap complete. MANUAL FOLLOW-UP STILL REQUIRED:

  1. Aliyun console → ECS → security group → allow inbound TCP 8080
  2. Append your GitHub Actions deploy public key to:
        /home/agent/.ssh/authorized_keys
     prefixed with:
        command="/usr/local/bin/deploy-agent",no-pty,no-port-forwarding,no-X11-forwarding
  3. Verify from outside:
        curl http://<server-public-ip>:8080/health
============================================================
POST
```

- [ ] **Step 2：chmod +x 并语法校验**

Run:
```bash
chmod +x scripts/bootstrap-server.sh
bash -n scripts/bootstrap-server.sh && echo "syntax OK"
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck scripts/bootstrap-server.sh
fi
```
Expected：`syntax OK`

- [ ] **Step 3：Commit**

```bash
git add scripts/bootstrap-server.sh
git commit -m "feat(deploy): add idempotent server bootstrap script"
```

---

## Task 11：GitHub Actions workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1：写 `.github/workflows/deploy.yml`**

```yaml
name: deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    name: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build

  deploy:
    name: deploy
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
    steps:
      - name: install ssh key
        env:
          SSH_DEPLOY_KEY: ${{ secrets.SSH_DEPLOY_KEY }}
        run: |
          mkdir -p ~/.ssh
          chmod 700 ~/.ssh
          printf '%s\n' "$SSH_DEPLOY_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan -t ed25519 43.108.21.46 >> ~/.ssh/known_hosts
      - name: trigger deploy-agent
        run: |
          ssh -i ~/.ssh/id_ed25519 \
              -o StrictHostKeyChecking=yes \
              -o BatchMode=yes \
              agent@43.108.21.46 \
              "${{ github.sha }}"
```

- [ ] **Step 2：用 `actionlint`（如果装了）静态校验**

Run:
```bash
if command -v actionlint >/dev/null 2>&1; then
  actionlint .github/workflows/deploy.yml
else
  echo "actionlint not installed (brew install actionlint to enable) — skipping"
fi
```
Expected：actionlint 输出 0 行问题，或打印跳过信息

- [ ] **Step 3：Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: GitHub Actions push-to-main → SSH deploy-agent"
```

---

## Task 12：README + 运维手册

**Files:**
- Modify: `README.md`（覆盖现有 30 字节占位内容）

- [ ] **Step 1：覆盖 `README.md`**

```markdown
# server_agent

阿里云 ECS 上托管的 AI Agent 平台。本仓库是该项目所有 Phase 的代码与文档总入口。

- 仓库：[`JqcFrankice/agent_qa`](https://github.com/JqcFrankice/agent_qa)
- 服务器：阿里云 ECS（Ubuntu 24.04），公网入口 `http://<public-ip>:8080`
- Spec / Plan：`docs/superpowers/specs/`、`docs/superpowers/plans/`

## Phase 1 - 基础设施骨架

当前 Phase 只交付：

- 一个 Node.js 22 + Fastify 写的最小服务，提供 `GET /`、`GET /health`、`GET /version`
- push-to-main → GitHub Actions → SSH 触发服务器上的 `deploy-agent` 脚本拉代码、构建、重启
- 健康检查失败自动回滚到上一个 commit

设计与决策详见
[`docs/superpowers/specs/2026-05-27-phase-1-infrastructure-design.md`](docs/superpowers/specs/2026-05-27-phase-1-infrastructure-design.md)。

## 本地开发

```bash
npm install
npm run dev          # tsx watch，含热重载
# 另一窗口
curl http://127.0.0.1:8080/health
```

可设置 `PORT`、`HOST`、`NODE_ENV`、`LOG_LEVEL`，否则会按 `tsconfig` + `vitest.config.ts` 默认值。

## 测试 / 校验

```bash
npm run lint
npm run typecheck
npm test
```

## 一次性服务器初始化（仅首次）

> 这一步不在 GitHub Actions 流水线内；上线一台新服务器时人工执行一次。

1. 用 root 登入服务器：
   ```bash
   ssh root@<server-ip>
   ```
2. 拉取 bootstrap 脚本（首次会顺便 clone 整个仓库）：
   ```bash
   curl -fsSL https://raw.githubusercontent.com/JqcFrankice/agent_qa/main/scripts/bootstrap-server.sh -o /tmp/bootstrap-server.sh
   bash /tmp/bootstrap-server.sh
   ```
   或：本地 `scp scripts/bootstrap-server.sh root@<server-ip>:/tmp/` 后再 `bash /tmp/bootstrap-server.sh`
3. 阿里云控制台 → ECS → 安全组 → 入方向 → 放行 TCP 8080
4. 在 GitHub Actions 上生成一对 ed25519 deploy key（不要复用本机密钥）：
   ```bash
   ssh-keygen -t ed25519 -f /tmp/agent_qa_deploy -N ""
   ```
   - 把 **私钥** `/tmp/agent_qa_deploy` 内容贴到 GitHub Secrets，名 `SSH_DEPLOY_KEY`
   - 把 **公钥** `/tmp/agent_qa_deploy.pub` 一行贴进服务器 `/home/agent/.ssh/authorized_keys`，前面加：
     ```
     command="/usr/local/bin/deploy-agent",no-pty,no-port-forwarding,no-X11-forwarding
     ```
     **注意**：以上前缀和公钥之间是一个空格，**整行不要换行**。
   - 删除 `/tmp/agent_qa_deploy*` 两个文件
5. 验证：`curl http://<server-public-ip>:8080/health` 应返回 `{"status":"ok",...}`

## 日常运维

| 操作 | 命令 |
|---|---|
| 看服务状态 | `systemctl status server-agent` |
| 看日志 | `journalctl -u server-agent -f` |
| 手动触发部署 | `sudo -u agent /usr/local/bin/deploy-agent`（在服务器上） |
| 紧急回滚到上个 commit | 在仓库手动 `git revert` 后 push main，触发 Actions |
| 修改环境变量 | 编辑 `/etc/server-agent/agent.env` → `systemctl restart server-agent` |
| 关掉自动部署 | 在 GitHub 仓库 → Settings → Actions → Disable |

## 验收清单

详见 spec §7。要点：

1. push main → Actions 全绿 → `/version.gitSha` 等于该 commit 短 hash
2. 故意写 throw 让进程启动失败 → Actions 报红 → 服务器 `/health` 仍是上一个版本
3. `ssh -i deploy_key agent@<server> 'whoami'` 实际跑的是 `deploy-agent`，无法获得 shell

## 后续 Phase

| Phase | 内容 |
|---|---|
| 2 | 账号系统 + 对话内核 MVP（Claude/Codex 切换） |
| 3 | 通用 skill 沉淀流水线 |
| 4 | QA-AGENT 模式 + game-qa-skill-system 集成 |
| 5 | Skill 审核 UI |
| 6 | 前端打磨 / provider 抽象 |

每个 Phase 都会先在 `docs/superpowers/specs/` 落地 spec、再 `docs/superpowers/plans/` 落地 plan，最后才动代码。
```

- [ ] **Step 2：肉眼检查 README 渲染（可选）**

Run:
```bash
if command -v glow >/dev/null 2>&1; then
  glow README.md | head -40
else
  head -40 README.md
fi
```
Expected：能读、链接正确、命令块格式齐整

- [ ] **Step 3：Commit**

```bash
git add README.md
git commit -m "docs: README with Phase 1 overview + ops runbook"
```

---

## Task 13：自检 + 推到 origin/main

**Files:** —

- [ ] **Step 1：把所有 npm 校验跑齐**

Run:
```bash
npm run lint
npm run typecheck
npm test
npm run build
```
Expected：四条全部退出码 0

- [ ] **Step 2：本机端到端启 build 产物**

Run:
```bash
PORT=8080 HOST=127.0.0.1 NODE_ENV=production npm start &
SERVER_PID=$!
sleep 1
curl -fsS http://127.0.0.1:8080/health  | grep -q '"status":"ok"'
curl -fsS http://127.0.0.1:8080/version | grep -q gitSha
curl -fsS http://127.0.0.1:8080/        | grep -q '<!doctype html>'
kill $SERVER_PID
```
Expected：三条 grep 都成功

- [ ] **Step 3：检查 git 状态干净**

Run: `git status`
Expected：`无文件要提交，干净的工作区`

- [ ] **Step 4：Push**

Run: `git push origin main`
Expected：远端更新；GitHub Actions 自动跑（首次因服务器尚未 bootstrap，`deploy` 任务会失败，但 `build` 会通过 — 这是预期）

- [ ] **Step 5：通知用户进入"服务器 bootstrap"环节**

> 在 PR 描述/会话里告诉用户：代码已就绪。下一步是按 README 的"一次性服务器初始化"清单执行人工步骤；完成后，下一次 push main 才会真正部署成功。

---

## 实施完成后的 Phase 1 验收（与 spec §7 对齐）

| # | 验收项 | 怎么验 |
|---|---|---|
| 1 | push main → Actions 全跑完 | GitHub Actions UI 看 ✅ |
| 2 | `/health` 200 | `curl http://<ip>:8080/health` |
| 3 | `/version.gitSha` 等于最新 commit 短 hash | `curl http://<ip>:8080/version` 与 `git rev-parse --short HEAD` 比对 |
| 4 | 浏览器首页显示版本号 | 浏览器打开 `http://<ip>:8080/` |
| 5 | 故意失败 → 自动回滚 | 在某 commit 写 `throw new Error("boom")` 在 server.ts 顶层，push，看 Actions 报红，再 curl `/version.gitSha` 仍是上一个 commit |
| 6 | systemd 内存 < 200MB | `systemctl status server-agent` 看 `Memory:` |
| 7 | command lock 生效 | `ssh -i deploy_key agent@<ip> whoami` 实际触发 deploy-agent，输出 `[deploy-agent] ...`，不会得到 shell |
| 8 | spec + plan 已 push | GitHub 上能看到这两个 .md |

---

## 后续 Phase 起步钩子（信息性）

Phase 2 起，新会话只需读：
- `docs/superpowers/specs/2026-05-27-phase-1-infrastructure-design.md`（理解骨架）
- `README.md`（运维手册）
- 然后直接调用 `superpowers:brainstorming` 启动 Phase 2 设计

无须重读 Phase 1 plan（plan 是一次性的实施清单，spec 才是长期设计参考）。
