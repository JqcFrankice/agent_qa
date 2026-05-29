import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import healthRoute from "../../src/routes/health.js";

describe("GET /health", () => {
  it("returns ok with uptimeSec", async () => {
    const app = Fastify();
    await app.register(healthRoute);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptimeSec).toBe("number");
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
    await app.close();
  });
});
