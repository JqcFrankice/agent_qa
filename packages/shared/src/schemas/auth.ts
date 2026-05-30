import { z } from "zod";
import { passwordSchema, usernameSchema } from "./user.js";

export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1)
});

export const registerRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  inviteCode: z.string().min(1).max(64)
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
