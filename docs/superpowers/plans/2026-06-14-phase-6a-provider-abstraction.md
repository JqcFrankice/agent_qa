# Phase 6a — Provider 抽象通用化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 provider/model 从硬编码常量解耦成 ProviderRegistry class + capability metadata + `/api/providers` 路由；前端三处下拉迁移到 `useProviders()`。加新 provider 不改 routes，加新模型不改前端。

**Architecture:** 后端 `ProviderRegistry`（class，register/has/get/list）取代 `Record<string, ProviderAdapter>`；`createDefaultRegistry(config)` 按 env key 是否为占位/缺失决定是否注册 aiwoo-claude / aiwoo-codex；`shared/providers/models.ts` 升级为 `ModelMeta { id, label, capabilities, contextWindow }`；`/api/providers` 登录后返回当前 registry 拼模型表 + 默认值；前端 React Query hook 消费。启动期 fail-fast：空 registry 抛错；defaultProvider 不在 registry 时 warn + fallback 到 list()[0]。

**Tech Stack:** Fastify 4 / Drizzle / better-sqlite3 / vitest / React 18 / TanStack Query / zod / TypeScript

**Spec:** [`docs/superpowers/specs/2026-06-14-phase-6a-provider-abstraction-design.md`](../specs/2026-06-14-phase-6a-provider-abstraction-design.md)

---

## File Structure

### Will create
- `packages/shared/src/schemas/providers.ts` — zod `ProvidersResponseSchema` + `ProvidersResponseDto`
- `packages/server/src/routes/providers.ts` — `GET /api/providers`
- `packages/server/tests/unit/providers/registry.test.ts` — `ProviderRegistry` class 单测
- `packages/server/tests/integration/providers.test.ts` — `/api/providers` 路由集成测试
- `packages/server/tests/integration/startup.test.ts` — 空 registry / defaultProvider fallback 启动校验
- `packages/web/src/lib/providers.ts` — `useProviders()` hook + flatten/default helper
- `packages/web/src/lib/providers.test.ts` — providers hook 周边纯函数测试

### Will modify
- `packages/shared/src/providers/models.ts` — 加 `ModelCapabilities` / `ModelMeta`，PROVIDER_MODELS 升级，导出 `findModel`
- `packages/shared/src/schemas/conversations.ts` — `providerIdSchema` 不动；DTO 类型同步（如需）
- `packages/shared/src/schemas/index.ts` — export `providers.js`
- `packages/server/src/providers/types.ts` — `ProviderAdapter.id: string`，加 `RegisteredProvider`
- `packages/server/src/providers/registry.ts` — 重写为 `ProviderRegistry` class + `createDefaultRegistry`
- `packages/server/src/config.ts` — `ANTHROPIC_AUTH_TOKEN` / `OPENAI_API_KEY` 改为 optional + 占位识别；`DEFAULT_PROVIDER` 类型放宽为 string；`AppConfig.defaultProvider` 改 string
- `packages/server/src/server.ts` — buildApp 接 `ProviderRegistry`；启动期 fail-fast + fallback；注册 providers 路由
- `packages/server/src/routes/messages.ts` — 注入 `ProviderRegistry`，校验 `registry.has(provider)`
- `packages/server/src/routes/conversations.ts` — 注入 `ProviderRegistry`，运行时校验 `registry.has`
- `packages/server/src/routes/skills.ts` — 注入 `ProviderRegistry`，校验 defaultProvider/defaultModel
- `packages/web/src/routes/chat/NewConversationDialog.tsx` — 模型下拉换 useProviders()
- `packages/web/src/routes/chat/index.tsx` — 模型下拉换 useProviders()
- `packages/web/src/routes/chat/SkillFormDialog.tsx` — 默认 provider/model 下拉换 useProviders()
- 现存测试 helper（`tests/integration/messages-stream.test.ts` 等）的 `fakeRegistry()` 形态 → 返回 `ProviderRegistry`

### Won't touch
- `packages/server/src/providers/aiwoo-claude.ts`
- `packages/server/src/providers/aiwoo-codex.ts`
- `packages/server/src/providers/sse-parser.ts`
- 任何 `db/migrations/*.sql`（本 phase 0 改动 schema）

---

## Conventions

- 每个任务一个 commit，message 格式 `feat|test|chore|refactor(scope): ...`。
- 严格 TDD：先写失败测试 → 跑确认失败 → 实现 → 跑确认通过 → commit。
- 实现期间 `npm run typecheck && npm test -- <file>` 在每个 task 末尾跑一次（仅相关包），最后一个任务跑全套四件套。
- 提交全部完成 + 四件套绿后 push origin/main → 自动部署。

---

### Task 1: 升级 `shared/providers/models.ts` — 加 ModelMeta + capabilities

**Files:**
- Modify: `packages/shared/src/providers/models.ts`
- Test: `packages/shared/src/providers/models.test.ts`

- [ ] **Step 1: 写失败测试**

把 `packages/shared/src/providers/models.test.ts` 替换成：

```ts
import { describe, expect, it } from "vitest";
import {
  PROVIDER_MODELS,
  findModel,
  isKnownProvider,
  isKnownProviderModel,
  type ProviderId
} from "./models.js";

describe("PROVIDER_MODELS", () => {
  it("each provider has at least one model", () => {
    expect(PROVIDER_MODELS["aiwoo-claude"].length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS["aiwoo-codex"].length).toBeGreaterThan(0);
  });

  it("every model carries capabilities and contextWindow", () => {
    const all = (Object.keys(PROVIDER_MODELS) as ProviderId[]).flatMap((p) => PROVIDER_MODELS[p]);
    for (const model of all) {
      expect(typeof model.id).toBe("string");
      expect(typeof model.label).toBe("string");
      expect(typeof model.capabilities.vision).toBe("boolean");
      expect(typeof model.capabilities.attachments).toBe("boolean");
      expect(typeof model.capabilities.toolCall).toBe("boolean");
      expect(model.contextWindow).toBeGreaterThan(0);
    }
  });
});

describe("findModel", () => {
  it("returns metadata for a known provider+model", () => {
    const meta = findModel("aiwoo-claude", "claude-opus-4-8");
    expect(meta).toBeDefined();
    expect(meta?.label).toMatch(/claude/i);
  });

  it("returns undefined for unknown provider", () => {
    expect(findModel("nope", "claude-opus-4-8")).toBeUndefined();
  });

  it("returns undefined for unknown model", () => {
    expect(findModel("aiwoo-claude", "nope")).toBeUndefined();
  });
});

describe("isKnownProvider / isKnownProviderModel", () => {
  it("isKnownProvider gates the union", () => {
    expect(isKnownProvider("aiwoo-claude")).toBe(true);
    expect(isKnownProvider("nope")).toBe(false);
  });
  it("isKnownProviderModel checks both", () => {
    expect(isKnownProviderModel("aiwoo-claude", "claude-opus-4-8")).toBe(true);
    expect(isKnownProviderModel("aiwoo-claude", "nope")).toBe(false);
    expect(isKnownProviderModel("nope", "claude-opus-4-8")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```
npm test -w @server-agent/shared -- providers/models.test.ts
```

预期：编译失败（`findModel` 未导出 / `ModelMeta` 类型未定义 / `capabilities` 属性不存在）。

- [ ] **Step 3: 升级 `models.ts` 实现**

把 `packages/shared/src/providers/models.ts` 替换成：

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
  contextWindow: number;
}

export const PROVIDER_MODELS: Record<"aiwoo-claude" | "aiwoo-codex", readonly ModelMeta[]> = {
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
} as const;

export type ProviderId = keyof typeof PROVIDER_MODELS;
export type ProviderModel = (typeof PROVIDER_MODELS)[ProviderId][number]["id"];

export const DEFAULT_PROVIDER_ID: ProviderId = "aiwoo-claude";

export function isKnownProvider(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDER_MODELS, value);
}

export function findModel(provider: string, id: string): ModelMeta | undefined {
  if (!isKnownProvider(provider)) return undefined;
  return PROVIDER_MODELS[provider].find((m) => m.id === id);
}

export function isKnownProviderModel(provider: string, model: string): boolean {
  return findModel(provider, model) !== undefined;
}
```

- [ ] **Step 4: 跑测试确认通过**

```
npm test -w @server-agent/shared -- providers/models.test.ts
```

预期：6 个用例全过。

- [ ] **Step 5: 跑 typecheck（shared 影响下游）**

```
npm run typecheck
```

预期：因为 PROVIDER_MODELS 形态变了，使用方仍然只读 `id` / `label`，应该全过；如果有报错记下，**留给后续相关 task 处理**（messages/conversations 等任务都会改），不在本 task 改其它包。如果 typecheck 报错只在 shared 内，必须在本 task 修复。

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/providers/models.ts packages/shared/src/providers/models.test.ts
git commit -m "feat(shared): ModelMeta + capabilities + findModel"
```

---

### Task 2: 写 `ProvidersResponseSchema`（zod 共享 schema）

**Files:**
- Create: `packages/shared/src/schemas/providers.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Test: `packages/shared/src/schemas/providers.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/shared/src/schemas/providers.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { providersResponseSchema } from "./providers.js";

describe("providersResponseSchema", () => {
  it("accepts a valid response", () => {
    const ok = providersResponseSchema.safeParse({
      providers: [
        {
          id: "aiwoo-claude",
          label: "Aiwoo Claude",
          models: [
            {
              id: "claude-opus-4-8",
              label: "Claude Opus 4.8",
              capabilities: { vision: true, attachments: false, toolCall: false },
              contextWindow: 200000
            }
          ]
        }
      ],
      defaultProviderId: "aiwoo-claude",
      defaultModel: "claude-opus-4-8"
    });
    expect(ok.success).toBe(true);
  });

  it("rejects when capabilities missing", () => {
    const bad = providersResponseSchema.safeParse({
      providers: [{ id: "x", label: "x", models: [{ id: "y", label: "y", contextWindow: 1 }] }],
      defaultProviderId: "x",
      defaultModel: "y"
    });
    expect(bad.success).toBe(false);
  });

  it("rejects when contextWindow not positive", () => {
    const bad = providersResponseSchema.safeParse({
      providers: [{
        id: "x", label: "x",
        models: [{ id: "y", label: "y",
          capabilities: { vision: false, attachments: false, toolCall: false }, contextWindow: 0 }]
      }],
      defaultProviderId: "x",
      defaultModel: "y"
    });
    expect(bad.success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```
npm test -w @server-agent/shared -- schemas/providers.test.ts
```

预期：模块找不到（`Cannot find module './providers.js'`）。

- [ ] **Step 3: 写实现**

新建 `packages/shared/src/schemas/providers.ts`：

```ts
import { z } from "zod";

export const modelCapabilitiesSchema = z.object({
  vision: z.boolean(),
  attachments: z.boolean(),
  toolCall: z.boolean()
});

export const providerModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  capabilities: modelCapabilitiesSchema,
  contextWindow: z.number().int().positive()
});

export const providerInfoSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  models: z.array(providerModelSchema).min(1)
});

export const providersResponseSchema = z.object({
  providers: z.array(providerInfoSchema),
  defaultProviderId: z.string().min(1),
  defaultModel: z.string().min(1)
});

export type ProvidersResponseDto = z.infer<typeof providersResponseSchema>;
export type ProviderInfoDto = z.infer<typeof providerInfoSchema>;
export type ProviderModelDto = z.infer<typeof providerModelSchema>;
```

修改 `packages/shared/src/schemas/index.ts`，加最后一行：

```ts
export * from "./auth.js";
export * from "./user.js";
export * from "./conversations.js";
export * from "./skills.js";
export * from "./providers.js";
```

- [ ] **Step 4: 跑测试确认通过**

```
npm test -w @server-agent/shared -- schemas/providers.test.ts
npm run typecheck
```

预期：3 用例过；shared 包 typecheck 全过。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/providers.ts packages/shared/src/schemas/providers.test.ts packages/shared/src/schemas/index.ts
git commit -m "feat(shared): providersResponseSchema (zod) + DTO types"
```

---

### Task 3: 重写 `providers/registry.ts` — ProviderRegistry class（不含 createDefaultRegistry）

**Files:**
- Modify: `packages/server/src/providers/types.ts`
- Modify: `packages/server/src/providers/registry.ts`
- Create: `packages/server/tests/unit/providers/registry.test.ts`

- [ ] **Step 1: 把 `ProviderAdapter.id` 由字面量改为 string**

`packages/server/src/providers/types.ts` 改为：

```ts
export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  signal: AbortSignal;
}

export interface ChatStreamEvent {
  type: "delta" | "done" | "error";
  textDelta?: string;
  finishReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  providerMessageId?: string;
  error?: { code: string; message: string };
}

export interface ProviderAdapter {
  readonly id: string;
  stream(req: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

export interface RegisteredProvider {
  id: string;
  label: string;
  adapter: ProviderAdapter;
}
```

- [ ] **Step 2: 写失败测试 — registry class 行为**

新建 `packages/server/tests/unit/providers/registry.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../../../src/providers/registry.js";
import type { ChatRequest, ChatStreamEvent, ProviderAdapter } from "../../../src/providers/types.js";
import { AppError } from "../../../src/errors.js";

function fakeAdapter(id: string): ProviderAdapter {
  return {
    id,
    async *stream(_req: ChatRequest): AsyncIterable<ChatStreamEvent> {
      yield { type: "done" };
    }
  };
}

describe("ProviderRegistry", () => {
  it("register / has / get / list happy path", () => {
    const reg = new ProviderRegistry();
    const claude = fakeAdapter("aiwoo-claude");
    reg.register({ id: "aiwoo-claude", label: "Aiwoo Claude", adapter: claude });

    expect(reg.has("aiwoo-claude")).toBe(true);
    expect(reg.has("aiwoo-codex")).toBe(false);
    expect(reg.get("aiwoo-claude")).toBe(claude);

    const codex = fakeAdapter("aiwoo-codex");
    reg.register({ id: "aiwoo-codex", label: "Aiwoo Codex", adapter: codex });
    expect(reg.list().map((p) => p.id)).toEqual(["aiwoo-claude", "aiwoo-codex"]);
  });

  it("register throws on duplicate id", () => {
    const reg = new ProviderRegistry();
    reg.register({ id: "x", label: "x", adapter: fakeAdapter("x") });
    expect(() => reg.register({ id: "x", label: "y", adapter: fakeAdapter("x") })).toThrow(/duplicate/i);
  });

  it("get throws AppError(400, CONV_VALIDATION) for unknown id", () => {
    const reg = new ProviderRegistry();
    let thrown: unknown;
    try {
      reg.get("nope");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    const app = thrown as AppError;
    expect(app.statusCode).toBe(400);
    expect(app.code).toBe("CONV_VALIDATION");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```
npm test -w @server-agent/server -- providers/registry.test.ts
```

预期：编译失败（`ProviderRegistry` 是函数 + Record，不是 class）。

- [ ] **Step 4: 重写 `registry.ts`**

把 `packages/server/src/providers/registry.ts` 替换成：

```ts
import { AiwooClaudeAdapter } from "./aiwoo-claude.js";
import { AiwooCodexAdapter } from "./aiwoo-codex.js";
import type { ProviderAdapter, RegisteredProvider } from "./types.js";
import { AppError } from "../errors.js";
import type { AppConfig } from "../config.js";

export class ProviderRegistry {
  private readonly entries = new Map<string, RegisteredProvider>();

  register(entry: RegisteredProvider): void {
    if (this.entries.has(entry.id)) {
      throw new Error(`duplicate provider id: ${entry.id}`);
    }
    this.entries.set(entry.id, entry);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): ProviderAdapter {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new AppError(400, "CONV_VALIDATION", `provider not available: ${id}`);
    }
    return entry.adapter;
  }

  list(): RegisteredProvider[] {
    return Array.from(this.entries.values());
  }
}

// createDefaultRegistry 在 Task 4 添加
```

> 旧的 `getProvider` 函数在 Task 5 改用 `registry.get` 时一并清理；本 task 暂保留对外签名空缺，下游 import 暂未失效（仍能 import `ProviderRegistry`）。

- [ ] **Step 5: 跑测试确认通过**

```
npm test -w @server-agent/server -- providers/registry.test.ts
```

预期：3 用例过。

> 此时 `server.ts` / `routes/messages.ts` / `tests/integration/messages-stream.test.ts` 还在 import 旧 `getProvider` / `createProviderRegistry`，会编译失败。**这是预期的**，由 Task 4-7 修复。typecheck 在每个 task 末尾跑，不在本 task 强制全绿。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/providers/types.ts packages/server/src/providers/registry.ts packages/server/tests/unit/providers/registry.test.ts
git commit -m "refactor(server): ProviderRegistry class (register/has/get/list)"
```

---

### Task 4: 加 `createDefaultRegistry(config)` + config env 占位识别

**Files:**
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/providers/registry.ts`
- Modify: `packages/server/tests/unit/providers/registry.test.ts`（追加用例）

- [ ] **Step 1: 改 config 让 token 字段可识别"未配置"**

把 `packages/server/src/config.ts` 的 schema / AppConfig / loadConfig 改成：

```ts
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().min(1).default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DB_PATH: z.string().min(1).default(":memory:"),
  SESSION_COOKIE_SECRET: z.string().min(1).default("test-session-secret"),
  ANTHROPIC_AUTH_TOKEN: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  AIWOO_BASE_URL: z.string().url().default("https://aiwoo.vip"),
  DEFAULT_PROVIDER: z.string().min(1).default("aiwoo-claude"),
  DEFAULT_MODEL: z.string().min(1).default("claude-opus-4-8"),
  UPSTREAM_FIRST_BYTE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000)
});

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  dbPath: string;
  sessionCookieSecret: string;
  anthropicAuthToken: string;
  openaiApiKey: string;
  aiwooBaseUrl: string;
  defaultProvider: string;
  defaultModel: string;
  upstreamFirstByteTimeoutMs: number;
  publicDir: string;
  gitSha: string;
  buildTime: string;
}
```

并把 `loadConfig` 中的 `isKnownProviderModel(...)` 守卫**删除**（启动期校验由 `server.ts` 接管，因为现在 registry 决定哪些 provider 真的可用）。

> `validateProductionSecrets` 保留不动；ANTHROPIC_AUTH_TOKEN 和 OPENAI_API_KEY 不再有 default 占位值，**测试运行时**靠 `tests/helpers/env.ts` 之类的固定 env，本 plan Task 6 会在 buildApp 注入 fixture registry 来绕过。如果 `tests/server.smoke.test.ts` 因为 ANTHROPIC_AUTH_TOKEN/OPENAI_API_KEY 默认空导致 registry 空启动报错，在 Task 6 修复测试时一起处理。

- [ ] **Step 2: 写失败测试 — createDefaultRegistry 行为**

把 `packages/server/tests/unit/providers/registry.test.ts` 末尾追加：

```ts
import { createDefaultRegistry } from "../../../src/providers/registry.js";
import type { AppConfig } from "../../../src/config.js";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0, host: "127.0.0.1", nodeEnv: "test", logLevel: "info",
    dbPath: ":memory:", sessionCookieSecret: "test-session-secret",
    anthropicAuthToken: "", openaiApiKey: "",
    aiwooBaseUrl: "https://aiwoo.vip",
    defaultProvider: "aiwoo-claude", defaultModel: "claude-opus-4-8",
    upstreamFirstByteTimeoutMs: 30000,
    publicDir: "/tmp", gitSha: "test", buildTime: "test",
    ...overrides
  };
}

describe("createDefaultRegistry", () => {
  it("registers both providers when both keys are set", () => {
    const reg = createDefaultRegistry(makeConfig({ anthropicAuthToken: "k1", openaiApiKey: "k2" }));
    expect(reg.list().map((p) => p.id).sort()).toEqual(["aiwoo-claude", "aiwoo-codex"]);
  });

  it("registers only aiwoo-claude when only anthropic token is set", () => {
    const reg = createDefaultRegistry(makeConfig({ anthropicAuthToken: "k1", openaiApiKey: "" }));
    expect(reg.list().map((p) => p.id)).toEqual(["aiwoo-claude"]);
  });

  it("registers only aiwoo-codex when only openai key is set", () => {
    const reg = createDefaultRegistry(makeConfig({ anthropicAuthToken: "", openaiApiKey: "k2" }));
    expect(reg.list().map((p) => p.id)).toEqual(["aiwoo-codex"]);
  });

  it("registers nothing when both keys are empty (does not throw)", () => {
    const reg = createDefaultRegistry(makeConfig({ anthropicAuthToken: "", openaiApiKey: "" }));
    expect(reg.list()).toEqual([]);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```
npm test -w @server-agent/server -- providers/registry.test.ts
```

预期：`createDefaultRegistry` 未导出。

- [ ] **Step 4: 在 `registry.ts` 末尾加实现**

```ts
export function createDefaultRegistry(config: AppConfig): ProviderRegistry {
  const registry = new ProviderRegistry();

  if (config.anthropicAuthToken && config.anthropicAuthToken.length > 0) {
    registry.register({
      id: "aiwoo-claude",
      label: "Aiwoo Claude",
      adapter: new AiwooClaudeAdapter({
        baseUrl: config.aiwooBaseUrl,
        authToken: config.anthropicAuthToken,
        firstByteTimeoutMs: config.upstreamFirstByteTimeoutMs
      })
    });
  }

  if (config.openaiApiKey && config.openaiApiKey.length > 0) {
    registry.register({
      id: "aiwoo-codex",
      label: "Aiwoo Codex",
      adapter: new AiwooCodexAdapter({
        baseUrl: config.aiwooBaseUrl,
        apiKey: config.openaiApiKey,
        firstByteTimeoutMs: config.upstreamFirstByteTimeoutMs
      })
    });
  }

  return registry;
}
```

> 注意：旧的 `createProviderRegistry`（返回 Record）和 `getProvider` 函数**整体删除**。下游 import 由 Task 5-7 修复。

- [ ] **Step 5: 跑测试确认通过**

```
npm test -w @server-agent/server -- providers/registry.test.ts
```

预期：4 个 createDefaultRegistry 用例 + 之前 3 个 ProviderRegistry 用例 全过。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/config.ts packages/server/src/providers/registry.ts packages/server/tests/unit/providers/registry.test.ts
git commit -m "feat(server): createDefaultRegistry by env key + relax config defaults"
```

---

### Task 5: `messages` route 接入 ProviderRegistry + 修测试 helper

**Files:**
- Modify: `packages/server/src/routes/messages.ts`
- Modify: `packages/server/tests/integration/messages-stream.test.ts`

- [ ] **Step 1: 改 messages route**

把 `packages/server/src/routes/messages.ts` 顶部 import + `MessageRouteDeps` + adapter 取值替换为：

```ts
import type { FastifyPluginAsync } from "fastify";
import { createMessageRequestSchema, findModel } from "@server-agent/shared";
import type { AppDb } from "../db/client.js";
import { ConversationsRepository } from "../db/repositories/conversations.js";
import { MessagesRepository } from "../db/repositories/messages.js";
import { AppError, errorBody } from "../errors.js";
import { checkRateLimit } from "../middleware/rate-limit.js";
import { requireUser } from "../middleware/session.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ChatMessage } from "../providers/types.js";

interface MessageRouteDeps {
  db: AppDb;
  providerRegistry: ProviderRegistry;
  defaultProvider: string;
}
```

把原来的 `const adapter = getProvider(deps.providerRegistry, conversation.provider);` 替换为：

```ts
if (!deps.providerRegistry.has(conversation.provider)) {
  const error = new AppError(400, "CONV_VALIDATION", `provider not available: ${conversation.provider}`);
  return reply.code(error.statusCode).send(errorBody(error));
}
const meta = findModel(conversation.provider, conversation.model);
if (!meta) {
  const error = new AppError(400, "CONV_VALIDATION", `unknown model: ${conversation.provider}/${conversation.model}`);
  return reply.code(error.statusCode).send(errorBody(error));
}
const adapter = deps.providerRegistry.get(conversation.provider);
```

> 校验放在 `reply.hijack()` 之前，失败走标准 400 JSON 响应；不要把校验放进 SSE。

- [ ] **Step 2: 改 messages-stream 集成测试 helper**

`packages/server/tests/integration/messages-stream.test.ts` 顶部 helper 改为：

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { InviteRepository } from "../../src/db/repositories/invites.js";
import { MessagesRepository } from "../../src/db/repositories/messages.js";
import { buildApp } from "../../src/server.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import type { ChatRequest, ChatStreamEvent, ProviderAdapter } from "../../src/providers/types.js";

type TestApp = Awaited<ReturnType<typeof buildApp>>;

function fakeRegistry(events: ChatStreamEvent[]): ProviderRegistry {
  const adapter: ProviderAdapter = {
    id: "aiwoo-claude",
    async *stream(_req: ChatRequest): AsyncIterable<ChatStreamEvent> {
      for (const event of events) yield event;
    }
  };
  const reg = new ProviderRegistry();
  reg.register({ id: "aiwoo-claude", label: "Aiwoo Claude", adapter });
  reg.register({ id: "aiwoo-codex", label: "Aiwoo Codex", adapter });
  return reg;
}

function slowRegistry(): ProviderRegistry {
  const adapter: ProviderAdapter = {
    id: "aiwoo-claude",
    async *stream(req: ChatRequest): AsyncIterable<ChatStreamEvent> {
      for (let i = 0; i < 100; i++) {
        if (req.signal.aborted) return;
        yield { type: "delta", textDelta: `chunk${i} ` };
        await new Promise<void>((resolveDelay, rejectDelay) => {
          const timer = setTimeout(resolveDelay, 50);
          req.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            rejectDelay(new DOMException("aborted", "AbortError"));
          }, { once: true });
        });
      }
    }
  };
  const reg = new ProviderRegistry();
  reg.register({ id: "aiwoo-claude", label: "Aiwoo Claude", adapter });
  reg.register({ id: "aiwoo-codex", label: "Aiwoo Codex", adapter });
  return reg;
}
```

把 `setup()` 改成：当未传 registry 时给一个默认 fakeRegistry（避免空 env 导致 buildApp 抛 "no provider registered"）：

```ts
async function setup(username: string, registry?: ProviderRegistry) {
  const db = createTestDb();
  await new InviteRepository(db).create({ code: "ABCDEFGHJKLM", usesRemaining: 10, createdBy: "test", note: "it" });
  const app = await buildApp({ db, providerRegistry: registry ?? fakeRegistry([{ type: "done" }]) });
  const cookie = await registerAndLogin(app, username);
  return { app, db, cookie };
}
```

- [ ] **Step 3: 跑测试**

```
npm test -w @server-agent/server -- integration/messages-stream
```

预期：messages-stream 现有用例全过；如果 buildApp 还在报"no provider registered" 这是因为 buildApp 改造在 Task 6 完成 — 跑这一步时如果失败，**记录但不阻塞**，Task 6 会完成 buildApp 改造。

> 此时 conversations.test.ts / startup.test.ts 还没准备好接 ProviderRegistry，先不跑那两个。

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/messages.ts packages/server/tests/integration/messages-stream.test.ts
git commit -m "refactor(server): messages route consumes ProviderRegistry + runtime has() check"
```

---

### Task 6: 改 `server.ts` — buildApp 接 ProviderRegistry + 启动期 fail-fast

**Files:**
- Modify: `packages/server/src/server.ts`
- Create: `packages/server/tests/integration/startup.test.ts`

- [ ] **Step 1: 写失败测试 — 启动行为**

新建 `packages/server/tests/integration/startup.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { buildApp } from "../../src/server.js";
import type { ChatRequest, ChatStreamEvent, ProviderAdapter } from "../../src/providers/types.js";

function fakeAdapter(id: string): ProviderAdapter {
  return {
    id,
    async *stream(_req: ChatRequest): AsyncIterable<ChatStreamEvent> {
      yield { type: "done" };
    }
  };
}

describe("server startup", () => {
  it("throws when registry is empty", async () => {
    const db = createTestDb();
    const empty = new ProviderRegistry();
    await expect(buildApp({ db, providerRegistry: empty })).rejects.toThrow(/no provider registered/i);
  });

  it("falls back when defaultProvider is not registered", async () => {
    const db = createTestDb();
    const reg = new ProviderRegistry();
    reg.register({ id: "aiwoo-codex", label: "Aiwoo Codex", adapter: fakeAdapter("aiwoo-codex") });
    process.env.DEFAULT_PROVIDER = "aiwoo-claude";
    process.env.DEFAULT_MODEL = "gpt-5.5";
    const app = await buildApp({ db, providerRegistry: reg });
    expect(app).toBeDefined();
    await app.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```
npm test -w @server-agent/server -- integration/startup
```

预期：因 buildApp 仍接 Record 类型，编译失败；或不抛 "no provider"。

- [ ] **Step 3: 改 server.ts**

把 `packages/server/src/server.ts` 替换为：

```ts
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import type { AppDb } from "./db/client.js";
import { openDatabase } from "./db/client.js";
import { markStreamingMessagesAborted } from "./db/cleanup.js";
import { SessionRepository } from "./db/repositories/sessions.js";
import { SkillsRepository } from "./db/repositories/skills.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { sessionMiddleware } from "./middleware/session.js";
import { ProviderRegistry, createDefaultRegistry } from "./providers/registry.js";
import { findModel, PROVIDER_MODELS, isKnownProvider } from "@server-agent/shared";
import authRoutes from "./routes/auth/index.js";
import conversationRoutes from "./routes/conversations.js";
import messageRoutes from "./routes/messages.js";
import skillsRoutes from "./routes/skills.js";
import adminSkillRoutes from "./routes/admin/skills.js";
import healthRoute from "./routes/health.js";
import versionRoute from "./routes/version.js";
import indexRoute from "./routes/index.js";

interface BuildAppOptions {
  db?: AppDb;
  providerRegistry?: ProviderRegistry;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const config = loadConfig();
  const registry = options.providerRegistry ?? createDefaultRegistry(config);

  if (registry.list().length === 0) {
    throw new Error("no provider registered: set ANTHROPIC_AUTH_TOKEN and/or OPENAI_API_KEY in agent.env");
  }

  if (!registry.has(config.defaultProvider)) {
    const fallback = registry.list()[0];
    logger.warn(
      { configured: config.defaultProvider, fallback: fallback.id },
      "DEFAULT_PROVIDER not in registry, falling back to first registered"
    );
    config.defaultProvider = fallback.id;
  }

  if (!findModel(config.defaultProvider, config.defaultModel)) {
    const provider = config.defaultProvider;
    if (isKnownProvider(provider)) {
      const firstModel = PROVIDER_MODELS[provider][0];
      if (firstModel) {
        logger.warn(
          { configured: config.defaultModel, fallback: firstModel.id },
          "DEFAULT_MODEL not valid for provider, falling back"
        );
        config.defaultModel = firstModel.id;
      }
    }
  }

  logger.info({ providers: registry.list().map((p) => p.id) }, "registered providers");

  const db = options.db ?? openDatabase(config.dbPath);
  await markStreamingMessagesAborted(db);
  const app = Fastify({ logger });

  await app.register(fastifyCookie, { secret: config.sessionCookieSecret });
  app.addHook("onRequest", sessionMiddleware(new SessionRepository(db)));

  await app.register(fastifyStatic, { root: config.publicDir, serve: false });
  await app.register(healthRoute, { prefix: "/api" });
  await app.register(versionRoute, {
    prefix: "/api",
    gitSha: config.gitSha,
    buildTime: config.buildTime,
    nodeEnv: config.nodeEnv
  });
  await app.register(authRoutes, {
    prefix: "/api/auth",
    db,
    secureCookies: config.nodeEnv === "production"
  });
  // Task 7 加 registry 字段；Task 8 加 providersRoute
  await app.register(conversationRoutes, { prefix: "/api", db, skills: new SkillsRepository(db) });
  await app.register(skillsRoutes, { prefix: "/api", db });
  await app.register(adminSkillRoutes, { prefix: "/api/admin", db });
  await app.register(messageRoutes, {
    prefix: "/api",
    db,
    providerRegistry: registry,
    defaultProvider: config.defaultProvider
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

- [ ] **Step 4: 跑测试确认通过**

```
npm test -w @server-agent/server -- integration/startup
npm test -w @server-agent/server -- integration/messages-stream
```

预期：startup 2 用例过；messages-stream 测试也过（fakeRegistry helper Task 5 已改）。

如果 conversations.test.ts 因为运行时未挂 registry 出现 schema 接受但运行 fail，那部分由 Task 7 处理；本 task 末尾不要求 conversations.test.ts 全绿。

- [ ] **Step 5: 跑 typecheck**

```
npm run typecheck -w @server-agent/server
```

预期：全过。如果 `routes/conversations.ts` / `routes/skills.ts` 还在 import `getProvider`/`PROVIDER_MODELS` 那部分 dead code 就删掉（这两个路由内部本来也没用 registry，Task 7 才加）。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/server.ts packages/server/tests/integration/startup.test.ts
git commit -m "feat(server): buildApp accepts ProviderRegistry + startup fail-fast/fallback"
```

---

### Task 7: `conversations` / `skills` route 接 ProviderRegistry，加运行时校验

**Files:**
- Modify: `packages/server/src/routes/conversations.ts`
- Modify: `packages/server/src/routes/skills.ts`
- Modify: `packages/server/src/server.ts`（恢复传 registry 给 conversations/skills）
- Modify: `packages/server/tests/integration/conversations.test.ts`（追加测试）

- [ ] **Step 1: 写失败测试 — conversations 运行时拒绝 unregistered provider**

`packages/server/tests/integration/conversations.test.ts` 末尾追加用例（在 `describe` 内最后一个 `it` 之前合适位置）：

```ts
import { ProviderRegistry } from "../../src/providers/registry.js";
import type { ChatRequest, ChatStreamEvent, ProviderAdapter } from "../../src/providers/types.js";

function codexOnlyRegistry(): ProviderRegistry {
  const adapter: ProviderAdapter = {
    id: "aiwoo-codex",
    async *stream(_req: ChatRequest): AsyncIterable<ChatStreamEvent> {
      yield { type: "done" };
    }
  };
  const reg = new ProviderRegistry();
  reg.register({ id: "aiwoo-codex", label: "Aiwoo Codex", adapter });
  return reg;
}
```

并加一条 `it`：

```ts
it("rejects creating a conversation with an unregistered provider (env key missing)", async () => {
  const db = createTestDb();
  await new InviteRepository(db).create({ code: "ABCDEFGHJKLM", usesRemaining: 10, createdBy: "test", note: "it" });
  const app = await buildApp({ db, providerRegistry: codexOnlyRegistry() });
  const cookie = await registerAndLogin(app, "alice");
  const res = await app.inject({
    method: "POST", url: "/api/conversations", headers: { cookie },
    payload: { provider: "aiwoo-claude", model: "claude-opus-4-8" }
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe("CONV_VALIDATION");
  expect(res.json().error.message).toMatch(/provider not available/i);
  await app.close();
});
```

- [ ] **Step 2: 跑测试确认失败**

```
npm test -w @server-agent/server -- integration/conversations
```

预期：上面用例返回 201（schema 接受 aiwoo-claude），需要运行时再校验。

- [ ] **Step 3: 改 `routes/conversations.ts`**

在 `ConversationRouteDeps` 加 `registry`，POST/PATCH 路由前加运行时校验：

```ts
import type { ProviderRegistry } from "../providers/registry.js";

interface ConversationRouteDeps {
  db: AppDb;
  skills: SkillsRepository;
  registry: ProviderRegistry;
}
```

POST `/conversations` handler 内 zod parse 通过后立刻加：

```ts
if (!deps.registry.has(parsed.data.provider)) {
  const error = new AppError(400, "CONV_VALIDATION", `provider not available: ${parsed.data.provider}`);
  return reply.code(error.statusCode).send(errorBody(error));
}
```

- [ ] **Step 4: 改 `routes/skills.ts`**

`SkillRouteDeps` 加 `registry`；POST `/skills` 与 PATCH `/skills/:id` zod parse 后、调用 `repo.create / update` 之前加：

```ts
const dp = parsed.data.defaultProvider;
if (dp && !deps.registry.has(dp)) {
  const error = new AppError(400, "SKILL_VALIDATION", `provider not available: ${dp}`);
  return reply.code(error.statusCode).send(errorBody(error));
}
```

> 不校验 `defaultModel`：现存 zod schema 已用 `providerIdSchema` + 自定义 model 字符串；运行时仅校 provider 是否启用就够（model 在 messages 路由真用时再校验）。

- [ ] **Step 5: 改 `server.ts`，传 registry 给 conversations / skills**

在 `app.register(conversationRoutes, ...)` 与 `app.register(skillsRoutes, ...)` 加 `registry` 字段：

```ts
await app.register(conversationRoutes, { prefix: "/api", db, skills: new SkillsRepository(db), registry });
await app.register(skillsRoutes, { prefix: "/api", db, registry });
```

- [ ] **Step 6: 跑测试确认通过**

```
npm test -w @server-agent/server -- integration/conversations
npm test -w @server-agent/server -- routes/skills
npm run typecheck -w @server-agent/server
```

预期：新加用例过；现有 conversations/skills 测试仍过。

> 现有 `tests/unit/routes/skills.test.ts` 如果直接 import `skillsRoutes` 并 register 时漏传 `registry`，会编译失败 — 在该文件 helper 里也补上 `registry: codexOnlyRegistry()` 或 `fakeRegistry()`（具体名称按文件现有 helper 命名），按需修一下并继续走绿。

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/conversations.ts packages/server/src/routes/skills.ts packages/server/src/server.ts packages/server/tests/integration/conversations.test.ts packages/server/tests/unit/routes/skills.test.ts
git commit -m "feat(server): conversations/skills routes runtime registry.has() check"
```

---

### Task 8: 加 `GET /api/providers` 路由 + 集成测试

**Files:**
- Create: `packages/server/src/routes/providers.ts`
- Create: `packages/server/tests/integration/providers.test.ts`
- Modify: `packages/server/src/server.ts`（解开 providersRoute import + register）

- [ ] **Step 1: 写失败测试**

新建 `packages/server/tests/integration/providers.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { InviteRepository } from "../../src/db/repositories/invites.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { buildApp } from "../../src/server.js";
import type { ChatRequest, ChatStreamEvent, ProviderAdapter } from "../../src/providers/types.js";

type TestApp = Awaited<ReturnType<typeof buildApp>>;

function fakeAdapter(id: string): ProviderAdapter {
  return {
    id,
    async *stream(_req: ChatRequest): AsyncIterable<ChatStreamEvent> {
      yield { type: "done" };
    }
  };
}

async function buildLoggedInApp(registry: ProviderRegistry, username = "alice") {
  const db = createTestDb();
  await new InviteRepository(db).create({ code: "ABCDEFGHJKLM", usesRemaining: 10, createdBy: "test", note: "it" });
  const app = await buildApp({ db, providerRegistry: registry });
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123", inviteCode: "ABCDEFGHJKLM" } });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "password123" } });
  const raw = login.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return { app, cookie: value!.split(";")[0] };
}

describe("GET /api/providers", () => {
  it("requires auth (401 without cookie)", async () => {
    const reg = new ProviderRegistry();
    reg.register({ id: "aiwoo-claude", label: "Aiwoo Claude", adapter: fakeAdapter("aiwoo-claude") });
    const db = createTestDb();
    const app = await buildApp({ db, providerRegistry: reg });
    const res = await app.inject({ method: "GET", url: "/api/providers" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns only registered providers + valid default", async () => {
    const reg = new ProviderRegistry();
    reg.register({ id: "aiwoo-codex", label: "Aiwoo Codex", adapter: fakeAdapter("aiwoo-codex") });
    process.env.DEFAULT_PROVIDER = "aiwoo-codex";
    process.env.DEFAULT_MODEL = "gpt-5.5";
    const { app, cookie } = await buildLoggedInApp(reg);
    const res = await app.inject({ method: "GET", url: "/api/providers", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providers.map((p: { id: string }) => p.id)).toEqual(["aiwoo-codex"]);
    expect(body.providers[0].models[0]).toMatchObject({
      id: "gpt-5.5",
      capabilities: { vision: false, attachments: true, toolCall: false }
    });
    expect(body.defaultProviderId).toBe("aiwoo-codex");
    expect(body.defaultModel).toBe("gpt-5.5");
    await app.close();
  });

  it("falls back defaultProviderId when configured one is unregistered", async () => {
    const reg = new ProviderRegistry();
    reg.register({ id: "aiwoo-codex", label: "Aiwoo Codex", adapter: fakeAdapter("aiwoo-codex") });
    process.env.DEFAULT_PROVIDER = "aiwoo-claude";
    process.env.DEFAULT_MODEL = "gpt-5.5";
    const { app, cookie } = await buildLoggedInApp(reg, "bob");
    const res = await app.inject({ method: "GET", url: "/api/providers", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().defaultProviderId).toBe("aiwoo-codex");
    await app.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```
npm test -w @server-agent/server -- integration/providers
```

预期：路由不存在 → 404。

- [ ] **Step 3: 写实现**

新建 `packages/server/src/routes/providers.ts`：

```ts
import type { FastifyPluginAsync } from "fastify";
import { PROVIDER_MODELS, isKnownProvider } from "@server-agent/shared";
import { requireUser } from "../middleware/session.js";
import type { ProviderRegistry } from "../providers/registry.js";

interface ProvidersRouteDeps {
  registry: ProviderRegistry;
  defaultProviderId: string;
  defaultModel: string;
}

const providersRoute: FastifyPluginAsync<ProvidersRouteDeps> = async (app, deps) => {
  app.get("/providers", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;

    const providers = deps.registry.list().map((p) => ({
      id: p.id,
      label: p.label,
      models: isKnownProvider(p.id) ? PROVIDER_MODELS[p.id].map((m) => ({ ...m })) : []
    }));

    return {
      providers,
      defaultProviderId: deps.defaultProviderId,
      defaultModel: deps.defaultModel
    };
  });
};

export default providersRoute;
```

- [ ] **Step 4: 在 `server.ts` 解开 providersRoute import + register**

加回 `import providersRoute from "./routes/providers.js";` 和：

```ts
await app.register(providersRoute, {
  prefix: "/api",
  registry,
  defaultProviderId: config.defaultProvider,
  defaultModel: config.defaultModel
});
```

放在 `authRoutes` 之后、`conversationRoutes` 之前（与原 Task 6 设计一致）。

- [ ] **Step 5: 跑测试确认通过**

```
npm test -w @server-agent/server -- integration/providers
npm run typecheck -w @server-agent/server
```

预期：3 用例过 + typecheck 全过。

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/providers.ts packages/server/tests/integration/providers.test.ts packages/server/src/server.ts
git commit -m "feat(server): GET /api/providers (auth required, registry-driven)"
```


---

### Task 9: 前端 — `useProviders()` hook + 纯函数 helper（先写测试）

**Files:**
- Create: `packages/web/src/lib/providers.ts`
- Create: `packages/web/src/lib/providers.test.ts`
- Modify: `packages/web/src/lib/api.ts`（加 `getProviders()` API 客户端方法）

- [ ] **Step 1: 加 API 客户端方法**

在 `packages/web/src/lib/api.ts` 末尾追加：

```ts
import type { ProvidersResponseDto } from "@server-agent/shared";

export function getProviders() {
  return request<ProvidersResponseDto>("/api/providers");
}
```

- [ ] **Step 2: 写失败测试**

新建 `packages/web/src/lib/providers.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { resolveDefaults, listProviderOptions, listModelOptions } from "./providers.js";
import type { ProvidersResponseDto } from "@server-agent/shared";

const sample: ProvidersResponseDto = {
  providers: [
    {
      id: "aiwoo-claude", label: "Aiwoo Claude",
      models: [
        { id: "claude-opus-4-8", label: "Claude Opus 4.8",
          capabilities: { vision: true, attachments: false, toolCall: false }, contextWindow: 200000 }
      ]
    },
    {
      id: "aiwoo-codex", label: "Aiwoo Codex",
      models: [
        { id: "gpt-5.5", label: "GPT-5.5",
          capabilities: { vision: false, attachments: true, toolCall: false }, contextWindow: 128000 }
      ]
    }
  ],
  defaultProviderId: "aiwoo-claude",
  defaultModel: "claude-opus-4-8"
};

describe("listProviderOptions", () => {
  it("returns id+label pairs in registry order", () => {
    expect(listProviderOptions(sample)).toEqual([
      { id: "aiwoo-claude", label: "Aiwoo Claude" },
      { id: "aiwoo-codex", label: "Aiwoo Codex" }
    ]);
  });
});

describe("listModelOptions", () => {
  it("returns models for the given provider", () => {
    expect(listModelOptions(sample, "aiwoo-codex").map((m) => m.id)).toEqual(["gpt-5.5"]);
  });
  it("returns [] for an unknown provider", () => {
    expect(listModelOptions(sample, "nope")).toEqual([]);
  });
});

describe("resolveDefaults", () => {
  it("uses skill default provider/model when both valid", () => {
    const r = resolveDefaults(sample, { skillProvider: "aiwoo-codex", skillModel: "gpt-5.5" });
    expect(r).toEqual({ provider: "aiwoo-codex", model: "gpt-5.5" });
  });

  it("falls back to global default when skill provider unknown", () => {
    const r = resolveDefaults(sample, { skillProvider: "nope", skillModel: "x" });
    expect(r).toEqual({ provider: "aiwoo-claude", model: "claude-opus-4-8" });
  });

  it("falls back to first model when skill model invalid for skill provider", () => {
    const r = resolveDefaults(sample, { skillProvider: "aiwoo-codex", skillModel: "nope" });
    expect(r).toEqual({ provider: "aiwoo-codex", model: "gpt-5.5" });
  });

  it("falls back to first registered provider when global default unknown", () => {
    const skewed: ProvidersResponseDto = { ...sample, defaultProviderId: "nope", defaultModel: "x" };
    const r = resolveDefaults(skewed, {});
    expect(r).toEqual({ provider: "aiwoo-claude", model: "claude-opus-4-8" });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```
npm test -w @server-agent/web -- lib/providers.test.ts
```

预期：`./providers.js` not found。

- [ ] **Step 4: 写实现**

新建 `packages/web/src/lib/providers.ts`：

```ts
import { useQuery } from "@tanstack/react-query";
import type { ProvidersResponseDto, ProviderModelDto } from "@server-agent/shared";
import { getProviders } from "./api.js";

export function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: getProviders,
    staleTime: Infinity,
    retry: false
  });
}

export function listProviderOptions(data: ProvidersResponseDto): { id: string; label: string }[] {
  return data.providers.map((p) => ({ id: p.id, label: p.label }));
}

export function listModelOptions(data: ProvidersResponseDto, providerId: string): ProviderModelDto[] {
  const p = data.providers.find((x) => x.id === providerId);
  return p ? [...p.models] : [];
}

export interface DefaultsHint {
  skillProvider?: string | null;
  skillModel?: string | null;
}

export function resolveDefaults(data: ProvidersResponseDto, hint: DefaultsHint): { provider: string; model: string } {
  const known = new Set(data.providers.map((p) => p.id));
  const pickProvider = (cand: string | null | undefined): string | null =>
    cand && known.has(cand) ? cand : null;

  const provider =
    pickProvider(hint.skillProvider ?? null) ??
    pickProvider(data.defaultProviderId) ??
    data.providers[0]?.id;

  if (!provider) return { provider: "", model: "" };

  const models = listModelOptions(data, provider);
  const modelKnown = (id: string | null | undefined) => !!id && models.some((m) => m.id === id);

  let model: string;
  if (provider === hint.skillProvider && modelKnown(hint.skillModel ?? null)) {
    model = hint.skillModel!;
  } else if (provider === data.defaultProviderId && modelKnown(data.defaultModel)) {
    model = data.defaultModel;
  } else {
    model = models[0]?.id ?? "";
  }

  return { provider, model };
}
```

- [ ] **Step 5: 跑测试确认通过**

```
npm test -w @server-agent/web -- lib/providers.test.ts
npm run typecheck -w @server-agent/web
```

预期：6 用例全过；typecheck 全过。

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/providers.ts packages/web/src/lib/providers.test.ts packages/web/src/lib/api.ts
git commit -m "feat(web): useProviders() hook + resolveDefaults helper"
```


---

### Task 10: 前端 — `NewConversationDialog` 迁移到 useProviders()

**Files:**
- Modify: `packages/web/src/routes/chat/NewConversationDialog.tsx`
- Modify: `packages/web/src/routes/chat/index.tsx`（去掉 ProviderId 类型 import 残留）

- [ ] **Step 1: 替换 NewConversationDialog 内部数据源**

把 `packages/web/src/routes/chat/NewConversationDialog.tsx` 替换为：

```tsx
import { useEffect, useState } from "react";
import type { SkillDto } from "@server-agent/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.js";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";
import { useProviders, listProviderOptions, listModelOptions, resolveDefaults } from "../../lib/providers.js";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { provider: string; model: string; systemPrompt?: string; skillId?: number }) => void;
  defaultProvider?: string;
  skill?: SkillDto | null;
  presetPrompt?: string | null;
}

export function NewConversationDialog({ open, onOpenChange, onCreate, defaultProvider, skill, presetPrompt }: NewConversationDialogProps) {
  const providersQuery = useProviders();

  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [systemPrompt, setSystemPrompt] = useState("");

  useEffect(() => {
    if (!open || !providersQuery.data) return;
    const data = providersQuery.data;
    const skillProvider = skill?.defaultProvider ?? defaultProvider ?? null;
    const skillModel = skill?.defaultModel ?? null;
    const { provider: p, model: m } = resolveDefaults(data, { skillProvider, skillModel });
    setProvider(p);
    setModel(m);

    if (presetPrompt !== null && presetPrompt !== undefined) {
      setSystemPrompt(presetPrompt);
    } else if (skill) {
      setSystemPrompt(skill.systemPrompt);
    } else {
      setSystemPrompt("");
    }
  }, [open, skill, defaultProvider, presetPrompt, providersQuery.data]);

  const onProviderChange = (next: string) => {
    setProvider(next);
    if (!providersQuery.data) return;
    const models = listModelOptions(providersQuery.data, next);
    setModel(models[0]?.id ?? "");
  };

  const submit = () => {
    if (!provider || !model) return;
    const trimmed = systemPrompt.trim();
    onCreate({
      provider,
      model,
      systemPrompt: trimmed ? trimmed : undefined,
      skillId: skill?.id
    });
    setSystemPrompt("");
  };

  if (!providersQuery.data) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{skill ? `基于 Skill「${skill.title}」新建会话` : "新建会话"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-400">
            {providersQuery.isError ? "加载服务商列表失败，请刷新页面" : "正在加载..."}
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  const data = providersQuery.data;
  const providerOptions = listProviderOptions(data);
  const modelOptions = listModelOptions(data, provider);
  const noProviders = providerOptions.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{skill ? `基于 Skill「${skill.title}」新建会话` : "新建会话"}</DialogTitle>
        </DialogHeader>
        {noProviders ? (
          <p className="text-sm text-zinc-400">服务暂不可用，请联系管理员</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-zinc-400">服务商</label>
              <select
                value={provider}
                onChange={(event) => onProviderChange(event.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              >
                {providerOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-400">模型</label>
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              >
                {modelOptions.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-400">System Prompt（可选）</label>
              <Textarea
                rows={3}
                maxLength={8000}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                placeholder="为该会话设置系统提示词"
              />
            </div>
            <Button className="w-full" onClick={submit} disabled={!provider || !model}>创建</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 调整 chat/index.tsx 中的类型 cast**

修改 `packages/web/src/routes/chat/index.tsx`：把 `import type { ProviderId, ... }` 中的 `ProviderId` 删掉；把第 ~242 行的 `as { provider: ProviderId; model: string; systemPrompt?: string; skillId?: number }` 改为 `as { provider: string; model: string; systemPrompt?: string; skillId?: number }`；如果 NewConversationDialog 接收的 `defaultProvider` 之前是 `ProviderId` 类型，改为 `string | undefined`。

> 不要扩大改动范围；除上述类型 cast 外不动其他逻辑。

- [ ] **Step 3: 跑 typecheck + 已有相关 unit test**

```
npm run typecheck -w @server-agent/web
npm test -w @server-agent/web
```

预期：全过。Web 包没有 NewConversationDialog 的组件级测试，靠 §12 手测覆盖。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/routes/chat/NewConversationDialog.tsx packages/web/src/routes/chat/index.tsx
git commit -m "feat(web): NewConversationDialog consumes useProviders()"
```


---

### Task 11: 全仓清理残余 PROVIDER_MODELS / getProvider / createProviderRegistry import

**Files:**
- Inspect: 全仓 grep
- Modify: 任何残留 import 的文件

- [ ] **Step 1: grep 残留**

```bash
grep -rn "PROVIDER_MODELS\|getProvider\|createProviderRegistry" packages/server/src packages/web/src
```

预期：
- `packages/server/src/routes/providers.ts` 仍 import `PROVIDER_MODELS`（合法用途）
- `packages/server/src/server.ts` 在 fallback 模型时引用 `PROVIDER_MODELS`（合法）
- `packages/server/src/providers/registry.ts` 内部使用（合法）
- 其它文件应该都已 0 引用

如果发现非法残留（譬如 conversations.ts/skills.ts 还在 import `PROVIDER_MODELS`/`getProvider`），删掉。

- [ ] **Step 2: 确认 web 包没有 PROVIDER_MODELS 引用**

```bash
grep -rn "PROVIDER_MODELS" packages/web/src
```

预期：0 行。

- [ ] **Step 3: 跑全套四件套**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

预期：全绿。如有失败修到绿。

- [ ] **Step 4: Commit（如果有改动）**

```bash
git add -A
git commit -m "chore: remove residual PROVIDER_MODELS/getProvider imports"
```

如果上一步 grep 没残留、四件套全绿、git status clean，跳过 commit。

---

### Task 12: 收尾 — AGENTS.md / 路线图 / README 同步 + push 部署

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md`

- [ ] **Step 1: AGENTS.md 加新坑**

读 `AGENTS.md` 找到 §6 末尾最大编号（当前 §6.14），在下方追加：

```markdown
### §6.15 加新 provider 的标准步骤（Phase 6a 沉淀）

加新 provider（譬如未来接 OpenAI/Anthropic 直连或别家中转）现在三步即可，**不需要改 routes**：

1. `packages/shared/src/providers/models.ts` 加新 `ProviderId` + 模型表（`ModelMeta` 含 `capabilities` + `contextWindow`）
2. `packages/server/src/providers/` 写新 adapter（实现 `ProviderAdapter`，参考 `aiwoo-claude.ts` / `aiwoo-codex.ts`）
3. `packages/server/src/providers/registry.ts` 的 `createDefaultRegistry` 中按 env key 守卫 `register({ id, label, adapter })`

`/api/providers` 自动暴露给前端，下拉无需改。新增模型只改第 1 步。
```

- [ ] **Step 2: README 更新路线图表**

读 `README.md` 找到「路线图」表，把 Phase 6 行替换为：

```
| 6a | done | provider 抽象（registry class + capability metadata + /api/providers） |
| 6b | next | 前端打磨（响应式 / 暗黑 / 虚拟滚动 / 多模态 / 搜索） |
```

- [ ] **Step 3: 路线图 §5 同步**

修改 `docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md` 的 §5 路线图汇总表，将原 Phase 6 行替换为：

```
| 6a | done | provider 抽象（registry class + capability metadata + /api/providers） |
| 6b | next | 前端打磨（响应式 / 暗黑 / 虚拟滚动 / 多模态 / 搜索） |
```

- [ ] **Step 4: 跑四件套最后确认**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

预期：全绿。

- [ ] **Step 5: Commit + push**

```bash
git add AGENTS.md README.md docs/superpowers/specs/2026-05-30-phase-3-6-roadmap.md
git commit -m "docs: phase 6a done, sync AGENTS/README/roadmap"
git push origin main
```

> push 后 GitHub Actions 自动跑 `npm ci → build:shared → lint → typecheck → test → build → deploy`。

- [ ] **Step 6: 生产手测验收**

等 GitHub Actions 部署 job 绿后：

```bash
curl https://aicoolyun.vip/api/health
# 浏览器：登录后开开发者工具 → Network → 看 /api/providers 200 + 结构正确
```

浏览器手测：
- 新建会话：模型下拉确实来自 /api/providers
- 发消息（codex 走 happy path；claude 视当时 aiwoo 状态）
- 旧会话打开正常列出消息

如果生产 healthy + 三项手测全过 → Phase 6a 收尾完成。

如果手测发现问题：用 `journalctl -u server-agent | grep -E "registered providers|DEFAULT_PROVIDER"` 排查启动 log。

---

## Self-Review

**Spec coverage（spec §1.1 必须交付项 → task）**

| Spec 要求 | Task |
|---|---|
| ProviderRegistry class（register/has/get/list） | Task 3 |
| createDefaultRegistry(config) 按 env key 注册 | Task 4 |
| ModelMeta + capabilities + contextWindow + findModel | Task 1 |
| GET /api/providers（登录鉴权） | Task 8 |
| 启动期 fail-fast + defaultProvider fallback | Task 6 |
| useProviders() hook + 下拉迁移 | Task 9 + Task 10 |
| messages route registry.has() + findModel 校验 | Task 5 |
| conversations / skills route 校验 | Task 7 |
| 测试：registry 单测、providers 路由集成、startup、shared models | Task 1, 3, 4, 6, 8, 9 |
| AGENTS § 6 + 路线图 + README 同步 | Task 12 |
| zod ProvidersResponseSchema | Task 2 |

> spec §3 提到 `SkillFormDialog.tsx` 需迁移，实际验证后该文件不暴露 provider/model 选择（在 NewConversationDialog 才选），无需改动。Plan §10 已确认仅迁移 NewConversationDialog + chat/index 类型 cast。

**Placeholder scan**：无 TBD/TODO 占位；每个代码 step 都有完整代码。

**Type 一致性**：
- `ProviderRegistry` 的 register/has/get/list 签名 Task 3 与 Task 4-8 使用一致
- `RegisteredProvider { id, label, adapter }` 全 task 命名一致
- `ProvidersResponseDto` zod 类型在 Task 2 定义，Task 8/9 一致使用
- `ModelMeta` / `findModel` 全 task 命名一致

**Scope 检查**：本 plan 只覆盖 6a（provider 抽象）；前端打磨（响应式 / 暗黑 / 虚拟滚动 / 多模态 / 搜索）明确列入 6b，不在本 plan。






