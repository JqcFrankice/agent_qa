import { z } from "zod";
import { providerIdSchema } from "./conversations.js";

export const skillTitleSchema = z.string().trim().min(1).max(80);
export const skillDescriptionSchema = z.string().trim().max(280);
export const skillSystemPromptSchema = z.string().trim().min(1).max(8000);

const baseField = {
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "name must be lowercase identifier"),
  label: z.string().trim().min(1).max(80),
  required: z.boolean().optional()
};

export const skillInputFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...baseField, type: z.literal("text"), placeholder: z.string().max(200).optional() }),
  z.object({ ...baseField, type: z.literal("textarea"), placeholder: z.string().max(200).optional() }),
  z.object({
    ...baseField,
    type: z.literal("select"),
    options: z.array(z.object({
      value: z.string().min(1).max(80),
      label: z.string().trim().min(1).max(80)
    })).min(1).max(50)
  })
]);

export const skillInputSchemaSchema = z.array(skillInputFieldSchema).max(20);

export const skillTagsSchema = z.array(
  z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "tag must be lowercase + hyphen, 1-32 chars")
).max(8);

export type SkillInputField = z.infer<typeof skillInputFieldSchema>;

export const createSkillRequestSchema = z.object({
  title: skillTitleSchema,
  description: skillDescriptionSchema.optional(),
  systemPrompt: skillSystemPromptSchema,
  defaultProvider: providerIdSchema.optional(),
  defaultModel: z.string().min(1).optional(),
  isPublic: z.boolean().optional(),
  inputSchema: skillInputSchemaSchema.nullable().optional(),
  tags: skillTagsSchema.optional()
});

export const updateSkillRequestSchema = z.object({
  title: skillTitleSchema.optional(),
  description: skillDescriptionSchema.optional(),
  systemPrompt: skillSystemPromptSchema.optional(),
  defaultProvider: providerIdSchema.nullable().optional(),
  defaultModel: z.string().min(1).nullable().optional(),
  isPublic: z.boolean().optional(),
  inputSchema: skillInputSchemaSchema.nullable().optional(),
  tags: skillTagsSchema.optional()
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
  inputSchema: SkillInputField[] | null;
  tags: string[];
  slug: string | null;
  isSystem: boolean;
}

export interface SkillDraftDto {
  title: string;
  systemPrompt: string;
}
