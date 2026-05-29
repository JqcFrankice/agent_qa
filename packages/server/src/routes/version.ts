import type { FastifyPluginAsync } from "fastify";

interface VersionOpts {
  gitSha: string;
  buildTime: string;
  nodeEnv: string;
}

const versionRoute: FastifyPluginAsync<VersionOpts> = async (app, opts) => {
  app.get("/version", async () => ({
    gitSha: opts.gitSha,
    buildTime: opts.buildTime,
    nodeEnv: opts.nodeEnv
  }));
};

export default versionRoute;
