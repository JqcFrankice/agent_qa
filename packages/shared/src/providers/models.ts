export const PROVIDER_MODELS = {
  "aiwoo-claude": [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
  ],
  "aiwoo-codex": [
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" }
  ]
} as const;

export type ProviderId = keyof typeof PROVIDER_MODELS;
export type ProviderModel = (typeof PROVIDER_MODELS)[ProviderId][number]["id"];

export const DEFAULT_PROVIDER_ID: ProviderId = "aiwoo-claude";

export function isKnownProvider(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDER_MODELS, value);
}

export function isKnownProviderModel(provider: string, model: string): boolean {
  if (!isKnownProvider(provider)) return false;
  return PROVIDER_MODELS[provider].some((item) => item.id === model);
}
