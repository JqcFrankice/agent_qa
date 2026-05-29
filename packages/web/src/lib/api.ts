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
