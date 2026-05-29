import { describe, it, expect, beforeAll } from "vitest";

let buildApp: typeof import("../src/server.js").buildApp;

beforeAll(async () => {
  process.env.PORT = "8080";
  process.env.HOST = "127.0.0.1";
  process.env.NODE_ENV = "test";
  ({ buildApp } = await import("../src/server.js"));
});

describe("buildApp", () => {
  it("registers /health and returns ok", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    await app.close();
  });

  it("registers /version and returns build info shape", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/version" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.gitSha).toBe("string");
    expect(typeof body.buildTime).toBe("string");
    expect(body.nodeEnv).toBe("test");
    await app.close();
  });
});
