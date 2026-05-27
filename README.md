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
