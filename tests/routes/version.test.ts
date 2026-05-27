import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import versionRoute from "../../src/routes/version.js";

describe("GET /version", () => {
  it("returns gitSha, buildTime, nodeEnv", async () => {
    const app = Fastify();
    await app.register(versionRoute, {
      gitSha: "abc1234",
      buildTime: "2026-05-27T00:00:00Z",
      nodeEnv: "production"
    });
    const res = await app.inject({ method: "GET", url: "/version" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      gitSha: "abc1234",
      buildTime: "2026-05-27T00:00:00Z",
      nodeEnv: "production"
    });
    await app.close();
  });
});
