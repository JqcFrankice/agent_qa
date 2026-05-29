import type { AppDb } from "../../db/client.js";

export interface AuthRouteDeps {
  db: AppDb;
  secureCookies: boolean;
  turnstileVerifier: (token: string, remoteIp?: string) => Promise<boolean>;
}
