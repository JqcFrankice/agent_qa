# Phase N1 Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy chat/Skill codebase with a deployable new-platform foundation containing the monorepo, shared contracts, PostgreSQL identity domain, Fastify control API, Next.js product shell, Temporal worker, local infrastructure, observability, container images, and validated Kubernetes/Terraform deployment skeleton.

**Architecture:** Keep the control plane in TypeScript: Next.js serves Explore/Workspace/Studio/Console, Fastify owns `/api/v1`, PostgreSQL stores identity and audit data, Redis handles cache/rate limiting, and Temporal owns durable workflow state. Local development runs PostgreSQL, Redis, Temporal, MinIO, and OpenTelemetry through Docker Compose; production artifacts target Kubernetes and managed Alibaba Cloud data services without touching the legacy ECS during N1.

**Tech Stack:** Node.js 22, npm workspaces, TypeScript ESM, Next.js/React, Fastify, Zod, Drizzle ORM, PostgreSQL, Redis, Temporal, S3-compatible storage, OpenTelemetry, Vitest, Playwright, Docker Compose, Helm, Terraform, Alibaba Cloud ACK/RDS/Redis/OSS/KMS.

## Global Constraints

- Execute in an isolated worktree and branch because this is a full-platform rewrite.
- Preserve Git history and create/push the annotated tag `legacy-server-agent-final` before deleting legacy product files.
- Take and verify a production SQLite backup before merging; do not migrate any legacy account, conversation, message, Skill, or review data.
- Remove automatic deployment to the legacy ECS in the same commit that replaces the repository skeleton; N1 must never deploy new code through `/usr/local/bin/deploy-agent`.
- Node.js is exactly major version 22 in local tooling, CI, and container images.
- Use npm workspaces and commit `package-lock.json`; dependency installation uses `--save-exact` so manifests and lockfile are reproducible.
- TypeScript is ESM-only with strict mode and no `any` in application code.
- All API payloads, environment variables, and persisted JSON boundaries use Zod schemas.
- PostgreSQL migrations are forward-only after merge; never edit a merged migration.
- BYOK business secrets are not implemented in N1. Infrastructure credentials remain environment/Kubernetes secrets and must never enter Git, logs, fixtures, or browser bundles.
- Temporal is the durable workflow system; Redis must not become an unrecoverable job queue.
- Root verification remains `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`, plus `npm run test:e2e` for UI flows.
- Every behavior task follows red-green-refactor and ends with a focused commit.
- Terraform `apply`, Helm deployment, DNS changes, and cloud-resource creation require an explicit human approval checkpoint during execution.

---

## Phase N1 Acceptance Boundary

N1 is complete when a clean machine can start the local infrastructure, migrate PostgreSQL, create an account, create a personal organization/project, log in, navigate the four product spaces, execute a Temporal foundation workflow, store/retrieve an object through the storage abstraction, and observe correlated API/workflow traces. Helm and Terraform must validate and render, but public catalog synchronization, BYOK, application execution, Workflow IR, upstream adapters, and production domain cutover remain N2+.

## File Map

```text
apps/
  api/                         Fastify control API, auth, organizations, projects
  web/                         Next.js Explore/Workspace/Studio/Console shell
packages/
  contracts/                   Zod API/event/domain contracts
  config/                      Environment parsing and typed configuration
  database/                    Drizzle schema, client, migrations, repositories
  observability/               OpenTelemetry bootstrap and request correlation
  platform-clients/            Redis, S3-compatible storage, Temporal clients
services/
  workflow-worker/             Temporal workflows and activities
scripts/
  smoke-foundation.ts          End-to-end infrastructure smoke check
infra/
  compose/                     Local PostgreSQL/Redis/Temporal/MinIO/OTel
  docker/                      Production image definitions
  helm/aicoolyun-platform/     Kubernetes chart
  terraform/                   Alibaba Cloud preproduction environment
tests/e2e/                     Playwright login/navigation tests
```

---

### Task 1: Freeze Legacy and Establish the New Workspace

**Files:**
- Delete: `packages/`, `deploy/`, `scripts/admin-cli.ts`, `scripts/bootstrap-server.sh`, `scripts/deploy-agent.sh`, `scripts/write-build-info.mjs`
- Delete: `.github/workflows/deploy.yml`
- Modify: `package.json`, `package-lock.json`, `.gitignore`, `tsconfig.base.json`, `eslint.config.js`, `README.md`, `AGENTS.md`
- Create: `.nvmrc`, `.node-version`, `.env.example`, `scripts/check-repo-shape.mjs`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: approved master spec `docs/superpowers/specs/2026-07-16-awesome-llm-apps-platform-redesign-design.md`.
- Produces: npm workspace roots `apps/*`, `packages/*`, `services/*`; root commands `lint`, `typecheck`, `test`, `build`, `test:e2e`, `infra:up`, `infra:down`; CI with no production deploy job.

- [ ] **Step 1: Create the isolated implementation worktree and legacy tag**

Run from the current clean `main` checkout:

```bash
git tag -a legacy-server-agent-final -m "Legacy server_agent before platform rebuild" HEAD
git push origin legacy-server-agent-final
git worktree add .claude/worktrees/platform-n1 -b feat/platform-n1-foundation
cd .claude/worktrees/platform-n1
```

Expected: `git status --short --branch` reports `feat/platform-n1-foundation`; `git show legacy-server-agent-final --no-patch` points at the approved spec commit or its immediate successor.

- [ ] **Step 2: Take the legacy production backup before deleting deployment code**

Run the documented production backup command and verify SQLite integrity without printing user data:

```bash
ssh root@43.108.21.46 'stamp=$(date +%Y%m%d-%H%M%S); file=/var/lib/server-agent/db/backups/pre-platform-rebuild-${stamp}.sqlite; sudo -u agent sqlite3 /var/lib/server-agent/db/main.sqlite ".backup \"${file}\""; sqlite3 "${file}" "PRAGMA integrity_check;"; stat -c "%n %s bytes" "${file}"'
```

Expected: output contains `ok` and a non-zero backup size. Record only the backup filename and size in the PR description.

- [ ] **Step 3: Write the repository-shape test before deleting legacy files**

Create `scripts/check-repo-shape.mjs`:

```js
import { existsSync } from "node:fs";

const required = ["apps/api", "apps/web", "packages/contracts", "services/workflow-worker", "infra/compose"];
const forbidden = ["deploy/server-agent.service", "scripts/deploy-agent.sh", "packages/server/src/routes/messages.ts"];

const missing = required.filter((path) => !existsSync(path));
const legacy = forbidden.filter((path) => existsSync(path));

if (missing.length || legacy.length) {
  console.error(JSON.stringify({ missing, legacy }, null, 2));
  process.exit(1);
}
```

- [ ] **Step 4: Run the shape test and verify it fails against the legacy tree**

Run: `node scripts/check-repo-shape.mjs`

Expected: exit 1; output lists missing new workspace directories and existing legacy paths.

- [ ] **Step 5: Replace the root workspace and disable legacy deployment**

Delete the legacy product/deploy paths listed above. Create empty workspace directories with `.gitkeep` files until later tasks populate them. Replace root `package.json` with scripts that use npm workspaces:

```json
{
  "name": "aicoolyun-platform",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*", "services/*"],
  "engines": { "node": "22.x", "npm": ">=10" },
  "scripts": {
    "check:shape": "node scripts/check-repo-shape.mjs",
    "lint": "npm run lint --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "test:e2e": "playwright test",
    "infra:up": "docker compose -f infra/compose/compose.yml up -d --wait",
    "infra:down": "docker compose -f infra/compose/compose.yml down",
    "dev": "concurrently -n api,web,worker -c cyan,magenta,yellow \"npm run dev -w @aicoolyun/api\" \"npm run dev -w @aicoolyun/web\" \"npm run dev -w @aicoolyun/workflow-worker\""
  },
  "devDependencies": {
    "@playwright/test": "1.55.0",
    "concurrently": "9.2.1",
    "eslint": "9.35.0",
    "typescript": "5.9.2",
    "typescript-eslint": "8.42.0",
    "vitest": "3.2.4"
  }
}
```

If npm reports that a pinned version is unavailable at execution time, stop and update the plan/spec with the resolved stable version instead of silently changing it.

Replace `.github/workflows/deploy.yml` with `.github/workflows/ci.yml` containing only checkout, Node 22 setup, `npm ci`, shape check, lint, typecheck, test, and build. Do not include SSH, ECS, deploy-agent, Helm, Terraform apply, or DNS steps.

- [ ] **Step 6: Install, run the shape test, and verify no deploy trigger remains**

Run:

```bash
npm install --package-lock-only --ignore-scripts
npm run check:shape
rg -n "43\.108\.21\.46|deploy-agent|SSH_DEPLOY_KEY" .github scripts package.json
```

Expected: shape test passes; `rg` returns no matches.

- [ ] **Step 7: Commit the workspace reset**

```bash
git add -A
git commit -m "chore(platform): replace legacy workspace skeleton"
```

---

### Task 2: Shared Contracts and Typed Configuration

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/{index,errors,health,identity}.ts`
- Create: `packages/contracts/src/{errors,health,identity}.test.ts`
- Create: `packages/config/package.json`, `packages/config/tsconfig.json`
- Create: `packages/config/src/{index,api}.ts`, `packages/config/src/api.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `ApiErrorEnvelopeSchema`, `HealthResponseSchema`, `UserDtoSchema`, `OrganizationDtoSchema`, `ProjectDtoSchema`, `RoleSchema`, `loadApiConfig(env)` and `ApiConfig`.
- Consumed by: Tasks 3-8.

- [ ] **Step 1: Write failing contract tests**

Test these exact behaviors:

```ts
expect(RoleSchema.options).toEqual(["owner", "admin", "developer", "operator", "viewer"]);
expect(ApiErrorEnvelopeSchema.parse({ error: { code: "AUTH_REQUIRED", message: "Login required", requestId: "req-1" } })).toBeTruthy();
expect(() => HealthResponseSchema.parse({ status: "maybe" })).toThrow();
expect(UserDtoSchema.parse({ id: crypto.randomUUID(), email: "USER@example.com", displayName: "User" }).email).toBe("USER@example.com");
```

Test `loadApiConfig` with a complete development environment, missing `DATABASE_URL`, and a production `SESSION_SECRET` shorter than 32 characters.

- [ ] **Step 2: Run tests and verify missing exports fail**

Run: `npm test -w @aicoolyun/contracts && npm test -w @aicoolyun/config`

Expected: FAIL because the schemas and loader do not exist.

- [ ] **Step 3: Implement the contracts and config loader**

Install workspace dependencies with exact resolved versions:

```bash
npm install -w @aicoolyun/contracts --save-exact zod@3
npm install -w @aicoolyun/config --save-exact zod@3 @aicoolyun/contracts@0.1.0
```

Use discriminated health state and a stable error envelope:

```ts
export const RoleSchema = z.enum(["owner", "admin", "developer", "operator", "viewer"]);
export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string().min(1),
  version: z.string().min(1),
  requestId: z.string().min(1),
  checks: z.record(z.enum(["ok", "error"])).optional()
});
export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    message: z.string().min(1),
    requestId: z.string().min(1),
    fields: z.record(z.array(z.string())).optional()
  })
});
```

`loadApiConfig` must parse and return `nodeEnv`, `port`, `databaseUrl`, `redisUrl`, `temporalAddress`, `temporalNamespace`, `s3Endpoint`, `s3Region`, `s3Bucket`, `s3AccessKeyId`, `s3SecretAccessKey`, `sessionSecret`, `webOrigin`, and `registrationMode`. Normalize `WEB_ORIGIN` by removing a trailing slash and require `SESSION_SECRET.length >= 32` in every environment.

- [ ] **Step 4: Run tests and package builds**

Run:

```bash
npm test -w @aicoolyun/contracts
npm test -w @aicoolyun/config
npm run typecheck -w @aicoolyun/contracts
npm run typecheck -w @aicoolyun/config
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/config .env.example package.json package-lock.json
git commit -m "feat(platform): add shared contracts and typed config"
```

---

### Task 3: PostgreSQL Schema and Identity Repositories

**Files:**
- Create: `infra/compose/compose.yml`, `infra/compose/otel-collector.yml`
- Create: `packages/database/package.json`, `packages/database/tsconfig.json`, `packages/database/drizzle.config.ts`
- Create: `packages/database/src/{index,client,ids}.ts`
- Create: `packages/database/src/schema/{users,sessions,organizations,projects,audit-logs,index}.ts`
- Create: `packages/database/src/repositories/{users,sessions,organizations,projects,audit-logs}.ts`
- Create: `packages/database/src/repositories/identity.integration.test.ts`
- Create: `packages/database/migrations/0000_platform_identity.sql`

**Interfaces:**
- Consumes: `Role` from `@aicoolyun/contracts`.
- Produces: `createDatabase(url)`, `UserRepository`, `SessionRepository`, `OrganizationRepository`, `ProjectRepository`, `AuditLogRepository`, and `withTransaction`.
- Consumed by: Tasks 4-6.

- [ ] **Step 1: Write the failing integration test**

Use a dedicated `TEST_DATABASE_URL`. The test must prove:

```ts
const user = await users.create({ email: "owner@example.com", displayName: "Owner", passwordHash: "hash" });
const org = await organizations.createWithOwner({ name: "Owner workspace", slug: "owner-workspace", ownerUserId: user.id });
const project = await projects.create({ organizationId: org.id, name: "Default", slug: "default" });
expect(await organizations.getRole(org.id, user.id)).toBe("owner");
expect((await projects.listForOrganization(org.id)).map((item) => item.id)).toContain(project.id);
await expect(users.create({ email: "OWNER@example.com", displayName: "Duplicate", passwordHash: "hash" })).rejects.toThrow();
```

Also verify session expiry lookup and append-only audit log insertion.

- [ ] **Step 2: Create and start the pinned local dependency stack**

Create `infra/compose/compose.yml` with PostgreSQL, Redis, Temporal, Temporal UI, MinIO, a one-shot MinIO bucket initializer, and the OpenTelemetry Collector. Pin every image by concrete version or digest, persist state in named volumes, and add service-local health checks. Use the port contract from Task 9 and configure Temporal to use its own PostgreSQL database rather than the platform database.

Run:

```bash
docker compose -f infra/compose/compose.yml config --quiet
npm run infra:up
docker compose -f infra/compose/compose.yml ps
```

Expected: config validates and every dependency reports healthy.

- [ ] **Step 3: Run the repository test and verify it fails before implementation**

Run:

```bash
npm run db:migrate -w @aicoolyun/database
npm test -w @aicoolyun/database -- identity.integration.test.ts
```

Expected: FAIL on missing repository exports before implementation. Infrastructure must remain healthy.

- [ ] **Step 4: Implement schema and repositories**

Install exact database dependencies:

```bash
npm install -w @aicoolyun/database --save-exact drizzle-orm@0.45.2 postgres@3
npm install -w @aicoolyun/database --save-dev --save-exact drizzle-kit@0.31.8 @aicoolyun/contracts@0.1.0
```

Use UUID primary keys generated in application code with `crypto.randomUUID()`. Normalize email to lowercase before persistence. The migration must create:

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'suspended')) DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','developer','operator','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE projects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Session repositories store only `sha256(rawToken)` and never persist the raw cookie value.

- [ ] **Step 5: Run migration and repository tests**

Run:

```bash
npm run db:migrate -w @aicoolyun/database
npm test -w @aicoolyun/database
npm run typecheck -w @aicoolyun/database
```

Expected: migration is idempotently recorded; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add infra/compose packages/database package.json package-lock.json
git commit -m "feat(database): add platform identity schema"
```

---

### Task 4: Fastify API Kernel, Errors, Health, and Observability

**Files:**
- Create: `packages/observability/{package.json,tsconfig.json}`
- Create: `packages/observability/src/{index,node}.ts`
- Create: `apps/api/{package.json,tsconfig.json}`
- Create: `apps/api/src/{app,main,errors,request-context,dependencies}.ts`
- Create: `apps/api/src/routes/{health,version,index}.ts`
- Create: `apps/api/tests/{health,error-envelope}.test.ts`

**Interfaces:**
- Consumes: config, health/error contracts, database client.
- Produces: `buildApp(options)`, `DependencyProbe`, `/api/v1/health/live`, `/api/v1/health/ready`, `/api/v1/version`.
- Consumed by: Tasks 5-6 and 8.

- [ ] **Step 1: Write failing route tests**

Test exact responses with Fastify injection:

```ts
expect((await app.inject({ method: "GET", url: "/api/v1/health/live" })).json()).toMatchObject({ status: "ok", service: "api" });
expect((await app.inject({ method: "GET", url: "/api/v1/health/ready" })).statusCode).toBe(200);
failingProbe.database = false;
expect((await degraded.inject({ method: "GET", url: "/api/v1/health/ready" })).statusCode).toBe(503);
expect((await app.inject({ method: "GET", url: "/api/v1/not-found" })).json().error.code).toBe("HTTP_NOT_FOUND");
```

Assert every response carries `x-request-id` and error bodies include the same ID.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -w @aicoolyun/api -- health.test.ts error-envelope.test.ts`

Expected: FAIL because `buildApp` is missing.

- [ ] **Step 3: Implement API kernel and probes**

Install exact API and telemetry dependencies, resolving the latest non-prerelease release inside each specified major:

```bash
npm install -w @aicoolyun/api --save-exact fastify@5 @fastify/sensible@6 @aicoolyun/config@0.1.0 @aicoolyun/contracts@0.1.0 @aicoolyun/database@0.1.0
npm install -w @aicoolyun/observability --save-exact @opentelemetry/api@1 @opentelemetry/sdk-node@0 @opentelemetry/auto-instrumentations-node@0
```

Define:

```ts
export interface DependencyProbe {
  database(): Promise<boolean>;
  redis(): Promise<boolean>;
  temporal(): Promise<boolean>;
  objectStorage(): Promise<boolean>;
}

export interface BuildAppOptions {
  config: ApiConfig;
  repositories: Repositories;
  probe: DependencyProbe;
  logger?: FastifyBaseLogger | false;
}
```

`live` checks only the API process. `ready` runs all probes with a two-second timeout and returns `503` with per-dependency `ok/error`. Register one error handler that maps validation to `HTTP_VALIDATION`, unknown routes to `HTTP_NOT_FOUND`, known `AppError` codes unchanged, and unexpected failures to `INTERNAL_ERROR` without exposing stack traces.

Initialize OpenTelemetry before importing Fastify in `main.ts`; set service name `aicoolyun-api`; propagate `x-request-id` into logs and traces.

- [ ] **Step 4: Run API tests and typecheck**

Run:

```bash
npm test -w @aicoolyun/api
npm run typecheck -w @aicoolyun/api
npm run build -w @aicoolyun/api
```

Expected: all commands pass and built server starts with `node apps/api/dist/main.js` when infrastructure env is present.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/observability package.json package-lock.json
git commit -m "feat(api): add control plane kernel and health"
```

---

### Task 5: Authentication and Session Lifecycle

**Files:**
- Create: `apps/api/src/auth/{password,session,service}.ts`
- Create: `apps/api/src/routes/auth/{register,login,logout,me,index}.ts`
- Create: `apps/api/tests/auth.integration.test.ts`
- Modify: `packages/contracts/src/identity.ts`, `packages/contracts/src/identity.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Produces: `AuthService.register`, `login`, `authenticate`, `logout`; cookie `aicoolyun_session`; routes under `/api/v1/auth`.
- Consumed by: Task 6 authorization and Task 8 web session handling.

- [ ] **Step 1: Add failing auth contract and integration tests**

Cover these cases:

- Registration with `REGISTRATION_MODE=open` creates a user, personal organization, default project, owner membership, session, and audit rows in one transaction.
- Registration with `REGISTRATION_MODE=disabled` returns `403 REGISTRATION_DISABLED`.
- Password shorter than 12 characters returns `400 AUTH_PASSWORD_WEAK`.
- Email is normalized to lowercase and duplicates return `409 AUTH_EMAIL_EXISTS`.
- Login returns an HttpOnly, SameSite=Lax cookie; production adds Secure.
- Invalid login always returns `401 AUTH_INVALID_CREDENTIALS` without revealing which field failed.
- Logout deletes the hashed session and clears the cookie.
- `/me` returns `401 AUTH_REQUIRED` without a valid session.

- [ ] **Step 2: Run the auth test and verify failure**

Run: `npm test -w @aicoolyun/api -- auth.integration.test.ts`

Expected: FAIL because auth routes are not registered.

- [ ] **Step 3: Implement password and session primitives**

Install authentication dependencies:

```bash
npm install -w @aicoolyun/api --save-exact argon2@0.44.0 @fastify/cookie@11 @fastify/rate-limit@10
```

Use Argon2id with explicit parameters and a 32-byte random session token:

```ts
export const hashPassword = (password: string) => argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
});

export function createSessionToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}
```

Sessions expire after 30 days and update `last_seen_at` at most once per five minutes. Registration must use a database transaction for all identity and audit writes.

- [ ] **Step 4: Register routes, rate limiting, and origin checks**

Apply a strict rate limit to register/login and reject state-changing browser requests whose `Origin` differs from `WEB_ORIGIN`. Set cookie path `/`, HttpOnly, SameSite=Lax, and Secure only in production.

- [ ] **Step 5: Run auth and repository tests**

Run:

```bash
npm test -w @aicoolyun/api -- auth.integration.test.ts
npm test -w @aicoolyun/database
npm run typecheck -w @aicoolyun/api
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api packages/contracts package.json package-lock.json
git commit -m "feat(auth): add platform accounts and sessions"
```

---

### Task 6: Organizations, Projects, RBAC, and Audit API

**Files:**
- Create: `apps/api/src/auth/authorization.ts`
- Create: `apps/api/src/routes/organizations/{list,create,members,index}.ts`
- Create: `apps/api/src/routes/projects/{list,create,index}.ts`
- Create: `apps/api/tests/organizations.integration.test.ts`
- Modify: `packages/contracts/src/identity.ts`, `packages/contracts/src/identity.test.ts`

**Interfaces:**
- Produces: `requireUser(request)`, `requireMembership(userId, organizationId, allowedRoles)`, organization/project CRUD routes.
- Consumed by: all later tenant-scoped APIs.

- [ ] **Step 1: Write failing tenant-isolation tests**

Create two users and two organizations. Verify:

```ts
expect(await callAs(ownerA, "GET", `/api/v1/organizations/${orgA.id}/projects`)).toHaveStatus(200);
expect(await callAs(ownerB, "GET", `/api/v1/organizations/${orgA.id}/projects`)).toHaveError(403, "AUTH_FORBIDDEN");
expect(await callAs(viewerA, "POST", `/api/v1/organizations/${orgA.id}/projects`, input)).toHaveError(403, "AUTH_FORBIDDEN");
expect(await callAs(developerA, "POST", `/api/v1/organizations/${orgA.id}/projects`, input)).toHaveStatus(201);
```

Verify organization/project creation creates audit actions `organization.created` and `project.created`.

- [ ] **Step 2: Run the integration test and verify failure**

Run: `npm test -w @aicoolyun/api -- organizations.integration.test.ts`

Expected: FAIL with missing routes.

- [ ] **Step 3: Implement authorization and routes**

Use this role matrix:

```ts
export const projectCreateRoles = ["owner", "admin", "developer"] as const;
export const memberManageRoles = ["owner", "admin"] as const;
export const organizationReadRoles = ["owner", "admin", "developer", "operator", "viewer"] as const;
```

Every route must load membership by both `organizationId` and authenticated `userId`; never authorize by accepting a user ID from the request body. Slug conflicts return `409 ORGANIZATION_SLUG_EXISTS` or `409 PROJECT_SLUG_EXISTS`.

- [ ] **Step 4: Run isolation tests and all API tests**

Run:

```bash
npm test -w @aicoolyun/api -- organizations.integration.test.ts
npm test -w @aicoolyun/api
npm run typecheck -w @aicoolyun/api
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/contracts
git commit -m "feat(api): add organizations projects and rbac"
```

---

### Task 7: Redis, Object Storage, and Temporal Foundation

**Files:**
- Create: `packages/platform-clients/{package.json,tsconfig.json}`
- Create: `packages/platform-clients/src/{index,redis,storage,temporal}.ts`
- Create: `packages/platform-clients/src/storage.integration.test.ts`
- Create: `services/workflow-worker/{package.json,tsconfig.json}`
- Create: `services/workflow-worker/src/{worker,workflows,activities}.ts`
- Create: `services/workflow-worker/src/workflows.test.ts`
- Create: `scripts/smoke-foundation.ts`
- Modify: `apps/api/src/dependencies.ts`

**Interfaces:**
- Produces: `createRedisClient`, `ObjectStorage`, `S3ObjectStorage`, `createTemporalClient`, `foundationHeartbeatWorkflow`, Temporal task queue `platform-foundation`.
- Consumed by: readiness checks and N2/N3.

- [ ] **Step 1: Write failing storage and workflow tests**

Storage contract:

```ts
await storage.put({ key: "smoke/hello.txt", body: Buffer.from("hello"), contentType: "text/plain" });
expect((await storage.get("smoke/hello.txt")).body.toString("utf8")).toBe("hello");
await storage.delete("smoke/hello.txt");
await expect(storage.get("smoke/hello.txt")).rejects.toMatchObject({ code: "STORAGE_NOT_FOUND" });
```

Workflow contract uses Temporal's official test environment:

```ts
const env = await TestWorkflowEnvironment.createTimeSkipping();
const worker = await Worker.create({
  connection: env.nativeConnection,
  taskQueue: "platform-foundation-test",
  workflowsPath: require.resolve("./workflows.js"),
  activities
});
const result = await worker.runUntil(() => env.client.workflow.execute(foundationHeartbeatWorkflow, {
  workflowId: `foundation-${crypto.randomUUID()}`,
  taskQueue: "platform-foundation-test",
  args: [{ requestId: "req-1", value: "ready" }]
}));
expect(result).toEqual({ requestId: "req-1", echoed: "ready" });
await env.teardown();
```

- [ ] **Step 2: Run tests and verify missing implementations fail**

Run: `npm test -w @aicoolyun/platform-clients && npm test -w @aicoolyun/workflow-worker`

Expected: FAIL on missing exports.

- [ ] **Step 3: Implement clients and worker**

Install exact runtime dependencies:

```bash
npm install -w @aicoolyun/platform-clients --save-exact redis@5 @aws-sdk/client-s3@3 @temporalio/client@1
npm install -w @aicoolyun/workflow-worker --save-exact @temporalio/activity@1 @temporalio/client@1 @temporalio/worker@1 @temporalio/workflow@1 @aicoolyun/platform-clients@0.1.0
npm install -w @aicoolyun/workflow-worker --save-dev --save-exact @temporalio/testing@1
```

`ObjectStorage` must expose only `put`, `get`, `delete`, and `head`; keys must reject leading `/`, `..`, and empty segments. S3 client configuration must support MinIO path-style locally and OSS endpoint configuration in deployed environments.

The foundation workflow uses one activity with a ten-second timeout and two retries:

```ts
const { echoFoundation } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 2 }
});

export async function foundationHeartbeatWorkflow(input: FoundationHeartbeatInput) {
  return echoFoundation(input);
}
```

The smoke script must start an in-process Temporal Worker, ping Redis, upload/get/delete one object, start `foundationHeartbeatWorkflow`, assert the echoed result, shut down the Worker, and print only component names and success states.

- [ ] **Step 4: Run unit/integration tests and smoke test**

Run:

```bash
npm test -w @aicoolyun/platform-clients
npm test -w @aicoolyun/workflow-worker
npm run smoke:foundation
```

Expected: tests pass; smoke output contains `redis=ok storage=ok temporal=ok`; no Worker process remains after the command.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-clients services/workflow-worker scripts/smoke-foundation.ts apps/api package.json package-lock.json
git commit -m "feat(runtime): add platform clients and temporal worker"
```

---

### Task 8: Next.js Product Shell and Session-Aware Navigation

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,next.config.ts,postcss.config.mjs}`
- Create: `apps/web/src/app/{layout,page,globals}.tsx`
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/app/(platform)/{layout,explore/page,workspace/page,studio/page,console/page}.tsx`
- Create: `apps/web/src/components/{app-shell,sidebar,topbar,empty-state,theme-toggle}.tsx`
- Create: `apps/web/src/lib/{api,session}.ts`
- Create: `apps/web/src/components/app-shell.test.tsx`
- Create: `tests/e2e/{setup,auth-navigation,mobile-shell}.spec.ts`
- Create: `playwright.config.ts`

**Interfaces:**
- Consumes: `/api/v1/auth/login`, `/api/v1/auth/me`, `/api/v1/auth/logout` and identity contracts.
- Produces: routes `/explore`, `/workspace`, `/studio`, `/console`, `/login`; same-origin API proxy `/api/v1/*`.

- [ ] **Step 1: Write failing component and Playwright tests**

Component test must assert the exact primary navigation labels and paths. Playwright must cover:

```ts
await page.goto("/login");
await page.getByLabel("邮箱").fill("owner@example.com");
await page.getByLabel("密码").fill("correct horse battery staple");
await page.getByRole("button", { name: "登录" }).click();
await expect(page).toHaveURL(/\/explore$/);
await page.getByRole("link", { name: "Studio" }).click();
await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible();
```

Mobile test uses `390x844`, opens the navigation drawer, visits Workspace, and asserts no horizontal document overflow.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -w @aicoolyun/web && npm run test:e2e -- auth-navigation.spec.ts`

Expected: FAIL because the web workspace and routes do not exist.

- [ ] **Step 3: Implement the shell**

Install exact Web dependencies, resolving the latest non-prerelease Next.js 16 and TanStack Query 5 releases:

```bash
npm install -w @aicoolyun/web --save-exact next@16 react@19.2.6 react-dom@19.2.6 @tanstack/react-query@5 lucide-react@latest zod@3 @aicoolyun/contracts@0.1.0
npm install -w @aicoolyun/web --save-dev --save-exact @testing-library/react@16 @testing-library/jest-dom@6 @types/react@19 @types/react-dom@19 tailwindcss@4 @tailwindcss/postcss@4
```

Use an unframed full-height application layout. Primary navigation is Explore, Workspace, Studio, Console with Lucide icons. Explore is the authenticated default route; `/` redirects to `/explore` for a valid session and `/login` otherwise. The top bar contains organization/project selectors, theme toggle, run-status entry, and user menu. Do not put page sections inside decorative cards.

Each N1 page must contain a real operational empty state rather than marketing copy:

- Explore: “应用目录将在 Phase N2 同步”。
- Workspace: “安装应用后会显示在这里”。
- Studio: “创建工作流” disabled with a Phase N5 status tooltip.
- Console: current account, organization, project, API health, and dependency readiness.

Configure Playwright `webServer` entries to start API and Web against the local Compose dependencies. `tests/e2e/setup.spec.ts` must register `owner@example.com` through the public API with `REGISTRATION_MODE=open`, tolerate `AUTH_EMAIL_EXISTS` on repeated local runs, and write only authenticated browser storage/cookies to `tests/e2e/.auth/owner.json`; it must never write the plaintext password to an artifact or log.

- [ ] **Step 4: Run unit, type, build, and Playwright tests**

Run:

```bash
npm test -w @aicoolyun/web
npm run typecheck -w @aicoolyun/web
npm run build -w @aicoolyun/web
npm run test:e2e
```

Expected: all commands pass on desktop and mobile projects.

- [ ] **Step 5: Capture and inspect screenshots**

Configure Playwright to retain screenshots for the four primary pages at `1440x900` and `390x844`. Inspect them for blank content, text overflow, overlapping navigation, inaccessible contrast, and layout shifts. Fix any failure before committing.

- [ ] **Step 6: Commit**

```bash
git add apps/web tests/e2e playwright.config.ts package.json package-lock.json
git commit -m "feat(web): add new platform product shell"
```

---

### Task 9: Local Infrastructure and Production Container Images

**Files:**
- Modify: `infra/compose/compose.yml`
- Create: `infra/docker/{api,web,workflow-worker}.Dockerfile`
- Create: `infra/docker/.dockerignore`
- Create: `scripts/check-images.sh`
- Modify: `.env.example`, `package.json`

**Interfaces:**
- Produces: local ports API 8080, Web 3000, PostgreSQL 5432, Redis 6379, Temporal 7233/UI 8233, MinIO 9000/9001, OTel 4317/4318; images `aicoolyun-api`, `aicoolyun-web`, `aicoolyun-workflow-worker`.

- [ ] **Step 1: Write the image smoke script before Dockerfiles**

`scripts/check-images.sh` must build all three images, start them through the Compose `app` profile, wait for API/Web health, call `/api/v1/health/ready`, and stop the profile in a trap. It must fail on a non-200 response.

- [ ] **Step 2: Run it and verify missing image definitions fail**

Run: `bash scripts/check-images.sh`

Expected: FAIL because Dockerfiles and Compose services are missing.

- [ ] **Step 3: Implement Compose and multi-stage images**

Pin image versions in Compose. Health checks must use service-local commands. Use non-root users and read-only root filesystems for application containers; grant writable `/tmp` only. The API and worker images must contain only production workspace dependencies and built artifacts. The web image must use Next.js standalone output.

Compose dependency health order:

```text
postgres healthy
redis healthy
temporal healthy
minio healthy
  -> api / workflow-worker
api healthy
  -> web
```

Do not include production credentials; local values live in `.env.example` and are explicitly marked development-only.

- [ ] **Step 4: Validate Compose and run image smoke**

Run:

```bash
docker compose -f infra/compose/compose.yml config --quiet
bash scripts/check-images.sh
```

Expected: Compose validation passes; smoke script reports API, Web, Worker, PostgreSQL, Redis, Temporal, and MinIO healthy.

- [ ] **Step 5: Commit**

```bash
git add infra/compose infra/docker scripts/check-images.sh .env.example package.json package-lock.json
git commit -m "chore(infra): add local stack and runtime images"
```

---

### Task 10: CI Quality Gates and Supply-Chain Checks

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Create: `scripts/check-migrations.mjs`
- Create: `scripts/check-no-secrets.sh`
- Modify: `package.json`

**Interfaces:**
- Produces: PR/main CI jobs `quality`, `integration`, `e2e`, `images`, `security`; no deployment job.

- [ ] **Step 1: Write local guard scripts and failing fixtures**

`check-migrations.mjs` must reject duplicate migration prefixes and modification of migrations already present on `origin/main`. `check-no-secrets.sh` must scan tracked files for private-key headers and common live key prefixes while excluding documented fake values.

Add tests that create temporary bad fixtures and assert each guard exits non-zero; remove the fixtures in test cleanup.

- [ ] **Step 2: Run guards and verify they catch fixtures**

Run: `npm run test:guards`

Expected: tests pass by observing the guard failures for bad fixtures.

- [ ] **Step 3: Implement CI jobs**

CI must:

1. Use Node 22 and `npm ci`.
2. Run shape, migration, and secret guards.
3. Run lint, typecheck, unit/integration tests, and build.
4. Start Compose dependencies for integration tests.
5. Run Playwright desktop/mobile tests.
6. Build the three OCI images.
7. Generate SBOMs and scan images/filesystems with Trivy; fail on unfixed Critical/High vulnerabilities unless an expiring, documented ignore exists.

Use path-independent commands so local and CI verification are identical.

- [ ] **Step 4: Run the complete local CI command set**

Run:

```bash
npm run check:shape
npm run test:guards
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add .github scripts package.json package-lock.json
git commit -m "ci: add new platform quality and security gates"
```

---

### Task 11: Helm Deployment Skeleton

**Files:**
- Create: `infra/helm/aicoolyun-platform/{Chart.yaml,values.yaml,values-preprod.yaml}`
- Create: `infra/helm/aicoolyun-platform/templates/{_helpers,configmap,serviceaccount,api-deployment,api-service,web-deployment,web-service,worker-deployment,ingress,pdb,networkpolicy}.yaml`
- Create: `infra/helm/aicoolyun-platform/tests/render.sh`

**Interfaces:**
- Consumes: images from Task 9 and external PostgreSQL, Redis, Temporal, OSS, OTel endpoints.
- Produces: namespace-scoped API/Web/Worker resources with NetworkPolicy, probes, resource limits, PDB, ingress, and secret references.

- [ ] **Step 1: Write the failing Helm render assertions**

`tests/render.sh` must render preprod values and assert:

- exactly three Deployments;
- every container has readiness/liveness probes, requests, limits, `runAsNonRoot`, read-only root filesystem, and dropped capabilities;
- no inline Secret values;
- API/Web/Worker use distinct ServiceAccounts;
- default-deny ingress and egress NetworkPolicies exist;
- Ingress routes `/api` to API and `/` to Web.

- [ ] **Step 2: Run the test and verify missing chart failure**

Run: `bash infra/helm/aicoolyun-platform/tests/render.sh`

Expected: FAIL because the chart does not exist.

- [ ] **Step 3: Implement the chart**

Use `autoscaling/v2` only if autoscaling is enabled; otherwise fixed replica counts are API 2, Web 2, Worker 1 in preprod. Reference one pre-created Kubernetes Secret named `aicoolyun-platform-env`; never template secret values. Allow egress only to cluster DNS, configured managed-service CIDRs, and the OTel collector. Do not create PostgreSQL, Redis, Temporal, OSS, or KMS inside the chart.

- [ ] **Step 4: Lint and validate rendered Kubernetes resources**

Run:

```bash
helm lint infra/helm/aicoolyun-platform -f infra/helm/aicoolyun-platform/values-preprod.yaml
bash infra/helm/aicoolyun-platform/tests/render.sh
helm template aicoolyun infra/helm/aicoolyun-platform -f infra/helm/aicoolyun-platform/values-preprod.yaml | kubeconform -strict -summary
```

Expected: lint passes, assertions pass, kubeconform reports zero invalid resources.

- [ ] **Step 5: Commit**

```bash
git add infra/helm
git commit -m "chore(k8s): add platform helm chart"
```

---

### Task 12: Terraform Preproduction Environment

**Files:**
- Create: `infra/terraform/{versions,providers,variables,outputs}.tf`
- Create: `infra/terraform/modules/network/{main,variables,outputs}.tf`
- Create: `infra/terraform/modules/platform-data/{main,variables,outputs}.tf`
- Create: `infra/terraform/modules/ack/{main,variables,outputs}.tf`
- Create: `infra/terraform/environments/preprod/{main,variables,outputs,terraform.tfvars.example}.tf`
- Create: `infra/terraform/tests/validate.sh`
- Create: `.github/workflows/preprod-deploy.yml`

**Interfaces:**
- Produces: Alibaba Cloud VPC/vSwitches, ACK, PostgreSQL RDS, Redis, private OSS bucket, KMS key, and outputs required by Helm.
- Does not automatically apply or change DNS.

- [ ] **Step 1: Write validation and policy assertions**

`validate.sh` must run `terraform fmt -check -recursive`, initialize without backend, validate the preprod root, and inspect the plan JSON generated with a fixture variable file. Assert:

- OSS ACL is private and versioning enabled;
- RDS/Redis have no `0.0.0.0/0` allowlist;
- ACK API is not publicly exposed by default;
- deletion protection is enabled for stateful services;
- outputs are marked sensitive where they contain endpoints or identifiers used by deployment.

- [ ] **Step 2: Run validation and verify missing modules fail**

Run: `bash infra/terraform/tests/validate.sh`

Expected: FAIL before the modules exist.

- [ ] **Step 3: Implement provider-pinned modules**

Pin Terraform and provider ranges in `versions.tf`:

```hcl
terraform {
  required_version = ">= 1.9.0, < 2.0.0"
  required_providers {
    alicloud = {
      source  = "aliyun/alicloud"
      version = ">= 1.240.0, < 2.0.0"
    }
  }
}
```

The network module creates one VPC and separate application/data vSwitches in at least two zones. The data module creates private PostgreSQL, Redis, OSS, and KMS resources with deletion protection and tags. The ACK module creates a managed cluster using only application vSwitches and returns kubeconfig as a sensitive output. The preprod root wires modules but contains no access keys, passwords, public IPs, or real domain values.

Before writing each Alibaba resource, consult the provider version selected by `terraform init` and use its exact schema. Do not guess deprecated field names; commit `.terraform.lock.hcl` after validation.

- [ ] **Step 4: Validate without applying**

Run:

```bash
terraform -chdir=infra/terraform fmt -recursive
bash infra/terraform/tests/validate.sh
```

Expected: formatting and validation pass; no resources are created.

- [ ] **Step 5: Add a manual-only preproduction workflow**

`preprod-deploy.yml` must use `workflow_dispatch`, a protected GitHub Environment named `preprod`, OIDC or short-lived cloud credentials, Terraform plan output as an artifact, an environment approval before apply, image digest inputs, and `helm upgrade --install --atomic --wait`. It must not run on push and must not reference the legacy ECS SSH key.

- [ ] **Step 6: Stop for explicit approval before any cloud mutation**

Present the Terraform plan summary, estimated monthly resources, Helm diff, and rollback procedure. Run `terraform apply` and the manual workflow only after the user explicitly approves the external resource creation.

- [ ] **Step 7: Commit**

```bash
git add infra/terraform .github/workflows/preprod-deploy.yml
git commit -m "chore(infra): add preproduction terraform skeleton"
```

---

### Task 13: Foundation Verification, Documentation, and PR Handoff

**Files:**
- Modify: `README.md`, `AGENTS.md`
- Create: `docs/runbooks/local-development.md`
- Create: `docs/runbooks/preprod-deployment.md`
- Create: `docs/architecture/phase-n1-foundation.md`

**Interfaces:**
- Produces: reproducible operator/developer instructions and Phase N1 verification evidence.

- [ ] **Step 1: Write the runbooks before the final smoke**

Document exact prerequisites, `.env` setup, infrastructure start/stop, migration, registration mode, local user flow, logs, traces, image build, Helm render, Terraform validate, backup location, and legacy production non-deployment rule. Update AGENTS.md so old SQLite/systemd/deploy-agent instructions are explicitly marked legacy and cannot be followed for the new platform.

- [ ] **Step 2: Run clean-machine verification**

From a clean clone/worktree:

```bash
npm ci
npm run infra:up
npm run db:migrate -w @aicoolyun/database
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke:foundation
npm run test:e2e
bash scripts/check-images.sh
helm lint infra/helm/aicoolyun-platform -f infra/helm/aicoolyun-platform/values-preprod.yaml
bash infra/terraform/tests/validate.sh
```

Expected: every command passes. Save CI links and screenshot paths in the PR description; do not commit generated screenshots unless they are intentional visual fixtures.

- [ ] **Step 3: Verify the legacy production service is unchanged**

Run:

```bash
curl -fsS https://aicoolyun.vip/api/health
ssh root@43.108.21.46 'systemctl is-active server-agent; git -C /opt/server_agent rev-parse --short HEAD'
```

Expected: legacy health remains `ok`, service is active, and server SHA has not advanced to the N1 branch.

- [ ] **Step 4: Commit documentation and final fixes**

```bash
git add README.md AGENTS.md docs/runbooks docs/architecture
git commit -m "docs(platform): document phase n1 operations"
```

- [ ] **Step 5: Push branch and open a draft PR**

```bash
git push -u origin feat/platform-n1-foundation
gh pr create --draft --base main --head feat/platform-n1-foundation --title "feat(platform): establish new platform foundation" --body-file /tmp/platform-n1-pr.md
```

The PR body must contain scope, deliberate legacy deletions, database non-migration, backup evidence, test commands/results, screenshots, security boundaries, Terraform/Helm validation, cloud resources not yet applied, and confirmation that legacy ECS deployment was removed from CI.

- [ ] **Step 6: Merge only after branch protection and review pass**

Use a merge commit, not squash. After merge, verify that the new `ci.yml` runs and no legacy deploy job or SSH step executes. Do not cut over `aicoolyun.vip`; production cutover remains Phase N8.

---

## Plan Self-Review Results

- **Master-spec coverage:** N1 monorepo, typed contracts, Next.js, Fastify, PostgreSQL, Redis, Temporal, OSS abstraction, OpenTelemetry, identity/organization/project/RBAC/audit, local Compose, container images, Helm, Terraform, and legacy isolation each map to an explicit task.
- **Deferred by design:** Catalog synchronization, AppManifest implementation beyond shared foundation, BYOK/KMS business flows, isolated third-party execution, Workflow IR, SDKs, and public domain cutover remain N2-N8 exactly as defined in the master spec.
- **Type consistency:** Organization roles are defined once in `@aicoolyun/contracts`; repository, API, and Web tasks consume the same DTO/schema package. Durable workflow state is Temporal-owned; Redis remains a cache/rate-limit dependency.
- **Safety:** Legacy backup/tag happen first; automatic ECS deployment is removed before the new workspace can merge; cloud creation and deployment have a mandatory explicit approval checkpoint.
- **Placeholder scan:** No unresolved markers or unspecified “add tests/error handling” steps remain. Alibaba Terraform resource fields are intentionally gated on the provider version selected by `terraform init`, with exact validation required before commit rather than unverified field names embedded in this plan.
