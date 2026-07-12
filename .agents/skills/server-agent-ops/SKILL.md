---
name: server-agent-ops
description: Use when working on the server_agent repo — touches deploy / migrations / aiwoo provider / live aicoolyun.vip server. Loads project conventions, deploy pitfalls, and operational shortcuts before any change that could affect production.
---

# server_agent 项目操作 skill

这个仓库是 [aicoolyun.vip](https://aicoolyun.vip) 上跑的 AI Agent 平台。
任何会影响 **部署 / 数据库迁移 / aiwoo provider / 服务器配置** 的工作之前，必须先读 [`AGENTS.md`](../../../AGENTS.md) 拿到完整上下文。

## 快速决策表

| 你在做什么 | 必读章节 |
|---|---|
| 改部署脚本 / CI 工作流 | AGENTS.md §3 部署、§6.1 build:shared 顺序、§6.6 rollback 演练 |
| 加新 provider / 新模型 / 改 prompt | AGENTS.md §6.2 模型可用性、§6.3 base URL 规则 |
| 加 SSE / 流式路由 | AGENTS.md §6.4 reply.raw 断连检测 |
| 改数据库 schema | AGENTS.md §3.1 forward-only migration、§6.1 build:shared |
| 服务器排错 / 看日志 | AGENTS.md §5 日常运维 |
| 起新 Phase | AGENTS.md §9 路线图、§6.5 spec/plan 流程 |

## 强约束（red flags — 违反就停下问用户）

1. **不要直接改 `main` 上的代码**。所有改动走 worktree 分支 + PR + merge。
2. **不要修改已 commit 的 migration 文件**（`packages/server/src/db/migrations/*.sql`）。新需求加新文件。
3. **不要在 deploy-agent.sh 把 `db:migrate` 放到 `build:shared` 之前**。会让自动部署炸但服务不挂，看起来像部署成功实则没上。
4. **不要直接在生产服务器上 `git push --force` 或 `git checkout` 任意分支**。生产仓库只跟 origin/main。
5. **不要把 aiwoo key、`SESSION_COOKIE_SECRET` 这类秘密写进 commit / 测试 / log 输出**。env 在服务器 `/etc/server-agent/agent.env`，本地 `.env` 已在 gitignore。
6. **不要假设 `/v1/models` 列出的模型就能调用**。aiwoo key 绑分组,加新模型前必须 curl 实测。
7. **不要绕过 lint / typecheck / test / build 四件套**。CI 会拦但本地先验更快。

## 软约定（best practice — 偏离时解释清楚）

- 每个 task 单独 commit，commit message 用 `feat|fix|test|chore|spec(scope): ...` 形式。
- spec / plan 写完立即 push（即使还没动代码），方便跨工具/会话恢复上下文。
- 真实上游验证（aiwoo curl）SSH 到服务器跑，避免本地装 key 的污染。
- TDD：先写失败测试（特别是 provider adapter、SSE 边界），再写实现。

## 高频运维命令（直接复制）

```bash
# 健康检查
curl https://aicoolyun.vip/api/health

# 看服务日志
ssh root@43.108.21.46 'journalctl -u server-agent -f'

# 手动触发部署（不通过 GH Actions）
ssh root@43.108.21.46 'sudo -u agent /usr/local/bin/deploy-agent'

# admin CLI（建邀请码）
ssh root@43.108.21.46 'cd /opt/server_agent && sudo -u agent bash -c "set -a; . /etc/server-agent/agent.env; set +a; npm run admin -- invite create --uses 1 --note 临时"'

# 改完 deploy-agent.sh 重装 pinned bin
ssh root@43.108.21.46 'cd /opt/server_agent && sudo -u agent git pull && install -o root -g root -m 0755 scripts/deploy-agent.sh /usr/local/bin/deploy-agent'
```

## 上线前自检 checklist

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` 全绿
- [ ] 涉及部署脚本/migration 时,在本地 worktree dry-run 过相关命令
- [ ] aiwoo 上游变动时,SSH 服务器实测一次真实 curl
- [ ] PR 描述里写清楚"这次改了什么/为什么/怎么验证"
- [ ] 部署后 `curl https://aicoolyun.vip/api/health` + 浏览器手动 user flow
- [ ] 学到的新坑写进 `AGENTS.md §6`

## 跨工具兼容

- **Codex** —— 通过此 SKILL.md 自动加载
- **Codex CLI** —— 读仓库根 `AGENTS.md`
- **Gemini CLI** —— 读仓库根 `AGENTS.md`
- **任何其它 agent 工具** —— 都应优先读 `AGENTS.md` 和 `README.md`

跨工具的"事实之源"是 `AGENTS.md`，本 SKILL.md 只是 Codex 的入口指针 + 快速决策表，**遇到分歧时以 AGENTS.md 为准**。
