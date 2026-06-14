import { z } from "zod";

export const usernameSchema = z.string().regex(/^[a-zA-Z0-9_-]{3,32}$/, "用户名只能包含字母、数字、下划线和短横线，长度 3-32");
export const passwordSchema = z.string().min(10, "密码至少 10 位").regex(/[A-Za-z]/, "密码必须包含字母").regex(/[0-9]/, "密码必须包含数字");

export const userRoleSchema = z.enum(["user", "admin"]);

export interface UserDto {
  id: number;
  username: string;
  createdAt: string;
  role: "user" | "admin";
}
