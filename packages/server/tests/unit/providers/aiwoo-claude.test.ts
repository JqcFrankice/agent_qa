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
});
