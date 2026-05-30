export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  signal: AbortSignal;
}

export interface ChatStreamEvent {
  type: "delta" | "done" | "error";
  textDelta?: string;
  finishReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  providerMessageId?: string;
  error?: { code: string; message: string };
}

export interface ProviderAdapter {
  readonly id: "aiwoo-claude" | "aiwoo-codex";
  stream(req: ChatRequest): AsyncIterable<ChatStreamEvent>;
}
