import { describe, expect, it } from "vitest";
import { checkRateLimit } from "../../../src/middleware/rate-limit.js";
import { createTestDb } from "../../helpers/test-db.js";

describe("checkRateLimit", () => {
  it("allows requests up to the limit within a window", () => {
    const db = createTestDb();
    const now = new Date("2026-05-29T00:00:00Z");
    expect(checkRateLimit(db, { key: "ip:1", limit: 2, windowMs: 60000, lockMs: 300000, now }).allowed).toBe(true);
    expect(checkRateLimit(db, { key: "ip:1", limit: 2, windowMs: 60000, lockMs: 300000, now }).allowed).toBe(true);
    const blocked = checkRateLimit(db, { key: "ip:1", limit: 2, windowMs: 60000, lockMs: 300000, now });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("starts a new bucket after the window and lock expire", () => {
    const db = createTestDb();
    const first = new Date("2026-05-29T00:00:00Z");
    const later = new Date("2026-05-29T00:06:00Z");
    checkRateLimit(db, { key: "ip:1", limit: 1, windowMs: 60000, lockMs: 300000, now: first });
    expect(checkRateLimit(db, { key: "ip:1", limit: 1, windowMs: 60000, lockMs: 300000, now: first }).allowed).toBe(false);
    expect(checkRateLimit(db, { key: "ip:1", limit: 1, windowMs: 60000, lockMs: 300000, now: later }).allowed).toBe(true);
  });
});
