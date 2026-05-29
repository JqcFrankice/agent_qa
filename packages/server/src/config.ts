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

export function loadConfig(): AppConfig {
  const parsed = schema.parse(process.env);
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
