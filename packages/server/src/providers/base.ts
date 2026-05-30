import { SseFrameParser, type SseFrame } from "./sse-parser.js";
import type { ChatStreamEvent } from "./types.js";

export interface UpstreamError {
  code: string;
  message: string;
}

export function mapHttpStatus(status: number, bodyText: string): UpstreamError {
  if (status === 503 && /model_not_found/.test(bodyText)) {
    return { code: "UPSTREAM_MODEL_UNAVAILABLE", message: "上游模型不可用" };
  }
  if (status >= 400 && status < 500) {
    return { code: "UPSTREAM_BAD_REQUEST", message: "上游请求被拒绝" };
  }
  return { code: "UPSTREAM_ERROR", message: "上游服务异常" };
}

interface StreamFramesOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
  firstByteTimeoutMs: number;
}

/**
 * POST to upstream, enforce a first-byte timeout, and yield decoded SSE frames.
 * On non-2xx, yields nothing and throws an UpstreamError-shaped object via the
 * caller's error mapping (caller catches by reading status before iterating).
 */
export async function* streamUpstreamFrames(options: StreamFramesOptions): AsyncGenerator<SseFrame, void, unknown> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal.addEventListener("abort", onAbort, { once: true });

  let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
  const armFirstByteTimeout = () => {
    firstByteTimer = setTimeout(() => controller.abort(new FirstByteTimeoutError()), options.firstByteTimeoutMs);
  };

  try {
    armFirstByteTimeout();
    const response = await fetch(options.url, {
      method: "POST",
      headers: options.headers,
      body: JSON.stringify(options.body),
      signal: controller.signal
    });

    if (!response.ok || !response.body) {
      const bodyText = await response.text().catch(() => "");
      throw new UpstreamHttpError(response.status, bodyText);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseFrameParser();
    let receivedFirstByte = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!receivedFirstByte) {
        receivedFirstByte = true;
        if (firstByteTimer) clearTimeout(firstByteTimer);
      }
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        yield frame;
      }
    }
  } finally {
    if (firstByteTimer) clearTimeout(firstByteTimer);
    options.signal.removeEventListener("abort", onAbort);
  }
}

export class FirstByteTimeoutError extends Error {
  constructor() {
    super("first byte timeout");
    this.name = "FirstByteTimeoutError";
  }
}

export class UpstreamHttpError extends Error {
  constructor(public readonly status: number, public readonly bodyText: string) {
    super(`upstream http ${status}`);
    this.name = "UpstreamHttpError";
  }
}

export function toErrorEvent(err: unknown): ChatStreamEvent {
  if (err instanceof UpstreamHttpError) {
    return { type: "error", error: mapHttpStatus(err.status, err.bodyText) };
  }
  if (err instanceof FirstByteTimeoutError) {
    return { type: "error", error: { code: "UPSTREAM_TIMEOUT", message: "上游响应超时" } };
  }
  throw err;
}
