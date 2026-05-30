import { describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/test-db.js";
import { InviteRepository } from "../../src/db/repositories/invites.js";
import { MessagesRepository } from "../../src/db/repositories/messages.js";
import { buildApp } from "../../src/server.js";
import type { ChatRequest, ChatStreamEvent, ProviderAdapter } from "../../src/providers/types.js";

type TestApp = Awaited<ReturnType<typeof buildApp>>;

function fakeRegistry(events: ChatStreamEvent[]): Record<string, ProviderAdapter> {
  const adapter: ProviderAdapter = {
    id: "aiwoo-claude",
    async *stream(_req: ChatRequest): AsyncIterable<ChatStreamEvent> {
      for (const event of events) yield event;
    }
  };
  return { "aiwoo-claude": adapter, "aiwoo-codex": adapter };
}

function slowRegistry(): Record<string, ProviderAdapter> {
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
  return { "aiwoo-claude": adapter, "aiwoo-codex": adapter };
}


async function setup(username: string, registry?: Record<string, ProviderAdapter>) {
  const db = createTestDb();
  await new InviteRepository(db).create({ code: "ABCDEFGHJKLM", usesRemaining: 10, createdBy: "test", note: "it" });
  const app = await buildApp({ db, providerRegistry: registry });
  const cookie = await registerAndLogin(app, username);
  return { app, db, cookie };
}

async function registerAndLogin(app: TestApp, username: string): Promise<string> {
  await app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123", inviteCode: "ABCDEFGHJKLM" } });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "password123" } });
  const raw = login.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value!.split(";")[0];
}

async function createConversation(app: TestApp, cookie: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/conversations", headers: { cookie }, payload: { provider: "aiwoo-claude", model: "claude-opus-4-8" } });
  return res.json().conversation.id;
}

describe("message streaming routes", () => {
  it("requires auth for GET messages", async () => {
    const { app } = await setup("alice");
    const res = await app.inject({ method: "GET", url: "/api/conversations/x/messages" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 404 for another user's conversation messages", async () => {
    const { app, cookie } = await setup("alice");
    const id = await createConversation(app, cookie);
    const bob = await registerAndLogin(app, "bob");
    const res = await app.inject({ method: "GET", url: `/api/conversations/${id}/messages`, headers: { cookie: bob } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("streams ready/delta/done and persists complete assistant message", async () => {
    const registry = fakeRegistry([
      { type: "delta", textDelta: "Hello" },
      { type: "done", finishReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } }
    ]);
    const { app, cookie } = await setup("alice", registry);
    const id = await createConversation(app, cookie);
    const res = await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers: { cookie }, payload: { content: "hi" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: ready");
    expect(res.body).toContain("event: delta");
    expect(res.body).toContain('data: {"text":"Hello"}');
    expect(res.body).toContain("event: done");

    const list = await app.inject({ method: "GET", url: `/api/conversations/${id}/messages`, headers: { cookie } });
    const messages = list.json().messages;
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Hello");
    expect(messages[1].status).toBe("complete");
    await app.close();
  });

  it("emits error event and marks assistant error on provider error", async () => {
    const registry = fakeRegistry([
      { type: "error", error: { code: "UPSTREAM_MODEL_UNAVAILABLE", message: "no model" } }
    ]);
    const { app, cookie } = await setup("alice", registry);
    const id = await createConversation(app, cookie);
    const res = await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers: { cookie }, payload: { content: "hi" } });
    expect(res.body).toContain("event: error");
    expect(res.body).toContain("UPSTREAM_MODEL_UNAVAILABLE");
    const list = await app.inject({ method: "GET", url: `/api/conversations/${id}/messages`, headers: { cookie } });
    expect(list.json().messages[1].status).toBe("error");
    expect(list.json().messages[1].errorCode).toBe("UPSTREAM_MODEL_UNAVAILABLE");
    await app.close();
  });

  it("sets conversation title from first user message", async () => {
    const registry = fakeRegistry([{ type: "done", finishReason: "end_turn" }]);
    const { app, cookie } = await setup("alice", registry);
    const id = await createConversation(app, cookie);
    await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers: { cookie }, payload: { content: "What is the capital of France?" } });
    const list = await app.inject({ method: "GET", url: "/api/conversations", headers: { cookie } });
    expect(list.json().conversations[0].title).toBe("What is the capital of France?".slice(0, 40));
    await app.close();
  });

  it("returns 409 CONV_BUSY when a streaming message already exists", async () => {
    const registry = fakeRegistry([{ type: "done", finishReason: "end_turn" }]);
    const { app, db, cookie } = await setup("alice", registry);
    const id = await createConversation(app, cookie);
    // Simulate an in-flight assistant message.
    await new MessagesRepository(db).createAssistantStreaming(id);
    const res = await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers: { cookie }, payload: { content: "hi" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONV_BUSY");
    await app.close();
  });

  it("rejects invalid content payload with 400", async () => {
    const registry = fakeRegistry([{ type: "done", finishReason: "end_turn" }]);
    const { app, cookie } = await setup("alice", registry);
    const id = await createConversation(app, cookie);
    const res = await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, headers: { cookie }, payload: { content: "   " } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CONV_VALIDATION");
    await app.close();
  });

  it("marks assistant aborted and persists partial content when client disconnects", async () => {
    const { app, db, cookie } = await setup("alice", slowRegistry());
    const id = await createConversation(app, cookie);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/conversations/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ content: "long answer please" }),
      signal: ac.signal
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (received.split("event: delta").length < 3) {
      const { done, value } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }
    ac.abort();
    await reader.cancel().catch(() => {});

    await new Promise((r) => setTimeout(r, 300));

    const messages = new MessagesRepository(db);
    const rows = await messages.listForConversation(id, (await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } }).then((r) => r.json())).user.id);
    const assistant = rows.find((row) => row.role === "assistant")!;
    expect(assistant.status).toBe("aborted");
    expect(assistant.content.length).toBeGreaterThan(0);
    await app.close();
  });
});
