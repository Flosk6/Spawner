# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Spawner is a self-hosted preview environment manager. It runs one copy of a project per branch on a VPS, each with its own URL, so a team (and the coding agents working for it) can test any branch in real time.

A project is a git repository holding a `.spawner/` directory: a manifest (`spawner.yaml`) and a Docker Compose file. Spawner checks out the code (or receives it as an archive from a local worktree), validates the compose file against a security policy, builds and starts it as a compose project, seeds it, and routes its URLs through Traefik.

**Key Features:**
- Environments from a git branch, tag or commit, or from an uploaded worktree (`tar.gz`)
- Compose as the environment format, validated against an allowlist (no host mounts, no privileged mode, no host network...)
- One Docker network per environment; Traefik routes through its `file` provider, without the Docker socket
- Job queue in Postgres: create, update, stop, start and delete run as jobs with streamed logs
- API (`/api/v1`) for the dashboard, scripts and the CLI: logs, exec in a service, resource usage
- Browser terminal into any service, CPU and memory graphs, memory guard before builds
- GitHub OAuth for the dashboard (invitations, passkeys and personal tokens come in milestone M2)

## Monorepo Architecture

This is a **pnpm + Turborepo** monorepo:

- **apps/api**: NestJS backend (port 3000) with Prisma + PostgreSQL; also serves the built interface in production
- **apps/web**: Vue 3 interface (Vite + Tailwind CSS + PrimeVue)
- **packages/core**: Manifest, interpolation, compose policy and rendering. Pure functions, no I/O, shared by the API and the coming CLI
- **packages/types**: Shapes returned by the API, shared by the interface and the CLI
- **packages/utils**: Validators for git inputs (repository URLs, refs)

All packages use `workspace:*` dependencies. **Shared packages must be built before running apps** (`pnpm build`; Turborepo builds dependencies first).

## Documentation

### Project Documentation Directory

Project documentation is stored in `/.ai/docs/`:
- When you need to read project documentation, look in this directory first
- When you need to create or update documentation files (.md), place them in `/.ai/docs/`
- This keeps all AI-relevant documentation organized and separate from user-facing docs

**Note:** This is different from user-facing documentation (like README.md) which remains in the project root.

### v1 rewrite

The v1 specification is [.ai/docs/spec-v1.md](.ai/docs/spec-v1.md). Work happens on the `v1` branch, milestone by milestone (M0 to M6). Read the spec before changing the environment engine, auth, routing or the installer.

- M0 (done): cleanup, CI, single image, test harness
- M1 (done): environment engine, `/api/v1`, interface on the new API
- Next: M2 access (invitations, passkeys, tokens, forwardAuth on previews), M3 CLI and MCP, M4 interface and supervision, M5 lifecycle and density, M6 installer and release

## Code Style

### Important Rules

- **NO EMOJIS**: Never use emojis in code, comments, error messages, or any output.
- **NEVER modify files under the data directory** (`SPAWNER_DATA_DIR`, `local-data/` in development): it holds the git mirrors and worktrees Spawner checked out. If you find a bug in a project's code:
  1. STOP - Do not modify the checked out copy
  2. INFORM the user about the issue and required fix
  3. LET THE USER make changes in their real repository and push

  **Rationale**: Prevents divergence between the real codebase and Spawner's copies.
- **No shell**: external programs (git, docker compose, ssh-keygen) run through `run()` in `apps/api/src/modules/engine/process.ts`, with an argument array and a minimal environment. Never build a command string.

### Comment Guidelines

- Avoid inline comments inside functions (only for extremely complex logic)
- Use JSDoc for function/method/class documentation
- Document complexity and intent, not obvious code
- Refactor bad comments when modifying code

**Good example:**

```typescript
/**
 * Brings a worktree of the repository to the given ref, from a shared
 * partial mirror. Two environments of the same repository never share a
 * working copy.
 *
 * @param repoUrl - Repository to read from (SSH or HTTPS)
 * @param ref - Branch, tag or commit
 * @param target - Worktree directory of the environment's source
 * @returns The commit checked out
 */
async checkout(repoUrl: string, ref: string, target: string, onLine: Log): Promise<{ commit: string }> {
  // Implementation without inline comments
}
```

## Development Commands

### Initial Setup

```bash
pnpm install              # Install all dependencies
pnpm build                # Build all packages (required!)
```

### Development

```bash
pnpm dev                  # Start API + Web in parallel
pnpm api:dev              # Start only backend (watch mode)
pnpm web:dev              # Start only frontend (Vite dev server, port 8080, proxies /api and the terminal to VITE_API_URL)
```

The full stack (Postgres, Traefik, Spawner) runs with `docker compose up -d --build` from the root, with `SPAWNER_DATA_DIR` set to an absolute path (see `.env.example`). The dashboard is then at `http://spawner.localtest.me` and environments at `http://<env>--<project>.localtest.me` (every subdomain of localtest.me resolves to 127.0.0.1).

### Building & Quality

```bash
pnpm build                # Build all (uses Turborepo cache)
pnpm api:build            # Build backend only
pnpm web:build            # Build frontend only
pnpm lint                 # Lint all code (read-only; use `pnpm --filter @spawner/api lint:fix` to fix)
pnpm typecheck            # Type-check every package
pnpm test                 # Run the test suites (Vitest)
pnpm format               # Format with Prettier
pnpm clean                # Clean build artifacts + node_modules
scripts/e2e-engine.sh     # End-to-end test of the engine (needs Docker; KEEP=1 leaves the stack up)
```

### Adding Dependencies

```bash
pnpm add -w -D <package>                    # Root (build tools only)
pnpm --filter @spawner/api add <package>    # Backend
pnpm --filter @spawner/web add <package>    # Frontend
pnpm --filter @spawner/core add <package>   # Shared package
```

## Testing

- Vitest, tests named `*.spec.ts` next to the code they cover (`apps/api/src`, `packages/*/src`).
- `packages/core/test/fixtures/compose/`: compose files the policy must refuse (`forbidden/`, each starting with `# expect: <code> <path>`) or accept (`allowed/`). Add a fixture with every policy change.
- Engine services are tested against real programs where it matters: `git-mirror.service.spec.ts` uses local `file://` repositories, `upload.service.spec.ts` builds hostile archives by hand.
- Specs are excluded from builds through `tsconfig.build.json`.
- API specs load `reflect-metadata` (see `apps/api/vitest.config.mts`); instantiate services directly rather than through the Nest container when possible.
- `scripts/e2e-engine.sh` starts the local stack, then creates `examples/node-postgres` from an uploaded archive, calls its URL through Traefik, runs a command in its database, updates it (the data must survive), and deletes it (nothing may be left: containers, volumes, network, images, routing file, sources). With `scripts/e2e-fixtures/bind-mount`, it checks that an update reaches files mounted from a source and that a delete removes what a container wrote there as root (only visible on Linux: Docker Desktop and OrbStack map ownership).
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, build, the Docker image build and the end-to-end test on every pull request and on pushes to `master` and `v1`.

## Backend Architecture (apps/api)

NestJS application with feature modules:

### Module Structure

- **engine**: the environment engine (no controllers)
  - `pipeline.service.ts`: what each job does, phase by phase
  - `job-queue.service.ts`: the queue in the `jobs` table, concurrency, recovery after a restart
  - `git-mirror.service.ts`: partial bare mirrors and one detached worktree per environment source
  - `upload.service.ts`: checks and extracts uploaded worktrees
  - `compose-runner.service.ts`: `docker compose` up, stop, start, down
  - `router.service.ts`: Traefik `file` provider routes and network attachment
  - `job-logs.service.ts`: one log file per job, followed live over SSE
  - `git-keys.service.ts`: SSH deploy keys, per repository or global
  - `storage.service.ts`: layout of the data directory; `spawner.config.ts`: settings from the environment
- **projects**: `/api/v1/projects`
- **environments**: `/api/v1/envs` and `/api/v1/jobs`
- **git**: deploy keys, repository access test, branch listing (dashboard session only)
- **auth**: GitHub OAuth, sessions, audit log, WebSocket tickets
- **terminal**: WebSocket gateway, a TTY exec session in a service through the Docker API
- **system**: host stats (CPU, RAM, disk) and the memory guard used before builds
- **stats**: per-environment CPU and memory sampling (cron, every minute)

### Key Files

- **app.module.ts**: Root module (config, throttling, schedule, feature modules)
- **main.ts**: Bootstrap, CORS, session middleware, Passport
- **web-app.ts**: Serves the built web interface from `WEB_DIST_PATH` (production image)
- **common/api-auth.guard.ts**: Guard of `/api/v1`: dashboard session or bootstrap token
- **common/docker.service.ts**: Dockerode: containers by environment label, exec, logs, stats, networks
- **prisma/schema.prisma**: Database schema; migrations in `prisma/migrations/`

### Database (PostgreSQL + Prisma)

Connection configured via `DATABASE_URL` environment variable.

**Tables:**
- `users`: GitHub OAuth accounts (githubId, username, email, role, lastLoginAt)
- `audit_logs`: Action tracking
- `sessions`: Express session storage (managed by connect-pg-simple)
- `projects`: slug, name, repository, default branch, `rootDir` (where `.spawner/` is, for monorepos)
- `environments`: slug, status, phase and error of the last failure, manifest, expiry; a deleted environment keeps its row (`deleted_at`), and its slug is unique among live environments through a partial index
- `environment_sources`: what each source runs (git ref and commit, or upload digest and size)
- `exposures`: name, service, port, host and entrypoint of each URL
- `jobs`: the queue and its history (type, status, phase, error, payload)
- `EnvironmentStats`: CPU and memory samples
- `settings`: Key-value store

### Environment Variables

**OAuth & Session:**
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `GITHUB_ORG`, `GITHUB_TEAM`: GitHub OAuth and access control
- `SESSION_SECRET`: Session signing secret (`openssl rand -base64 32`)
- `SESSION_MAX_AGE`: Session duration in ms (default: 86400000 = 24h)
- `FRONTEND_URL`: Dashboard URL, for redirects and CORS

**Application:**
- `PORT`: API server port (default: 3000)
- `DATABASE_URL`: PostgreSQL connection string
- `DOCKER_SOCKET`: Docker socket (default: /var/run/docker.sock)
- `WEB_DIST_PATH`: Built web interface served by the API (set to `/app/web` in the image; unset in development)

**Engine:**
- `SPAWNER_DATA_DIR`: Data directory (default: /var/lib/spawner). Must be mounted at the same path in the Spawner container: the compose files Spawner renders use these paths
- `GIT_KEYS_PATH`: Deploy keys (default: `<data dir>/keys`)
- `SPAWNER_PREVIEW_DOMAIN`: Domain of the previews (default: localtest.me)
- `SPAWNER_TLS`: `letsencrypt` or `off` (default: off); `SPAWNER_TLS_RESOLVER`: Traefik resolver name (default: letsencrypt)
- `SPAWNER_TRAEFIK_ENTRYPOINT`: Traefik entrypoint of the routes (default: `web`, or `websecure` with TLS)
- `SPAWNER_TRAEFIK_CONTAINER`: Traefik container, attached to each environment network (default: spawner-traefik)
- `SPAWNER_DASHBOARD_HOST`, `SPAWNER_DASHBOARD_UPSTREAM`: dashboard route (default: `spawner.<preview domain>` to `http://spawner:3000`)
- `SPAWNER_BOOTSTRAP_TOKEN`: Bearer token accepted by `/api/v1` until personal tokens exist
- `SPAWNER_BUILD_CONCURRENCY`: Builds at once (default: 1 below 8 GiB of RAM, 2 above)
- `SPAWNER_ENV_TTL`, `SPAWNER_ENV_TTL_MAX`: Lifetime of an environment (default: 72h, at most 14d)
- `SPAWNER_ENV_MEMORY`, `SPAWNER_ENV_MEMORY_MAX`: Memory of an environment (default: 2g, at most 4g)
- `SPAWNER_START_TIMEOUT_SECONDS` (300), `SPAWNER_JOB_TIMEOUT_SECONDS` (1800)
- `SPAWNER_UPLOAD_MAX` (100m), `SPAWNER_UPLOAD_MAX_FILES` (50000), `SPAWNER_UPLOAD_MAX_EXTRACTED` (1g)
- `SPAWNER_ALLOW_LOCAL_REPOS`: accept `file://` repositories (tests only)

**Memory Safety:**
- `MIN_REQUIRED_FREE_MEMORY_GB`: Minimum free RAM required before builds (default: 2)
- `ENABLE_MEMORY_CHECK`: Enable memory safety checks (default: true)

## Frontend Architecture (apps/web)

Vue 3 with Composition API, Vue Router 4, Tailwind CSS and PrimeVue.

### Key Views

- **Home.vue**: counts, host usage and recent environments
- **ProjectList.vue**: projects, created and edited in `ProjectDialog.vue`
- **EnvironmentList.vue**: environments by project and status, created in `EnvironmentDialog.vue`
- **EnvironmentDetail.vue**: URLs, sources, live job log (`JobLog.vue`), services with their logs and terminal, resource graphs, redeploy, stop, start, delete
- **GitSettings.vue**: deploy keys per repository
- **SystemOverview.vue**: host and environment resource usage
- **Login.vue**: GitHub OAuth login

### Architecture Patterns

- **Composition API**: All components use `<script setup>`
- **API**: `services/api.ts`, typed with `@spawner/types`; it adds the `X-Spawner-Client` header the API requires on changes made with a session
- **State**: Pinia store for authentication (`stores/auth.ts`); pages poll while a job runs
- **Routing**: Navigation guards for authentication
- **WebSocket**: Socket.IO client in `components/XtermTerminal.vue`, on the dashboard origin

## Environments

### Manifest

`.spawner/spawner.yaml` in the project repository (in `rootDir` for a monorepo). See `examples/node-postgres`:

```yaml
version: 1
project: example          # must match the project slug in Spawner
name: app                 # name of this repository's source (default: app)
compose: compose.yaml     # relative to .spawner/ (default)
sources:                  # other repositories, checked out next to this one
  front: { repo: git@github.com:acme/front.git, default_ref: main }
exposures:                # the first one is the entrypoint unless one sets entrypoint: true
  - { name: web, service: app, port: 3000 }
seed:                     # run once after the first start (argument arrays, no shell)
  - { service: app, run: [node, seed.js] }
ttl: 24h
limits: { memory: 2g }
```

The compose file may use only Spawner variables, `${SPAWNER_URL}`, `${SPAWNER_URL_<EXPOSURE>}`, `${SPAWNER_HOST_<EXPOSURE>}`, `${SPAWNER_SRC_<SOURCE>}`, `${SPAWNER_PROJECT}`, `${SPAWNER_ENV}`; any other `${...}` is an error, and every remaining `$` is escaped in the rendered file, so the host environment never leaks into it.

### Naming

- Compose project: `spn-<project>--<env>`; containers, volumes and the `default` network follow Compose naming
- Labels on every service: `dev.spawner.env` (environment id), `dev.spawner.project`, `dev.spawner.env-name`, `dev.spawner.service`
- Hosts: the entrypoint is `<env>--<project>.<preview domain>`, the other exposures `<exposure>--<env>--<project>.<preview domain>`
- Slugs: projects up to 20 characters, environments up to 29, exposures up to 10

### Data directory

```
<SPAWNER_DATA_DIR>/
  mirrors/<hash>/            bare partial mirror of a repository (--filter=blob:none), shared
  envs/<id>/src/_primary/    the project repository: git worktree or extracted upload
  envs/<id>/src/<source>/    the other sources
  envs/<id>/compose.rendered.yaml
  traefik/<id>.yaml          routes of the environment; traefik/_spawner.yaml for the dashboard
  jobs/<id>.log              job logs
  uploads/                   archives waiting for their job
  keys/                      deploy keys and known_hosts
```

### Jobs

Every change is a job, run in order per environment, at most one at a time per environment. Builds (create, update) are limited by `SPAWNER_BUILD_CONCURRENCY`; stop, start and delete run alongside. A create or update goes through:

1. **preparing**: memory check, sources (git worktree at the ref, or upload checked entry by entry: no absolute paths, `..`, links leaving the archive, devices or hard links)
2. **validating**: manifest, compose policy, interpolation, limits; the issues found are logged with their path and a hint
3. **building**: `docker compose up -d --build --wait` (with `fresh`, `down --volumes` first); on an update, the services that mount files of a source are then recreated, since Compose keeps them on the replaced directory
4. **seeding**: on create, or with `fresh` or `reseed`
5. **routing**: Traefik joins the environment network, the routes file is written

The environment ends `ready` (with an expiry) or `failed` (with the phase and the error). A delete removes the routes, `compose down --volumes`, the project's images, the worktrees and the environment directory. Files that services wrote as root into a mounted source are removed through a short-lived root container of Spawner's own image (`StorageService.removeTree`), since Spawner runs as `node`.

## Authentication & Security

### Access

- Dashboard: GitHub OAuth (org and team membership), sessions in Postgres, HttpOnly cookies
- `/api/v1` (`ApiAuthGuard`): a dashboard session, or `Authorization: Bearer <SPAWNER_BOOTSTRAP_TOKEN>`. Changes made with a session must carry `X-Spawner-Client`: a page on another origin, such as a preview, cannot add it without a CORS preflight, so the session cookie alone cannot act
- Terminal: one-time WebSocket ticket from `GET /api/auth/ws-token` (session), valid 30 seconds

**Endpoints:**
- `GET /api/auth/github` - Initiate OAuth
- `GET /api/auth/github/callback` - OAuth callback
- `GET /api/auth/logout` - Destroy session
- `GET /api/auth/me` - Current user
- `GET /api/auth/status` - Auth status
- `GET /api/auth/ws-token` - WebSocket ticket

### Isolation

- Compose policy (`packages/core/src/compose/validate.ts`): allowlist of keys; no host bind mounts outside the sources, privileged mode, capabilities, devices, host namespaces, ports published on the host, external networks or Docker socket; limits on memory, CPU and processes
- Every service gets `no-new-privileges`, resource limits, a restart policy and capped local logs
- One network per environment; Traefik has no Docker socket and joins each network
- Rendered paths are checked with `realpath` against the sources
- Git runs with `GIT_TERMINAL_PROMPT=0`, no system config, `ssh:https` protocols only, `BatchMode` SSH with a known_hosts file; repository URLs come after `--` and refs are validated (`@spawner/utils`)
- Logs of the environments' services are served as `text/plain` with `nosniff`

## API Endpoints

Base: `/api`

### Projects (`/api/v1/projects`)

- `GET /` - List, with the count of live environments
- `GET /:slug` - Get
- `POST /` - Create: `{ "slug": "blog", "name": "Blog", "repoUrl": "git@github.com:acme/blog.git", "defaultRef": "main", "rootDir": "." }`
- `PATCH /:slug` - Update
- `DELETE /:slug` - Delete (refused while it has live environments)

### Environments (`/api/v1/envs`)

- `GET /` - List (`?project=blog`, `?project=blog&slug=feat-login`)
- `GET /:id` - Get: status, URLs, exposures, sources, last job
- `POST /` - Create (multipart, answers 202 with `{ environment, job }`):
  - fields `project`, `env`, `createdVia` (`ui`, `cli`, `mcp`, `api`)
  - `primary`: JSON `{ "ref": "feat/login" }` to deploy the project repository from git (default branch when absent)
  - `sources`: JSON `{ "front": { "ref": "develop" } }` for the other sources taken from git
  - files `primary` and `source:<name>`: gzip tar archives of worktrees, instead of git
- `POST /:id/update` - Redeploy (same fields, plus `fresh=true` to drop the data, `reseed=true` to replay the seed)
- `POST /:id/stop`, `POST /:id/start`, `DELETE /:id` - Jobs (202)
- `POST /:id/exec` - `{ "service": "db", "argv": ["psql", "-c", "select 1"], "timeoutSec": 120 }`, answers `{ exitCode, stdout, stderr, truncated, timedOut }`
- `GET /:id/services` - Containers and their state
- `GET /:id/logs/:service?tail=200` - Service output (text)
- `GET /:id/stats?minutes=60` - CPU and memory samples

### Jobs (`/api/v1/jobs`)

- `GET /:id` - Status, phase, error
- `GET /:id/logs` - Log (text)
- `GET /:id/logs/stream` - Log as server-sent events, one line per event, until the job ends

### Git (`/api/git`, dashboard session)

- `GET /key`, `POST /key/generate` - Global deploy key
- `GET /keys/repos`, `POST /keys/generate` - Keys per repository (`{ "gitRepo": "..." }`)
- `POST /test` - Test access to a repository (`{ "gitRepo": "..." }`)
- `POST /branches` - List branches (`{ "gitRepo": "..." }`)

### Terminal (WebSocket)

**Namespace:** `/terminal`
**Auth:** WebSocket ticket in the `token` query parameter

**Events:**
- Client → `start-terminal`: `{ environmentId, resourceName }` (`resourceName` is the compose service)
- Client → `terminal-input`: `{ input, resourceName }`
- Client → `stop-terminal`: `{ resourceName }`
- Server → `terminal-output`, `terminal-error`, `terminal-exit`

## Common Tasks

### Changing the compose policy

1. Edit `packages/core/src/compose/validate.ts` (and `render.ts` if the rendered file changes)
2. Add fixtures to `packages/core/test/fixtures/compose/forbidden/` or `allowed/`
3. `pnpm --filter @spawner/core test`, then `scripts/e2e-engine.sh`

### Debugging an environment

```bash
# Job log and status
curl -H "Authorization: Bearer $SPAWNER_BOOTSTRAP_TOKEN" http://localhost:8080/api/v1/jobs/<job id>/logs

# Containers of an environment
docker ps -a --filter "label=dev.spawner.env=<environment id>"
docker compose -p spn-<project>--<env> -f <data dir>/envs/<id>/compose.rendered.yaml ps

# Routes and Spawner logs
cat <data dir>/traefik/<id>.yaml
docker logs spawner
```

### Setting Up GitHub OAuth (Development)

1. Create an OAuth App (organization, Settings, Developer settings, OAuth Apps) with the callback `http://spawner.localtest.me/api/auth/github/callback`
2. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_ORG`, `GITHUB_TEAM` and `SESSION_SECRET` in `.env`
3. Add the members to the team

## Infrastructure

### Deployment Requirements

- Ubuntu 22.04+ VPS dedicated to previews
- Docker with Compose v2
- A DNS record `*.preview.yourdomain.com` pointing to the VPS (the dashboard is `spawner.preview.yourdomain.com`)
- Node.js 22.x with pnpm 8 for development only (the image bundles its own Node and the Docker CLI)

### Container Image

One image built from the root `Dockerfile` runs the API and serves the web interface on the same origin. It includes git, ssh and the Docker CLI with the compose plugin. The entrypoint gives the `node` user access to the Docker socket and the data directory, applies Prisma migrations, then drops root.

### Stacks

- `docker-compose.yml`: local stack over HTTP (Postgres, Traefik, Spawner)
- `docker-compose.production.yml`: HTTPS with a certificate per host (Let's Encrypt TLS challenge), configured by `configure.sh` into `.env.production`. The wildcard certificate (DNS-01) and the new installer come in M6

### Reverse Proxy

Traefik v3 reads routes from `<data dir>/traefik/` (file provider, watched). Spawner writes `_spawner.yaml` for the dashboard and one file per environment, and attaches Traefik to each environment network.

### Turborepo Caching

- `build`: Depends on `^build`, caches `dist/**`
- `dev`: No cache, persistent
- `lint`, `typecheck`, `test`: Depend on `^build`
