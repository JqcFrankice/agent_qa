import type { FastifyPluginAsync } from "fastify";

const healthRoute: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    uptimeSec: Math.round(process.uptime())
  }));
};

export default healthRoute;
