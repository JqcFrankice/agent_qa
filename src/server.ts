import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import healthRoute from "./routes/health.js";
import versionRoute from "./routes/version.js";
import indexRoute from "./routes/index.js";

// 不显式标注返回类型：传入 pino 实例后 Fastify 实际推断出
// FastifyInstance<..., Logger<never, boolean>>，与默认的 FastifyBaseLogger
// 不兼容（fastify@4 + pino@9 的类型缝隙）。让 TS 推断更安全。
export async function buildApp() {
  const config = loadConfig();
  const app = Fastify({ logger });

  await app.register(fastifyStatic, {
    root: config.publicDir,
    serve: false  // 我们手动用 sendFile，不让它自动 mount /
  });
  await app.register(healthRoute);
  await app.register(versionRoute, {
    gitSha: config.gitSha,
    buildTime: config.buildTime,
    nodeEnv: config.nodeEnv
  });
  await app.register(indexRoute);

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp();

  const close = async (sig: string): Promise<void> => {
    logger.info({ sig }, "shutdown");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void close("SIGTERM"));
  process.on("SIGINT", () => void close("SIGINT"));

  await app.listen({ host: config.host, port: config.port });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, "fatal");
    process.exit(1);
  });
}
