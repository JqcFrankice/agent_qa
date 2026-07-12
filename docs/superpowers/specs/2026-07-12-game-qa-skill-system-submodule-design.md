# game-qa-skill-system Submodule 集成设计

**日期**：2026-07-12

**状态**：待用户审阅

**上游仓库**：[`JqcFrankice/game-qa-skill-system`](https://github.com/JqcFrankice/game-qa-skill-system)

**目标版本**：`9116b9ad611d0274e44fbd738f11738f194a01b4`

## 1. 背景

`server_agent` 的 Phase 1-4 文档多次引用 `game-qa-skill-system`，但当前仓库没有 `.gitmodules`、gitlink 或包依赖。Phase 4 因上游当时不可访问，最终使用了 3 条手写 QA preset。

上游现已可访问，并扩展为包含 45 个游戏 QA 知识 Skill、测试用例生成工作流以及 Claude、Gemini、Codex 适配层的独立仓库。本次目标是建立可更新、可审计的 Git 引用，不在本阶段改写现有 preset 或运行时聊天逻辑。

## 2. 方案

以 Git submodule 方式将上游固定在：

```text
external/game-qa-skill-system
```

`.gitmodules` 记录 HTTPS URL 和跟踪分支 `main`，主仓 gitlink 固定到实施时上游 `main` 的最新提交。固定提交保证 CI 与生产构建可复现；后续更新通过显式拉取上游并提交新的 gitlink 完成。

不采用以下方案：

- 直接复制上游约 120 个文件：会丢失独立历史，后续同步容易产生大面积内容冲突。
- 仅更新 3 条 preset：不能满足“拉取上游最新 Git”的目标，也无法使用完整 QA 知识体系。

## 3. CI 与部署

### 3.1 GitHub Actions

`.github/workflows/deploy.yml` 的 `actions/checkout@v4` 开启递归 submodule checkout。构建 job 因此会验证目标提交可访问，避免主仓引用了无效或私有化的上游提交后继续部署。

### 3.2 生产部署

`scripts/deploy-agent.sh` 在 `git reset --hard <ref>` 后执行：

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

submodule 同步失败时由 `set -e` 立即终止，旧服务不重启。回滚流程调用同一个 `deploy_commit()`，因此也会恢复旧主仓提交对应的 submodule 版本。

该脚本在生产上是 `/usr/local/bin/deploy-agent` 的 pinned 副本。仓库脚本部署成功后，必须按 `AGENTS.md` 约定在服务器重新安装 pinned bin，否则下一次自动部署仍不会更新 submodule。

### 3.3 新机初始化

`scripts/bootstrap-server.sh` 在首次 clone 或已有仓库 reset 后统一执行 submodule sync/update，确保新服务器和重复初始化结果一致。

## 4. 冲突处理

本次新增路径在主仓中不存在，预期不会产生文件级冲突。若上游 `main` 在实施期间前进，则重新获取远端并固定到当时最新提交；不在 submodule 工作区合并或修改上游文件。

未来更新发生冲突时按以下规则处理：

1. 主仓只选择一个经过验证的上游提交，不创建合并后的本地上游提交。
2. 上游内容修改应提交到 `game-qa-skill-system` 仓库，再更新主仓 gitlink。
3. 若主仓两个分支引用不同上游版本，先比较上游提交历史和兼容性，再选择较新的已验证提交。

## 5. 验证

实施完成后执行：

1. `git submodule status` 显示目标路径和固定提交，无 `-`、`+` 或冲突标记。
2. `git submodule update --init --recursive` 可在干净环境完成。
3. 上游仓库自身 `scripts/validate-repo.ps1` 仅在可用 PowerShell 环境执行；macOS 无 PowerShell 时记录为未运行，不改写其脚本。
4. 主项目执行 `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`。
5. 推送后确认 GitHub Actions 通过，并检查 `https://aicoolyun.vip/api/health`。

## 6. 范围边界

本次不做：

- 将 45 个上游 Skill 自动导入 `skills` 数据表。
- 修改现有 3 条 QA preset 内容。
- 在聊天运行时动态读取 submodule 文件。
- 修改 `game-qa-skill-system` 上游仓库内容。

这些属于后续运行时集成设计，不能与 Git 引用更新混为一次变更。
