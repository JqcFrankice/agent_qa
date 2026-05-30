import { describe, expect, it, vi, afterEach } from "vitest";
import { streamMessage, type StreamEvent } from "./streamMessage.js";

function mockFetchSse(chunks: string[], ok = true, status = 200) {
  const encoder = new TextEncoder();
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (!ok) {
      return new Response(JSON.stringify({ error: { code: "CONV_BUSY", message: "busy" } }), { status });
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    });
    return new Response(stream, { status: 200 });
  }));
}

afterEach(() => vi.restoreAllMocks());

describe("streamMessage", () => {
  it("parses ready delta and done events from chunked SSE", async () => {
    mockFetchSse([
      'event: ready\ndata: {"assistantMessageId":"a1"}\n\n',
      'event: delta\ndata: {"text":"Hel',
      'lo"}\n\n',
      'event: done\ndata: {"finishReason":"stop"}\n\n'
    ]);

    const events: StreamEvent[] = [];
    for await (const event of streamMessage("c1", "hi", new AbortController().signal)) events.push(event);

    expect(events).toEqual([
      { type: "ready", assistantMessageId: "a1" },
      { type: "delta", text: "Hello" },
      { type: "done", finishReason: "stop" }
    ]);
  });

  it("yields an error event when the request is rejected", async () => {
    mockFetchSse([], false, 409);
    const events: StreamEvent[] = [];
    for await (const event of streamMessage("c1", "hi", new AbortController().signal)) events.push(event);
    expect(events).toEqual([{ type: "error", code: "CONV_BUSY", message: "busy" }]);
  });
});
