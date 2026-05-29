import type { AppDb } from "../db/client.js";

interface RateLimitInput {
  key: string;
  limit: number;
  windowMs: number;
  lockMs: number;
  now?: Date;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSec?: number;
}

interface RawDb {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
  };
}

interface BucketRow {
  key: string;
  count: number;
  window_start: number;
  locked_until: number | null;
}

export function checkRateLimit(db: AppDb, input: RateLimitInput): RateLimitResult {
  const raw = (db as unknown as { $client?: RawDb; session?: { client?: RawDb } }).$client
    ?? (db as unknown as { session?: { client?: RawDb } }).session?.client;
  if (!raw) throw new Error("Unsupported database client");

  raw.exec("CREATE TABLE IF NOT EXISTS rate_limit_buckets (key text PRIMARY KEY NOT NULL, count integer NOT NULL, window_start integer NOT NULL, locked_until integer)");
  const nowMs = (input.now ?? new Date()).getTime();
  const row = raw.prepare("SELECT key, count, window_start, locked_until FROM rate_limit_buckets WHERE key = ?").get(input.key) as BucketRow | undefined;

  if (!row || nowMs - row.window_start >= input.windowMs) {
    raw.prepare("INSERT OR REPLACE INTO rate_limit_buckets (key, count, window_start, locked_until) VALUES (?, 1, ?, null)").run(input.key, nowMs);
    return { allowed: true };
  }

  if (row.locked_until && row.locked_until > nowMs) {
    return { allowed: false, retryAfterSec: Math.ceil((row.locked_until - nowMs) / 1000) };
  }

  if (row.count >= input.limit) {
    const lockedUntil = nowMs + input.lockMs;
    raw.prepare("UPDATE rate_limit_buckets SET locked_until = ? WHERE key = ?").run(lockedUntil, input.key);
    return { allowed: false, retryAfterSec: Math.ceil(input.lockMs / 1000) };
  }

  raw.prepare("UPDATE rate_limit_buckets SET count = count + 1 WHERE key = ?").run(input.key);
  return { allowed: true };
}
