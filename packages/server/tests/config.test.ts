import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("config", () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it("loads valid production env", async () => {
    process.env.PORT = "8080";
    process.env.HOST = "127.0.0.1";
    process.env.NODE_ENV = "production";
    process.env.DB_PATH = "/tmp/server-agent.sqlite";
    process.env.SESSION_COOKIE_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.TURNSTILE_SECRET_KEY = "0x4AAAA-real-secret";
    process.env.TURNSTILE_SITE_KEY = "0x4AAAA-real-site";
    delete process.env.LOG_LEVEL;
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig();
    expect(cfg.port).toBe(8080);
    expect(cfg.host).toBe("127.0.0.1");
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

  it("rejects production placeholder secrets", async () => {
    process.env.PORT = "8080";
    process.env.HOST = "127.0.0.1";
    process.env.NODE_ENV = "production";
    process.env.DB_PATH = "/tmp/server-agent.sqlite";
    process.env.SESSION_COOKIE_SECRET = "replace-with-32-byte-random-secret";
    process.env.TURNSTILE_SECRET_KEY = "replace-with-cloudflare-turnstile-secret";
    process.env.TURNSTILE_SITE_KEY = "replace-with-cloudflare-turnstile-site-key";
    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow();
  });
});
