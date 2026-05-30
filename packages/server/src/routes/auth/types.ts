import type { AppDb } from "../../db/client.js";

export interface AuthRouteDeps {
  db: AppDb;
  secureCookies: boolean;
}
