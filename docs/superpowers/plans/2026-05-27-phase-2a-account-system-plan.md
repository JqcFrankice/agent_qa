# Phase 2a Account System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Phase 1 single Fastify service into an HTTPS, workspace-based app with SQLite persistence, invite-only account registration/login, cookie sessions, admin CLI, and a React/Tailwind frontend.

**Architecture:** Move the current flat `src/` service into `packages/server`, add `packages/shared` for zod schemas used by server and web, and add `packages/web` for a Vite SPA served by Caddy. Server persistence uses Drizzle over SQLite with forward-only migrations; deploy applies migrations before build/restart so migration failure does not take down the running service.

**Tech Stack:** Node 22, TypeScript ESM, npm workspaces, Fastify, Drizzle ORM, better-sqlite3, argon2, @fastify/cookie, Vitest, React, Vite, Tailwind CSS, TanStack Query, Cloudflare Turnstile, Caddy v2, systemd.

---

## Pre-flight

**Files:**
- Read: `package.json`
- Read: `src/server.ts`
- Read: `src/config.ts`
- Read: `scripts/deploy-agent.sh`
- Read: `scripts/bootstrap-server.sh`
- Read: `.github/workflows/deploy.yml`

- [ ] **Step 1: Confirm clean branch**

Run:
```bash
git branch --show-current
git status --short
```
Expected: work happens on a feature branch or with explicit approval for `main`; status is clean.

- [ ] **Step 2: Confirm Phase 1 baseline passes**

Run:
```bash
npm run lint && npm run typecheck && npm test && npm run build
```
Expected: all commands exit 0.

---

## File structure after Task 1

```text
server_agent/
├── package.json
├── tsconfig.base.json
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── schemas/user.ts
│   │       ├── schemas/auth.ts
│   │       ├── schemas/index.ts
│   │       └── index.ts
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   ├── src/
│   │   │   ├── build-info.ts
│   │   │   ├── config.ts
│   │   │   ├── errors.ts
│   │   │   ├── logger.ts
│   │   │   ├── server.ts
│   │   │   ├── crypto/
│   │   │   ├── db/
│   │   │   ├── middleware/
│   │   │   └── routes/
│   │   └── tests/
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
├── deploy/
│   ├── Caddyfile
│   ├── agent.env.example
│   └── server-agent.service
└── scripts/
    ├── admin-cli.ts
    ├── bootstrap-server.sh
    ├── deploy-agent.sh
    └── write-build-info.mjs
```

---

## Task 1: npm workspaces and Phase 1 server migration

**Files:**
- Modify: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Move: `src/**` → `packages/server/src/**`
- Move: `tests/**` → `packages/server/tests/**`
- Modify: `scripts/write-build-info.mjs`
- Modify: `vitest.config.ts`
- Modify: `eslint.config.js`

- [ ] **Step 1: Rewrite root package scripts for workspaces**

Modify root `package.json`:
```json
{
  "name": "server-agent-root",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "dev": "npm run dev --workspace=@server-agent/server",
    "start": "npm run start --workspace=@server-agent/server",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "admin": "tsx scripts/admin-cli.ts",
    "db:migrate": "npm run db:migrate --workspace=@server-agent/server"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "eslint": "^9.11.1",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "typescript-eslint": "^8.8.0",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Add base tsconfig**

Create `tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 3: Create server package manifest**

Create `packages/server/package.json`:
```json
{
  "name": "@server-agent/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p . && node ../../scripts/write-build-info.mjs",
    "start": "node dist/server.js",
    "test": "vitest run",
    "lint": "eslint src tests",
    "typecheck": "tsc -p . --noEmit",
    "db:migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "@fastify/cookie": "^9.4.0",
    "@fastify/static": "^7.0.4",
    "@server-agent/shared": "0.1.0",
    "argon2": "^0.41.1",
    "better-sqlite3": "^11.3.0",
    "commander": "^12.1.0",
    "drizzle-orm": "^0.33.0",
    "fastify": "^4.28.1",
    "pino": "^9.4.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11"
  }
}
```

- [ ] **Step 4: Create server tsconfig**

Create `packages/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 5: Move Phase 1 server files**

Run:
```bash
mkdir -p packages/server && git mv src packages/server/src && git mv tests packages/server/tests
```
Expected: tracked files move into `packages/server`.

- [ ] **Step 6: Update build-info script output path**

Modify `scripts/write-build-info.mjs` so it writes to `packages/server/dist/build-info.json`:
```js
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

const out = resolve("packages/server/dist/build-info.json");
const gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
const buildTime = new Date().toISOString();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ gitSha, buildTime }, null, 2));
```

- [ ] **Step 7: Update eslint and vitest paths**

Modify `eslint.config.js` to lint `packages/server/src` and `packages/server/tests` instead of root `src tests`.
Modify `vitest.config.ts` test include to `packages/*/tests/**/*.test.ts` and `packages/*/src/**/*.test.ts`.

- [ ] **Step 8: Install dependencies and verify**

Run:
```bash
npm install && npm run lint && npm run typecheck && npm test && npm run build
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json packages scripts/write-build-info.mjs eslint.config.js vitest.config.ts
git commit -m "refactor: move server into npm workspace"
```

---

## Task 2: Shared schemas package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/schemas/user.ts`
- Create: `packages/shared/src/schemas/auth.ts`
- Create: `packages/shared/src/schemas/index.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/schemas/auth.test.ts`

- [ ] **Step 1: Create shared package**

Create `packages/shared/package.json`:
```json
{
  "name": "@server-agent/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc -p . --noEmit"
  },
  "dependencies": { "zod": "^3.23.8" }
}
```

Create `packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Write schema tests**

Create `packages/shared/src/schemas/auth.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loginRequestSchema, registerRequestSchema } from "./auth.js";

describe("auth schemas", () => {
  it("accepts valid register input", () => {
    const parsed = registerRequestSchema.parse({
      username: "alice_123",
      password: "password123",
      inviteCode: "ABCDEFGHJKLM",
      turnstileToken: "token"
    });
    expect(parsed.username).toBe("alice_123");
  });

  it("rejects weak passwords", () => {
    expect(() => registerRequestSchema.parse({
      username: "alice",
      password: "short",
      inviteCode: "ABCDEFGHJKLM",
      turnstileToken: "token"
    })).toThrow();
  });

  it("accepts login input", () => {
    expect(loginRequestSchema.parse({ username: "alice", password: "password123" }).username).toBe("alice");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
npm run test --workspace=@server-agent/shared -- auth.test.ts
```
Expected: FAIL because schemas do not exist.

- [ ] **Step 4: Implement user schema**

Create `packages/shared/src/schemas/user.ts`:
```ts
import { z } from "zod";

export const usernameSchema = z.string().regex(/^[a-zA-Z0-9_-]{3,32}$/, "用户名只能包含字母、数字、下划线和短横线，长度 3-32");
export const passwordSchema = z.string().min(10, "密码至少 10 位").regex(/[A-Za-z]/, "密码必须包含字母").regex(/[0-9]/, "密码必须包含数字");

export interface UserDto {
  id: number;
  username: string;
  createdAt: string;
}
```

- [ ] **Step 5: Implement auth schema**

Create `packages/shared/src/schemas/auth.ts`:
```ts
import { z } from "zod";
import { passwordSchema, usernameSchema } from "./user.js";

export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1)
});

export const registerRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  inviteCode: z.string().min(1).max(64),
  turnstileToken: z.string().min(1)
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
```

- [ ] **Step 6: Add exports**

Create `packages/shared/src/schemas/index.ts`:
```ts
export * from "./auth.js";
export * from "./user.js";
```

Create `packages/shared/src/index.ts`:
```ts
export * from "./schemas/index.js";
```

- [ ] **Step 7: Verify and commit**

Run:
```bash
npm run test --workspace=@server-agent/shared && npm run typecheck --workspace=@server-agent/shared
```
Expected: PASS.

Commit:
```bash
git add packages/shared package.json package-lock.json
git commit -m "feat(shared): add auth schemas"
```

---

## Task 3: SQLite, Drizzle schema, migrations, and repositories

**Files:**
- Create: `packages/server/drizzle.config.ts`
- Create: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/db/client.ts`
- Create: `packages/server/src/db/migrate.ts`
- Create: `packages/server/src/db/migrations/0000_initial.sql`
- Create: `packages/server/src/db/repositories/users.ts`
- Create: `packages/server/src/db/repositories/sessions.ts`
- Create: `packages/server/src/db/repositories/invites.ts`
- Test: `packages/server/tests/helpers/test-db.ts`
- Test: `packages/server/tests/unit/repositories/auth-repositories.test.ts`

- [ ] **Step 1: Write repository tests**

Create `packages/server/tests/unit/repositories/auth-repositories.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { InviteRepository } from "../../../src/db/repositories/invites.js";
import { SessionRepository } from "../../../src/db/repositories/sessions.js";
import { UserRepository } from "../../../src/db/repositories/users.js";

describe("auth repositories", () => {
  it("creates users and finds by username", async () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    const user = await users.create("alice", "hash");
    expect(user.id).toBeGreaterThan(0);
    expect((await users.findByUsername("alice"))?.passwordHash).toBe("hash");
  });

  it("consumes invite uses", async () => {
    const db = createTestDb();
    const invites = new InviteRepository(db);
    await invites.create({ code: "ABCDEFGHJKLM", usesRemaining: 1, createdBy: "test", note: "unit" });
    expect(await invites.consume("ABCDEFGHJKLM")).toBe(true);
    expect(await invites.consume("ABCDEFGHJKLM")).toBe(false);
  });

  it("creates and revokes sessions", async () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    const sessions = new SessionRepository(db);
    const user = await users.create("alice", "hash");
    await sessions.create({ id: "sid", userId: user.id, expiresAt: new Date(Date.now() + 86400000), ipAddress: "127.0.0.1", userAgent: "vitest" });
    expect((await sessions.findValid("sid", new Date()))?.user.username).toBe("alice");
    await sessions.delete("sid");
    expect(await sessions.findValid("sid", new Date())).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm run test --workspace=@server-agent/server -- auth-repositories.test.ts
```
Expected: FAIL because db modules do not exist.

- [ ] **Step 3: Add Drizzle schema**

Create `packages/server/src/db/schema.ts` with `users`, `sessions`, and `inviteCodes` exactly as specified in `docs/superpowers/specs/2026-05-27-phase-2a-account-system-design.md` §5.1.

- [ ] **Step 4: Add initial migration**

Create `packages/server/src/db/migrations/0000_initial.sql`:
```sql
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS `users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `password_hash` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `default_provider` text
);
CREATE UNIQUE INDEX IF NOT EXISTS `users_username_unique` ON `users` (`username`);

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
  `expires_at` integer NOT NULL,
  `ip_address` text,
  `user_agent` text,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS `idx_sessions_user_id` ON `sessions` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_sessions_expires` ON `sessions` (`expires_at`);

CREATE TABLE IF NOT EXISTS `invite_codes` (
  `code` text PRIMARY KEY NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `expires_at` integer,
  `uses_remaining` integer DEFAULT 1 NOT NULL,
  `created_by` text NOT NULL,
  `note` text
);
```

- [ ] **Step 5: Add DB client and migration runner**

Create `packages/server/src/db/client.ts`:
```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type AppDb = BetterSQLite3Database<typeof schema>;

export function openDatabase(path: string): AppDb {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}
```

Create `packages/server/src/db/migrate.ts` that reads sorted `.sql` files in `src/db/migrations`, creates `__drizzle_migrations(name text primary key, applied_at integer not null)`, skips applied files, runs each file in a transaction, then inserts the migration name.

- [ ] **Step 6: Add repository implementations**

Implement the repository methods used in the tests. Session validity must reject expired sessions and sessions whose `last_seen_at` is older than 7 days, and update `last_seen_at` on valid lookup.

- [ ] **Step 7: Add test DB helper**

Create `packages/server/tests/helpers/test-db.ts`:
```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as schema from "../../src/db/schema.js";

export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const migration = readFileSync(resolve("src/db/migrations/0000_initial.sql"), "utf8");
  sqlite.exec(migration);
  return drizzle(sqlite, { schema });
}
```
Adjust `resolve(...)` if tests run from package root.

- [ ] **Step 8: Verify and commit**

Run:
```bash
npm run test --workspace=@server-agent/server -- auth-repositories.test.ts && npm run typecheck --workspace=@server-agent/server
```
Expected: PASS.

Commit:
```bash
git add packages/server/src/db packages/server/tests/helpers packages/server/tests/unit/repositories package.json package-lock.json
git commit -m "feat(server): add sqlite auth persistence"
```

---

## Task 4: Crypto helpers, rate limits, Turnstile, and error format

**Files:**
- Create: `packages/server/src/crypto/argon2.ts`
- Create: `packages/server/src/crypto/session-id.ts`
- Create: `packages/server/src/crypto/invite-code.ts`
- Create: `packages/server/src/middleware/rate-limit.ts`
- Create: `packages/server/src/middleware/turnstile.ts`
- Create: `packages/server/src/errors.ts`
- Test: `packages/server/tests/unit/crypto/auth-crypto.test.ts`
- Test: `packages/server/tests/unit/middleware/rate-limit.test.ts`

- [ ] **Step 1: Write crypto tests**

Create tests asserting password hash verifies, wrong password fails, session id length is at least 40 chars, invite code length is 12 and excludes `0OIL`.

- [ ] **Step 2: Write rate limit tests**

Create tests asserting a bucket allows N requests in a window and rejects N+1 until the window changes.

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
npm run test --workspace=@server-agent/server -- auth-crypto.test.ts rate-limit.test.ts
```
Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement crypto helpers**

`argon2.ts`:
```ts
import argon2 from "argon2";

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
```

`session-id.ts`:
```ts
import { randomBytes } from "node:crypto";
export function newSessionId(): string { return randomBytes(32).toString("base64url"); }
```

`invite-code.ts`:
```ts
import { randomInt } from "node:crypto";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newInviteCode(): string {
  let out = "";
  for (let i = 0; i < 12; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
```

- [ ] **Step 5: Implement AppError**

Create `packages/server/src/errors.ts`:
```ts
export class AppError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message); }
}

export function errorBody(error: AppError) {
  return { error: { code: error.code, message: error.message } };
}
```

- [ ] **Step 6: Implement rate limiter**

Use SQLite table `rate_limit_buckets(key text primary key, count integer not null, window_start integer not null, locked_until integer)` created lazily. Export `checkRateLimit(db, { key, limit, windowMs, lockMs, now })` returning `{ allowed: boolean; retryAfterSec?: number }`.

- [ ] **Step 7: Implement Turnstile verifier**

Create `verifyTurnstile(secret, token, remoteIp)` that POSTs form data to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with a 5s AbortController timeout and returns `true` only when JSON `{ success: true }` is received.

- [ ] **Step 8: Verify and commit**

Run:
```bash
npm run test --workspace=@server-agent/server -- auth-crypto.test.ts rate-limit.test.ts && npm run typecheck --workspace=@server-agent/server
```
Expected: PASS.

Commit:
```bash
git add packages/server/src/crypto packages/server/src/middleware packages/server/src/errors.ts packages/server/tests/unit
git commit -m "feat(server): add auth security helpers"
```

---

## Task 5: Config, session middleware, and auth API routes

**Files:**
- Modify: `packages/server/src/config.ts`
- Create: `packages/server/src/middleware/session.ts`
- Create: `packages/server/src/routes/auth/register.ts`
- Create: `packages/server/src/routes/auth/login.ts`
- Create: `packages/server/src/routes/auth/logout.ts`
- Create: `packages/server/src/routes/auth/me.ts`
- Create: `packages/server/src/routes/auth/index.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/tests/integration/auth/auth-routes.test.ts`

- [ ] **Step 1: Write auth integration tests**

Create tests for register success, duplicate username 409, login success sets `sa_sid`, bad login 401, `GET /api/auth/me` without cookie 401, with cookie 200, logout clears cookie and invalidates session.

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm run test --workspace=@server-agent/server -- auth-routes.test.ts
```
Expected: FAIL because routes do not exist.

- [ ] **Step 3: Extend config**

`loadConfig()` must parse:
```env
PORT=8080
HOST=127.0.0.1
NODE_ENV=production
LOG_LEVEL=info
DB_PATH=/var/lib/server-agent/db/main.sqlite
SESSION_COOKIE_SECRET=<secret>
TURNSTILE_SECRET_KEY=<secret>
TURNSTILE_SITE_KEY=<site-key>
```
In `NODE_ENV=test`, allow in-memory/test DB and a fixed Turnstile bypass only through test helpers, not production code paths.

- [ ] **Step 4: Implement session middleware**

Read `sa_sid`, lookup session, attach `request.user = { id, username, createdAt }` when valid. Add Fastify module augmentation for `request.user`.

- [ ] **Step 5: Implement auth routes**

Routes must return the exact error codes from spec §6.4:
- login bad credentials: `AUTH_INVALID_CREDENTIALS`
- rate limited: `AUTH_RATE_LIMITED`
- username taken: `AUTH_USERNAME_TAKEN`
- invalid invite: `AUTH_INVITE_INVALID`
- Turnstile failure: `AUTH_TURNSTILE_FAILED`
- zod invalid: `AUTH_VALIDATION`
- missing session: `AUTH_NOT_AUTHENTICATED`

Cookie attributes: `HttpOnly`, `Secure` when production, `SameSite=Lax`, `Path=/`, `Max-Age=2592000`.

- [ ] **Step 6: Register cookie/session/auth routes**

Modify `server.ts` to register `@fastify/cookie`, add session hook, register `/api/health`, `/api/version`, `/api/auth/*`, and keep SPA fallback only for non-API paths.

- [ ] **Step 7: Verify and commit**

Run:
```bash
npm run test --workspace=@server-agent/server -- auth-routes.test.ts && npm run typecheck --workspace=@server-agent/server
```
Expected: PASS.

Commit:
```bash
git add packages/server/src/config.ts packages/server/src/middleware/session.ts packages/server/src/routes/auth packages/server/src/server.ts packages/server/tests/integration/auth
git commit -m "feat(server): add cookie auth routes"
```

---

## Task 6: Admin CLI

**Files:**
- Create: `scripts/admin-cli.ts`
- Test: `packages/server/tests/unit/admin-cli.test.ts`

- [ ] **Step 1: Write CLI behavior tests**

Test command parser functions for invite create/list/revoke and user list/revoke-sessions/delete using an in-memory DB.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm run test --workspace=@server-agent/server -- admin-cli.test.ts
```
Expected: FAIL because CLI does not exist.

- [ ] **Step 3: Implement CLI commands**

`scripts/admin-cli.ts` must support:
```bash
npm run admin -- invite create --uses 5 --expires 7d --note "for jira team"
npm run admin -- invite list
npm run admin -- invite revoke <code>
npm run admin -- user list
npm run admin -- user revoke-sessions <username>
npm run admin -- user reset-password <username>
npm run admin -- user delete <username>
```
Use repositories directly. `reset-password` reads password from interactive stdin only when attached to TTY; in non-TTY, exit non-zero with a clear message.

- [ ] **Step 4: Verify and commit**

Run:
```bash
npm run test --workspace=@server-agent/server -- admin-cli.test.ts && npm run typecheck
```
Expected: PASS.

Commit:
```bash
git add scripts/admin-cli.ts packages/server/tests/unit/admin-cli.test.ts package.json
git commit -m "feat: add auth admin CLI"
```

---

## Task 7: React/Vite/Tailwind frontend

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/tailwind.config.ts`
- Create: `packages/web/postcss.config.js`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/lib/queryClient.ts`
- Create: `packages/web/src/routes/login.tsx`
- Create: `packages/web/src/routes/register.tsx`
- Create: `packages/web/src/routes/home.tsx`
- Create: `packages/web/src/components/Form.tsx`
- Create: `packages/web/src/components/TurnstileWidget.tsx`
- Create: `packages/web/src/styles.css`

- [ ] **Step 1: Install web dependencies**

Run:
```bash
npm install --workspace=@server-agent/web @vitejs/plugin-react vite react react-dom @tanstack/react-query react-hook-form @hookform/resolvers tailwindcss postcss autoprefixer
npm install --save-dev --workspace=@server-agent/web @types/react @types/react-dom
```
Expected: package and lockfile update.

- [ ] **Step 2: Add web package files**

Create package scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `test`.
Configure Vite to proxy `/api` to `http://127.0.0.1:8080` in dev.
Configure Tailwind content to `./index.html` and `./src/**/*.{ts,tsx}`.

- [ ] **Step 3: Implement API client**

`api.ts` must wrap fetch with `credentials: "include"`, parse `{ error }`, and expose `login`, `register`, `logout`, `me`.

- [ ] **Step 4: Implement pages**

`App.tsx` must route:
- `/` → `/home` if authenticated, else `/login`
- `/login` → login form
- `/register` → register form with Turnstile token
- `/home` → protected hello page with logout.

- [ ] **Step 5: Verify and commit**

Run:
```bash
npm run typecheck --workspace=@server-agent/web && npm run build --workspace=@server-agent/web
```
Expected: PASS.

Commit:
```bash
git add packages/web package.json package-lock.json
git commit -m "feat(web): add auth frontend"
```

---

## Task 8: Caddy, systemd, deploy, bootstrap, and CI

**Files:**
- Create: `deploy/Caddyfile`
- Modify: `deploy/agent.env.example`
- Modify: `deploy/server-agent.service`
- Modify: `scripts/bootstrap-server.sh`
- Modify: `scripts/deploy-agent.sh`
- Modify: `.github/workflows/deploy.yml`
- Modify: `README.md`

- [ ] **Step 1: Add Caddyfile**

Create `deploy/Caddyfile` exactly from spec §4, with `aicoolyun.vip`, `www.aicoolyun.vip`, HTTPS redirect, security headers, `/api/*` reverse proxy to `127.0.0.1:8080`, and SPA root `/opt/server_agent/packages/web/dist`.

- [ ] **Step 2: Update env example**

Ensure `deploy/agent.env.example` contains:
```env
PORT=8080
HOST=127.0.0.1
NODE_ENV=production
LOG_LEVEL=info
DB_PATH=/var/lib/server-agent/db/main.sqlite
SESSION_COOKIE_SECRET=replace-with-32-byte-random-secret
TURNSTILE_SECRET_KEY=replace-with-cloudflare-turnstile-secret
TURNSTILE_SITE_KEY=replace-with-cloudflare-turnstile-site-key
```

- [ ] **Step 3: Update systemd unit**

Set service to run `npm start --workspace=@server-agent/server`, keep `EnvironmentFile=/etc/server-agent/agent.env`, and add `ReadWritePaths=/var/lib/server-agent/db`.

- [ ] **Step 4: Update bootstrap script**

Add idempotent steps:
- install Caddy and sqlite3
- create `/var/lib/server-agent/db` and `/var/lib/server-agent/db/backups` as `agent:agent 0750`
- install `deploy/Caddyfile` to `/etc/caddy/Caddyfile`
- enable and start Caddy
- install backup systemd service/timer that runs daily SQLite `.backup`
- extend sudoers so `agent` may restart `server-agent` and reload Caddy.

- [ ] **Step 5: Update deploy script**

Order must be:
```bash
git fetch origin main
git reset --hard origin/main
npm ci
npm run db:migrate --workspace=@server-agent/server
npm run build --workspaces --if-present
sudo systemctl restart server-agent
curl -fsS http://127.0.0.1:${PORT:-8080}/api/health
```
If migration fails, exit before build/restart.

- [ ] **Step 6: Update GitHub Actions**

CI must run:
```yaml
- run: npm ci
- run: npm run lint --workspaces --if-present
- run: npm run typecheck --workspaces --if-present
- run: npm run test --workspaces --if-present
- run: npm run build --workspaces --if-present
```
Deploy job remains SSH-triggered as in Phase 1.

- [ ] **Step 7: Verify and commit**

Run:
```bash
npm run lint && npm run typecheck && npm test && npm run build
```
Expected: PASS.

Commit:
```bash
git add deploy scripts .github/workflows/deploy.yml README.md
git commit -m "chore(deploy): support https app deployment"
```

---

## Task 9: Final automated verification and drills

**Files:**
- Modify only files required by discovered defects.

- [ ] **Step 1: Run full local verification**

Run:
```bash
npm run lint && npm run typecheck && npm test && npm run build
```
Expected: all pass.

- [ ] **Step 2: Verify local API auth behavior**

Start the server with a local env and run:
```bash
curl -i http://127.0.0.1:8080/api/auth/me
```
Expected: HTTP 401 with `AUTH_NOT_AUTHENTICATED`.

- [ ] **Step 3: Verify migration failure abort drill**

Create a temporary branch commit with a deliberately invalid migration, push it, and observe deploy-agent logs.
Expected: deploy exits during `db:migrate`; `systemctl restart server-agent` is not reached; old service keeps serving `/api/health`.
After the drill, revert the invalid migration commit with a new revert commit.

- [ ] **Step 4: Verify Phase 1 rollback drill still uses `main()`**

Add a temporary throw in `packages/server/src/server.ts` inside `main()` before `listen`, not inside `buildApp()`.
Expected: local tests and build still reach the intended deploy path; deployed health check fails, deploy-agent resets to old SHA and restarts successfully.
After the drill, revert the drill commit with a new revert commit.

- [ ] **Step 5: Complete manual E2E checklist**

Verify spec §9.2 items 1–17:
- HTTPS page loads
- certificate valid
- HTTP redirects to HTTPS
- HSTS present
- `/api/health` works
- `/api/version.gitSha` equals HEAD
- invite registration works
- login persists
- `/api/auth/me` rejects anonymous and accepts session
- logout works
- invite exhaustion works
- Turnstile failure returns 423
- bad login locks after configured attempts
- migration failure abort works
- rollback drill works
- DB backup file exists and is non-empty
- spec and plan are pushed.

- [ ] **Step 6: Commit any fixes**

If drills required fixes:
```bash
git add <fixed-files>
git commit -m "fix: stabilize phase 2a acceptance drills"
```

- [ ] **Step 7: Push**

Run:
```bash
git push -u origin HEAD
```
Expected: branch pushed.

---

## Self-review notes

- Spec coverage: covers HTTPS/Caddy, localhost-only Fastify, SQLite/Drizzle/migrations, registration/login/logout/me, Turnstile, invite codes, argon2id, cookie sessions, rate limit, admin CLI, npm workspaces, React/Vite/Tailwind pages, deploy/bootstrap/CI, migration abort drill, rollback drill, and final E2E checklist.
- Phase 2b is intentionally excluded from implementation tasks except for preserving `users.defaultProvider` as the future hook.
- No secrets are committed; only examples are stored in git.
