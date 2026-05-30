import { AiwooClaudeAdapter } from "./aiwoo-claude.js";
import { AiwooCodexAdapter } from "./aiwoo-codex.js";
import type { ProviderAdapter } from "./types.js";
import { AppError } from "../errors.js";
import type { AppConfig } from "../config.js";

export function createProviderRegistry(config: AppConfig): Record<string, ProviderAdapter> {
  return {
    "aiwoo-claude": new AiwooClaudeAdapter({
      baseUrl: config.aiwooBaseUrl,
      authToken: config.anthropicAuthToken,
      firstByteTimeoutMs: config.upstreamFirstByteTimeoutMs
    }),
    "aiwoo-codex": new AiwooCodexAdapter({
      baseUrl: config.aiwooBaseUrl,
      apiKey: config.openaiApiKey,
      firstByteTimeoutMs: config.upstreamFirstByteTimeoutMs
    })
  };
}

export function getProvider(registry: Record<string, ProviderAdapter>, id: string): ProviderAdapter {
  const adapter = registry[id];
  if (!adapter) {
    throw new AppError(400, "CONV_VALIDATION", `unknown provider: ${id}`);
  }
  return adapter;
}
