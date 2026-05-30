import { streamUpstreamFrames, toErrorEvent } from "./base.js";
import type { ChatRequest, ChatStreamEvent, ProviderAdapter } from "./types.js";

export interface AiwooClaudeConfig {
  baseUrl: string;
  authToken: string;
  firstByteTimeoutMs: number;
}

export class AiwooClaudeAdapter implements ProviderAdapter {
  readonly id = "aiwoo-claude" as const;

  constructor(private readonly config: AiwooClaudeConfig) {}

  async *stream(req: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: 8192,
      stream: true,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content }))
    };
    if (req.systemPrompt) body.system = req.systemPrompt;

    let providerMessageId: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: string | undefined;

    let frames;
    try {
      frames = streamUpstreamFrames({
        url: `${this.config.baseUrl}/v1/messages`,
        headers: {
          "x-api-key": this.config.authToken,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          accept: "text/event-stream"
        },
        body,
        signal: req.signal,
        firstByteTimeoutMs: this.config.firstByteTimeoutMs
      });

      for await (const frame of frames) {
        const data = safeParse(frame.data);
        if (frame.event === "message_start") {
          providerMessageId = data?.message?.id;
          inputTokens = data?.message?.usage?.input_tokens ?? inputTokens;
        } else if (frame.event === "content_block_delta") {
          if (data?.delta?.type === "text_delta") {
            yield { type: "delta", textDelta: data.delta.text ?? "" };
          }
        } else if (frame.event === "message_delta") {
          finishReason = data?.delta?.stop_reason ?? finishReason;
          outputTokens = data?.usage?.output_tokens ?? outputTokens;
        } else if (frame.event === "error") {
          yield { type: "error", error: { code: "UPSTREAM_ERROR", message: data?.error?.message ?? "上游服务异常" } };
          return;
        } else if (frame.event === "message_stop") {
          yield {
            type: "done",
            finishReason: finishReason ?? "end_turn",
            providerMessageId,
            usage: { inputTokens, outputTokens }
          };
          return;
        }
      }
    } catch (err) {
      yield toErrorEvent(err);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeParse(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
