import { describe, expect, it } from "vitest";
import { newInviteCode } from "../../../src/crypto/invite-code.js";
import { hashPassword, verifyPassword } from "../../../src/crypto/argon2.js";
import { newSessionId } from "../../../src/crypto/session-id.js";

describe("auth crypto helpers", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("password123");
    expect(await verifyPassword(hash, "password123")).toBe(true);
    expect(await verifyPassword(hash, "wrongpassword123")).toBe(false);
  });

  it("creates long base64url session ids", () => {
    const id = newSessionId();
    expect(id.length).toBeGreaterThanOrEqual(40);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("creates 12 character invite codes without ambiguous characters", () => {
    const code = newInviteCode();
    expect(code).toHaveLength(12);
    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]+$/);
    expect(code).not.toMatch(/[0OIL]/);
  });
});
