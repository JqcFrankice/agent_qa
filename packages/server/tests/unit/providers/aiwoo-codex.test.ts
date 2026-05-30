import { describe, expect, it, vi, afterEach } from "vitest";
import { AiwooCodexAdapter } from "../../../src/providers/aiwoo-codex.js";
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

const codexSse = [
  'event: response.output_text.delta\ndata: {"delta":"Hi"}\n\n',
  'event: response.completed\ndata: {"response":{"id":"resp_1","usage":{"input_tokens":3,"output_tokens":2},"status":"completed"}}\n\n'
];

afterEach(() => vi.restoreAllMocks());

describe("AiwooCodexAdapter", () => {
  it("maps OpenAI Responses SSE to neutral events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(codexSse)));
    const adapter = new AiwooCodexAdapter({ baseUrl: "https://aiwoo.vip", apiKey: "k", firstByteTimeoutMs: 1000 });
    const events = await collect(adapter.stream({ model: "gpt-5.5", messages: [{ role: "user", content: "hi" }], signal: new AbortController().signal }));
    expect(events).toEqual([
      { type: "delta", textDelta: "Hi" },
      { type: "done", finishReason: "completed", providerMessageId: "resp_1", usage: { inputTokens: 3, outputTokens: 2 } }
    ]);
  });
});
