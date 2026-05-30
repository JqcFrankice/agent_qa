import { z } from "zod";
import { isKnownProviderModel, PROVIDER_MODELS } from "../providers/models.js";

export const providerIdSchema = z.enum(["aiwoo-claude", "aiwoo-codex"]);

export const createConversationRequestSchema = z.object({
  provider: providerIdSchema,
  model: z.string().min(1),
  systemPrompt: z.string().max(4000).optional()
}).superRefine((value, ctx) => {
  if (!isKnownProviderModel(value.provider, value.model)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "model is not allowed for provider" });
  }
});

export const updateConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(80).optional()
}).refine((value) => value.title !== undefined, { message: "title is required" });

export const createMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(32000)
});

export interface ConversationDto {
  id: string;
  title: string | null;
  provider: keyof typeof PROVIDER_MODELS;
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
