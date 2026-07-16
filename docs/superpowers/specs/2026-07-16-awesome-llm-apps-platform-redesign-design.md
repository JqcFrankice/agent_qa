# Awesome LLM Apps 公共 Agent 平台重塑设计

**日期**：2026-07-16

**状态**：待用户审阅

**目标项目**：`server_agent` / `aicoolyun.vip`

**主要上游**：[`Shubhamsaboo/awesome-llm-apps`](https://github.com/Shubhamsaboo/awesome-llm-apps)

**决策摘要**：抛弃现有聊天 + Skill 产品代码和生产数据，从零建设公开多用户 AI Agent 平台。平台同时提供应用商店、个人工作台和开发发布平台，以 `awesome-llm-apps` 为主要内容来源，并持续同步上游。

---

## 1. 背景与目标

现有 `server_agent` 已实现账号、聊天、Provider、Skill、QA preset 和审核流，但它的核心模型仍是“会话 + Prompt Skill”。`awesome-llm-apps` 则是包含 100 多个 Agent、RAG、MCP、语音、生成式 UI 和多 Agent 示例的异构项目集合。两者直接合并会形成不可维护的依赖、权限和运行时耦合。

本次不在旧架构上继续扩展，而是将项目重塑为一个公开多用户 Agent 平台：

1. 用户可以在应用商店发现、安装和运行 Agent 应用。
2. 用户可以在个人工作台管理应用、文件、知识库、运行记录、定时任务和产物。
3. 用户可以在可视化 Studio 中编排工作流，也可以使用 Python/TypeScript SDK 开发代码应用。
4. 开发者可以测试、提交审核、发布和维护应用版本。
5. 平台持续同步 `awesome-llm-apps`，但上游变更必须经过适配、安全检查、端到端测试和人工审核后才能运行。

### 1.1 成功标准

- `awesome-llm-apps` 的全部应用均有可搜索的商店目录条目、来源路径、固定 commit 和适配状态。
- 通过认证的应用可以完成安装、BYOK 配置、运行、实时观察和产物保存的完整流程。
- 可视化工作流和代码应用共享同一套 Manifest、权限、运行、事件和版本协议。
- 第三方代码在多租户隔离环境中运行，不能访问宿主机、平台内部数据库或其他租户数据。
- 公开开发者可以提交应用，管理员能够审查权限、测试、安全扫描和版本变更。
- 桌面端覆盖完整创建与调试流程；移动端覆盖发现、运行、审批和结果查看。

### 1.2 已确认的产品决策

- 产品形态：应用商店 + 个人工作台 + 开发发布平台。
- 用户范围：公开多用户平台。
- 上游关系：持续同步上游并通过平台适配层接入。
- 基础设施：允许完整扩容，不受当前单 ECS 限制。
- 外部服务费用：纯 BYOK，平台不提供共享模型或第三方服务 Key。
- 首版覆盖：全量目录收录，应用按适配和认证状态分级运行。
- 开发方式：可视化编排 + Python/TypeScript SDK 双模式。
- 运行形态：聊天、表单、生成式 UI、后台任务、定时任务、Webhook 和 API 全部支持。
- 视觉方向：商店偏内容发现；Workspace、Studio 和 Console 偏专业开发工具。
- 历史数据：不迁移现有账号、会话、消息或 Skill。
- 架构路线：统一平台内核 + Python/Node/特殊容器隔离运行时。

---

## 2. 范围与非目标

### 2.1 总体范围

- 公共应用目录、搜索、分类、详情、安装和版本管理。
- 用户、组织、项目和角色权限。
- BYOK 密钥库与应用级授权。
- 文件、数据集、知识库、运行产物和审计记录。
- 可视化 Agent Studio、Workflow IR、调试和测试集。
- Python/TypeScript SDK 和代码应用运行协议。
- 实时、异步、定时、Webhook 和 API 运行入口。
- Python、Node、浏览器、语音、MCP 和 GPU Worker。
- 应用发布、审核、灰度、回滚和弃用。
- `awesome-llm-apps` 上游同步、适配和认证流水线。
- 运行日志、指标、链路、告警和管理员运营界面。

### 2.2 非目标

- 不迁移旧平台生产数据。
- 不保持旧 `/chat`、旧 Skill API 或 SQLite schema 兼容。
- 不直接在主 API 进程中执行上游 Python/Node 代码。
- 不自动上线未经人工审核的上游更新。
- 不允许模型返回任意可执行前端代码。
- 不向用户提供平台共享的模型、搜索、语音或抓取服务 Key。
- 初期不建设支付、订阅和外部服务代付能力；平台仍实施计算资源配额和滥用防护。
- 不承诺所有目录条目在首次公开发布时都达到“可运行”或“平台认证”。

---

## 3. 产品信息架构

新平台顶层分为四个空间，根路径直接进入 Explore，不建设独立营销首页。

### 3.1 Explore

- 应用商店首页、分类、搜索、筛选和精选集合。
- 应用详情：真实运行预览、输入输出、所需 Key、权限、资源、版本、来源、许可证和认证状态。
- 安装、Fork、收藏、版本选择和已知限制。
- 认证状态分为：`cataloged`（目录收录）、`adapting`（适配中）、`runnable`（可运行）、`certified`（平台认证）。
- 只有 `runnable` 和 `certified` 版本可以安装运行。

### 3.2 Workspace

- 已安装应用、最近运行和固定应用。
- 聊天、动态表单、生成式 UI 和运行结果。
- 文件、数据集、知识库和产物。
- 定时任务、Webhook、API 调用记录和人工审批队列。
- 运行详情、节点轨迹、日志、成本数据和重跑入口。

### 3.3 Studio

- 无限工作流画布、节点库、属性面板和底部运行控制台。
- Draft、版本、Fork、差异、回滚和环境配置。
- 测试集、Mock Provider、单节点调试和完整沙箱运行。
- 代码工作区用于 SDK 应用；可视化工作流和代码节点可以互相组合。
- 发布前权限检查、Manifest 检查和测试报告。

### 3.4 Console

- Integrations：BYOK 密钥、MCP Server、OAuth 连接和网络授权。
- Developer：应用、版本、SDK Token、Webhook、API Key 和发布状态。
- Organization：成员、角色、项目、配额和审计日志。
- Admin：应用审核、上游同步、安全发现、Worker 状态、队列、告警和用户治理。

### 3.5 核心用户路径

```text
浏览应用
  -> 查看依赖、权限与所需 Key
  -> 安装到 Workspace
  -> 绑定自己的 Key
  -> 使用聊天、表单或 API 启动
  -> 实时查看节点执行
  -> 保存或下载结果
  -> Fork 到 Studio 修改
  -> 测试并提交发布
```

---

## 4. 视觉与交互原则

- Explore 使用真实应用封面、运行截图和结果预览，重点支持发现和比较。
- Workspace、Studio 和 Console 采用高密度、克制的专业工具风格，暗色与亮色主题都完整支持。
- Studio 桌面布局固定为左侧节点库、中间画布、右侧属性面板、底部日志与轨迹。
- 移动端不提供复杂画布编辑，重点覆盖发现、安装、运行、审批、状态和结果查看。
- 所有长任务明确展示排队、准备、运行、等待输入、重试、成功、失败、取消和超时状态。
- 运行中 UI 使用稳定尺寸与虚拟化列表，日志、流式输出和动态节点状态不得造成布局跳动。
- 商店详情优先展示实际产品状态，不使用纯装饰素材替代真实运行结果。
- 生成式 UI 只能使用平台受控组件协议；独立前端包必须运行在受 CSP 限制的隔离 iframe。

---

## 5. 总体技术架构

平台分为控制平面、编排平面、运行平面和数据平面。

```text
Next.js Web
  -> Fastify Control API
       -> PostgreSQL
       -> Redis
       -> OSS/S3
       -> KMS
       -> Temporal
            -> Native Workflow Workers
            -> Runtime Manager
                 -> Python Kubernetes Jobs
                 -> Node Kubernetes Jobs
                 -> Browser Workers
                 -> Voice Workers
                 -> MCP Workers
                 -> GPU Workers

Workers -> Event Gateway -> SSE/WebSocket -> Web
All services -> OpenTelemetry -> Logs / Metrics / Traces / Alerts
```

### 5.1 技术选型

- 前端：Next.js + React + TypeScript + TanStack Query。
- 控制 API：Fastify + TypeScript，使用 OpenAPI 和共享 schema。
- 主数据库：托管 PostgreSQL。
- 缓存与限流：托管 Redis。
- 持久工作流：Temporal，负责任务队列、定时、重试、信号、人工等待和恢复。
- 容器调度：Kubernetes；在阿里云优先使用 ACK。
- 对象存储：阿里云 OSS，通过 S3 风格存储接口封装。
- 密钥：阿里云 KMS 信封加密。
- 可观测性：OpenTelemetry + 集中日志、指标、链路和告警。
- 基础设施：Terraform + Helm，开发环境提供 Docker Compose。

Temporal 是运行状态和持久编排的事实之源；Redis 不承担不可恢复的任务队列。PostgreSQL 保存平台业务数据、运行索引和可查询摘要，不保存 Temporal 的内部状态。

### 5.2 建议仓库结构

```text
apps/
  web/                 # Explore / Workspace / Studio / Console
  api/                 # Fastify control plane
services/
  sync-service/        # awesome-llm-apps 同步与候选版本
  runtime-manager/     # 创建和管理隔离容器
  event-gateway/       # SSE/WebSocket 事件分发
packages/
  contracts/           # API schema 与事件协议
  manifest/            # AppManifest 校验与工具
  workflow-ir/         # 可视化工作流中间表示
  workflow-engine/     # 原生节点执行与 Temporal 接入
  ui-components/       # 平台受控生成式 UI 组件
  sdk-typescript/
sdks/
  python/
runtimes/
  python/
  node/
  browser/
  voice/
  mcp/
  gpu/
adapters/
  awesome-llm-apps/    # 每个上游应用的 Manifest/patch/test
infra/
  terraform/
  helm/
  compose/
docs/
```

---

## 6. 统一应用契约

所有应用必须提供经过版本化的 `AppManifest`。Manifest 是商店展示、安装授权、构建、调度和审核的共同事实之源。

```yaml
apiVersion: platform.aicoolyun.vip/v1
kind: AgentApp
metadata:
  id: awesome.ai-deep-research
  name: AI Deep Research Agent
  version: 1.0.0
  license: Apache-2.0
source:
  repository: Shubhamsaboo/awesome-llm-apps
  path: advanced_ai_agents/single_agent_apps/ai_deep_research_agent
  commit: 6ce858fdce51087a231b07ca423be39020b964ad
runtime:
  type: python
  entrypoint: deep_research_openai.py
ui:
  mode: form
inputs: []
outputs: []
secrets:
  - OPENAI_API_KEY
  - FIRECRAWL_API_KEY
permissions:
  network:
    allow:
      - api.openai.com
      - api.firecrawl.dev
  files: workspace-only
resources:
  cpu: "1"
  memory: 2Gi
  timeout: 30m
triggers:
  - manual
  - api
```

完整 Manifest 必须声明：

- 标识、版本、作者、来源、固定 commit 和许可证。
- 运行时、入口、构建方式和健康检查。
- 输入、输出、UI 模式和产物类型。
- 所需密钥和 OAuth/MCP 连接。
- 网络、文件、浏览器、音频、摄像头、GPU 和代码执行权限。
- CPU、内存、GPU、临时磁盘、超时和最大并发。
- 手动、聊天、定时、Webhook、API 和事件触发器。
- Mock fixture、端到端测试和评估标准。

### 6.1 应用类型

- `workflow`：由 Workflow IR 表示，运行在平台原生 Worker。
- `python`：使用 Python SDK 或适配包装器。
- `node`：使用 TypeScript SDK 或适配包装器。
- `container`：复杂应用使用审核后的专用 OCI 镜像。
- `frontend`：隔离 iframe 前端包，后端仍必须使用以上运行类型之一。

### 6.2 Workflow IR

Workflow IR 是版本化的有向图，节点和边均有明确类型。首批节点包括：

- 模型、Prompt、结构化输出。
- HTTP、工具、MCP 和浏览器。
- 文件解析、Embedding、向量检索和 RAG。
- 条件、循环、并行、聚合、重试和超时。
- 单 Agent、多 Agent、交接和人工审批。
- 表单、聊天、表格、图表、时间线、看板和文件输出。
- 定时器、Webhook 和 API 输入输出。

Studio 在保存和运行前检查断开节点、不可达节点、无界循环、类型不匹配、缺失 Key、未授权权限和不可用模型。

---

## 7. awesome-llm-apps 同步与认证

平台不把上游仓库作为主服务依赖，也不直接从 `main` 执行代码。Sync Service 定期读取上游 GitHub 仓库并记录固定 commit。

### 7.1 同步流程

```text
发现新 commit
  -> 比较应用目录
  -> 创建候选 Source Revision
  -> 自动识别依赖、入口和所需 Key
  -> 生成或更新 Manifest 草稿
  -> 许可证/恶意代码/依赖漏洞/密钥扫描
  -> 构建不可变镜像
  -> Mock 测试
  -> 真实服务端到端测试
  -> 管理员审核权限与变更
  -> 灰度发布
  -> 正式认证
```

### 7.2 适配器边界

每个适配目录只保存平台 Manifest、最小 patch、构建文件、fixture 和测试，不复制整个上游历史。构建时从固定 commit 获取源代码并应用可审计 patch。上游代码变化不会静默覆盖已发布版本。

### 7.3 认证等级

- `cataloged`：已发现并建立目录条目，不能运行。
- `adapting`：已进入适配或测试，不能公开安装。
- `runnable`：通过基础构建、安全和 Happy Path 测试，可以安装。
- `certified`：通过权限审查、真实端到端、故障与回归测试，允许公开推荐。
- `suspended`：发现安全、许可证或运行问题，禁止新运行并保留审计记录。

更新版本必须重新检查权限差异。新增网络域名、密钥、文件或设备权限时，已安装用户必须重新授权。

---

## 8. 运行生命周期

每次调用生成不可变 `Run` 快照，绑定应用版本、Workflow 版本、输入、环境、模型设置和密钥引用。

```text
授权与输入校验
  -> 创建 Run
  -> 启动 Temporal Workflow
  -> 调度匹配 Task Queue
  -> 创建临时容器和工作区
  -> 注入本次运行所需密钥
  -> 执行并持续发送 RunEvent
  -> 保存结构化输出和 Artifact
  -> 清理容器、临时文件和密钥
```

### 8.1 Run 状态

`queued -> preparing -> running -> waiting_input -> succeeded | failed | canceled | timed_out`

节点另外支持 `pending`、`running`、`retrying`、`skipped`、`succeeded`、`failed` 和 `canceled`。

### 8.2 实时事件

统一 `RunEvent` 至少包含：

- `run.status.changed`
- `step.started` / `step.completed` / `step.failed`
- `model.delta` / `model.usage`
- `tool.started` / `tool.completed`
- `log.appended`
- `artifact.created`
- `approval.requested`
- `run.completed`

Event Gateway 通过 SSE 或 WebSocket 转发，客户端断线后使用事件序号恢复，不依赖内存中的一次性连接。

### 8.3 重试与恢复

- 每个节点声明最大重试次数、退避策略、可重试错误和幂等键。
- 长任务状态由 Temporal 持久化，Worker 重启后可以恢复。
- 用户可以从失败节点重新运行；平台复用已经确认可复用的上游节点产物。
- 等待人工输入或审批的任务不占用运行容器。
- 取消操作传递到模型请求、工具调用和容器进程。

---

## 9. 安全与多租户

### 9.1 容器隔离

- 每个认证应用版本对应不可变 OCI 镜像和 SBOM。
- 不共享 Python 虚拟环境、Node `node_modules` 或用户工作目录。
- 使用非 root 用户、只读根文件系统、最小 Linux capabilities 和 seccomp/AppArmor 策略。
- 禁止挂载 Docker Socket、宿主机目录和 Kubernetes ServiceAccount Token。
- CPU、内存、GPU、临时磁盘、进程数、时长和并发均有限制。
- 浏览器、语音、MCP、GPU 和普通 Worker 使用不同节点池和安全策略。

### 9.2 网络隔离

- 默认拒绝公网和集群横向访问。
- 允许域名必须在 Manifest 声明，并通过统一 Egress Proxy。
- 禁止访问云元数据地址、平台数据库、Kubernetes API 和私有管理网络。
- DNS、目标域名、响应大小和请求时长均记录并受策略限制。

### 9.3 BYOK

- Key 通过 KMS 信封加密，数据库仅保存密文和元数据。
- 浏览器、应用作者、日志系统和普通 API 响应永远不返回明文。
- 用户把 Key 授权给具体应用、组织或项目，默认不跨应用共享。
- Runtime Manager 只在执行前解析本次所需 Key，并注入临时容器。
- 日志和事件写入前经过敏感信息清洗；平台维护常见 Key 格式和用户自定义敏感字段规则。
- 用户可以撤销和轮换 Key；撤销立即阻止新任务，正在运行任务按安全策略终止。

### 9.4 身份与权限

- 采用用户、组织、项目和成员角色四层模型。
- 基础角色为 Owner、Admin、Developer、Operator、Viewer。
- 发布、密钥授权、组织成员、生产运行和管理员审核均写入不可变审计日志。
- API Token 使用作用域和到期时间，不使用长期全权限 Token。

---

## 10. Studio、SDK 与生成式 UI

### 10.1 Studio

- 工作流草稿自动保存，但运行只引用显式创建的不可变版本。
- 支持单节点运行、完整沙箱运行、Mock 运行和真实 BYOK 运行。
- 调试器显示输入输出摘要、工具调用、模型用量、重试、日志和产物。
- Fork 保留来源链，用户修改后形成独立应用和版本。
- 发布前生成 Manifest 差异、权限差异、测试报告和安全报告。

### 10.2 SDK

Python 和 TypeScript SDK 提供一致能力：

- 定义应用和 Manifest。
- 读取经过 schema 校验的输入。
- 调用平台模型网关、工具、MCP、文件、知识库和事件 API。
- 创建日志、进度、审批、结构化结果和 Artifact。
- 访问密钥引用，但不能枚举用户其他 Key。
- 响应取消信号、超时和资源限制。

应用不能直接连接平台内部 PostgreSQL、Redis、Temporal 或对象存储管理接口。

### 10.3 生成式 UI

平台提供受控组件协议，首批组件为 Markdown、表单、表格、图表、指标、时间线、看板、文件、引用列表和审批框。模型只返回经过 schema 校验的组件树和数据，不能执行脚本。

需要完整自定义 UI 的应用提交独立构建产物，在隔离 iframe 中运行，并使用版本化 postMessage Bridge 访问有限的平台能力。

---

## 11. 核心数据模型

以下为领域边界，不要求所有表在第一个 Phase 一次创建。

### 11.1 身份与组织

- `users`
- `organizations`
- `organization_memberships`
- `projects`
- `api_tokens`
- `audit_logs`

### 11.2 密钥与连接

- `connections`
- `connection_secret_versions`
- `connection_grants`
- `mcp_servers`

### 11.3 应用与版本

- `apps`
- `app_sources`
- `source_revisions`
- `app_versions`
- `app_certifications`
- `app_permissions`
- `app_installations`
- `app_reviews`

### 11.4 工作流与运行

- `workflow_definitions`
- `workflow_versions`
- `runs`
- `run_steps`
- `run_event_indexes`
- `artifacts`
- `schedules`
- `webhook_endpoints`
- `approval_requests`

### 11.5 数据与知识库

- `files`
- `datasets`
- `knowledge_bases`
- `documents`
- `document_chunks`
- `embedding_indexes`

所有租户数据表必须包含明确的组织或项目归属。跨租户访问不能只依赖前端过滤，Repository 和授权层都必须强制检查。

---

## 12. API 与错误模型

Control API 使用版本化 REST/OpenAPI；实时运行事件使用 SSE/WebSocket；Worker 内部协议使用版本化 RPC 或消息 schema。

主要 API 域：

- `/api/v1/auth/*`
- `/api/v1/organizations/*`
- `/api/v1/catalog/apps/*`
- `/api/v1/apps/*`
- `/api/v1/workflows/*`
- `/api/v1/runs/*`
- `/api/v1/connections/*`
- `/api/v1/files/*`
- `/api/v1/knowledge-bases/*`
- `/api/v1/developer/*`
- `/api/v1/admin/*`

错误响应包含稳定 `code`、用户可读 `message`、`requestId` 和可选字段错误，不把上游密钥、内部路径或堆栈返回客户端。

错误码按领域分组：

- `AUTH_*`：登录、组织和作用域。
- `APP_*`：版本、安装、认证和权限。
- `MANIFEST_*`：契约和兼容性。
- `CONNECTION_*`：Key 缺失、无效、撤销和授权。
- `RUN_*`：状态、取消、超时和恢复。
- `RUNTIME_*`：镜像、容器、资源和沙箱。
- `UPSTREAM_*`：模型、工具和第三方服务。
- `QUOTA_*`：计算、存储、并发和速率限制。

上游错误必须归一化，同时在脱敏内部日志中保留原始 provider code 供排障。

---

## 13. 可观测性与运营

- 所有 HTTP 请求、Temporal Workflow、Worker 任务、模型调用和工具调用共享 Trace ID。
- 指标至少覆盖 API 延迟、错误率、队列等待、运行时长、Worker 容量、容器启动、上游错误、Token 用量、存储和认证通过率。
- Run 详情展示用户可见的脱敏日志；管理员日志与安全审计分离授权。
- 上游同步、镜像构建、认证测试和灰度发布均生成可查询报告。
- 关键告警包括任务堆积、Worker 不可用、KMS/OSS/Temporal 故障、跨租户拒绝异常上升和敏感信息检测命中。

---

## 14. 测试与发布门禁

### 14.1 测试层级

1. Manifest、Workflow IR、事件和 SDK 契约测试。
2. Control API、Repository、授权和 Worker 单元/集成测试。
3. Mock Provider 下的确定性工作流测试。
4. 代表性应用真实端到端测试。
5. 沙箱逃逸、网络越权、密钥泄漏和多租户隔离测试。
6. Playwright 桌面/移动端核心流程和视觉回归。
7. 队列、长任务、Worker 丢失、上游限流和依赖故障演练。
8. 容量、并发、长时间运行和灰度回滚测试。

### 14.2 黄金应用矩阵

每种能力至少维护一个平台认证的黄金应用：

- Starter 单 Agent
- 多 Agent
- RAG
- MCP
- 浏览器自动化
- 语音实时交互
- 生成式 UI
- 后台定时任务
- GPU/多模态
- Python SDK 与 TypeScript SDK

模型输出测试验证 schema、工具调用、引用、产物和安全约束，不依赖完整文本相等。

### 14.3 发布门禁

- lint、typecheck、unit、integration、contract 和 build 全部通过。
- 镜像扫描无未豁免的 Critical/High 风险。
- 数据库迁移具备前向和回滚/兼容策略。
- 代表性 E2E、隔离测试和 Playwright 测试通过。
- 灰度环境完成健康检查和真实 BYOK 运行。
- 生产使用 canary Worker 和可回滚版本发布。

---

## 15. 分阶段交付

本次重塑不能作为一个实施计划一次完成。每个阶段都必须单独走 design -> plan -> TDD -> verification -> deploy。

### Phase N1：新平台骨架

- 新 monorepo 和本地开发环境。
- Next.js、Fastify、PostgreSQL、Redis、Temporal、OSS 抽象和 OpenTelemetry。
- 新账号、组织、项目、角色和审计基础。
- Kubernetes/Terraform/Helm 部署骨架。

### Phase N2：目录与上游同步

- `awesome-llm-apps` 全量目录同步。
- Manifest schema、Source Revision、分类、认证状态和管理员候选版本界面。
- Explore 商店和应用详情。

### Phase N3：安全运行内核

- BYOK、KMS、Connection Grant。
- Run/RunEvent、Temporal、Runtime Manager、Python/Node Worker。
- 文件、Artifact、实时状态和运行详情。
- 认证首批 Starter 与 RAG 黄金应用。

### Phase N4：Workspace

- 安装应用、聊天、动态表单、生成式 UI。
- 文件、数据集、知识库、定时任务、Webhook 和 API。
- 运行历史、重试、取消、等待输入和产物管理。

### Phase N5：Visual Studio

- Workflow IR 和节点引擎。
- 可视化画布、节点配置、调试器、Mock、版本、Fork 和测试集。
- 受控生成式 UI 组件协议。

### Phase N6：开发者生态

- Python/TypeScript SDK。
- 代码应用构建和隔离运行。
- 开发者 Console、提交审核、灰度、发布、回滚和弃用。

### Phase N7：高级运行时

- MCP、浏览器、语音、GPU、多 Agent 和长任务专用 Worker。
- 人工审批、断点恢复和高级资源策略。
- 扩大 `awesome-llm-apps` 的 runnable/certified 覆盖率。

### Phase N8：公开发布

- 完整安全审计、故障演练、容量测试和运营后台。
- 新用户注册策略、资源配额和滥用治理。
- `aicoolyun.vip` 灰度切换和旧平台下线。

---

## 16. 旧平台处置与切换

- 旧平台在新平台开发期间继续服务，但不再扩展产品功能。
- 开始重写前创建可恢复的 Git tag、生产数据库备份和部署配置备份。
- 新平台使用独立环境、数据库、域名或预发布子域，不覆盖旧生产。
- 不编写旧账号、会话、消息、Skill 或审核数据迁移程序。
- N8 验收通过后，把 `aicoolyun.vip` 切换到新平台。
- 旧数据库和构建产物离线加密归档，旧服务停止并移除公网入口。

---

## 17. 风险与缓解

### R1：上游应用异构程度过高

缓解：全量目录与全量可运行分离；使用 Manifest、认证等级和多运行时，不用一个依赖环境强行兼容全部应用。

### R2：运行第三方代码带来安全风险

缓解：不可变镜像、Kubernetes 隔离、默认拒绝网络、最小权限、短期密钥、沙箱测试和人工审核共同构成门禁。

### R3：BYOK 被应用或日志泄漏

缓解：KMS 信封加密、应用级授权、运行时临时注入、Egress Proxy、日志清洗、撤销和密钥泄漏测试。

### R4：可视化工作流与代码应用分裂

缓解：两者共享 AppManifest、Workflow/Run 事件、SDK Context、Artifact 和发布协议；代码只作为一种运行节点或应用类型。

### R5：Temporal/Kubernetes 增加运维复杂度

缓解：优先使用托管服务；Terraform/Helm 固化环境；本地 Docker Compose 提供最小开发闭环；每个阶段增加故障演练。

### R6：全量内容导致商店质量下降

缓解：明确显示认证状态，只允许 runnable/certified 运行；搜索默认提高 certified 权重；长期未适配项目不伪装成可用。

### R7：公开平台被滥用计算资源

缓解：账号验证、组织配额、并发限制、速率限制、运行超时、风险权限审核和管理员封禁。BYOK 不等于无限平台计算资源。

---

## 18. 总体验收标准

- 新用户能注册、创建组织、配置自己的 Key 并安装认证应用。
- 用户能通过聊天或表单启动任务，断线重连后继续看到完整事件和结果。
- 用户能在 Studio Fork 一个上游应用、修改工作流、测试并提交审核。
- 开发者能分别使用 Python 和 TypeScript SDK 发布通过认证的应用。
- 管理员能查看上游变更、Manifest/权限差异、安全报告、E2E 结果并执行灰度发布。
- 未授权应用无法读取 Key、其他租户文件、平台数据库或未声明网络目标。
- Worker 丢失、API 重启和浏览器断线不导致持久任务状态丢失。
- Explore、Workspace、Studio 和 Console 在目标桌面视口无重叠、空白或关键流程阻断；移动端核心流程可用。
- N8 发布门禁通过后，新平台接管 `aicoolyun.vip`，旧平台停止公网服务且备份可恢复。

---

## 19. 后续文档顺序

本文件是新平台总设计和 Phase 分解依据，不直接充当八个阶段的实施计划。用户确认本 spec 后，下一份文档应为 `Phase N1 新平台骨架` 的详细实施计划；后续 Phase 在开始前分别补充阶段级 design 和 plan。
