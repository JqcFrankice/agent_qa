import { z } from "zod";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBuildInfo } from "./build-info.js";

const schema = z.object({
  PORT: z.coerce.number().int().positive(),
  HOST: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DB_PATH: z.string().min(1).default(":memory:")
});

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "test" | "production";
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  dbPath: string;
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
    publicDir,
    gitSha: buildInfo.gitSha,
    buildTime: buildInfo.buildTime
  };
}
