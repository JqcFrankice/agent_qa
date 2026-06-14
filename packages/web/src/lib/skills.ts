import type { SkillDto, SkillDraftDto, SkillInputField } from "@server-agent/shared";
import { ApiError, type ApiErrorBody } from "./api.js";

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

export interface SkillInput {
  title: string;
  description?: string;
  systemPrompt: string;
  defaultProvider?: string;
  defaultModel?: string;
  isPublic?: boolean;
  inputSchema?: SkillInputField[] | null;
  tags?: string[];
}

export function listSkills() {
  return request<{ skills: SkillDto[] }>("/api/skills");
}

export function createSkill(input: SkillInput) {
  return request<{ skill: SkillDto }>("/api/skills", { method: "POST", body: JSON.stringify(input) });
}

export function updateSkill(id: number, patch: Partial<SkillInput>) {
  return request<{ skill: SkillDto }>(`/api/skills/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteSkill(id: number) {
  return request<{ ok: true }>(`/api/skills/${id}`, { method: "DELETE" });
}

export function extractSkillFromConversation(conversationId: string) {
  return request<{ draft: SkillDraftDto }>(`/api/conversations/${conversationId}/extract-skill`, { method: "POST" });
}
