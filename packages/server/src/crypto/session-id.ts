import { randomBytes } from "node:crypto";

export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}
