export type StreamEvent =
  | { type: "ready"; assistantMessageId: string }
  | { type: "delta"; text: string }
  | { type: "done"; finishReason?: string; usage?: { inputTokens: number; outputTokens: number } }
  | { type: "error"; code: string; message: string };

export async function* streamMessage(
  conversationId: string,
  content: string,
  signal: AbortSignal
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    credentials: "include",
    signal
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    yield { type: "error", code: err.error?.code ?? "INTERNAL", message: err.error?.message ?? "请求失败" };
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const parsed = parseSSE(frame);
      if (parsed) yield parsed;
    }
  }
}

function parseSSE(frame: string): StreamEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const data = safeParse(dataLines.join("\n"));
  if (!data) return null;

  switch (event) {
    case "ready":
      return { type: "ready", assistantMessageId: String(data.assistantMessageId ?? "") };
    case "delta":
      return { type: "delta", text: typeof data.text === "string" ? data.text : "" };
    case "done":
      return {
        type: "done",
        finishReason: data.finishReason as string | undefined,
        usage: data.usage as { inputTokens: number; outputTokens: number } | undefined
      };
    case "error":
      return {
        type: "error",
        code: typeof data.code === "string" ? data.code : "INTERNAL",
        message: typeof data.message === "string" ? data.message : "上游服务异常"
      };
    default:
      return null;
  }
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
