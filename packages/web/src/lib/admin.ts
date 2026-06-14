import type { SkillInputField } from "@server-agent/shared";
import { ApiError, type ApiErrorBody } from "./api.js";

export interface AdminSkillDto {
  id: number;
  title: string;
  description: string;
  systemPrompt: string;
  inputSchema: SkillInputField[] | null;
  tags: string[];
  slug: string | null;
  version: number;
  reviewStatus: "pending" | "approved" | "rejected";
  rejectReason: string | null;
  publishedAt: string | null;
  createdAt: string;
  authorUsername: string;
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

export function listAdminSkills(status: "pending" | "approved" | "rejected" = "pending") {
  return request<{ skills: AdminSkillDto[] }>(`/api/admin/skills?status=${status}`);
}

export function approveSkill(id: number) {
  return request<{ ok: true }>(`/api/admin/skills/${id}/approve`, { method: "POST" });
}

export function rejectSkill(id: number, reason: string) {
  return request<{ ok: true }>(`/api/admin/skills/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}
