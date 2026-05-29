import { describe, expect, it } from "vitest";
import { loginRequestSchema, registerRequestSchema } from "./auth.js";

describe("auth schemas", () => {
  it("accepts valid register input", () => {
    const parsed = registerRequestSchema.parse({
      username: "alice_123",
      password: "password123",
      inviteCode: "ABCDEFGHJKLM"
    });
    expect(parsed.username).toBe("alice_123");
  });

  it("rejects weak passwords", () => {
    expect(() => registerRequestSchema.parse({
      username: "alice",
      password: "short",
      inviteCode: "ABCDEFGHJKLM"
    })).toThrow();
  });

  it("accepts login input", () => {
    expect(loginRequestSchema.parse({ username: "alice", password: "password123" }).username).toBe("alice");
  });
});
