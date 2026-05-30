import { randomBytes } from "node:crypto";

export function newDbId(): string {
  return randomBytes(16).toString("base64url");
}
