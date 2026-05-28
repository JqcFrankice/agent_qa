# Phase 2b — 对话内核 MVP 设计文档

**Spec 编号**：2026-05-28-phase-2b-chat-core
**目标项目**：[`server_agent`](https://github.com/JqcFrankice/agent_qa)
**作者**：Claude Opus 4.6（与 @JqcFrankice 协作 brainstorm）
**状态**：已通过设计评审，待落地为 plan
**前置 Spec**：[`2026-05-27-phase-2a-account-system-design.md`](./2026-05-27-phase-2a-account-system-design.md)

---

## 0. 全局背景

最终目标是阿里云上的多用户 AI Agent 平台（详见 Phase 1 spec §0）。Phase 2 在 Phase 2a 时被拆为：

| 子 Phase | 范围 | 价值里程碑 |
|---|---|---|
| Phase 2a | HTTPS + 账号系统 + 持久化基线 | `https://aicoolyun.vip` 可注册/登录 |
| **Phase 2b（本 spec）** | 对话内核 MVP（多会话 + Claude/Codex provider 抽象 + SSE 流式） | 用户能在 UI 里跟 AI 对话，会话有历史 |

Phase 2b 完成后，Phase 1 spec §0 第 6 条"对话使用阿里云上部署的 Claude 或 Codex（aiwoo 中转），用户可选"被首次兑现；Phase 3（自动总结 → skill 沉淀）的钩子（明确的会话边界、纯文本消息）被埋好。

---

## 1. 范围与非范围

### 范围（Phase 2b 必须交付）

- `conversations` + `messages` 两张表 + 一条前向 migration（`0001_conversations_messages.sql`）
- Provider Adapter 接口（中性 `ChatRequest` / `ChatStreamEvent`）+ 2 个实现：
  - `AiwooClaudeAdapter`：`POST https://aiwoo.vip/v1/messages`（Anthropic 格式）
  - `AiwooCodexAdapter`：`POST https://aiwoo.vip/v1/responses`（OpenAI Responses 格式）
- 模型白名单（`packages/shared/src/providers/models.ts`）：编译期常量；服务器启动校验 env 默认值在白名单内
- conversations CRUD：`GET/POST /api/conversations`、`PATCH/DELETE /api/conversations/:id`
- messages：`GET /api/conversations/:id/messages`、`POST /api/conversations/:id/messages`（流式响应）
- 流式机制：客户端 `POST + fetch ReadableStream`，服务端 `text/event-stream` 写 `event: ready / delta / done / error`
- 取消语义：浏览器 `AbortController.abort()` → 服务端 `req.raw.on('close')` → 上游 fetch abort → 部分 assistant 内容入库（`status='aborted'`）
- 自动 title：首条 user message 前 40 字（用户可后续手动重命名上限 80 字符）
- 进程重启清理：服务启动时把 `messages.status='streaming'` 的残骸全改为 `'aborted'`
- 前端 `/chat` 页面：sidebar（列表 + 新建 + 重命名 + 删除）+ 消息流（Markdown + Shiki + 代码 copy）+ 输入框（Send/Stop）
- 引入 shadcn/ui（仅作组件库）+ Tailwind 深色主题
- 沿用 2a 鉴权（`sa_sid` cookie + sessionMiddleware），跨用户隔离在 repository 层强制
- env 新增字段：`ANTHROPIC_AUTH_TOKEN`、`OPENAI_API_KEY`、`AIWOO_BASE_URL`、`DEFAULT_PROVIDER`、`DEFAULT_MODEL`、`UPSTREAM_FIRST_BYTE_TIMEOUT_MS`
- 演练（drill）：上游 503 / 用户中断 / 进程重启 streaming 清理 / migration 失败 abort（沿用 2a）

### 非范围（明确不做，留给后续 Phase）

- 多模态（图片 / 文件上传） — Phase 6
- 工具调用 / function calling — 暂未规划
- 对话总结 → skill 沉淀 — Phase 3
- QA-AGENT 对话模式 — Phase 4
- 多 key 轮询 / 用量计费 / 配额 — Phase 6
- Context 截断 / token 估算 — Phase 3 总结上线后
- 同会话内切 provider — 未来按需加 `messages.provider_override`
- 搜索 / 拖动排序 / 多选批量删除 / 文件夹 / 标签 — Phase 6
- 移动端响应式打磨 — Phase 6
- WebSocket — POST + chunked SSE 替代

---

## 2. 数据模型

### 2.1 Drizzle schema 增量（追加到 `packages/server/src/db/schema.ts`）

下面是新增的两张表，与 2a 已有的 `users` / `sessions` / `invite_codes` 在同一个 `schema.ts` 文件里追加。

```ts
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
// users 已在本文件 2a 段定义，这里直接引用同文件导出

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),                   // 16 字节随机 base64url（~22 字符）
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),                          // 可空，首条消息后回填
  provider: text("provider").notNull(),          // 'aiwoo-claude' | 'aiwoo-codex'
  model: text("model").notNull(),                // 例 'claude-opus-4-7' | 'gpt-5.5'
  systemPrompt: text("system_prompt"),           // 可空（用户在新建对话框可填）
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),  // 软删除
}, (t) => ({
  byUserUpdated: index("idx_conversations_user_updated").on(t.userId, t.updatedAt),
  byUserActive: index("idx_conversations_user_active").on(t.userId, t.deletedAt),
}));

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),                   // 16 字节随机 base64url
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull().default(""),  // 纯文本；assistant 流式期间持续 append
  status: text("status", { enum: ["complete", "streaming", "aborted", "error"] })
    .notNull().default("complete"),
  errorCode: text("error_code"),                 // status='error' 时填，例 'UPSTREAM_TIMEOUT'
  providerMessageId: text("provider_message_id"),// 上游返回的 id（调试用，可空）
  inputTokens: integer("input_tokens"),          // 上游 usage 回传，可空
  outputTokens: integer("output_tokens"),        // 同上
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull().default(sql`(unixepoch())`),
}, (t) => ({
  byConvCreated: index("idx_messages_conv_created").on(t.conversationId, t.createdAt),
}));
```

### 2.2 关键约定

| 约定 | 值 |
|---|---|
| ID 生成 | `crypto.randomBytes(16) → base64url`（不用 UUID v4，节省字符 + DB 索引体积） |
| Title 长度上限 | 自动生成 40 字符；用户改名上限 80 字符 |
| systemPrompt 长度上限 | 4000 字符（zod 校验） |
| 单 user message 长度上限 | 32000 字符（zod 校验） |
| 一条会话 messages 数量 | 不限（DB 不硬限；context 报错走 Phase 3 解决） |
| 软删除 | 设 `deleted_at`；前端列表只查 `deleted_at IS NULL`；物理删交给 Phase 3 总结后或运维 |
| Migration 文件 | `0001_conversations_messages.sql`（前向 only） |

### 2.3 数据完整性

- `messages.conversation_id` 外键 + `ON DELETE CASCADE`：删会话连带删消息
- `conversations.user_id` 外键 + `ON DELETE CASCADE`：管理员删用户连带删会话
- 流式期间崩溃恢复：服务进程挂掉，DB 残留 `status='streaming'` 的 message。**启动钩子 cleanup**：
  ```sql
  UPDATE messages SET status='aborted' WHERE status='streaming';
  ```
  （不删，保留已写入的部分内容）

---

## 3. Provider Adapter 抽象

### 3.1 中性接口（`packages/server/src/providers/types.ts`）

```ts
export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;          // 纯文本
}

export interface ChatRequest {
  model: string;            // 例 'claude-opus-4-7' | 'gpt-5.5'
  messages: ChatMessage[];  // 不含 system；system 单独传
  systemPrompt?: string;
  signal: AbortSignal;      // 上游 fetch 直接绑这个 signal
}

export interface ChatStreamEvent {
  type: "delta" | "done" | "error";
  textDelta?: string;          // type='delta'
  finishReason?: string;       // type='done'
  usage?: { inputTokens: number; outputTokens: number };  // type='done'，可空
  providerMessageId?: string;  // type='done'，可空
  error?: { code: string; message: string };              // type='error'
}

export interface ProviderAdapter {
  readonly id: "aiwoo-claude" | "aiwoo-codex";
  /**
   * 流式调用上游。返回 AsyncIterable，调用方用 for-await-of 消费。
   * signal abort 时上游 fetch 自动断开，迭代器自然结束（throw AbortError）。
   */
  stream(req: ChatRequest): AsyncIterable<ChatStreamEvent>;
}
```

### 3.2 `AiwooClaudeAdapter`（`packages/server/src/providers/aiwoo-claude.ts`）

- **HTTP**：`POST ${AIWOO_BASE_URL}/v1/messages`（base 不带 `/v1`，符合 `aiwoo_provider.md` 记忆）
- **Headers**：
  - `x-api-key: ${ANTHROPIC_AUTH_TOKEN}`
  - `anthropic-version: 2023-06-01`
  - `content-type: application/json`
  - `accept: text/event-stream`
- **Body**：
  ```json
  {
    "model": "claude-opus-4-7",
    "max_tokens": 8192,
    "stream": true,
    "system": "<systemPrompt or omit>",
    "messages": [{"role":"user","content":"..."}]
  }
  ```
- **SSE event 处理**（按 Anthropic spec）：
  - `message_start` → 暂存 `message.id`
  - `content_block_delta` (`delta.type='text_delta'`) → emit `{type:'delta', textDelta: delta.text}`
  - `message_delta` → 暂存 `usage.output_tokens`
  - `message_stop` → emit `{type:'done', finishReason, usage, providerMessageId}`
  - `error` → emit `{type:'error', error:{code, message}}`
- **错误归一**：
  - HTTP 503 + body 含 `model_not_found` → `code='UPSTREAM_MODEL_UNAVAILABLE'`
  - 4xx → `UPSTREAM_BAD_REQUEST`
  - 5xx 其他 → `UPSTREAM_ERROR`
  - 30s 内无任何字节 → `UPSTREAM_TIMEOUT`

### 3.3 `AiwooCodexAdapter`（`packages/server/src/providers/aiwoo-codex.ts`）

- **HTTP**：`POST ${AIWOO_BASE_URL}/v1/responses`（带 `/v1`）
- **Headers**：
  - `Authorization: Bearer ${OPENAI_API_KEY}`
  - `content-type: application/json`
  - `accept: text/event-stream`
- **Body**：
  ```json
  {
    "model": "gpt-5.5",
    "stream": true,
    "instructions": "<systemPrompt or omit>",
    "input": [
      {"role":"user","content":[{"type":"input_text","text":"..."}]},
      {"role":"assistant","content":[{"type":"output_text","text":"..."}]}
    ]
  }
  ```
- **SSE event 处理**（按 OpenAI Responses spec）：
  - `response.output_text.delta` → emit `{type:'delta', textDelta: event.delta}`
  - `response.completed` → emit `{type:'done', usage, providerMessageId, finishReason}`
  - `error` / `response.failed` → emit `{type:'error', ...}`
- **错误归一**：同 Claude adapter

### 3.4 Provider 注册表（`packages/server/src/providers/registry.ts`）

```ts
const adapters: Record<string, ProviderAdapter> = {
  "aiwoo-claude": new AiwooClaudeAdapter(config),
  "aiwoo-codex": new AiwooCodexAdapter(config),
};
export function getProvider(id: string): ProviderAdapter { /* lookup or throw CONV_VALIDATION */ }
```

### 3.5 模型白名单（`packages/shared/src/providers/models.ts`）

```ts
export const PROVIDER_MODELS = {
  "aiwoo-claude": [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
    { id: "claude-4.5-haiku", label: "Claude Haiku 4.5" },
  ],
  "aiwoo-codex": [
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5-codex", label: "GPT-5 Codex" },
  ],
} as const;
```

- 该常量在 `shared` 包，前后端共用
- 服务器启动时校验 `DEFAULT_PROVIDER` + `DEFAULT_MODEL` 必须命中白名单，否则 fail-fast
- **plan 段 1 第一步必须**：`curl https://aiwoo.vip/v1/models`（带 `x-api-key`）重新核对 wf 分组真实清单后再开始写代码（你的 `aiwoo_provider.md` 记忆是 2026-05-26 写的，可能漂移）

### 3.6 上游 fetch 行为

- **超时**：30s "首字节超时"（`UPSTREAM_FIRST_BYTE_TIMEOUT_MS` 配置；30s 内无任何 SSE event 即 abort）；后续无 hard timeout
- **取消**：`signal` 直接绑用户 abort；fetch 自动断开 socket，aiwoo 收到 RST 停止扣费
- **不重试**：流式半路重试会让用户看到重复内容；网络错直接报给用户

---

## 4. 路由 + SSE 编排

### 4.1 API 契约

| 方法 | 路径 | Body | 200/201 | 错误 |
|---|---|---|---|---|
| GET | `/api/conversations` | — | 200 `{conversations:[{id,title,provider,model,updatedAt,createdAt}]}` 按 updatedAt desc | 401 |
| POST | `/api/conversations` | `{provider, model, systemPrompt?}` | 201 `{conversation:{id,...}}` | 400/401 |
| PATCH | `/api/conversations/:id` | `{title?}` | 200 `{conversation:{...}}` | 400/401/404 |
| DELETE | `/api/conversations/:id` | — | 200 `{ok:true}` | 401/404 |
| GET | `/api/conversations/:id/messages` | — | 200 `{messages:[{id,role,content,status,createdAt}]}` | 401/404 |
| POST | `/api/conversations/:id/messages` | `{content}` | **SSE 流** | 401/404/409/429 |

### 4.2 流式 POST 编排（核心）

```
1. 鉴权：sessionMiddleware 已挂 req.user，否则 401
2. 加载会话：repo 查 id + userId 匹配 + deleted_at IS NULL，否则 404
3. 检查会话状态：若已有 status='streaming' 的 message → 409 CONV_BUSY
4. zod 校验 body.content（≤32000 字符），否则 400 CONV_VALIDATION
5. rate limit：每用户 30 msg/min（沿用 2a SQLite bucket 实现），超出 429 CONV_RATE_LIMITED
6. DB 事务：
   - INSERT user message (status='complete')
   - INSERT assistant message (status='streaming', content='')
   - 若 conversation.title IS NULL 且这是第一条 user msg → UPDATE conversations.title = substr(content, 0, 40)
   - UPDATE conversations.updated_at = unixepoch()
7. 切到 SSE 模式：
   reply.raw.writeHead(200, {
     'Content-Type': 'text/event-stream',
     'Cache-Control': 'no-cache',
     'Connection': 'keep-alive',
     'X-Accel-Buffering': 'no'   // Caddy 默认会 flush，此 header 用于其他反代场景兜底
   })
8. 发首事件：'event: ready\ndata: {"assistantMessageId":"..."}\n\n'
9. 拉历史消息（按 createdAt asc，含刚 INSERT 的 user msg；不含刚 INSERT 的空 assistant msg） → 转 ChatMessage[]
10. const controller = new AbortController(); req.raw.on('close', () => controller.abort());
11. for await (event of provider.stream({model, messages, systemPrompt, signal: controller.signal})) {
      switch (event.type) {
        case 'delta':
          reply.raw.write(`event: delta\ndata: ${JSON.stringify({text:event.textDelta})}\n\n`);
          buffer += event.textDelta;
          if (buffer.length >= 256 || timeSinceLastFlush >= 200ms) {
            UPDATE messages SET content = content || buffer WHERE id = assistantMessageId;
            buffer = '';
          }
          break;
        case 'done':
          flushBuffer();
          UPDATE messages SET status='complete', errorCode=null, providerMessageId=?, inputTokens=?, outputTokens=? WHERE id=?;
          reply.raw.write(`event: done\ndata: {...}\n\n`);
          return;
        case 'error':
          flushBuffer();
          UPDATE messages SET status='error', errorCode=event.error.code WHERE id=?;
          reply.raw.write(`event: error\ndata: {code,message}\n\n`);
          return;
      }
    }
12. catch (err) {
      flushBuffer();
      if (err.name === 'AbortError') {
        UPDATE messages SET status='aborted' WHERE id=?;
        // 连接已断，不再写 SSE
      } else {
        UPDATE messages SET status='error', errorCode='INTERNAL' WHERE id=?;
        if (!reply.raw.destroyed) {
          reply.raw.write(`event: error\ndata: {"code":"INTERNAL","message":"..."}\n\n`);
        }
      }
    }
13. finally: reply.raw.end();
```

### 4.3 SSE event 帧格式（前后端约定）

```
event: ready
data: {"assistantMessageId":"abc..."}

event: delta
data: {"text":"Hello"}

event: delta
data: {"text":" world"}

event: done
data: {"finishReason":"stop","usage":{"inputTokens":42,"outputTokens":8}}

# 或

event: error
data: {"code":"UPSTREAM_TIMEOUT","message":"上游响应超时"}
```

### 4.4 错误码增量（追加到 2a 的错误表）

| code | HTTP | 触发 |
|---|---|---|
| `CONV_NOT_FOUND` | 404 | conversation id 不属于当前用户或已软删 |
| `CONV_VALIDATION` | 400 | provider/model 不在白名单、systemPrompt 超长、content 超长、title 超长 |
| `CONV_BUSY` | 409 | 同一会话已有 streaming 中的消息 |
| `CONV_RATE_LIMITED` | 429 | 超出 30 msg/min |
| `UPSTREAM_TIMEOUT` | — (SSE error event) | 30s 首字节超时 |
| `UPSTREAM_MODEL_UNAVAILABLE` | — | aiwoo 503 + model_not_found |
| `UPSTREAM_BAD_REQUEST` | — | aiwoo 4xx |
| `UPSTREAM_ERROR` | — | 其他 aiwoo 异常 |
| `INTERNAL` | — / 500 | 兜底 |

---

## 5. 鉴权与权限

- 沿用 2a 的 `sa_sid` cookie + `sessionMiddleware`（fastify `onRequest` hook）。SSE 路由不特殊处理。
- 所有 `/api/conversations/*` 路由要求 `req.user` 存在，否则 401 `AUTH_NOT_AUTHENTICATED`
- 跨用户隔离在 **repository 层** 强制：`findById(id, userId)`、`findMessages(convId, userId)` 一律带 `WHERE user_id = ?`，router 层不做权限判断
- Caddy 反代默认透传 cookie，无需改 Caddyfile
- SSE 长连接对 cookie session 的影响：`last_seen_at` 仅在 `onRequest` hook 触发时刷新（普通请求），SSE 期间不刷新——预期行为，避免长连接打断 7 天 idle 失效逻辑

---

## 6. 前端

### 6.1 路由（在 2a 三页面基础上修订）

| 路径 | 内容 | 鉴权 |
|---|---|---|
| `/` | 已登录 → `/chat`；未登录 → `/login` | 任意 |
| `/login` | 同 2a | 未登录 only |
| `/register` | 同 2a | 未登录 only |
| `/chat` | 聊天主界面（替换 2a 的 `/home`） | 必须登录 |

`/home` 占位被 chat 取代，路由 redirect。

### 6.2 布局

```
┌─────────────────────────────────────────────────┐
│ Sidebar (260px, fixed)     │ Main (flex-1)      │
│  ┌─────────────────────┐   │  ┌──────────────┐ │
│  │ + New Conversation  │   │  │ Title bar    │ │
│  ├─────────────────────┤   │  │ provider/mdl │ │
│  │ Conversation 1   ⋮  │   │  ├──────────────┤ │
│  │ Conversation 2   ⋮  │   │  │              │ │
│  │ ...                 │   │  │ MessageList  │ │
│  ├─────────────────────┤   │  │ (scroll)     │ │
│  │ {username} ▾        │   │  ├──────────────┤ │
│  │  Logout             │   │  │ Composer     │ │
│  └─────────────────────┘   │  └──────────────┘ │
└─────────────────────────────────────────────────┘
```

### 6.3 组件结构（`packages/web/src/`）

```
src/
├── routes/
│   ├── login.tsx                  # 沿用 2a
│   ├── register.tsx               # 沿用 2a
│   └── chat/
│       ├── index.tsx              # /chat 容器
│       ├── Sidebar.tsx
│       ├── ConversationItem.tsx   # 含 ⋮ 菜单（重命名 + 删除）
│       ├── NewConversationDialog.tsx  # provider/model 下拉 + systemPrompt 可选
│       ├── MessageList.tsx
│       ├── MessageBubble.tsx      # role + content + status badge
│       ├── MarkdownView.tsx       # react-markdown + remark-gfm + Shiki
│       ├── CodeBlock.tsx          # 含 copy 按钮
│       └── Composer.tsx           # textarea + Send/Stop 按钮
├── lib/
│   ├── api.ts                     # 沿用 2a + 加 conversations / messages
│   ├── streamMessage.ts           # POST + ReadableStream + SSE 解析
│   └── queryClient.ts
├── components/ui/                 # shadcn/ui copy-paste：button / input / dialog / dropdown-menu / toast / skeleton / textarea
└── App.tsx
```

### 6.4 状态管理

- `@tanstack/react-query` 管 `conversations` 列表 + `messages` 列表的 query
- `useStreamMessage(conversationId)` 自定义 hook（**不**走 react-query mutation，因为流式不是普通 promise）：
  - 内部维护 `streamingMessage` 状态（实时累加 delta）
  - SSE 完成后 `queryClient.invalidateQueries(['messages', conversationId])` + `invalidateQueries(['conversations'])`（更新 updatedAt 排序）
  - 暴露 `abort()` 方法
- 全局只 react-query；不引 Redux / Zustand

### 6.5 流式接收（`lib/streamMessage.ts`）

```ts
export async function* streamMessage(
  conversationId: string,
  content: string,
  signal: AbortSignal,
): AsyncGenerator<
  | { type: 'ready'; assistantMessageId: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; finishReason?: string; usage?: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; code: string; message: string }
> {
  const res = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    credentials: 'include',
    signal,
  });
  if (!res.ok) {
    const err = await res.json();
    yield { type: 'error', code: err.error.code, message: err.error.message };
    return;
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const parsed = parseSSE(frame);  // 解 'event: x\ndata: y'
      if (parsed) yield parsed;
    }
  }
}
```

### 6.6 视觉与交互

- shadcn/ui 默认深色主题（zinc + 亮蓝 accent）
- Shiki 主题 `github-dark-default`，与 shadcn dark 视觉一致
- Markdown 支持：标题、列表、表格、引用、代码块、内联代码、链接、删除线、任务列表（`remark-gfm`）
- 输入框：自适应高度（max 8 行），`Enter` 发送，`Shift+Enter` 换行（桌面浏览器；移动端 Phase 6 再改）
- 流式中：发送按钮变成"停止"按钮，点击 abort
- 会话切换时若有正在流式的消息：弹 confirm（shadcn Dialog）"切走会终止流式生成，确认？"
- 删除会话：用 `sonner` toast，含"撤销"按钮（5 秒内点 → DELETE 反向变 PATCH 设 deleted_at=NULL）
- 错误展示：`UPSTREAM_*` 类错误以红色气泡显示在 assistant message 位置；网络/鉴权错误用 toast

---

## 7. 配置与依赖增量

### 7.1 env 新增字段（`/etc/server-agent/agent.env`）

```
ANTHROPIC_AUTH_TOKEN=<aiwoo key for Claude>      # 新增
OPENAI_API_KEY=<aiwoo key for Codex>             # 新增
AIWOO_BASE_URL=https://aiwoo.vip                 # 新增（不带 /v1，由 adapter 内部按需拼）
DEFAULT_PROVIDER=aiwoo-claude                    # 新增
DEFAULT_MODEL=claude-opus-4-7                    # 新增
UPSTREAM_FIRST_BYTE_TIMEOUT_MS=30000             # 新增（默认 30s）
```

`config.ts` 用 zod 校验全部，缺一即 fail-fast。`agent.env.example` 同步更新。

### 7.2 依赖增量

| 包 | 用途 | workspace |
|---|---|---|
| — | adapter 用 Node 18+ 内置 fetch + ReadableStream | server |
| — | SSE parsing 自己写（避免引依赖） | server |
| `react-markdown` | Markdown 渲染 | web |
| `remark-gfm` | GFM 表格/任务列表 | web |
| `shiki` | 代码高亮 | web |
| `@radix-ui/react-*` | shadcn/ui primitive | web |
| `class-variance-authority`、`clsx`、`tailwind-merge` | shadcn/ui 工具 | web |
| `lucide-react` | shadcn 默认 icon set | web |
| `sonner` | Toast | web |

不引：lodash、moment、axios、framer-motion、socket.io。

---

## 8. 部署管道与运维增量

### 8.1 `deploy-agent.sh`

migrate 步骤已在 2a 加过，本 Phase 仅多一个 migration 文件，无脚本改动。

### 8.2 Caddyfile

不需要改。`/api/*` 已统一反代到 127.0.0.1:8080；HTTP/1.1 chunked 默认透传，无需特殊 buffering 配置。

### 8.3 Bootstrap

无新增。

### 8.4 Backup

会话/消息也落 `main.sqlite`，沿用 2a 的 daily timer，无新增。

### 8.5 演练（drill）

| 演练 | 触发 | 期望 |
|---|---|---|
| 上游 503 | 临时改 env `DEFAULT_MODEL='fake-model'` 触发请求 | SSE error event `UPSTREAM_MODEL_UNAVAILABLE`；assistant message status=error；前端显示错误气泡 |
| 用户中断 | 流式中点"停止" | 前端 abortController.abort()；服务器侧 close 触发 abort；DB 保存部分内容 + status=aborted；前端气泡显示"已中断"标签 |
| 服务进程崩溃恢复 | `systemctl restart server-agent` 时正好有流式 | 重启后启动 hook 把 status=streaming 改为 status=aborted；用户刷新看到"已中断" |
| Migration 失败 abort | 故意失败 migration push | 沿用 2a 流程：deploy-agent 在 migrate 阶段 exit 非 0；不重启 |

---

## 9. 验收标准

### 9.1 自动化测试

**单元测试（vitest）**
- `providers/aiwoo-claude.test.ts`：fixture 模拟 SSE byte stream → 期望 emit 正确事件序列；abort signal 触发时迭代器立即 throw AbortError；模拟 503/4xx/timeout 三种错误路径
- `providers/aiwoo-codex.test.ts`：同上
- `providers/sse-parser.test.ts`：边界（跨 chunk 切分、`\r\n\r\n` 兼容、空行、超大单帧）
- `repositories/conversations.test.ts`、`repositories/messages.test.ts`：CRUD + 软删 + user_id 隔离

**集成测试（fastify.inject + in-memory SQLite + provider mock）**
- 每个 conversations 路由覆盖：成功 + 至少一种失败（401/404/409/429）
- 流式路由：mock provider 返回固定 SSE → 断言响应字节 + 数据库最终态
- 流式路由 abort：客户端中断 → 断言 message status=aborted、内容部分保存
- 启动时清理 streaming：手动插入 streaming 记录、调启动 hook、断言变 aborted
- 跨用户隔离：用户 A 的 conversation id 用户 B 访问 → 一律 404

**总用例数预估**：约 35 个，按段拆到 plan 各阶段。CI 强制 lint + typecheck + test 全过，否则 deploy job 不触发（沿用 2a）。

### 9.2 端到端验收清单

| # | 项 | 验证 |
|---|---|---|
| 1 | 登录后访问 `/` 重定向 `/chat`，看到空 sidebar + "开始新对话"占位 | 浏览器 |
| 2 | "新对话"对话框列出 5 个 model（白名单） | 点击 dropdown |
| 3 | 默认 provider/model = env 配置 | 新对话框初始状态 |
| 4 | 发送一条简单消息 → 看到 assistant 流式打字（用 Claude） | 浏览器 |
| 5 | 同上，用 Codex | 浏览器 |
| 6 | 多轮对话上下文保留（"我刚说了什么？"能正确回答） | Claude + Codex 各一遍 |
| 7 | Markdown 渲染：发"用 markdown 给我表格 + 代码块"看效果 | 视觉验收 |
| 8 | 代码块 copy 按钮工作 | 点 copy 看剪贴板 |
| 9 | 流式中点"停止" → 部分内容保留 | DB + UI 双确认 |
| 10 | 删除会话 → 列表移除 + toast 撤销可用 | 浏览器 |
| 11 | 重命名会话 → sidebar 更新 | 浏览器 |
| 12 | 上游 model 不存在错误展示 | 临时改 env DEFAULT_MODEL 为 'fake' |
| 13 | 鉴权：未登录 fetch `/api/conversations` 401 | curl |
| 14 | 跨用户隔离：A 用户的会话 ID，B 用户 GET 返回 404 | curl + 两个账号 |
| 15 | 进程崩溃 streaming 清理 | 手动 INSERT streaming 记录 + restart |
| 16 | 用户名 + logout 工作 | 浏览器 |
| 17 | spec + plan 已 push GitHub | git log |

### 9.3 性能 / 容量声明（不强测）

- 1k 会话 + 100k 消息：sidebar 加载 p95 < 100ms；单会话消息列表 < 200ms
- SSE 流式：本地→服务器→上游 RTT 不引入额外 buffer 延迟（buffer 在 server 侧 200ms / 256B 双触发）
- 服务端总内存 < 400MB（2a 后 ~300MB + Phase 2b SSE 连接 + 模型 wire 缓冲 ~50MB）

---

## 10. 决策记录（ADR，编号续 2a）

| # | 决策 | 替代 | 理由 |
|---|---|---|---|
| ADR-22 | 对话粒度 = 多会话（conversations + messages） | 单会话 | Phase 2b 价值含"历史"；Phase 3/4 hook 需要明确边界 |
| ADR-23 | Provider 绑定粒度 = 会话级 | 轮次级、会话级 + 单轮覆盖 | YAGNI；Phase 3 总结风格一致；未来加 `messages.provider_override` 列即可平滑升级 |
| ADR-24 | 一开始就抽 ProviderAdapter + 接 Claude + Codex | 仅 Claude 推迟抽象 | 2a §0 已承诺；wire format 差异早抽更干净 |
| ADR-25 | 流式 = POST + fetch ReadableStream（chunked SSE payload） | EventSource、WebSocket | 一跳搞定 + cookie 天然兼容 + Caddy 零改 |
| ADR-26 | messages 仅文本中性格式 | 多模态 JSON 块、原生 provider 体 | MVP；Phase 3 总结需纯文本；扩展点 = 加 `content_blocks` 列 |
| ADR-27 | Context = 全量传不截断 | 滑动窗口 + token 估算 | Phase 3 解决；MVP 期 context 不会爆 |
| ADR-28 | aiwoo key = 全平台共享（env file） | 用户自带 key、加密入库 | 仅 admin 一人付费；2a EnvironmentFile 路径一致 |
| ADR-29 | 取消 = 保留部分输出 + status=aborted | 不可取消、丢弃部分 | 用户体验；Phase 3 总结时可标 aborted 略过或正常处理 |
| ADR-30 | 自动 title = 首条 user msg 前 40 字 | LLM 总结、纯手工 | 零额外成本；首条已含足够语义；Phase 3 总结时可回填更好 title |
| ADR-31 | 前端范围 = sidebar + Markdown + Shiki + shadcn/ui，**不**含搜索/拖动/批量/上传 | 全功能 UI | YAGNI；Phase 6 是"前端打磨" |
| ADR-32 | 模型清单 = 编译期白名单（shared 包） | 运行时拉 `/v1/models`、env 自由文本 | 启动 fail-fast；shared 包前后端共享；Phase 6 改运行时即可 |
| ADR-33 | 流式不重试 | 半路重试、整请求重试 | 半路重试会重复内容；整请求重试需用户授权（UI 不做） |
| ADR-34 | 进程重启时 streaming → aborted（启动钩子 cleanup） | 保留 streaming 让用户看到、删除残骸 | 用户能看到"已中断"；保留已写部分内容；DB 干净 |
| ADR-35 | 跨用户隔离强制点 = repository 层 | router 层、middleware | 集中防御；router 层不需要重复判断；测试覆盖更聚焦 |
| ADR-36 | rate limit = 30 msg/min/user | IP 维度、按 token 维度 | 用户量小；账号已有；token 维度需要先估算 |
| ADR-37 | shadcn/ui 引入但不加业务复杂度 | 纯 Tailwind 手写、Material UI | 美观可视化用户要求；可达性/焦点管理免费；copy-paste 不锁依赖 |

---

## 11. 风险与遗留

### 11.1 风险

- **R9 SSE 长连接占资源**：每个流式请求占一条 Node 连接 + 一条 aiwoo socket。极端情况 N 用户并发拉爆。
  Mitigation：Phase 2b 用户量小（<10 邀请）；CONV_BUSY 限制单会话并发；Phase 后期加每用户全局并发限流
- **R10 aiwoo 服务降级**：aiwoo 单点，挂了所有用户都不能对话。
  Mitigation：错误归一显示给用户；监控留 Phase 后期；不引第二个 provider（YAGNI）
- **R11 模型 ID 漂移**：aiwoo 变更 wf 分组模型清单，白名单失配。
  Mitigation：plan 段 1 第一步重新 curl 校对；env 默认值不在白名单 → 启动 fail-fast；用户层面看到 UPSTREAM_MODEL_UNAVAILABLE
- **R12 Markdown XSS**：模型可能输出 `<script>` 等危险 HTML。
  Mitigation：react-markdown 默认 sanitize（不执行 raw HTML）；不引 `rehype-raw`；CSP 已在 2a 限定 `script-src 'self'`，外站脚本被挡
- **R13 大消息撑爆 SQLite**：单条 `messages.content` 无硬上限（assistant 输出可能 50KB+）。
  Mitigation：SQLite TEXT 列足够；Phase 3 总结/归档时清理；DB 体积监控走 Phase 后期
- **R14 流式期间数据库写入风暴**：每 200ms / 256 字节一次 UPDATE。
  Mitigation：buffer 批处理；如需进一步压力，Phase 后期改为完成时一次性写

### 11.2 遗留（推到后续 Phase）

- **L11 Context 截断 / 总结** — Phase 3
- **L12 多模态（图片/文件）** — Phase 6
- **L13 工具调用 / function calling** — 未规划 Phase
- **L14 配额 / 用量计费** — Phase 6
- **L15 多 provider key 轮询** — Phase 6
- **L16 移动端响应式** — Phase 6
- **L17 搜索 / 文件夹 / 标签** — Phase 6
- **L18 SSE 长连接监控告警** — Phase 后期

---

## 12. 升级 / 演进路径

| Phase | 在 Phase 2b 基础上叠加 | 对本 spec 的破坏性更改 |
|---|---|---|
| 3 | conversation_summaries 表；后台总结 task；title 回填；context 注入总结 | 增表 + 后台 systemd timer/task；不破坏现有路由 |
| 4 | conversations.type 列（'normal' \| 'qa-agent'）；qa skill 注入 system prompt；接 game-qa-skill-system 仓库 | 增列 + 新建对话框加类型选择；引子模块或并列 clone |
| 5 | reviewer 角色；skill 审核 UI | users.role 列；新前端路由 |
| 6 | 多模态：messages 加 `content_blocks` JSON 列；多 provider key；移动端打磨；搜索/排序/批量 | 增列 + adapter 入参分流；前端能力扩展 |

---

## 13. 下一步

本 spec 通过用户评审后：

1. 调用 `superpowers:writing-plans` skill，将本 spec 转为可逐步执行的 plan
2. plan 文件路径：`docs/superpowers/plans/2026-05-28-phase-2b-chat-core-plan.md`
3. plan 按 5 段验收：
   - **段 A**：DB schema + migration + repositories + 启动 cleanup hook
   - **段 B**：Provider adapters（Claude + Codex）+ SSE 解析 + 单元测试
   - **段 C**：conversations CRUD + 流式 POST 路由 + 集成测试
   - **段 D**：前端 chat 页面 + Sidebar + Composer + Markdown/Shiki/shadcn 引入
   - **段 E**：drill 演练 + 端到端验收
4. spec + plan 一并 commit & push 到 `origin/main`
5. 实施在后续会话中按 plan 推进
