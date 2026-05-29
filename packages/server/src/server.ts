import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import type { AppDb } from "./db/client.js";
import { openDatabase } from "./db/client.js";
import { SessionRepository } from "./db/repositories/sessions.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { sessionMiddleware } from "./middleware/session.js";
import { verifyTurnstile } from "./middleware/turnstile.js";
import authRoutes from "./routes/auth/index.js";
import healthRoute from "./routes/health.js";
import versionRoute from "./routes/version.js";
import indexRoute from "./routes/index.js";

interface BuildAppOptions {
  db?: AppDb;
  turnstileVerifier?: (token: string, remoteIp?: string) => Promise<boolean>;
}

// 不显式标注返回类型：传入 pino 实例后 Fastify 实际推断出
// FastifyInstance<..., Logger<never, boolean>>，与默认的 FastifyBaseLogger
// 不兼容（fastify@4 + pino@9 的类型缝隙）。让 TS 推断更安全。
export async function buildApp(options: BuildAppOptions = {}) {
  const config = loadConfig();
  const db = options.db ?? openDatabase(config.dbPath);
  const app = Fastify({ logger });

  await app.register(fastifyCookie, {
    secret: config.sessionCookieSecret
  });
  app.addHook("onRequest", sessionMiddleware(new SessionRepository(db)));

  await app.register(fastifyStatic, {
    root: config.publicDir,
    serve: false
  });
  await app.register(healthRoute, { prefix: "/api" });
  await app.register(versionRoute, {
    prefix: "/api",
    gitSha: config.gitSha,
    buildTime: config.buildTime,
    nodeEnv: config.nodeEnv
  });
  await app.register(authRoutes, {
    prefix: "/api/auth",
    db,
    secureCookies: config.nodeEnv === "production",
    turnstileVerifier: options.turnstileVerifier ?? ((token, remoteIp) => verifyTurnstile(config.turnstileSecretKey, token, remoteIp))
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
