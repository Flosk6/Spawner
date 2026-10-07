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
- `spawner` CLI and MCP server (`apps/cli`), for people and coding agents: `up` from a worktree (uncommitted changes included, checked locally first), `--json` everywhere, stable exit codes; served by each server at `/api/v1/cli/spawner`
- Browser terminal into any service, closed when idle and recorded for the admins
- Supervision: CPU and memory of every container every 30 seconds (charts up to 30 days), disk per environment, a timeline of crashes, out-of-memory kills, health changes and jobs, crash loop alerts, and the room left for more environments; memory guard before builds
- Lifecycle: an environment sleeps after 2 hours without activity (its containers stop, its URLs show a waiting page that wakes it up), expires after 72 hours; quotas per person and room checks before creating or waking one; build guards on memory and disk; reconciliation with Docker every minute and a targeted cleanup of what Spawner owns
- Logs of a deleted environment archived and readable 7 days
- Project variables for the compose files (secrets encrypted, masked in job logs); public URLs (`auth: none`) only where an admin allows them
- Accounts without passwords: invitation links, then passkeys; GitHub login optional
- Personal API tokens with scopes, and a device flow to log the CLI in
- Protected previews: Traefik asks Spawner before each request (forwardAuth); share links for guests
- Audit trail of logins, tokens, environments, commands and terminals

## Monorepo Architecture

This is a **pnpm + Turborepo** monorepo:

- **apps/api**: NestJS backend (port 3000) with Prisma + PostgreSQL; also serves the built interface in production
- **apps/web**: Vue 3 interface (Vite + Tailwind CSS + PrimeVue)
- **apps/cli**: the `spawner` CLI and MCP server, bundled by esbuild into one CommonJS file (`dist/spawner.cjs`) with no runtime dependency
- **packages/core**: Manifest, interpolation, compose policy and rendering, log error filter, capacity. Pure functions (no I/O but `realpath`), shared by the API and the CLI
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
- M2 (done): accounts (invitations, passkeys, optional GitHub), roles, tokens, device flow, protected previews, share links, CSRF, audit
- M3 (done): the CLI (upload, `--json`, exit codes, logs with an error filter, stats, init and the agent instructions) and the MCP server
- M4 (done): supervision (metrics, timeline, disk, capacity, alerts), archived logs, terminal limits and recordings, project variables and public URLs, the screens of spec 11.5
- M5 (done): sleep and wake-up, expiry, quotas and room checks, build guards, limits an admin can change, reconciliation, targeted cleanup, density (replaced images removed, sources removed after the build, Dockerfile layer warnings)
- Next: M6 installer and release

Public documentation is in `docs/` (in English): `docs/cli.md` (commands, JSON outputs, exit codes, MCP) and `docs/manifest.md` (`.spawner/`).

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
pnpm --filter @spawner/cli build   # Bundle the CLI: apps/cli/dist/spawner.cjs (link it into your PATH as spawner)
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
- Passkeys are tested for real: `src/testing/soft-authenticator.ts` is a software authenticator (P-256, attestation "none") whose answers go through the actual WebAuthn verification. `src/testing/` is not built.
- Specs are excluded from builds through `tsconfig.build.json`.
- CLI (`apps/cli`): archives and workspaces are tested on real git repositories (`src/testing/repo.ts`); operations, the commands and the MCP server run against `fakeFetch` (`src/testing/fake-api.ts`), which answers routes such as `"GET /envs/:id"`; MCP tools are called by the SDK's client over an in-memory transport. `src/testing/` is not bundled (only what `src/main.ts` imports is).
- API specs load `reflect-metadata` (see `apps/api/vitest.config.mts`); instantiate services directly rather than through the Nest container when possible.
- Lifecycle: `lifecycle.service.spec.ts` (sleep after the idle time, expiry), `reconcile.service.spec.ts` (degraded, ready again, failed without containers), `cleanup.service.spec.ts` (what deleted environments left goes automatically; resources of unknown environments and unused mirrors wait for an admin), `limits.service.spec.ts`, `wake-page.spec.ts`, room and quota checks in `usage.spec.ts`; `packages/core` tests `dockerfileLayerWarnings`, `alwaysOnIssues` and `runtimeSources`.
- Supervision is tested on its pure parts: `samples.spec.ts` (CPU and memory from Docker stats, minute buckets, a fake `/proc`), `docker-events.spec.ts` (`interpretDockerEvent`: a die during a job, the exit 137 that follows an OOM kill; `detectCrashLoops`), `disk.spec.ts` (`attributeDisk` on a `docker system df` answer), `usage.spec.ts` (ranges, downsampling), `retention.spec.ts` (rollups and purges, with a fake Prisma and data directory). The collectors do not start under `NODE_ENV=test`; the end-to-end test covers them.
- `scripts/e2e-engine.sh` starts the local stack, then creates `examples/node-postgres` from an uploaded archive, calls its URL through Traefik (with an agent's preview token), checks its protection (anonymous browsers go to the dashboard, API clients get a 401, a share link opens it, an invited teammate opens it), runs a command in its database, updates it (the data must survive), and deletes it (nothing may be left: containers, volumes, network, images, routing file, sources). `scripts/e2e/teammate.mjs` plays the teammate with Node built-ins only: invitation with a software passkey, passkey login, CSRF check, device login of the CLI, then the preview through the dashboard; it also approves the login of the real CLI. Then an agent's turn: the CLI downloaded from the server, logged in as the teammate, runs `up --wait --json` from a git worktree with an uncommitted change (and two project variables, one secret, which must be masked in the job log), calls the protected URL with `url --with-token`, `exec` (stdin, exit codes), `logs`, `status`, `stats`, `ls`, `share`, a compose file refused before upload (exit 7); then supervision: the terminal session recorded, the jobs in the timeline, three out-of-memory kills that the timeline, `spawner status` and the system alerts report as a crash loop, minute metrics of each service, the disk of the environment, `spawner capacity` and the project usage; then `logout`; `scripts/e2e/mcp.mjs` drives `spawner mcp` over stdio (status, url, exec, logs with errors_only after breaking the database, up with progress, down), after which the deleted environment stays listed with its archived logs (the error found through MCP) and its timeline. Before MCP, the lifecycle: a service stopped with `docker stop` makes the environment degraded until it runs again; `spawner sleep` stops it and a visit gets the waiting page and wakes it up, data kept; with the idle time set to a minute it sleeps by itself and `spawner exec` wakes it up first; with a quota of one, a second `spawner up` exits with 6. With `scripts/e2e-fixtures/bind-mount` (a project allowed public URLs), the capacity is announced at 0 and the creation refused (503) while an environment costs 512 GiB, then back; once its expiry is moved to the past (psql in the Postgres container), the environment disappears without leftovers; a volume labelled for it is removed by the automatic cleanup while an unlabelled one stays; it checks that an update reaches files mounted from a source and that a delete removes what a container wrote there as root (only visible on Linux: Docker Desktop and OrbStack map ownership).
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, build, the Docker image build and the end-to-end test on every pull request and on pushes to `master` and `v1`.

## Backend Architecture (apps/api)

NestJS application with feature modules:

### Module Structure

- **engine**: the environment engine (no controllers)
  - `pipeline.service.ts`: what each job does, phase by phase: deploys (build guards, Dockerfile layer warnings, replaced images removed, sources removed after the build unless mounted or holding an env_file), stop, start, sleep, wake (containers recreated from their images if gone), delete
  - `job-queue.service.ts`: the queue in the `jobs` table, concurrency, recovery after a restart
  - `git-mirror.service.ts`: partial bare mirrors and one detached worktree per environment source
  - `upload.service.ts`: checks and extracts uploaded worktrees
  - `compose-runner.service.ts`: `docker compose` up, recreate, stop, start, down
  - `router.service.ts`: Traefik `file` provider routes, preview protection middlewares, network attachment; sleeping and stopped environments are routed to Spawner's waiting page (`publishPlaceholder`)
  - `job-logs.service.ts`: one log file per job, followed live over SSE; the queue keeps the logs of the last 5 jobs of each environment
  - `log-archive.service.ts`: at deletion, the last 1 MiB of each service's output, compressed, readable 7 days through the logs routes
  - `git-keys.service.ts`: SSH deploy keys, per repository or global
  - `storage.service.ts`: layout of the data directory
- **auth**: who makes each request (`actor.middleware.ts`), dashboard sessions, passkey login (WebAuthn), optional GitHub login, the CLI device flow, terminal tickets
- **team**: invitations, users and roles, each user's account (passkeys, linked GitHub), the first admin
- **tokens**: personal API tokens
- **previews**: forwardAuth decisions for Traefik, the preview cookie, preview tokens for agents, share links; `wake.controller.ts` serves the waiting page of sleeping and stopped environments and wakes them up (`wake-page.ts`)
- **settings**: settings changed from the interface (GitHub login, secrets encrypted); `limits.service.ts` applies the limits an admin changed (lifetimes, sleep, quota, memory, build guards) onto `SpawnerConfig`
- **audit**: the audit trail (global), 90 days
- **projects**: `/api/v1/projects`
- **environments**: `/api/v1/envs` and `/api/v1/jobs`
- **git**: deploy keys and repository access test (admins)
- **terminal**: WebSocket gateway, a TTY exec session in a service through the Docker API (bash when the image has it), closed after 15 minutes without input or 4 hours; `terminal-sessions.service.ts` records what each session shows (2 MiB at most) for the admins
- **timeline** (global): `TimelineService`, the events of an environment (crash, oom, unhealthy, healthy, job started, succeeded or failed, extended) and crash loops (3 crashes or OOM kills in 10 minutes)
- **supervision**:
  - `metrics-collector.service.ts`: every 30 seconds, one-shot Docker stats of every container (environments, Spawner's own compose project, other containers) and the host from `/proc`; one point per minute and scope in `metric_points`; the last sample in memory for the pages
  - `docker-events.service.ts`: the Docker events of environment containers (die, oom, health_status) into the timeline, reconnecting with `since`
  - `disk.service.ts`: `docker system df` every 15 minutes and after each job, attributed to the environments (`disk.ts`)
  - `usage.service.ts`: charts (1h to 30d, from points or rollups), the system overview and its alerts, capacity, project usage
  - `retention.service.ts`: 15-minute rollups, purges (points 48 hours; rollups, disk, events, terminals 30 days; deleted environments 7 days)
- **system**: the memory and disk guards used before builds
- **lifecycle** (global): `activity.service.ts` (last activity, at most one write a minute), `lifecycle.service.ts` (every minute: sleep after the idle time, delete once expired), `reconcile.service.ts` (startup and every minute: degraded, ready again, failed), `cleanup.service.ts` (targeted cleanup, `/api/v1/system/cleanup`)
- **health**: `/api/v1/healthz` and `/api/v1/readyz`
- **meta**: `/api/v1/info` (version, domain, limits: what the CLI checks locally with) and the CLI download

### Key Files

- **app.module.ts**: Root module (config, throttling, schedule, feature modules)
- **main.ts**: Bootstrap, CORS, session middleware, Passport
- **web-app.ts**: Serves the built web interface from `WEB_DIST_PATH` (production image)
- **common/actor.ts**: the actor of a request, roles, scopes, and who may act on an environment
- **common/auth.guard.ts**: global guard; routes are authenticated unless marked `@Public()`, and need the scopes of `@Scopes()`
- **common/secrets.service.ts**: the master secret and the keys derived from it (signed tokens, encrypted settings, session)
- **common/spawner.config.ts**: settings from the environment
- **common/docker.service.ts**: Dockerode: containers by environment label, exec (with stdin), logs (structured, followed, by time range), usage and one-shot stats samples, networks
- **common/docker-logs.ts**: decodes the Docker logs stream (multiplexed frames or TTY text) into lines with stream and time
- **prisma/schema.prisma**: Database schema; migrations in `prisma/migrations/`

### Database (PostgreSQL + Prisma)

Connection configured via `DATABASE_URL` environment variable.

**Tables:**
- `users`: name, role (`admin` or `member`), active flag, WebAuthn user handle
- `identities`: external logins of a user (GitHub)
- `passkeys`: WebAuthn credentials (public key, counter)
- `invites`: one-time links, by SHA-256; with `user_id`, a new passkey for an existing user
- `api_tokens`: personal tokens (prefix, SHA-256, scopes, project, expiry, revocation)
- `device_codes`: CLI logins waiting for approval
- `share_links`: guest links to an environment's previews, by SHA-256
- `audit_events`: the audit trail
- `sessions`: Express session storage (managed by connect-pg-simple)
- `projects`: slug, name, repository, default branch, `rootDir` (where `.spawner/` is, for monorepos), `allowPublic` (exposures with `auth: none`), `allowAlwaysOn` (`idle: never`)
- `project_variables`: variables of the project's compose files; secret values encrypted with the master secret
- `environments`: slug, status, phase and error of the last failure, owner and token name, manifest, expiry, last activity; a deleted environment keeps its row (`deleted_at`), and its slug is unique among live environments through a partial index
- `environment_sources`: what each source runs (git ref and commit, or upload digest and size), and whether its code is still on disk (`onDisk`)
- `exposures`: name, service, port, host and entrypoint of each URL
- `jobs`: the queue and its history (type, status, phase, error, error code for machines, payload, who asked)
- `environment_events`: the timeline of each environment, 30 days
- `metric_points`: CPU and memory per minute, for an environment (with each service in `details`), Spawner, the other containers or the host; 48 hours
- `metric_rollups`: 15-minute averages and maxima of the points, 30 days
- `disk_snapshots`: disk measures and their breakdown per environment, 30 days
- `terminal_sessions`: who opened a terminal where, how it ended, the size of its recording; 30 days
- `settings`: Key-value store

### Environment Variables

**Access:**
- `FRONTEND_URL`: Dashboard URL (default: `<scheme>://spawner.<preview domain>`). It must be a host of the preview domain: the dashboard sets the preview cookie on that domain
- `SPAWNER_SECRET`: master secret, from which signing and encryption keys derive; generated into `<data dir>/secret.key` when not set
- `SESSION_SECRET`: Session signing secret (default: derived from the master secret)
- `SESSION_MAX_AGE`: Session duration in ms (default: 86400000 = 24h)
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_ORG`, `GITHUB_TEAM`: GitHub login until it is configured from the settings page; `GITHUB_CALLBACK_URL` overrides `<dashboard>/api/v1/auth/github/callback`

**Application:**
- `PORT`: API server port (default: 3000)
- `DATABASE_URL`: PostgreSQL connection string
- `DOCKER_SOCKET`: Docker socket (default: /var/run/docker.sock)
- `WEB_DIST_PATH`: Built web interface served by the API (set to `/app/web` in the image; unset in development)
- `SPAWNER_CLI_PATH`: CLI bundle served at `/api/v1/cli/spawner` (set to `/app/cli/spawner` in the image; `apps/cli/dist/spawner.cjs` in development)

**Engine:**
- `SPAWNER_DATA_DIR`: Data directory (default: /var/lib/spawner). Must be mounted at the same path in the Spawner container: the compose files Spawner renders use these paths
- `GIT_KEYS_PATH`: Deploy keys (default: `<data dir>/keys`)
- `SPAWNER_PREVIEW_DOMAIN`: Domain of the previews (default: localtest.me)
- `SPAWNER_TLS`: `letsencrypt` or `off` (default: off); `SPAWNER_TLS_RESOLVER`: Traefik resolver name (default: letsencrypt)
- `SPAWNER_TRAEFIK_ENTRYPOINT`: Traefik entrypoint of the routes (default: `web`, or `websecure` with TLS)
- `SPAWNER_TRAEFIK_CONTAINER`: Traefik container, attached to each environment network (default: spawner-traefik)
- `SPAWNER_DASHBOARD_HOST`, `SPAWNER_DASHBOARD_UPSTREAM`: dashboard route (default: `spawner.<preview domain>` to `http://spawner:3000`)
- `SPAWNER_BOOTSTRAP_TOKEN`: Bearer token of the installation, with every scope and no user, for scripts and CI
- `SPAWNER_BUILD_CONCURRENCY`: Builds at once (default: 1 below 8 GiB of RAM, 2 above)
- `SPAWNER_ENV_TTL`, `SPAWNER_ENV_TTL_MAX`: Lifetime of an environment (default: 72h, at most 14d)
- `SPAWNER_ENV_IDLE`: time without activity before an environment sleeps (default: 2h; `never` turns sleeping off)
- `SPAWNER_ENVS_PER_USER`: live environments a person may own, sleeping ones included (default: 5; 0 for no limit)
- `SPAWNER_ENV_MEMORY`, `SPAWNER_ENV_MEMORY_MAX`: Memory of an environment (default: 2g, at most 4g)
- `SPAWNER_START_TIMEOUT_SECONDS` (300), `SPAWNER_JOB_TIMEOUT_SECONDS` (1800)
- `SPAWNER_UPLOAD_MAX` (100m), `SPAWNER_UPLOAD_MAX_FILES` (50000), `SPAWNER_UPLOAD_MAX_EXTRACTED` (1g)
- `SPAWNER_ALLOW_LOCAL_REPOS`: accept `file://` repositories (tests only)

**Memory Safety:**
- `MIN_REQUIRED_FREE_MEMORY_GB`: Minimum free RAM required before builds (default: 2)
- `MIN_REQUIRED_FREE_DISK_GB`: Minimum free disk required before builds (default: 10); a build waits up to two minutes for both, then fails (code `capacity`)
- The settings page (`PUT /api/v1/settings/limits`) overrides the lifetimes, idle time, quota, memory and build guards; these variables are then the defaults
- `ENABLE_MEMORY_CHECK`: Enable memory safety checks (default: true)

## Frontend Architecture (apps/web)

Vue 3 with Composition API, Vue Router 4, Tailwind CSS and PrimeVue.

### Key Views

- **Home.vue**: counts, room left, recent environments
- **ProjectList.vue**: projects, created and edited by admins in `ProjectDialog.vue` (with "Allow public URLs")
- **ProjectDetail.vue**: what the project uses, what one environment costs, the room left for it, its variables (admins)
- **EnvironmentList.vue**: environments by owner, project and status (ready, degraded, sleeping, in progress, stopped, failed), deleted ones of the last 7 days; created in `EnvironmentDialog.vue`, which reads `spawner.yaml` to offer a branch per source
- **EnvironmentDetail.vue**: a crash loop banner above tabs: overview (URLs, sources, services, share links, disk in `DiskPanel.vue`; during a job, a link to its live log), logs (`LogViewer.vue`: services, errors, search, follow, download), resources (`ResourcePanel.vue`, `UsageChart.vue`), timeline (`TimelinePanel.vue`), jobs (`JobsPanel.vue`, the live log in `JobLog.vue`), terminal; redeploy, extend, stop, start, delete; a deleted environment opens read-only, with its archived logs
- **Login.vue**: passkey login, GitHub when configured
- **InviteAccept.vue**: an invitation link: name, then a passkey
- **DeviceApproval.vue**: approves a CLI login (`/device?code=`)
- **Account.vue**: name, passkeys, linked GitHub, how to install the CLI and the MCP server, API tokens
- **Team.vue** (admin): members, roles, deactivation, links for a new passkey, invitations
- **Settings.vue**, **Audit.vue**, **GitSettings.vue** (admin): limits (`LimitsSettings.vue`), GitHub login, audit trail and terminal sessions with their recordings, deploy keys
- **SystemOverview.vue** (admin): alerts, host now and over time, disk breakdown (`BreakdownBar.vue`), capacity per project, every container

### Architecture Patterns

- **Composition API**: All components use `<script setup>`
- **API**: `services/api.ts`, typed with `@spawner/types`; it adds the `X-Spawner-Client` header the API requires on changes made without a bearer token
- **State**: Pinia store for the session (`stores/auth.ts`); pages poll while a job runs
- **Passkeys**: `@simplewebauthn/browser` (`startRegistration`, `startAuthentication`)
- **Permissions**: the interface hides what the API would refuse (`canManage` in `utils/environment.ts`); the API decides
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
idle: 2h                  # sleep after this long without activity (at least 10m; never needs the project's permission)
limits: { memory: 2g }
```

The compose file may use only Spawner variables, `${SPAWNER_URL}`, `${SPAWNER_URL_<EXPOSURE>}`, `${SPAWNER_HOST_<EXPOSURE>}`, `${SPAWNER_SRC_<SOURCE>}`, `${SPAWNER_PROJECT}`, `${SPAWNER_ENV}`, and the project's variables (set by admins on the project page; secret values are masked in job logs); any other `${...}` is an error, and every remaining `$` is escaped in the rendered file, so the host environment never leaks into it.

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
  jobs/<id>.log              job logs (the last 5 jobs of each environment)
  archives/<id>/<service>.jsonl.gz   last 1 MiB of each service's output, after a delete (7 days)
  terminals/<session>.log    terminal recordings (30 days)
  uploads/                   archives waiting for their job
  keys/                      deploy keys and known_hosts
```

### Jobs

Every change is a job, run in order per environment, at most one at a time per environment. Builds (create, update) are limited by `SPAWNER_BUILD_CONCURRENCY`; stop, start, sleep, wake and delete run alongside. A create or update goes through:

1. **preparing**: memory and disk guards (a build waits up to two minutes), sources (git worktree at the ref, or upload checked entry by entry: no absolute paths, `..`, links leaving the archive, devices or hard links)
2. **validating**: manifest, public exposures and `idle: never` (refused unless the project allows them), compose policy, interpolation (with the project's variables), limits; the issues found are logged with their path and a hint
3. **building**: `docker compose up -d --build --wait` (with `fresh`, `down --volumes` first); on an update, the services that mount files of a source are then recreated, since Compose keeps them on the replaced directory
4. **seeding**: on create, or with `fresh` or `reseed`
5. **routing**: Traefik joins the environment network, the routes file is written

The environment ends `ready` (with an expiry) or `failed` (with the phase and the error, and an expiry if it had none); the timeline records the start and the end of each job with its duration. After a successful deploy, the images an update replaced are removed, and so is the code of the sources no service mounts and no env_file lives in: only the build needed it, and every rebuild checks out or receives the sources again.

**Lifecycle**: every minute, an awake environment (`ready` or `degraded`) whose last activity (a request let through by forwardAuth, a deploy, start, wake-up, command, logs read, terminal, preview token) is older than its idle time gets a `sleep` job: its status is `sleeping` from the start, its URLs lead to Spawner's waiting page (Traefik's `replacePath` to `/api/v1/wake`, still behind forwardAuth), then its containers stop. A visit to a team URL queues a `wake` job (when the server has the memory) and gets a page that reloads by itself once the environment answers; public URLs (`auth: none`) do not wake it up. Stopped environments lead to a page too. Every minute, expired environments are deleted (actor "Spawner (expired)"). Creating an environment needs the person's quota (409, code `quota`) and room for a typical environment of the project (503, code `capacity`); starting and waking need the memory.

**Reconciliation**, at startup and every minute: an awake environment whose service is exited, restarting or unhealthy is `degraded` (with the reason), `ready` again once all run; one whose containers are gone, or left in a transitional status without a job, fails. Then the automatic cleanup removes what deleted environments left (containers, volumes, networks, images, routes, directories), images of previous builds no container runs, and uploads older than a day; resources labelled for environments this installation does not know, and unused git mirrors, wait for an admin (`POST /api/v1/system/cleanup`). Spawner never runs a global prune. A delete archives the services' logs, then removes the routes, `compose down --volumes`, the project's images, the worktrees and the environment directory. Files that services wrote as root into a mounted source are removed through a short-lived root container of Spawner's own image (`StorageService.removeTree`), since Spawner runs as `node`.

## Authentication & Security

### Accounts and roles

- No passwords. The first access goes through an invitation link (one use, 24 hours by default), which creates the account with a passkey; then the user logs in with a passkey. An admin can send a user who lost their passkeys a link for a new one. Without TLS (local install), browsers refuse passkeys on any host but localhost, so an invitation logs in without one.
- GitHub login is optional, configured from the settings page (the client secret is stored encrypted). With an organization set, its members (of the team, when one is set) can log in and get a member account; membership is checked at every login.
- The first admin: while no active admin exists, each start of Spawner prints an invitation valid one hour in its logs. `node dist/admin.js invite --role admin` prints one on demand (in the container: `docker exec -u node spawner node dist/admin.js invite --role admin`).
- Roles: `admin` does everything; `member` creates environments, manages, shares, runs commands and opens terminals in their own, and reads everyone's environments, logs and resources. Projects, team, settings, deploy keys and audit are for admins.

### Requests

- Each request has an actor (`ActorMiddleware`): a bearer token (personal token, or the bootstrap token of the installation) or the dashboard session. The global `AuthGuard` requires one unless the route is `@Public()`, plus the scopes listed with `@Scopes()`.
- Scopes: `envs:read`, `envs:write`, `envs:exec`, `preview`, `admin`. A session has all the scopes of its role; a token has those it was given, never more than its user's role allows (a demoted admin's tokens lose `admin` at once), and may be restricted to one project.
- Personal tokens: `spn_<prefix>_<secret>`, shown once; only their SHA-256 is stored. 90 days by default, revocable, last use recorded. A token creates tokens of at most its own scopes.
- CLI login (device flow, RFC 8628): the CLI gets a code, its user approves it at `/device` from a dashboard session, and the CLI receives a token named after the machine.
- CSRF: every request that changes something without a bearer token must carry `X-Spawner-Client`, which a page on another origin cannot add without a CORS preflight that only the dashboard origin passes. The session cookie is `__Host-spawner_session` over HTTPS, so previews can neither receive nor overwrite it.
- Rate limits apply per user (per IP without one), tighter on the login routes.
- Terminal: the WebSocket needs a one-time ticket (`POST /api/v1/auth/ws-ticket`, 30 seconds) that keeps the scopes and project of the token that asked for it, and the dashboard origin when the client sends an Origin (browsers always do; the CLI does not); it opens only where the user may run commands, and is audited.

### Previews

Before each request to an exposure with `auth: team` (the default), Traefik asks `GET /api/v1/auth/verify` (forwardAuth, with only the Accept, Cookie and X-Spawner-Preview headers). It lets through, in this order: CORS preflights; the `X-Spawner-Preview` header (a one-hour token for one environment, from `POST /api/v1/envs/:id/preview-token`, removed before the request reaches the application); a share link (`?__spawner_share=`), answered by a redirect without the parameter and a cookie valid for that environment only; the team cookie `spawner_preview` (12 hours, for active users); a share cookie. Otherwise a browser goes to `<dashboard>/api/v1/auth/preview?next=`, which sets the team cookie on the preview domain for a logged-in user (or sends them to log in first), and other clients get a 401. Each request let through records the environment's last activity (at most once a minute). Exposures with `auth: none` are public; they need the project's `allowPublic`, set by an admin. While an environment sleeps or is stopped, its routes keep the forwardAuth (team URLs) and lead to the waiting page (`GET /api/v1/wake`, which checks access again: the preview header is not removed there).

### Audit

Logins, invitations, users, tokens, device approvals, passkeys, projects, project variables (names only), environment actions, commands (truncated), terminals, refused compose files and settings changes go to `audit_events`, kept 90 days and listed for admins. Terminal sessions are also recorded (`terminal_sessions` and their output in `terminals/`), 30 days.

### Isolation

- Compose policy (`packages/core/src/compose/validate.ts`): allowlist of keys; no host bind mounts outside the sources, privileged mode, capabilities, devices, host namespaces, ports published on the host, external networks or Docker socket; limits on memory, CPU and processes
- Every service gets `no-new-privileges`, resource limits, a restart policy and capped local logs
- One network per environment; Traefik has no Docker socket and joins each network
- Rendered paths are checked with `realpath` against the sources
- Git runs with `GIT_TERMINAL_PROMPT=0`, no system config, `ssh:https` protocols only, `BatchMode` SSH with a known_hosts file; repository URLs come after `--` and refs are validated (`@spawner/utils`)
- Logs of the environments' services are served as `text/plain` with `nosniff`

## API Endpoints

Base: `/api`. Changes made without a bearer token need the `X-Spawner-Client` header.

### Access (`/api/v1/auth`)

- `GET /session` - The logged-in user and the login methods available (public)
- `GET /whoami` - Who makes the request: `{ via, user, scopes, token }` (any actor; what `spawner whoami` shows)
- `POST /logout`
- `POST /passkey/options`, `POST /passkey` - Passkey login (public)
- `GET /github`, `GET /github/callback` - GitHub login, or `?link=true` to link GitHub to the account (`/api/auth/github/callback`, the route before v1, forwards to it)
- `POST /device` (public) - Starts a CLI login: `{ "clientName": "claude-laptop" }` gives `{ deviceCode, userCode, verificationUri, interval }`
- `POST /device/token` (public) - Polled by the CLI: `{ "deviceCode": "..." }`, a 400 `{ error: "authorization_pending" | "slow_down" | "access_denied" | "expired_token" }` until it gives the token
- `GET /device/:userCode`, `POST /device/approve` - Approval from the dashboard: `{ "userCode": "BCDF-GHJK", "approve": true }`
- `POST /ws-ticket` - One-time ticket for the terminal WebSocket
- `GET /verify` - forwardAuth of Traefik (public, internal)
- `GET /preview?next=<preview URL>` - Sets the preview cookie for a logged-in user (public)

### Team and account

- `POST /api/v1/invites` (admin) - `{ "role": "member", "note": "Grace", "ttlHours": 24 }`, or `{ "userId": 3 }` for a new passkey; answers the link once
- `GET /api/v1/invites`, `DELETE /api/v1/invites/:id` (admin) - Pending invitations
- `GET /api/v1/invites/open/:token`, `POST .../passkey-options`, `POST .../accept` (public) - Using an invitation: `{ "name": "Grace", "credential": <registration>, "passkeyName": "MacBook" }`
- `GET /api/v1/users`, `PATCH /api/v1/users/:id` (admin) - `{ "role": "admin" }`, `{ "isActive": false }`
- `GET /api/v1/me`, `PATCH /api/v1/me` - The account; `POST /me/passkeys/options`, `POST /me/passkeys`, `DELETE /me/passkeys/:id`, `DELETE /me/identities/:id`
- `GET /api/v1/tokens` (`?all=true` for admins), `POST /api/v1/tokens`, `DELETE /api/v1/tokens/:id` - `{ "name": "ci", "scopes": ["envs:read"], "expiresInDays": 30, "project": "blog" }`; the token is answered once
- `GET /api/v1/settings/github`, `PUT /api/v1/settings/github` (admin)
- `GET /api/v1/settings/limits`, `PUT /api/v1/settings/limits` (admin) - `{ values, defaults, overridden }`; `{ "idleSeconds": "30m", "envsPerUser": 3, "envMemoryBytes": "1g" }`, null for the default of the server
- `GET /api/v1/audit?before=<id>&action=env.` (admin)

### Projects (`/api/v1/projects`)

- `GET /` - List, with the count of live environments
- `GET /:slug` - Get, with the names of its variables
- `GET /:slug/branches?source=front` - Branches of the project repository, or of another source of its manifest
- `GET /:slug/manifest?ref=` - `spawner.yaml` at a ref (the default branch otherwise): name, sources with their default branches, exposures, issues
- `GET /:slug/usage` - Environments by status, memory and disk now, and what one environment typically costs (memory, disk, build time)
- `GET /:slug/variables`, `PUT /:slug/variables/:name`, `DELETE /:slug/variables/:name` (admin) - `{ "value": "sk_test", "secret": true }`; secret values are never answered again
- `POST /` (admin) - Create: `{ "slug": "blog", "name": "Blog", "repoUrl": "git@github.com:acme/blog.git", "defaultRef": "main", "rootDir": ".", "allowPublic": false }`
- `PATCH /:slug`, `DELETE /:slug` (admin) - Update, delete (refused while it has live environments)

### Environments (`/api/v1/envs`)

- `GET /` - List (`?project=blog`, `?project=blog&slug=feat-login`, `?mine=true`, `?deleted=true` for the environments deleted in the last 7 days)
- `GET /:id` - Get: status, owner and token, URLs, exposures, sources, last job, CPU and memory of the last sample (`usage`), when it sleeps (`idleSeconds`, `sleepsAt`); a deleted environment stays readable 7 days (`deletedAt`), with its logs, timeline and metrics
- `POST /` - Create (multipart, answers 202 with `{ environment, job }`):
  - fields `project`, `env`, `createdVia` (`ui`, `cli`, `mcp`, `api`), `ttl` (lifetime such as `24h`, instead of the manifest's)
  - `primary`: JSON `{ "ref": "feat/login" }` to deploy the project repository from git (default branch when absent)
  - `sources`: JSON `{ "front": { "ref": "develop" } }` for the other sources taken from git
  - files `primary` and `source:<name>`: gzip tar archives of worktrees, instead of git
- `POST /:id/update` - Redeploy (same fields, plus `fresh=true` to drop the data, `reseed=true` to replay the seed)
- `POST /:id/stop`, `POST /:id/start`, `DELETE /:id` - Jobs (202)
- `POST /:id/sleep`, `POST /:id/wake` - Put to sleep now, wake up (202); `job: null` when there is nothing to do; starting and waking answer 503 (`code: "capacity"`) without the memory
- `POST /:id/extend` - `{ "ttl": "24h" }`: the environment now expires 24 hours from now (10 minutes to the maximum)
- `POST /:id/exec` - `{ "service": "db", "argv": ["psql", "-c", "select 1"], "timeoutSec": 120, "stdin": "<base64>" }`, answers `{ exitCode, stdout, stderr, truncated, timedOut }`; stdin is optional (1 MiB), JSON bodies may reach 2 MiB
- `GET /:id/services` - Containers: state, health, restarts, out-of-memory kill, exit code; `?usage=true` adds CPU, memory (without reclaimable cache), limit and writable layer size, measured right now
- `GET /:id/logs?service=api,db&tail=200&since=<ISO>&until=<ISO>&grep=users&errors=true` - Output of the services as `{ lines: [{ service, stream, time, text }] }`, merged in time order; with filters, the last matches among the last 5000 lines of each service, and with `errors=true` an error cut by the tail is kept from its first line. `follow=true` streams server-sent events (one line per event, `: keep-alive` comments every 15 s, `event: end` when every service stopped). The error filter is `isErrorLine` in `packages/core/src/logs.ts`. `format=text` downloads them as a text file. A deleted environment answers from its archive
- `GET /:id/logs/:service?tail=200` - Service output (text), for the dashboard
- `GET /:id/events?limit=50&before=<id>` - Timeline, newest first, and the crash loops of the last 10 minutes: `{ events, crashLoops }`
- `GET /:id/metrics?range=24h` - CPU and memory of the environment and of each service (`1h`, `6h`, `24h`, `7d`, `30d`; 360 points at most)
- `GET /:id/disk` - Images, volumes, writable layers and sources of the environment, at the last measure
- `GET /:id/jobs` - The last jobs, newest first, with who asked
- `POST /:id/preview-token` - `{ header: "X-Spawner-Preview", token, expiresAt }`, for agents calling a protected preview
- `POST /:id/share` (`{ "ttlHours": 24 }`), `GET /:id/shares`, `DELETE /:id/shares/:shareId` - Share links

Changing an environment, sharing it, running commands in it and opening its terminal need its owner or an admin.

### Jobs (`/api/v1/jobs`)

- `GET /:id` - Status, phase, error, `errorCode` for machines (`invalid`, `capacity`, `upload`, `interrupted`), `actor`
- `GET /:id/logs` - Log (text)
- `GET /:id/logs/stream` - Log as server-sent events, one line per event, until the job ends; a `ping` event every 15 s

### Git (`/api/v1/git`, admins)

- `GET /key`, `POST /key/generate` - Global deploy key
- `GET /keys/repos`, `POST /keys/generate` - Keys per repository (`{ "gitRepo": "..." }`)
- `POST /test` - Test access to a repository (`{ "gitRepo": "..." }`)

### System and health

- `GET /api/v1/system` (admin) - Host now (CPU, memory, disk), every container (environments, Spawner, others), disk breakdown, alerts (disk above 80 % with less than 50 GiB free, or below the 10 GiB reserve; memory below the build guard; crash loops; OOM kills of the last hour)
- `GET /api/v1/system/metrics?range=24h` (admin) - The host, Spawner and the other containers over time
- `GET /api/v1/system/cleanup`, `POST /api/v1/system/cleanup` (admin) - What Spawner owns and no longer needs (`automatic` items go every minute anyway), then remove it all
- `GET|POST... /api/v1/wake` (public, internal) - The waiting page of a sleeping or stopped environment, reached through its routes (`?__spawner_wake=status` answers its state)
- `GET /api/v1/system/capacity` - How many more environments of each project fit, within the reader's quota (`quota: { limit, used, remaining }`): `min((available memory - 1 GiB) / typical memory, (free disk - 10 GiB) / typical disk, quota)`, and what limits it
- `GET /api/v1/terminals`, `GET /api/v1/terminals/:id/recording` (admin) - Terminal sessions and what they showed (text, escape codes included)
- `GET /api/v1/healthz`, `GET /api/v1/readyz` (public)
- `GET /api/v1/info` - Version, dashboard URL, preview domain, scheme, and the limits the CLI checks a deploy with (compose, upload, ttl, exec, share)
- `GET /api/v1/cli/spawner` (public) - The CLI bundle, to save as `spawner`

### Terminal (WebSocket)

**Namespace:** `/terminal`
**Auth:** a ticket from `POST /api/v1/auth/ws-ticket` in the `token` query parameter, and the dashboard origin when an Origin header is sent

**Events:**
- Client → `start-terminal`: `{ environmentId, resourceName, cols, rows }` (`resourceName` is the compose service)
- Client → `terminal-input`: `{ input, resourceName }`
- Client → `terminal-resize`: `{ resourceName, cols, rows }`
- Client → `stop-terminal`: `{ resourceName }`
- Server → `terminal-output`, `terminal-error`, `terminal-exit`

## CLI Architecture (apps/cli)

One bundle, `dist/spawner.cjs` (esbuild, CommonJS so that it runs saved without an extension, minified: the MCP SDK brings three variants of zod). Everything is a dev dependency: nothing is installed at runtime.

- `src/main.ts`, `src/cli.ts`: commander program; each action gets `{ output, cwd, ctx }` first, returns its exit code, and never calls `process.exit`
- `src/context.ts` `ensureAwake`: exec, shell, url and logs --follow wake a sleeping environment up first
- `src/ops/`: the operations, shared by the commands and the MCP server: `up.ts` (local check with the project's public URL permission and variables, packing, create or update, wait), `envs.ts` (status with the timeline and crash loops, list, stats, capacity, url, share, stop/start/down, extend), `logs.ts`, `exec.ts`, `auth.ts` (device login, whoami, logout, tokens), `init.ts`, `shell.ts` (Socket.IO terminal)
- `src/mcp.ts`: `spawner mcp`, the nine tools of the specification on the same operations, stdio transport
- `src/context.ts`: the server connection, target resolution (project from `spawner.yaml` or `--project`, environment from the branch), waiting for jobs
- `src/archive.ts`: what is sent (`git ls-files`, default excludes, `upload.include`) and the tar.gz (no hard links, symlinks checked)
- `src/check.ts`: `spawner.yaml` and the compose file validated with `@spawner/core` and the server's limits (`GET /info`)
- `src/config.ts`: `~/.config/spawner/credentials.json` (0600), `SPAWNER_URL` and `SPAWNER_TOKEN`
- `src/errors.ts`: `CliError` and the exit codes (0 ok, 1 error, 2 usage, 3 auth, 4 environment failed, 5 timeout, 6 quota or capacity, 7 refused)

Rules: human messages on stderr, results on stdout (only JSON with `--json`); errors carry a stable `code` and a `hint`; external programs (git, open) run through `execFile` with argument arrays.

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

### First login (development)

1. `docker compose up -d --build`, then `docker logs spawner` shows a link to create the first admin (or run `docker exec -u node spawner node dist/admin.js invite --role admin`)
2. Over plain HTTP, browsers allow passkeys on localhost only: open the link on `http://spawner.localtest.me` to log in without a passkey (local install), or on `http://localhost:8080` to create one
3. GitHub login, if wanted: create an OAuth App with the callback `http://spawner.localtest.me/api/v1/auth/github/callback`, then fill the settings page (System, Settings)

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
- `docker-compose.production.yml`: HTTPS with a certificate per host (Let's Encrypt TLS challenge), configured by `configure.sh` into `.env.production`, which also prints the link of the first admin. The wildcard certificate (DNS-01) and the new installer come in M6

### Reverse Proxy

Traefik v3 reads routes from `<data dir>/traefik/` (file provider, watched). Spawner writes `_spawner.yaml` for the dashboard and the preview protection middlewares, and one file per environment; it attaches Traefik to each environment network, and an environment is ready once Traefik serves its hosts.

### Turborepo Caching

- `build`: Depends on `^build`, caches `dist/**`
- `dev`: No cache, persistent
- `lint`, `typecheck`, `test`: Depend on `^build`
