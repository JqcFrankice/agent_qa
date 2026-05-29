import type { FastifyPluginAsync } from "fastify";
import { loginRoute } from "./login.js";
import { logoutRoute } from "./logout.js";
import { meRoute } from "./me.js";
import { registerRoute } from "./register.js";
import type { AuthRouteDeps } from "./types.js";

const authRoutes: FastifyPluginAsync<AuthRouteDeps> = async (app, deps) => {
  await registerRoute(app, deps);
  await loginRoute(app, deps);
  await logoutRoute(app, deps);
  await meRoute(app);
};

export default authRoutes;
