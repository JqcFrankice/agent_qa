import { streamUpstreamFrames, toErrorEvent } from "./base.js";
import type { ChatRequest, ChatStreamEvent, ProviderAdapter } from "./types.js";

export interface AiwooCodexConfig {
  baseUrl: string;
  apiKey: string;
  firstByteTimeoutMs: number;
}

export class AiwooCodexAdapter implements ProviderAdapter {
  readonly id = "aiwoo-codex" as const;

  constructor(private readonly config: AiwooCodexConfig) {}

  async *stream(req: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const body: Record<string, unknown> = {
      model: req.model,
      stream: true,
      input: req.messages.map((m) => ({
        role: m.role,
        content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }]
      }))
    };
    if (req.systemPrompt) body.instructions = req.systemPrompt;

    try {
      const frames = streamUpstreamFrames({
        url: `${this.config.baseUrl}/v1/responses`,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          accept: "text/event-stream"
        },
        body,
        signal: req.signal,
        firstByteTimeoutMs: this.config.firstByteTimeoutMs
      });

      for await (const frame of frames) {
        const data = safeParse(frame.data);
        if (frame.event === "response.output_text.delta") {
          yield { type: "delta", textDelta: data?.delta ?? "" };
        } else if (frame.event === "response.completed") {
          const response = data?.response ?? {};
          yield {
            type: "done",
            finishReason: response.status ?? "completed",
            providerMessageId: response.id,
            usage: {
              inputTokens: response.usage?.input_tokens ?? 0,
              outputTokens: response.usage?.output_tokens ?? 0
            }
          };
          return;
        } else if (frame.event === "error" || frame.event === "response.failed") {
          const message = data?.error?.message ?? data?.response?.error?.message ?? "上游服务异常";
          yield { type: "error", error: { code: "UPSTREAM_ERROR", message } };
          return;
        }
      }
    } catch (err) {
      yield toErrorEvent(err);
    }
  }
}

function safeParse(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
