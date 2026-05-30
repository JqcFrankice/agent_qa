import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER_ID, isKnownProvider, isKnownProviderModel, PROVIDER_MODELS } from "./models.js";

describe("provider model whitelist", () => {
  it("contains Claude and Codex providers", () => {
    expect(Object.keys(PROVIDER_MODELS)).toEqual(["aiwoo-claude", "aiwoo-codex"]);
  });

  it("validates provider/model pairs", () => {
    expect(isKnownProvider("aiwoo-claude")).toBe(true);
    expect(isKnownProvider("unknown")).toBe(false);
    expect(isKnownProviderModel("aiwoo-claude", PROVIDER_MODELS["aiwoo-claude"][0].id)).toBe(true);
    expect(isKnownProviderModel("aiwoo-claude", PROVIDER_MODELS["aiwoo-codex"][0].id)).toBe(false);
  });

  it("exposes a default provider that is known", () => {
    expect(DEFAULT_PROVIDER_ID).toBe("aiwoo-claude");
    expect(isKnownProvider(DEFAULT_PROVIDER_ID)).toBe(true);
  });
});
