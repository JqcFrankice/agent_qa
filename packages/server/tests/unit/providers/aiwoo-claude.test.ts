import { describe, expect, it, vi, afterEach } from "vitest";
import { AiwooClaudeAdapter } from "../../../src/providers/aiwoo-claude.js";
import type { ChatStreamEvent } from "../../../src/providers/types.js";

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

// A fetch mock whose response body honors the AbortSignal it is given: it emits
// the initial chunks, then errors the stream with the signal's abort reason.
// This faithfully reproduces how real fetch surfaces both user aborts (reason =
// AbortError) and first-byte timeouts (reason = FirstByteTimeoutError).
function signalAwareFetch(initialChunks: string[]) {
  const encoder = new TextEncoder();
  return vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of initialChunks) controller.enqueue(encoder.encode(chunk));
        init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
      }
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
}

async function collect(iterable: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

const claudeSse = [
  'event: message_start\ndata: {"message":{"id":"msg_1","usage":{"input_tokens":3}}}\n\n',
  'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hi"}}\n\n',
  'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
  'event: message_stop\ndata: {}\n\n'
];

afterEach(() => vi.restoreAllMocks());

describe("AiwooClaudeAdapter", () => {
  it("maps Anthropic SSE to neutral events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(claudeSse)));
    const adapter = new AiwooClaudeAdapter({ baseUrl: "https://aiwoo.vip", authToken: "k", firstByteTimeoutMs: 1000 });
    const events = await collect(adapter.stream({ model: "claude-opus-4-7", messages: [{ role: "user", content: "hi" }], signal: new AbortController().signal }));
    expect(events).toEqual([
      { type: "delta", textDelta: "Hi" },
      { type: "done", finishReason: "end_turn", providerMessageId: "msg_1", usage: { inputTokens: 3, outputTokens: 2 } }
    ]);
  });

  it("maps 503 model_not_found to UPSTREAM_MODEL_UNAVAILABLE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"model_not_found"}}', { status: 503 })));
    const adapter = new AiwooClaudeAdapter({ baseUrl: "https://aiwoo.vip", authToken: "k", firstByteTimeoutMs: 1000 });
    const events = await collect(adapter.stream({ model: "fake", messages: [{ role: "user", content: "hi" }], signal: new AbortController().signal }));
    expect(events[0].type).toBe("error");
    expect(events[0].error?.code).toBe("UPSTREAM_MODEL_UNAVAILABLE");
  });

  it("maps 4xx to UPSTREAM_BAD_REQUEST", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"bad key"}}', { status: 401 })));
    const adapter = new AiwooClaudeAdapter({ baseUrl: "https://aiwoo.vip", authToken: "k", firstByteTimeoutMs: 1000 });
    const events = await collect(adapter.stream({ model: "claude-opus-4-7", messages: [{ role: "user", content: "hi" }], signal: new AbortController().signal }));
    expect(events[0].type).toBe("error");
    expect(events[0].error?.code).toBe("UPSTREAM_BAD_REQUEST");
  });

  it("emits UPSTREAM_TIMEOUT when no first byte arrives in time", async () => {
    vi.stubGlobal("fetch", signalAwareFetch([]));
    const adapter = new AiwooClaudeAdapter({ baseUrl: "https://aiwoo.vip", authToken: "k", firstByteTimeoutMs: 20 });
    const events = await collect(adapter.stream({ model: "claude-opus-4-7", messages: [{ role: "user", content: "hi" }], signal: new AbortController().signal }));
    expect(events[0].type).toBe("error");
    expect(events[0].error?.code).toBe("UPSTREAM_TIMEOUT");
  });

  it("re-throws AbortError when the request signal aborts mid-stream", async () => {
    vi.stubGlobal("fetch", signalAwareFetch([
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hi"}}\n\n'
    ]));
    const adapter = new AiwooClaudeAdapter({ baseUrl: "https://aiwoo.vip", authToken: "k", firstByteTimeoutMs: 1000 });
    const ac = new AbortController();
    const events: ChatStreamEvent[] = [];
    await expect(async () => {
      for await (const event of adapter.stream({ model: "claude-opus-4-7", messages: [{ role: "user", content: "hi" }], signal: ac.signal })) {
        events.push(event);
        ac.abort();
      }
    }).rejects.toThrow(/abort/i);
    expect(events).toEqual([{ type: "delta", textDelta: "Hi" }]);
  });
});
