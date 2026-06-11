import { z } from "zod";
import { providerIdSchema } from "./conversations.js";

export const skillTitleSchema = z.string().trim().min(1).max(80);
export const skillDescriptionSchema = z.string().trim().max(280);
export const skillSystemPromptSchema = z.string().trim().min(1).max(8000);

export const createSkillRequestSchema = z.object({
  title: skillTitleSchema,
  description: skillDescriptionSchema.optional(),
  systemPrompt: skillSystemPromptSchema,
  defaultProvider: providerIdSchema.optional(),
  defaultModel: z.string().min(1).optional(),
  isPublic: z.boolean().optional()
});

export const updateSkillRequestSchema = z.object({
  title: skillTitleSchema.optional(),
  description: skillDescriptionSchema.optional(),
  systemPrompt: skillSystemPromptSchema.optional(),
  defaultProvider: providerIdSchema.nullable().optional(),
  defaultModel: z.string().min(1).nullable().optional(),
  isPublic: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, { message: "no fields to update" });

export const extractSkillRequestSchema = z.object({
  conversationId: z.string().min(1)
});

export interface SkillDto {
  id: number;
  title: string;
  description: string;
  systemPrompt: string;
  defaultProvider: string | null;
  defaultModel: string | null;
  isPublic: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorUsername: string;
  isOwn: boolean;
}

export interface SkillDraftDto {
  title: string;
  systemPrompt: string;
}
