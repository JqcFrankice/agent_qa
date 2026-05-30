import { z } from "zod";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isKnownProviderModel } from "@server-agent/shared";
import { loadBuildInfo } from "./build-info.js";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().min(1).default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DB_PATH: z.string().min(1).default(":memory:"),
  SESSION_COOKIE_SECRET: z.string().min(1).default("test-session-secret"),
  ANTHROPIC_AUTH_TOKEN: z.string().min(1).default("test-anthropic-token"),
  OPENAI_API_KEY: z.string().min(1).default("test-openai-key"),
  AIWOO_BASE_URL: z.string().url().default("https://aiwoo.vip"),
  DEFAULT_PROVIDER: z.enum(["aiwoo-claude", "aiwoo-codex"]).default("aiwoo-claude"),
  DEFAULT_MODEL: z.string().min(1).default("claude-opus-4-8"),
  UPSTREAM_FIRST_BYTE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000)
});

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  dbPath: string;
  sessionCookieSecret: string;
  anthropicAuthToken: string;
  openaiApiKey: string;
  aiwooBaseUrl: string;
  defaultProvider: "aiwoo-claude" | "aiwoo-codex";
  defaultModel: string;
  upstreamFirstByteTimeoutMs: number;
  publicDir: string;
  gitSha: string;
  buildTime: string;
}

function validateProductionSecrets(parsed: z.infer<typeof schema>): void {
  if (parsed.NODE_ENV !== "production") return;
  const placeholders = new Set([
    "test-session-secret",
    "replace-with-32-byte-random-secret"
  ]);
  if (parsed.SESSION_COOKIE_SECRET.length < 32 || placeholders.has(parsed.SESSION_COOKIE_SECRET)) {
    throw new Error("SESSION_COOKIE_SECRET must be a non-placeholder value with at least 32 characters in production");
  }
}

export function loadConfig(): AppConfig {
  const parsed = schema.parse(process.env);
  validateProductionSecrets(parsed);
  if (!isKnownProviderModel(parsed.DEFAULT_PROVIDER, parsed.DEFAULT_MODEL)) {
    throw new Error(`DEFAULT_MODEL "${parsed.DEFAULT_MODEL}" is not allowed for DEFAULT_PROVIDER "${parsed.DEFAULT_PROVIDER}"`);
  }
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
    anthropicAuthToken: parsed.ANTHROPIC_AUTH_TOKEN,
    openaiApiKey: parsed.OPENAI_API_KEY,
    aiwooBaseUrl: parsed.AIWOO_BASE_URL,
    defaultProvider: parsed.DEFAULT_PROVIDER,
    defaultModel: parsed.DEFAULT_MODEL,
    upstreamFirstByteTimeoutMs: parsed.UPSTREAM_FIRST_BYTE_TIMEOUT_MS,
    publicDir,
    gitSha: buildInfo.gitSha,
    buildTime: buildInfo.buildTime
  };
}
