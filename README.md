# server_agent

阿里云 ECS 上托管的 AI Agent 平台。本仓库是该项目所有 Phase 的代码与文档总入口。

- 仓库：[`JqcFrankice/agent_qa`](https://github.com/JqcFrankice/agent_qa)
- 公网入口：`https://aicoolyun.vip`
- Spec / Plan：`docs/superpowers/specs/`、`docs/superpowers/plans/`

## Phase 2a - HTTPS + 账号系统 + 持久化基线

当前交付：

- npm workspaces：`packages/server`、`packages/shared`、`packages/web`
- Fastify API：`/api/health`、`/api/version`、`/api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/me`
- SQLite + Drizzle schema + forward-only migration pipeline
- 邀请码注册门槛 + IP 限流，argon2id 密码哈希，HttpOnly cookie session
- React + Vite + Tailwind 登录 / 注册 / 登录后占位页
- Caddy v2 HTTPS 终结，HTTP → HTTPS，HSTS
- push-to-main → GitHub Actions → SSH 触发服务器上的 `deploy-agent` 脚本拉代码、迁移、构建、重启

设计与决策详见：

- [`docs/superpowers/specs/2026-05-27-phase-2a-account-system-design.md`](docs/superpowers/specs/2026-05-27-phase-2a-account-system-design.md)
- [`docs/superpowers/plans/2026-05-27-phase-2a-account-system-plan.md`](docs/superpowers/plans/2026-05-27-phase-2a-account-system-plan.md)

## 本地开发

```bash
npm install
npm run dev
# 另一窗口
curl http://127.0.0.1:8080/api/health
```

本地最小环境变量：

```env
PORT=8080
HOST=127.0.0.1
NODE_ENV=development
LOG_LEVEL=info
DB_PATH=/tmp/server-agent-dev.sqlite
SESSION_COOKIE_SECRET=dev-secret
```

## 测试 / 校验

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Admin CLI

```bash
npm run admin -- invite create --uses 5 --expires 7d --note "for test users"
npm run admin -- invite list
npm run admin -- invite revoke <code>
npm run admin -- user list
npm run admin -- user revoke-sessions <username>
npm run admin -- user reset-password <username>
npm run admin -- user delete <username>
```

## 一次性服务器初始化（仅首次）

> 这一步不在 GitHub Actions 流水线内；上线一台新服务器时人工执行一次。

1. 用 root 登入服务器：
   ```bash
   ssh root@<server-ip>
   ```
2. 拉取 bootstrap 脚本：
   ```bash
   curl -fsSL https://raw.githubusercontent.com/JqcFrankice/agent_qa/main/scripts/bootstrap-server.sh -o /tmp/bootstrap-server.sh
   bash /tmp/bootstrap-server.sh
   ```
3. 阿里云控制台 → ECS → 安全组：放行 TCP 80 / 443，撤掉公网 8080。
4. 编辑 `/etc/server-agent/agent.env`，确认 `SESSION_COOKIE_SECRET` 为真实随机值（bootstrap 已自动生成）。
5. 在 GitHub Actions 上生成一对 ed25519 deploy key（不要复用本机密钥）：
   ```bash
   ssh-keygen -t ed25519 -f /tmp/agent_qa_deploy -N ""
   ```
   - 把私钥 `/tmp/agent_qa_deploy` 内容贴到 GitHub Secrets，名 `SSH_DEPLOY_KEY`
   - 把公钥 `/tmp/agent_qa_deploy.pub` 一行贴进服务器 `/home/agent/.ssh/authorized_keys`，前面加：
     ```
     command="/usr/local/bin/deploy-agent",no-pty,no-port-forwarding,no-X11-forwarding
     ```
6. 验证：
   ```bash
   curl -I http://aicoolyun.vip
   curl https://aicoolyun.vip/api/health
   ```

## 日常运维

| 操作 | 命令 |
|---|---|
| 看服务状态 | `systemctl status server-agent` |
| 看服务日志 | `journalctl -u server-agent -f` |
| 看 Caddy 日志 | `journalctl -u caddy -f` |
| 手动触发部署 | `sudo -u agent /usr/local/bin/deploy-agent`（在服务器上） |
| 手动 DB 备份 | `sudo -u agent sqlite3 /var/lib/server-agent/db/main.sqlite ".backup '/var/lib/server-agent/db/backups/manual.sqlite'"` |
| 修改环境变量 | 编辑 `/etc/server-agent/agent.env` → `systemctl restart server-agent` |
| 关掉自动部署 | 在 GitHub 仓库 → Settings → Actions → Disable |

## 后续 Phase

| Phase | 内容 |
|---|---|
| 2b | 对话内核 MVP（Claude/Codex provider 抽象 + SSE 流式 + 历史） |
| 3 | 通用 skill 沉淀流水线 |
| 4 | QA-AGENT 模式 + game-qa-skill-system 集成 |
| 5 | Skill 审核 UI |
| 6 | 前端打磨 / provider 抽象 |

每个 Phase 都会先在 `docs/superpowers/specs/` 落地 spec、再 `docs/superpowers/plans/` 落地 plan，最后才动代码。
