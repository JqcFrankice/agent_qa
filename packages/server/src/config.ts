import { z } from "zod";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBuildInfo } from "./build-info.js";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().min(1).default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DB_PATH: z.string().min(1).default(":memory:"),
  SESSION_COOKIE_SECRET: z.string().min(1).default("test-session-secret"),
  TURNSTILE_SECRET_KEY: z.string().min(1).default("test-turnstile-secret"),
  TURNSTILE_SITE_KEY: z.string().min(1).default("test-turnstile-site-key")
});

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  dbPath: string;
  sessionCookieSecret: string;
  turnstileSecretKey: string;
  turnstileSiteKey: string;
  publicDir: string;
  gitSha: string;
  buildTime: string;
}

function validateProductionSecrets(parsed: z.infer<typeof schema>): void {
  if (parsed.NODE_ENV !== "production") return;
  const placeholders = new Set([
    "test-session-secret",
    "test-turnstile-secret",
    "test-turnstile-site-key",
    "replace-with-32-byte-random-secret",
    "replace-with-cloudflare-turnstile-secret",
    "replace-with-cloudflare-turnstile-site-key"
  ]);
  if (parsed.SESSION_COOKIE_SECRET.length < 32 || placeholders.has(parsed.SESSION_COOKIE_SECRET)) {
    throw new Error("SESSION_COOKIE_SECRET must be a non-placeholder value with at least 32 characters in production");
  }
  if (placeholders.has(parsed.TURNSTILE_SECRET_KEY) || placeholders.has(parsed.TURNSTILE_SITE_KEY)) {
    throw new Error("Turnstile keys must be non-placeholder values in production");
  }
}

export function loadConfig(): AppConfig {
  const parsed = schema.parse(process.env);
  validateProductionSecrets(parsed);
  const here = dirname(fileURLToPath(import.meta.url));
  const publicDir = resolve(here, "..", "public");
  const buildInfo = loadBuildInfo();
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    dbPath: parsed.DB_PATH,
    sessionCookieSecret: parsed.SESSION_COOKIE_SECRET,
    turnstileSecretKey: parsed.TURNSTILE_SECRET_KEY,
    turnstileSiteKey: parsed.TURNSTILE_SITE_KEY,
    publicDir,
    gitSha: buildInfo.gitSha,
    buildTime: buildInfo.buildTime
  };
}
