import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("config", () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it("loads valid env with defaults", async () => {
    process.env.PORT = "8080";
    process.env.HOST = "0.0.0.0";
    process.env.NODE_ENV = "production";
    delete process.env.LOG_LEVEL;
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig();
    expect(cfg.port).toBe(8080);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.nodeEnv).toBe("production");
    expect(cfg.logLevel).toBe("info");
  });

  it("throws on invalid PORT", async () => {
    process.env.PORT = "not-a-number";
    process.env.HOST = "0.0.0.0";
    process.env.NODE_ENV = "production";
    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow();
  });
});
