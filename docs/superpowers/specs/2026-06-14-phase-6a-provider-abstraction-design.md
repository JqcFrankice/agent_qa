## Phase 6a — Provider 抽象通用化（design）

**Spec 编号**：2026-06-14-phase-6a-provider-abstraction
**目标项目**：[`server_agent`](https://github.com/JqcFrankice/agent_qa)
**作者**：Claude Opus 4.6（与 @JqcFrankice 协作）
**前置**：Phase 5 已上线（[`2026-06-14-phase-5-review-workflow-design.md`](./2026-06-14-phase-5-review-workflow-design.md)）
**关联路线图**：[`2026-05-30-phase-3-6-roadmap.md §4`](./2026-05-30-phase-3-6-roadmap.md) — Phase 6 outline

---

## 0. 目标 & 取舍

**单句目标**：把 provider/model 从硬编码常量解耦成 registry + capability metadata，前端通过 `/api/providers` 动态消费。加新 provider 不改 routes，加新模型不改前端。

**为什么先做这条线**：
- AGENTS §6.2 踩过"aiwoo claude 全线不可用，codex 正常"的坑——provider 与运行时配置必须能解耦，运营才能临时屏蔽。
- Phase 6b（前端打磨：响应式 / 暗黑 / 多模态 / 搜索）依赖模型 capability metadata（vision / attachments），先把数据源做出来，6b 才能用稳。
- 兑现 roadmap §0 北极星「provider-agnostic」。

**Phase 6 拆分**：本 spec 仅做 6a（provider 抽象，纯后端 + 前端只读消费）。前端打磨拆为后续 6b。

**本 phase 范围（roadmap §4.2 五件事筛选后保留两件）**：
- ✅ adapter 注册表重构 + 模型 metadata + `/api/providers` 路由
- ❌ token 估算 + context window 截断（contextWindow 字段存数据但不使用）
- ❌ 多 key 轮询 + `usage_logs` 表（运营/计费层，单 key 够用）

跨 Phase 的硬约束（沿用 roadmap §0）：
- **Provider-agnostic**：skill / preset / 模板永远不绑死某个 provider 或 wire 格式。
- **Forward-only migration**：本 phase 0 改动 schema。
- **跨工具兼容**：运维沉淀仍写 `AGENTS.md`。

---

## 1. 范围

### 1.1 必须交付

- `ProviderRegistry` class（`packages/server/src/providers/registry.ts` 重写）：`register / has / get / list`。
- `createDefaultRegistry(config)`：内部按 env key 有无决定是否 register aiwoo-claude / aiwoo-codex（缺 key 即跳过，不再注册占位 adapter）。
- `shared/providers/models.ts` 升级为 `ModelMeta { id, label, capabilities: { vision, attachments, toolCall }, contextWindow }`，导出 `findModel(provider, id)`。
- 新路由 `GET /api/providers`（登录鉴权）：返回 `{ providers, defaultProviderId, defaultModel }`，仅列 registry 中已注册的 provider。
- 启动期 fail-fast：registry 全空抛错；`config.defaultProvider` 不在 registry 时 warn + fallback 到第一个。
- 前端 `useProviders()` hook + 三处下拉迁移（NewConversationDialog / chat index / SkillFormDialog），web 包不再 import `PROVIDER_MODELS` 常量。
- `messages` / `conversations` route 校验改用 `registry.has(provider)` + `findModel(provider, model)`。
- 测试：registry 单测、providers 路由集成测试、startup 校验测试、shared models 测试扩展。

### 1.2 非范围（明确不做）

- token 估算 / contextWindow 截断 — 不在本 phase；capability 字段存数据但不消费。
- 多 key 轮询 / `usage_logs` 表 — 留给后期。
- 数据库化 provider 配置（admin UI 增删 provider）— 留给后期。
- env 显式开关（`AIWOO_CLAUDE_ENABLED=false`）— 用 env key 有无即可，避免双层语义。
- 前端响应式 / 暗黑 / 虚拟滚动 / 多模态 / 搜索 — 全部留给 Phase 6b。
- React Testing Library 引入 — UI 行为靠手测覆盖。

---

## 2. 关键决策

### D1 — registry 重写为 class，不沿用 `Record<string, ProviderAdapter>`
- 选项 A（class + register/has/get/list）vs B（保留 Record，仅在 routes/providers 拼接）。
- 选 A：兑现"加新厂商不改 routes"目标；调用方语义清晰；缺 key 时不注册占位 adapter（避免 `Record` 形态下要么强制注册要么需要单独可用性表的尴尬）。

### D2 — model registry 仍硬编码在 `shared/providers/models.ts`
- 选项 A（shared 硬编码，PR 上线）vs B（env 子集动态过滤）vs C（DB 化）。
- 选 A：跟现状一致、类型安全、前后端共享一份事实。env 覆盖会引入 shared 类型 vs 运行时不一致的风险；DB 化是 Phase 7+ 的事。
- 加新模型仍走 PR + 部署，AGENTS §6.2 的"加新模型前必须 curl 实测"约定继续生效。

### D3 — provider 启用与否由 env key 有无决定
- 不引入额外 enabled 开关；运营临时屏蔽 = 清空对应 key + restart。
- 单一信号源减少状态不一致。

### D4 — capability 字段：vision / attachments / toolCall + contextWindow
- 全部加上：vision/attachments 为 6b 多模态预留，toolCall 为后期 tool-use 预留（全填 false），contextWindow 现在仅存数据不消费。
- 加字段不贵，回头改 schema 反而麻烦。

### D5 — `/api/providers` 需要登录
- 跟 `/api/skills`、`/api/conversations` 一致，未登录 401。
- 不做未登录公开（目前架构不需要）。

### D6 — 启动校验：registry 空 = fail-fast；defaultProvider 不在 registry = warn + fallback
- 全空 → throw → systemd restart loop，运维 5 次失败查日志，"no provider registered" 一目了然。**不静默兜底**避免上线后 chat 全部 400。
- 部分缺失 + default 不在 → warn + 静默降级到 `registry.list()[0]`。运营场景 (claude 全挂只剩 codex) 经常出现，不能阻塞启动。

### D7 — 旧会话指向已停用 provider 的处理：不迁移、不自动切换
- 列表正常显示原 provider/model + "已停用"灰色提示。
- 发新消息时由 `messages` route 校验抛 400，前端弹 toast"该 provider 已停用，请新建会话"。
- 静默切换会让用户莫名换模型，破坏可预期性。

---

## 3. 架构 & 模块边界

```
shared/providers/
  models.ts            # ModelMeta + PROVIDER_MODELS（加 capabilities + contextWindow）
                       # 导出 findModel / isKnownProvider / isKnownProviderModel

shared/schemas/
  providers.ts         # NEW: ProvidersResponseSchema（zod，前后端共享）

server/providers/
  registry.ts          # 重写：ProviderRegistry class + createDefaultRegistry(config)
  types.ts             # ProviderAdapter.id 字面量联合 → string
                       # 加 RegisteredProvider 类型（registry 内部用）
  aiwoo-claude.ts      # 不动
  aiwoo-codex.ts       # 不动
  sse-parser.ts        # 不动

server/routes/
  providers.ts         # NEW: GET /api/providers
  index.ts             # 注册 providers 路由
  messages.ts          # provider/model 校验改用 registry.has + findModel
  conversations.ts     # 同上
  skills.ts            # default_provider/default_model 校验同上

server/server.ts       # 启动期校验：空 registry 抛错；defaultProvider fallback

web/lib/
  providers.ts         # NEW: useProviders() hook + flatten/default helper

web/routes/chat/
  NewConversationDialog.tsx  # 模型下拉换 useProviders()
  index.tsx                  # 模型下拉换 useProviders()
  SkillFormDialog.tsx        # default_provider/default_model 下拉换 useProviders()
```

**核心边界**：
- `ProviderRegistry` 是后端唯一的 provider 入口。系统支持哪些 provider 都问 registry，不再 import `PROVIDER_MODELS` keys。
- `shared/providers/models.ts` 仍是 model metadata 的事实之源，server 通过 registry 间接暴露给前端，前端拿到的是「实际可用」子集。
- 前端只读消费 `/api/providers`，不再硬编码 provider/model 字符串。

---

## 4. 数据契约

### 4.1 `shared/providers/models.ts` 升级

```ts
export interface ModelCapabilities {
  vision: boolean;
  attachments: boolean;
  toolCall: boolean;
}

export interface ModelMeta {
  id: string;
  label: string;
  capabilities: ModelCapabilities;
  contextWindow: number;        // tokens；当前不强制截断，仅展示/未来用
}

export const PROVIDER_MODELS: Record<ProviderId, readonly ModelMeta[]> = {
  "aiwoo-claude": [
    { id: "claude-opus-4-8",   label: "Claude Opus 4.8",
      capabilities: { vision: true, attachments: false, toolCall: false }, contextWindow: 200000 },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6",
      capabilities: { vision: true, attachments: false, toolCall: false }, contextWindow: 200000 },
    { id: "claude-haiku-4-5",  label: "Claude Haiku 4.5",
      capabilities: { vision: true, attachments: false, toolCall: false }, contextWindow: 200000 }
  ],
  "aiwoo-codex": [
    { id: "gpt-5.5",       label: "GPT-5.5",
      capabilities: { vision: false, attachments: true, toolCall: false }, contextWindow: 128000 },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex",
      capabilities: { vision: false, attachments: true, toolCall: false }, contextWindow: 128000 }
  ]
};

export function findModel(provider: string, id: string): ModelMeta | undefined;
export function isKnownProvider(value: string): value is ProviderId;
export function isKnownProviderModel(provider: string, model: string): boolean;
```

> capability 值是占位，确切值在实现时按 aiwoo 实测/上游文档核对；toolCall 全填 false（Phase 6+ 才开）。

### 4.2 `GET /api/providers` 响应（登录鉴权，未登录 401）

```jsonc
{
  "providers": [
    {
      "id": "aiwoo-claude",
      "label": "Aiwoo Claude",
      "models": [
        {
          "id": "claude-opus-4-8",
          "label": "Claude Opus 4.8",
          "capabilities": { "vision": true, "attachments": false, "toolCall": false },
          "contextWindow": 200000
        }
      ]
    },
    { "id": "aiwoo-codex", "label": "Aiwoo Codex", "models": [/* ... */] }
  ],
  "defaultProviderId": "aiwoo-claude",
  "defaultModel": "claude-opus-4-8"
}
```

- shared 加 zod schema `ProvidersResponseSchema`，前后端共享。
- `defaultProviderId` 必须在 `providers[].id` 里（启动期已 fallback）。

### 4.3 后端 registry API

```ts
// packages/server/src/providers/types.ts
export interface ProviderAdapter {
  readonly id: string;            // 由字面量联合改为 string
  stream(req: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

// packages/server/src/providers/registry.ts
export interface RegisteredProvider {
  id: string;
  label: string;
  adapter: ProviderAdapter;
}

export class ProviderRegistry {
  register(p: RegisteredProvider): void;     // 重复 id 抛 Error
  has(id: string): boolean;
  get(id: string): ProviderAdapter;          // 缺则抛 AppError(400, CONV_VALIDATION)
  list(): RegisteredProvider[];              // 注册顺序
}

export function createDefaultRegistry(config: AppConfig): ProviderRegistry;
// 内部行为：
//   if (config.anthropicAuthToken) registry.register({ id:"aiwoo-claude", label:"Aiwoo Claude", adapter:new AiwooClaudeAdapter(...) })
//   if (config.openaiApiKey)       registry.register({ id:"aiwoo-codex",  label:"Aiwoo Codex",  adapter:new AiwooCodexAdapter(...) })
```

---

## 5. 调用链 & 兼容性

### 5.1 messages route 改动

现状：
```ts
const provider = getProvider(registry, providerId);   // 函数式
isKnownProviderModel(providerId, model);              // 直接查 shared 常量
```

改成：
```ts
if (!registry.has(providerId)) throw new AppError(400, "CONV_VALIDATION", `provider not available: ${providerId}`);
const adapter = registry.get(providerId);
const meta = findModel(providerId, model);
if (!meta) throw new AppError(400, "CONV_VALIDATION", `unknown model: ${providerId}/${model}`);
```

- 校验顺序：先 `registry.has`（运行时是否启用），再 `findModel`（model 在白名单）。
- 错误码沿用，前端不感知。
- adapter.stream() 入参/出参完全不变，SSE 行为不变。

### 5.2 conversations / skills route
- POST/PATCH /api/conversations 校验 provider+model 走同样两步。
- skill `default_provider`/`default_model` 在 skills route 里同样校验。

### 5.3 前端模型下拉迁移

涉及三个组件：`NewConversationDialog.tsx` / `routes/chat/index.tsx` / `SkillFormDialog.tsx`。

- 新 hook：`useProviders()`（React Query，`queryKey: ['providers']`，`staleTime: Infinity`，登录后只取一次）。
- 默认值取响应里的 `defaultProviderId` / `defaultModel`，但已存在的 conversation 仍显示自己的 provider/model（id 一致即可）。
- 旧会话指向已被停用 provider：列表显示原 id + "已停用"灰色提示；发消息时 messages route 抛 400 → 前端 toast "该 provider 已停用，请新建会话"。

### 5.4 PROVIDER_MODELS 用法清理
- 全仓搜 `PROVIDER_MODELS` / `isKnownProvider` / `isKnownProviderModel`：
  - server 用法：保留（registry 内部 + route 校验）。
  - web 用法：所有 `PROVIDER_MODELS` 引用迁移到 `useProviders()`；shared 仍导出，web 包不再 import 常量（types 仍可 import）。

### 5.5 `ProviderAdapter.id` 字面量退化
- `id: "aiwoo-claude" | "aiwoo-codex"` → `id: string`。
- 全仓搜使用点：目前只在 sse-parser 错误日志里出现。
- 任何 `if (adapter.id === "aiwoo-claude")` 的窄化逻辑改用 `instanceof AiwooClaudeAdapter` 或 string equality。

---

## 6. 启动校验 & 错误处理

### 6.1 启动期 fail-fast（`server.ts`）

```ts
const registry = createDefaultRegistry(config);

if (registry.list().length === 0) {
  throw new Error("no provider registered: set ANTHROPIC_AUTH_TOKEN and/or OPENAI_API_KEY in agent.env");
}

if (!registry.has(config.defaultProvider)) {
  fastify.log.warn(
    { configured: config.defaultProvider, fallback: registry.list()[0].id },
    "DEFAULT_PROVIDER not in registry, falling back to first registered"
  );
  config.defaultProvider = registry.list()[0].id;
  // model 同理：findModel(config.defaultProvider, config.defaultModel) 不存在则取该 provider 第一个
}
```

- 全空 = 启动失败，systemd restart loop，5 次失败后人工介入。
- 部分缺失 = warn + 静默降级（运营场景常见）。

### 6.2 运行期错误码

| 场景 | HTTP | code | message |
|---|---|---|---|
| 请求 provider 不在 registry | 400 | `CONV_VALIDATION` | `provider not available: <id>` |
| 请求 model 不在 capability 表 | 400 | `CONV_VALIDATION` | `unknown model: <provider>/<id>` |
| /api/providers 未登录 | 401 | `AUTH_REQUIRED` | （走现有 sessionMiddleware） |
| registry.list() 当时为空（理论上启动期已挡） | 503 | `PROVIDER_REGISTRY_EMPTY` | 防御兜底 |

错误码沿用 `packages/server/src/errors.ts`，前端 `lib/api.ts` 现成 toast 处理够用。

### 6.3 日志
- registry register/skip 时 `fastify.log.info({ providers: registry.list().map(p=>p.id) })`。
- 拒绝 chat 请求时不要把 provider id 之外的 config 落日志（避免 leak token）。

### 6.4 前端降级
- `useProviders()` 401 走现有 401 拦截 → 跳登录。
- 200 但 providers 为空（防御）：NewConversationDialog 禁用提交 + "服务暂不可用，请联系管理员"。
- 旧会话的 provider 不在响应里：见 §5.3。

---

## 7. 测试矩阵

### 7.1 单元测试

**`packages/server/src/providers/registry.test.ts`（新）**
- register 重复 id 抛错
- get 不存在抛 `AppError(400, CONV_VALIDATION)`
- has / list 行为
- `createDefaultRegistry`：
  - 两个 key 都有 → 注册两个
  - 仅 anthropicAuthToken → 仅 aiwoo-claude
  - 仅 openaiApiKey → 仅 aiwoo-codex
  - 都没有 → 空 registry（不抛错；启动校验在 server.ts 抛）

**`packages/shared/src/providers/models.test.ts`（扩展）**
- 每个 ModelMeta 的 capability 字段都齐
- `findModel` 命中/未命中
- contextWindow 为正整数
- (sanity) PROVIDER_MODELS 至少各 1 条

### 7.2 集成测试

**`packages/server/src/routes/providers.test.ts`（新）**
- 未登录 → 401
- 登录后 → 结构正确，defaultProviderId/defaultModel 与 fixture config 一致
- fixture 只配 codex key → 响应仅含 codex
- defaultProvider 不在 registry 时，响应 defaultProviderId 是 fallback 值

**`packages/server/src/routes/messages.test.ts`（扩展）**
- happy path 不变
- conversation provider 在 registry 中缺失 → 400 `CONV_VALIDATION`
- unknown model → 400（确认重构未破坏现有行为）

**`packages/server/src/routes/conversations.test.ts`（扩展）**
- provider 未注册 / model 未知 各一条

### 7.3 启动期测试

- 空 registry 启动抛 Error，message 含 `no provider registered`
- defaultProvider 不在 registry：启动后 `config.defaultProvider` fallback 到 `list()[0].id`，spy log 断言 warn 已记录

### 7.4 前端测试

- `web/src/lib/providers.test.ts`（新，仅纯函数）：
  - 解析响应 → flatten 出 model options 的 helper
  - default 选择 helper（NewConversationDialog 用）
- 不引入 React Testing Library；UI 行为靠 §8.3 手测覆盖。

### 7.5 不测的（YAGNI）
- aiwoo 上游 SSE / token 计算（6a 不动这条路径）
- 多 key 轮询 / usage_logs（不在范围）
- contextWindow 截断（不在范围）

---

## 8. 部署 / 上线 / 回滚

### 8.1 数据库 migration
- **0 改动**。本 phase 不写新 SQL。

### 8.2 env 变化
- 不新增任何 env。
- 运营临时屏蔽 provider：清空对应 key + `systemctl restart server-agent`。

### 8.3 部署节奏
1. worktree 分支按 plan 推进，commit 颗粒按 plan 任务粒度。
2. 四件套绿后 push main → GH Actions → 自动部署。
3. 部署后健康检查：
   ```bash
   curl https://aicoolyun.vip/api/health
   curl -b cookie.txt https://aicoolyun.vip/api/providers
   ```
4. 浏览器手测：
   - 新建会话 → 模型下拉来自 /api/providers
   - 发消息（codex 走 happy path）
   - skill 表单 default_provider/default_model 下拉同上
   - 旧会话打开不崩；指向已停用 provider 时发消息按 §5.3 toast

### 8.4 回滚
- 纯后端重构 + 前端只读消费，**无不可逆动作**（无 schema 变更）。
- `deploy-agent.sh` 的 `/api/health × 10` 自动回滚（AGENTS §3.1）兜底。
- 若 /api/providers 出问题但 health 仍绿：`journalctl -u server-agent | grep providers` 排查 → 改 main 重新部署。

### 8.5 AGENTS.md 沉淀（实现完成后写）
- §6 末尾加新坑（按编号续）："**加新 provider 的标准步骤**"：
  1. `shared/providers/models.ts` 加 ModelMeta（含 capability + contextWindow）
  2. `server/providers/` 写新 adapter（实现 ProviderAdapter）
  3. `server/providers/registry.ts` createDefaultRegistry 中 register（带 env key 守卫）
- 路线图 Phase 6 拆 6a（done） + 6b（next 前端打磨），README 同步。
- 实现期间踩到的新坑按惯例落 AGENTS §6。

---

## 9. 验收 checklist（Phase 6a 收尾）

- [ ] `npm run lint && typecheck && test && build` 全绿
- [ ] /api/providers 登录返回结构正确；未登录 401
- [ ] /api/providers 仅返回 env key 齐的 provider（手测：清空一个 key restart 验一次）
- [ ] 新建会话 / 编辑 skill 默认值的下拉走 `useProviders()`，前端无 `PROVIDER_MODELS` 常量 import
- [ ] aiwoo codex 真实上游 happy path 跑通（消息发出 + SSE 接到 + 入库）
- [ ] 启动校验：空 env 启动直接退出（fixture 测 + 手测一次）
- [ ] AGENTS §6 + 路线图 + README 同步

---

## 10. 风险

- **R1 capability 占位值与 aiwoo 上游实际能力对不上**。缓解：实现时按 aiwoo 文档/curl 实测核对一次；6b 多模态接入时还会再验一次。
- **R2 旧会话指向已停用 provider 体验不佳**。缓解：列表显示"已停用"灰标 + 发消息时 toast；不做静默切换避免破坏可预期性。
- **R3 env key 撤掉后启动期 warn 没人看到**。缓解：log 关键字 "DEFAULT_PROVIDER not in registry" 容易 grep；上线手测覆盖（§8.3）。
- **R4 registry 重构改动了 `ProviderAdapter.id` 类型**。缓解：全仓 grep 现有用法（已确认仅 sse-parser 日志使用），单测覆盖；CI 跑 typecheck 兜底。
