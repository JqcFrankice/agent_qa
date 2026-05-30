# server_agent

阿里云 ECS 上托管的 AI Agent 平台。

- 仓库：[`JqcFrankice/agent_qa`](https://github.com/JqcFrankice/agent_qa)
- 公网入口：[`https://aicoolyun.vip`](https://aicoolyun.vip)
- Agent 协作 / 运维手册：[`AGENTS.md`](./AGENTS.md)
- Spec / Plan：`docs/superpowers/specs/`、`docs/superpowers/plans/`

## 当前状态：Phase 2b（聊天核心 MVP）已上线

已交付：

- npm workspaces：`packages/{server,shared,web}`
- Fastify API：
  - `/api/health`、`/api/version`
  - `/api/auth/{register,login,logout,me}`（邀请码 + argon2id + cookie session + IP 限流）
  - `/api/conversations`（CRUD）+ `/api/conversations/:id/messages`（GET 历史 + POST SSE 流式）
- Provider 抽象：中性 `ChatRequest/ChatStreamEvent` 接口；`AiwooClaudeAdapter`、`AiwooCodexAdapter` 已对真实 aiwoo wire 格式实测可用
- React + Vite + Tailwind 多会话聊天 UI（侧栏 + Markdown + 代码高亮 + 中断/重试）
- SQLite + Drizzle 数据持久化（forward-only migration）
- Caddy v2 HTTPS（HSTS、CSP、HTTP→HTTPS）
- push-to-main → GitHub Actions → SSH 触发服务器 `deploy-agent` 自动部署 + 健康检查 + 失败回滚

设计与决策详见：

- [`docs/superpowers/specs/2026-05-28-phase-2b-chat-core-design.md`](docs/superpowers/specs/2026-05-28-phase-2b-chat-core-design.md)
- [`docs/superpowers/plans/2026-05-28-phase-2b-chat-core-plan.md`](docs/superpowers/plans/2026-05-28-phase-2b-chat-core-plan.md)
- 历史 Phase（1、2a）的 spec/plan 同目录。

## 本地开发

```bash
npm install
npm run dev            # 起 server :8080 + web 自动代理 /api
curl http://127.0.0.1:8080/api/health
```

最小本地 env（**不要 commit**）：

```env
PORT=8080
HOST=127.0.0.1
NODE_ENV=development
LOG_LEVEL=info
DB_PATH=/tmp/server-agent-dev.sqlite
SESSION_COOKIE_SECRET=dev-secret
ANTHROPIC_AUTH_TOKEN=...    # aiwoo claude key（无则发消息会失败）
OPENAI_API_KEY=...          # aiwoo codex key
AIWOO_BASE_URL=https://aiwoo.vip
DEFAULT_PROVIDER=aiwoo-claude
DEFAULT_MODEL=claude-opus-4-8
UPSTREAM_FIRST_BYTE_TIMEOUT_MS=30000
```

## 验证四件套

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Admin CLI

> 生产环境建议在服务器上跑（参见 [AGENTS.md §5.3](./AGENTS.md#53-admin-cli在-server-上跑)）。

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
2. 拉取并执行 bootstrap：
   ```bash
   curl -fsSL https://raw.githubusercontent.com/JqcFrankice/agent_qa/main/scripts/bootstrap-server.sh -o /tmp/bootstrap-server.sh
   bash /tmp/bootstrap-server.sh
   ```
3. 阿里云控制台 → ECS → 安全组：放行 TCP 80 / 443，撤掉公网 8080。
4. 编辑 `/etc/server-agent/agent.env`：
   - bootstrap 已生成 `SESSION_COOKIE_SECRET`
   - **手动补**：`ANTHROPIC_AUTH_TOKEN`（aiwoo claude key）、`OPENAI_API_KEY`（aiwoo codex key）、`AIWOO_BASE_URL`、`DEFAULT_PROVIDER`、`DEFAULT_MODEL`、`UPSTREAM_FIRST_BYTE_TIMEOUT_MS`
5. 在 GitHub Actions 上生成一对 ed25519 deploy key（不要复用本机密钥）：
   ```bash
   ssh-keygen -t ed25519 -f /tmp/agent_qa_deploy -N ""
   ```
   - 把私钥贴进 GitHub Secrets，名 `SSH_DEPLOY_KEY`
   - 把公钥一行贴进服务器 `/home/agent/.ssh/authorized_keys`，前面加：
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
| 关掉自动部署 | GitHub → Settings → Actions → Disable |

> **改 `scripts/deploy-agent.sh` 后必须在服务器 root 重装 `/usr/local/bin/deploy-agent`**，否则 GH Actions 还是用旧版 pinned bin。详见 [AGENTS.md §3.2](./AGENTS.md#32-关键约束务必遵守)。

## 路线图

| Phase | 状态 | 内容 |
|---|---|---|
| 1 | done | 基础设施骨架（Fastify + systemd + Caddy + GH Actions 部署） |
| 2a | done | HTTPS + 账号系统 + 持久化 |
| 2b | **done** | 聊天核心 MVP（aiwoo claude/codex provider + SSE + /chat UI） |
| 3 | **next** | Skill 沉淀流水线：保存对话为 skill / 选用 skill 新建会话 / 个人+可发布存储 |
| 4 | planned | QA-AGENT 模式：参数化 skill（input schema）+ 内置 QA preset（bug 复现 / 用例生成 / 回归清单） |
| 5 | planned | Skill 审核流：pending/approved 状态机 + 版本管理 + admin UI |
| 6 | planned | 前端打磨（响应式 / 搜索 / 多模态）+ provider 抽象通用化（adapter registry / 多 key 轮询 / 用量） |

每个 Phase 都先在 `docs/superpowers/specs/` 落地 spec、再 `docs/superpowers/plans/` 落地 plan，最后才动代码。
Phase 3-6 的总览路线图（含 Phase 3 详细 spec）：[`docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md`](docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md)。

## 给 AI Agent

如果你是 Claude Code、Codex、Gemini 等 agent 工具来协作这个仓库，**先读 [`AGENTS.md`](./AGENTS.md)**：那里有部署机制、运维快捷命令、坑、约定，全部沉淀过。
