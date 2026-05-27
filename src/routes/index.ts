import "@fastify/static";  // side-effect import: 触发 module augmentation 把 sendFile 合并到 FastifyReply
import type { FastifyPluginAsync } from "fastify";

const indexRoute: FastifyPluginAsync = async (app) => {
  app.get("/", async (_req, reply) => {
    return reply.sendFile("index.html");
  });
};

export default indexRoute;
