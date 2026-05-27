# Phase 1 — 基础设施骨架与自动部署管道 设计文档

**Spec 编号**：2026-05-27-phase-1-infrastructure
**目标项目**：[`server_agent`](https://github.com/JqcFrankice/agent_qa)
**作者**：Claude Opus 4.6（与 @JqcFrankice 协作 brainstorm）
**状态**：已通过设计评审，待落地为 plan

---

## 0. 全局背景（多 Phase 路线图）

最终目标是在阿里云上构建一个**多用户 AI Agent 平台**，关键能力：

1. 部署在阿里云 ECS、代码托管 GitHub、push 即自动拉取重启
2. 外网 GUI 网页访问对话
3. 独立账号系统、独立 AI 对话历史/缓存
4. 每次对话结束自动总结提炼独立 skill，长期沉淀训练
5. 特殊对话模式 **QA-AGENT**，基于 [`game-qa-skill-system`](https://github.com/JqcFrankice/game-qa-skill-system) 维护，skill 变更走审核 UI（沉淀型除外）
6. 对话使用阿里云上部署的 Claude 或 Codex（aiwoo 中转），用户可选

整套系统拆分为 6 个 Phase：

```
Phase 1  基础设施骨架 + 部署管道（domain/HTTPS/auto-deploy/health）   ← 本 spec
Phase 2  账号系统 + 对话内核 MVP（多用户聊天、Claude/Codex 切换）
Phase 3  通用 skill 沉淀流水线
Phase 4  QA-AGENT 模式 + game-qa-skill-system 仓库集成
Phase 5  Skill 审核 UI + 沉淀分类规则
Phase 6  前端打磨 + 可扩展性收尾
```

每个 Phase 走独立的 **spec → plan → 实施** 循环。

---

## 1. 范围与非范围

### 范围（Phase 1 必须交付）

- 用 Node.js 22 + TypeScript + Fastify 编写的最小 HTTP 服务，作为后续所有功能的运行时载体（占位本体）
- 一条 push-to-main → 自动部署到阿里云 ECS 的 GitHub Actions 管道
- 一次轻量的服务器侧"运行环境就绪化"：专用用户、目录、systemd unit、env 文件、deploy 脚本、SSH command 锁定
- 部署失败的自动回滚 + 健康检查 gate
- README + 部署/运维操作手册

### 非范围（明确不做，留给后续 Phase）

- 账号系统、JWT、用户会话
- 与 Claude / Codex CLI 或 aiwoo API 的实际对话集成
- 数据库（无 Postgres/SQLite）
- skill 沉淀、QA-AGENT 模式、Skill 审核 UI
- 前端聊天界面（仅一个静态首页占位）
- 域名、HTTPS、反向代理（先 IP + HTTP；后续 Phase 上 Caddy）
- 监控告警（Prometheus/Grafana 等）

---

## 2. 仓库结构（本地工作区 = 阿里云部署源 = GitHub）

```
server_agent/                       # = github.com/JqcFrankice/agent_qa
├── README.md                       # 项目说明 + 快速链接
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts                   # Fastify 启动入口
│   ├── routes/
│   │   ├── health.ts               # GET /health
│   │   ├── version.ts              # GET /version
│   │   └── index.ts                # GET /  → 静态首页
│   ├── config.ts                   # 从 process.env 读配置 + zod 校验
│   └── logger.ts                   # pino logger
├── public/
│   └── index.html                  # 极简首页占位（显示版本号）
├── scripts/
│   ├── deploy-agent.sh             # 服务器上的部署脚本（authorized_keys command 锁定它）
│   ├── bootstrap-server.sh         # 一次性初始化服务器
│   └── write-build-info.mjs        # 生成 dist/build-info.json（含 gitSha/buildTime）
├── deploy/
│   ├── server-agent.service        # systemd unit
│   └── agent.env.example           # /etc/server-agent/agent.env 模板
├── docs/
│   └── superpowers/
│       ├── specs/
│       │   └── 2026-05-27-phase-1-infrastructure-design.md   ← 本文件
│       └── plans/
│           └── 2026-05-27-phase-1-infrastructure-plan.md     ← 下一步生成
├── .github/
│   └── workflows/
│       └── deploy.yml              # push main → SSH → deploy-agent
└── .gitignore
```

### 关键约束

- 仓库内不放任何 secret；`agent.env` 存在服务器 `/etc/server-agent/`，仓库只有 `.example`
- `deploy-agent.sh` 必须幂等：任何时候手动执行结果一致
- `bootstrap-server.sh` 设计为只跑一次，但重复执行不破坏现有状态

---

## 3. 服务器侧布局

| 项 | 值 |
|---|---|
| 系统用户 | `agent`（`useradd -m -s /bin/bash agent`，无 sudo） |
| 代码目录 | `/opt/server_agent`（owner = `agent:agent`） |
| 静态首页 | `/opt/server_agent/public/` |
| 配置目录 | `/etc/server-agent/`（root:agent, 0750） |
| 环境文件 | `/etc/server-agent/agent.env`（root:agent, 0640） |
| systemd unit | `/etc/systemd/system/server-agent.service` |
| 日志 | journalctl（pino 写 stdout，systemd 收编） |
| 监听地址 | Phase 1 暴露 `0.0.0.0:8080`；后续 Phase 切到 `127.0.0.1:8787` + Caddy |
| GitHub deploy key | `agent` 的 `~/.ssh/authorized_keys` 一行：<br>`command="/usr/local/bin/deploy-agent",no-pty,no-port-forwarding,no-X11-forwarding ssh-ed25519 ...` |
| `deploy-agent` 安装位置 | `/usr/local/bin/deploy-agent`（root:root, 0755） |

### Bootstrap 顺序（一次性人工操作）

1. SSH 进 `root@43.108.21.46`
2. 跑 `bootstrap-server.sh`：建用户/目录、写 unit、装 deploy-agent、写 agent 的 authorized_keys、装 sudoers 片段
3. 手填 `/etc/server-agent/agent.env`（Phase 1 内容很少：`PORT=8080`、`HOST=0.0.0.0`、`NODE_ENV=production`、`LOG_LEVEL=info`）
4. 阿里云安全组放行 8080
5. `systemctl enable --now server-agent`
6. 验证 `curl http://43.108.21.46:8080/health`

---

## 4. 部署管道（GitHub Actions → SSH → deploy-agent）

### 触发

- `push` 到 `main` 分支 → 跑 `build` + `deploy`
- `pull_request` 到 `main` → 仅跑 `build`（typecheck + lint + test），不部署
- `workflow_dispatch` → 手动跑 `build` + `deploy`

### Workflow（`.github/workflows/deploy.yml`）

#### Job 1: `build`（ubuntu-latest）

```
checkout → setup-node@v4 (node=22, cache=npm)
       → npm ci
       → npm run lint
       → tsc --noEmit
       → npm test
       → npm run build
       → upload-artifact (dist/) [可选，phase 1 不强求]
```

失败 → 整个 workflow 终止。

#### Job 2: `deploy`（needs: build；条件：`github.ref == 'refs/heads/main'`）

```
1. 写入 SSH_DEPLOY_KEY 到 ~/.ssh/id_ed25519，chmod 600
2. ssh-keyscan 43.108.21.46 >> ~/.ssh/known_hosts
3. ssh -i ~/.ssh/id_ed25519 \
       -o StrictHostKeyChecking=yes \
       agent@43.108.21.46 \
       "$GITHUB_SHA"   # 由于 command lock，client 端命令被忽略，
                       # 但 SSH_ORIGINAL_COMMAND="$GITHUB_SHA" 仍可被脚本读取
```

### `deploy-agent` 脚本职责（顺序）

```bash
set -euo pipefail
exec 200>/opt/server_agent/.deploy.lock
flock -n 200 || { echo "another deploy in progress"; exit 75; }

# 把服务实际 env 加载进来，这样脚本读到的 PORT/HOST 与服务一致
set -a
. /etc/server-agent/agent.env
set +a

cd /opt/server_agent
RECORD_OLD_SHA=$(git rev-parse HEAD)
TARGET_SHA="${SSH_ORIGINAL_COMMAND:-origin/main}"

git fetch origin main
git reset --hard "$TARGET_SHA"
npm ci
npm run build
sudo /bin/systemctl restart server-agent

# health check loop
for i in $(seq 1 10); do
  if curl -fsS "http://127.0.0.1:${PORT:-8080}/health" >/dev/null; then
    echo "deploy ok @ $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "health check failed, rolling back to $RECORD_OLD_SHA"
git reset --hard "$RECORD_OLD_SHA"
npm ci
npm run build
sudo /bin/systemctl restart server-agent
for i in $(seq 1 10); do
  if curl -fsS "http://127.0.0.1:${PORT:-8080}/health" >/dev/null; then
    echo "rolled back to $RECORD_OLD_SHA"
    exit 1   # 故意非零，让 Actions 标红
  fi
  sleep 1
done

echo "rollback also failed; service may be broken"
exit 2
```

### 权限细节

- `/etc/sudoers.d/server-agent`：
  ```
  agent ALL=(root) NOPASSWD: /bin/systemctl restart server-agent, /bin/systemctl status server-agent
  ```
- `agent` 用户只能跑这两个命令；不能拿到 root shell

### GitHub Secrets 清单（Phase 1）

| 名称 | 用途 |
|---|---|
| `SSH_DEPLOY_KEY` | 部署用 ed25519 私钥（PEM） |

其它 secrets 留给后续 Phase。

---

## 5. 服务（Fastify app）实现轮廓

### 入口 `src/server.ts`

```ts
import Fastify from "fastify";
import { config } from "./config.js";
import { logger } from "./logger.js";
import healthRoute from "./routes/health.js";
import versionRoute from "./routes/version.js";
import indexRoute from "./routes/index.js";

const app = Fastify({ loggerInstance: logger });
await app.register(import("@fastify/static"), { root: config.publicDir });
await app.register(healthRoute);
await app.register(versionRoute);
await app.register(indexRoute);

const close = async (sig: string) => {
  logger.info({ sig }, "shutdown");
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", () => close("SIGTERM"));
process.on("SIGINT", () => close("SIGINT"));

await app.listen({ host: config.host, port: config.port });
```

### `src/config.ts`

- `zod` 校验 env，缺关键变量 fail-fast
- 导出 `{ host, port, nodeEnv, publicDir, gitSha, buildTime, logLevel }`
- `gitSha` / `buildTime` 从 `dist/build-info.json` 读

### Routes

| 路由 | 返回 |
|---|---|
| `GET /health` | `{ "status": "ok", "uptimeSec": <number> }` 200 |
| `GET /version` | `{ "gitSha": "...", "buildTime": "...", "nodeEnv": "..." }` 200 |
| `GET /` | `public/index.html`（fetch `/version` 自显示版本号） |

### 日志

- `pino` JSON 输出到 stdout
- `LOG_LEVEL` 从 env 读，默认 `info`
- systemd 收 stdout → journalctl

### 测试 / lint（Phase 1 最小）

- `vitest`：`tests/health.test.ts`（`fastify.inject` 期望 200）
- `tsc --noEmit` 在 CI
- `eslint`（@typescript-eslint 推荐配置）

### npm scripts

| Script | 命令 |
|---|---|
| `dev` | `tsx watch src/server.ts` |
| `build` | `tsc -p . && node scripts/write-build-info.mjs > dist/build-info.json` |
| `start` | `node dist/server.js` |
| `test` | `vitest run` |
| `lint` | `eslint src` |

---

## 6. 错误处理 / 失败模式

| 失败模式 | 行为 |
|---|---|
| `npm ci` 失败（网络/缺包） | `deploy-agent` 退出非零 → CI 报红；旧版本仍在运行（systemd 未重启） |
| `npm run build` 失败 | 同上 |
| `systemctl restart` 失败 | `deploy-agent` 捕获非零 → 走"git reset 上一个 SHA + rebuild + restart" |
| 重启后 health 10 秒内不返回 200 | 自动回滚分支；回滚仍失败 → 退出 1，告警靠 Actions UI 红勾 |
| 健康检查永远 200 但服务实际坏 | 不在 Phase 1 范围（深度 health check 推到后续 Phase） |
| GH Actions Secrets 丢失/Key 撤销 | SSH 步骤直接失败 → Actions 报红；运维仍可 `ssh root@... ./deploy-agent` 手动应急 |
| 部署进程被重复触发 | `flock /opt/server_agent/.deploy.lock` 单实例；并发触发的第二个立即退出 |
| systemd unit 配置出错 | bootstrap 时 `systemd-analyze verify` 校验；上线后单次 reload 不会破坏老版本 |

### `server-agent.service` 关键字段

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

[Install]
WantedBy=multi-user.target
```

---

## 7. 验收标准

1. `git push origin main` 后，GitHub Actions 完整跑完 → 服务器版本 = 该 commit
2. `curl http://43.108.21.46:8080/health` 返回 `{"status":"ok",...}` 200
3. `curl http://43.108.21.46:8080/version` 返回里 `gitSha` 等于最新 commit 短 hash
4. 浏览器打开 `http://43.108.21.46:8080/` 能看到首页且页面自显示版本号
5. 故意在 `src/server.ts` 写一个让进程启动失败的语句，push → Actions 报红，服务器 `/health` 仍是上一个 commit 的版本（验证回滚）
6. `systemctl status server-agent` 显示 `active (running)`，`Memory:` 在 200MB 以内
7. `ssh -i deploy_key agent@43.108.21.46 'whoami'`（强行覆盖命令）等价于运行 `deploy-agent`，无法获得 shell（验证 command lock）
8. 本 spec 与对应 plan 已 push 到 `origin/main`

---

## 8. 风险与遗留

### 风险

- **R1 安全组**：阿里云安全组没放行 8080 → Phase 1 唯一对外端口不可达。
  **对策**：bootstrap 脚本打印提示 + README 说明手动放行步骤。
- **R2 npm ci 不稳定**：国内拉包慢/失败。
  **对策**：暂不切镜像；失败 retry 一次；多次失败靠回滚兜底。频繁失败再上 npmmirror。
- **R3 deploy key 泄漏**：攻击者拿到 deploy 私钥仍可触发部署，并可通过 `SSH_ORIGINAL_COMMAND` 把版本拉回历史里任何已存在的 commit（含已被你后来修过的"含漏洞旧版"）。
  **对策**：
  - `command=` lock + `no-pty,no-port-forwarding,no-X11-forwarding`：攻击者最多让 `deploy-agent` 跑一遍；拿不到 shell、不能注入新代码（只能选已 push 的历史 commit）
  - 私钥仅存于 GitHub Secrets 与用户本机的 1Password
  - 后续 Phase 可加：`deploy-agent` 校验 `SSH_ORIGINAL_COMMAND` 必须是带签名 tag 或某个 protected branch 的 ancestor

### 遗留（后续 Phase 必须补）

- **L1 HTTPS / 域名** — Phase 2 开始账号/登录前必须补
- **L2 监控 / 告警** — Phase 后期
- **L3 secrets 升级**：从 EnvironmentFile → SOPS/age — 在 Phase 2-3 之间
- **L4 部署产物管理**：当代码体量变大，把方案 1 升级为 "CI 构建 tarball + scp 解压"（atomic symlink）

---

## 9. 升级 / 演进路径（信息性）

| Phase | 在本骨架上叠加的关键能力 | 对本 spec 的破坏性更改 |
|---|---|---|
| 2 | SQLite/Postgres + JWT + 登录 + 真聊天接 aiwoo Claude/Codex | 加 EnvironmentFile 字段；可能上 Caddy 反代 |
| 3 | 对话结束总结 → skill 入库 | 引入 skill 存储目录；可能加后台任务 |
| 4 | QA-AGENT 模式接 game-qa-skill-system 仓库 | 引入 git 子模块或独立 clone 路径 |
| 5 | Skill 审核 UI + 沉淀分类 | 加新前端路由、新数据库表 |
| 6 | 前端打磨 / 可扩展模型供应商 | 抽象 provider 接口 |

---

## 10. 决策记录（关键 ADR 速查）

| # | 决策 | 替代 | 理由 |
|---|---|---|---|
| ADR-01 | 后端语言 = Node.js + TypeScript + Fastify | Python/FastAPI、Go | 服务器已装 Node 22；后续 AI/SSE/同语言前端便利 |
| ADR-02 | 部署触发 = GitHub Actions SSH | webhook、systemd timer 轮询 | 实时；secret 集中在 GH；服务器侧零监听端口 |
| ADR-03 | 部署执行 = 服务器侧 `deploy-agent` 脚本 + `command=` lock | Actions 直接 ssh 跑命令、scp 产物 | 部署逻辑集中、私钥泄漏可控、本地能跑同一脚本 |
| ADR-04 | 服务用户 = 专用 `agent` + `/opt/server_agent` | root + `/root/agent_qa` | 安全隔离、Linux 标准位置 |
| ADR-05 | secrets = `/etc/server-agent/agent.env` via systemd EnvironmentFile | Vault / SOPS / CI sync | Phase 1 体量小；后续可平滑替换 |
| ADR-06 | 进程管理 = systemd | PM2 / Docker | 原生、journalctl、安全加固字段丰富 |
| ADR-07 | Phase 1 监听 = `0.0.0.0:8080`（HTTP，无 HTTPS） | 自签证书、Caddy 立刻接 | 减少 Phase 1 范围；账号系统出来前不放敏感数据 |
| ADR-08 | 失败恢复 = git reset 回上一个 commit + 重建 | atomic symlink、不回滚 | 简单可靠；Phase 1 无 DB schema 牵连 |

---

## 11. 下一步

本 spec 通过用户评审后：

1. 调用 `superpowers:writing-plans` skill，将本 spec 转为可逐步执行的 plan
2. plan 文件路径：`docs/superpowers/plans/2026-05-27-phase-1-infrastructure-plan.md`
3. spec + plan 一并 commit & push 到 `origin/main`
4. 实施工作在**后续会话**中分步进行（本次会话只产出 spec + plan）
