export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = body as ApiErrorBody;
    throw new ApiError(error.error?.code ?? "INTERNAL", error.error?.message ?? "请求失败", res.status);
  }
  return body as T;
}

export interface User {
  id: number;
  username: string;
  createdAt: string;
}

export function login(input: { username: string; password: string }) {
  return request<{ ok: true; user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function register(input: { username: string; password: string; inviteCode: string }) {
  return request<{ ok: true }>("/api/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export function logout() {
  return request<{ ok: true }>("/api/auth/logout", { method: "POST" });
}

export function me() {
  return request<{ user: User }>("/api/auth/me");
}

export interface ConversationDto {
  id: string;
  title: string | null;
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "aborted" | "error";
  errorCode: string | null;
  createdAt: string;
}

export function listConversations() {
  return request<{ conversations: ConversationDto[] }>("/api/conversations");
}

export function createConversation(input: { provider: string; model: string; systemPrompt?: string }) {
  return request<{ conversation: ConversationDto }>("/api/conversations", { method: "POST", body: JSON.stringify(input) });
}

export function renameConversation(id: string, title: string) {
  return request<{ conversation: ConversationDto }>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
}

export function deleteConversation(id: string) {
  return request<{ ok: true }>(`/api/conversations/${id}`, { method: "DELETE" });
}

export function listMessages(conversationId: string) {
  return request<{ messages: MessageDto[] }>(`/api/conversations/${conversationId}/messages`);
}
