# Architecture

How Spawner is built, for those who read or change its code. [Concepts](concepts.md) describes what it does from the user's side, and [security](security.md) what it protects and why; this page says where each part lives.

## The pieces

```text
                    ports 80 and 443
                           |
                    spawner-traefik           file provider, no Docker socket
                     |           |
       spawner-core network    one network per environment
             |                   |
          spawner                web, api, db of each environment
   API, dashboard, CLI bundle    (a Compose project: spn-<project>--<env>)
   Docker socket, data directory
             |
       spawner-postgres
```

- **One image** (the root `Dockerfile`) runs the API and serves the dashboard (`WEB_DIST_PATH=/app/web`) and the CLI bundle (`SPAWNER_CLI_PATH=/app/cli/spawner`) on the same origin. It carries git, ssh, the Docker CLI with the compose plugin, and the installer (`/app/install.sh`) for updates. Its entrypoint gives the `node` user access to the Docker socket and the data directory, applies the Prisma migrations, then drops root.
- **Postgres** holds Spawner's state, including the job queue and the sessions.
- **Traefik** v3 reads its routes from files Spawner writes into `<data dir>/traefik/` (file provider, watched). It has no Docker socket: Spawner attaches it to each environment's network.
- **The stacks**: `install.sh` writes `/opt/spawner/compose.yaml` from the images on GHCR; the root `docker-compose.yml` builds the same stack from the sources, over plain HTTP, for development and the end-to-end test.

## The workspace

A pnpm workspace built with Turborepo. `build` depends on the build of the dependencies and caches `dist/`; `lint`, `typecheck` and `test` need the dependencies built; `dev` is not cached.

| Package | What it holds |
|---|---|
| `apps/api` | NestJS, Prisma, the environment engine |
| `apps/web` | The dashboard: Vue 3, Vite, Tailwind CSS, PrimeVue |
| `apps/cli` | The `spawner` CLI and MCP server |
| `packages/core` | Manifest, interpolation, compose policy and rendering, the log error filter, capacity: pure functions (no I/O but `realpath`), shared by the API and the CLI so that `spawner up` refuses locally what the server would refuse |
| `packages/types` | The shapes the API answers, shared by the dashboard and the CLI |
| `packages/utils` | Validators of git inputs (repository URLs, refs) |

## The API (apps/api)

### Modules

- **engine**: the environment engine, without controllers.
  - `pipeline.service.ts`: what each job does, phase by phase (below).
  - `job-queue.service.ts`: the queue in the `jobs` table, concurrency, recovery after a restart.
  - `git-mirror.service.ts`: partial bare mirrors, one detached worktree per environment source.
  - `upload.service.ts`: checks and extracts uploaded worktrees.
  - `compose-runner.service.ts`: `docker compose` up, recreate, stop, start, down.
  - `router.service.ts`: the Traefik routes and the preview protection middlewares (below).
  - `job-logs.service.ts`: one log file per job, followed live over server-sent events; the logs of the last 5 jobs of each environment are kept.
  - `log-archive.service.ts`: at deletion, the last 1 MiB of each service's output, compressed, readable 7 days.
  - `git-keys.service.ts`: SSH deploy keys, per repository or global.
  - `storage.service.ts`: the layout of the data directory; `removeTree` deletes what services wrote as root into a mounted source, through a short-lived root container of Spawner's own image, since Spawner runs as `node`.
  - `process.ts`: `run()`, through which every external program runs, with an argument array and a minimal environment.
- **auth**: who makes each request (`actor.middleware.ts`), dashboard sessions, passkey login (WebAuthn), the optional GitHub login, the CLI device flow, terminal tickets.
- **team**: invitations, users and roles, each user's account (passkeys, linked GitHub), the first admin.
- **tokens**: personal API tokens.
- **previews**: forwardAuth decisions for Traefik, the preview cookie, preview tokens for agents, share links; `wake.controller.ts` serves the waiting page of sleeping and stopped environments (`wake-page.ts`) and wakes them up.
- **settings**: settings changed from the dashboard (GitHub login, its secret encrypted); `limits.service.ts` applies the limits an admin changed (lifetimes, sleep, quota, memory, build guards) over the [configuration](configuration.md).
- **audit** (global): the audit trail, 90 days.
- **projects**, **environments** (environments and jobs), **git** (deploy keys, repository access test): routes only.
- **terminal**: the WebSocket gateway, a TTY exec session in a service through the Docker API (bash when the image has it), closed after 15 minutes without input or 4 hours. The Socket.IO server takes the WebSocket transport only, messages of 64 KiB at most, and 10 seconds to join a namespace (`TERMINAL_SOCKET_OPTIONS`). Engine.IO's `allowRequest` redeems the ticket and checks the origin before the WebSocket opens; a refused namespace connection, the main namespace always, closes the connection. Clients split their input into pieces of 4096 UTF-16 code units (`chunkTerminalInput` in `packages/core/src/terminal.ts`, copied in `apps/web/src/utils/terminal.ts`). `terminal-sessions.service.ts` records what each session shows (2 MiB at most) for the admins.
- **timeline** (global): the events of an environment (crash, oom, unhealthy, healthy, job started, succeeded or failed, extended) and crash loops (3 crashes or out-of-memory kills in 10 minutes).
- **supervision**: the collectors and what they feed (below).
- **system**: the memory and disk guards used before builds.
- **lifecycle** (global): activity, sleep and expiry, reconciliation, cleanup (below).
- **health**: `/api/v1/healthz` and `/api/v1/readyz`.
- **meta**: `/api/v1/info` (the version, the domain, and the limits the CLI checks a deploy with) and the CLI download.
- **updates**: updates from the dashboard (below).

### Requests

- `main.ts` bootstraps the application: CORS for the dashboard's origins, the session (stored in Postgres by connect-pg-simple), Passport, the frame headers, the dashboard (`web-app.ts`).
- `common/frame-headers.ts` sets `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` on every response. A page that sets its own policy must keep `frame-ancestors 'none'`, as the waiting page does.
- `ActorMiddleware` finds the actor of each request: a bearer token (a personal token, or the installation's bootstrap token) or the dashboard session. `common/actor.ts` defines actors, roles, scopes, and who may act on an environment.
- `common/auth.guard.ts` is global: a route needs an actor unless it is marked `@Public()`, and the scopes listed by `@Scopes()`.
- Changes made without a bearer token must carry the `X-Spawner-Client` header (CSRF).
- Rate limits apply per user, per address without one, tighter on the login routes (`common/throttler.guard.ts`).
- `common/access.service.ts` (global) holds the terminals and log streams to what their actor may still do: it reads the actor again when the team or tokens services report a change, and every 30 seconds, and closes what it no longer allows.
- `common/secrets.service.ts` holds the master secret and the keys derived from it (signed tokens, encrypted settings, the session).
- `common/docker.service.ts` wraps the Docker API (Dockerode): containers by environment label, exec with stdin, logs (structured, followed, by time range), usage and stats samples, networks. `common/docker-logs.ts` decodes the logs stream (multiplexed frames or TTY text) into lines with their stream and time.

### Routes

Everything is under `/api/v1`, in the modules of `apps/api/src/modules/`. The shapes the routes answer are in `packages/types`, shared by the dashboard and the CLI.

| Prefix | Where |
|---|---|
| `/auth` | `auth/auth.controller.ts` (session, passkeys, GitHub, device flow, terminal tickets, whoami); `previews/previews.module.ts` (`verify`, `verify-public`, `preview`: what Traefik and the preview cookie use) |
| `/envs` | `environments/environments.controller.ts`; `previews/previews.module.ts` (preview tokens, share links); `supervision/supervision.module.ts` (events, metrics, disk) |
| `/jobs` | `environments/jobs.controller.ts` |
| `/projects` | `projects/projects.controller.ts` (with branches, manifest, variables); `supervision/supervision.module.ts` (usage) |
| `/invites`, `/users`, `/me` | `team/team.controller.ts` |
| `/tokens` | `tokens/tokens.module.ts` |
| `/settings` | `settings/settings.module.ts` (GitHub login, limits) |
| `/system` | `supervision/supervision.module.ts` (overview, metrics, capacity); `lifecycle/lifecycle.module.ts` (`/system/cleanup`); `updates/updates.module.ts` (`/system/update`) |
| `/audit`, `/terminals`, `/git` | `audit/audit.module.ts`, `terminal/terminal-sessions.service.ts`, `git/git.controller.ts` |
| `/info`, `/cli/spawner`, `/healthz`, `/readyz`, `/wake` | `meta/meta.module.ts`, `health/health.module.ts`, `previews/wake.controller.ts` |

The terminal is the Socket.IO namespace `/terminal` (`terminal/terminal.gateway.ts`): the client sends `start-terminal`, `terminal-input`, `terminal-resize` and `stop-terminal`, the server `terminal-output`, `terminal-error` and `terminal-exit`.

### Database

PostgreSQL through Prisma (`apps/api/prisma/schema.prisma`, migrations in `apps/api/prisma/migrations/`, applied at startup).

| Table | What it holds |
|---|---|
| `users` | Name, role (`admin` or `member`), active flag, WebAuthn user handle |
| `identities` | External logins of a user (GitHub) |
| `passkeys` | WebAuthn credentials: public key, counter |
| `invites` | One-time links, by SHA-256; with `user_id`, a new passkey for an existing user |
| `api_tokens` | Personal tokens: prefix, SHA-256, scopes, project, expiry, revocation, and the token they were created with |
| `device_codes` | CLI logins waiting for approval |
| `share_links` | Guest links to an environment's previews, by SHA-256 |
| `audit_events` | The audit trail |
| `sessions` | Dashboard sessions (connect-pg-simple) |
| `projects` | Slug, name, repository, default branch, `rootDir` (where `.spawner/` is, in a monorepo), `allowPublic` (exposures with `auth: none`), `allowAlwaysOn` (`idle: never`), `sourceRepos` (the repositories other sources may come from) |
| `project_variables` | Variables of the project's compose files; secret values encrypted with the master secret |
| `environments` | Slug, status, phase and error of the last failure, owner and token name, manifest, expiry, last activity. A deleted environment keeps its row (`deleted_at`); its slug is unique among live environments through a partial index |
| `environment_sources` | What each source runs (git ref and commit, or upload digest and size), and whether its code is still on disk |
| `exposures` | Name, service, port, host and entrypoint of each URL |
| `jobs` | The queue and its history: type, status, phase, error, error code, payload, who asked |
| `environment_events` | The timeline of each environment, 30 days |
| `metric_points` | CPU and memory per minute, of an environment (each service in `details`), Spawner, the other containers or the host; 48 hours |
| `metric_rollups` | 15-minute averages and maxima of the points, 30 days |
| `disk_snapshots` | Disk measures and their breakdown per environment, 30 days |
| `terminal_sessions` | Who opened a terminal where, how it ended, the size of its recording; 30 days |
| `settings` | Key-value store: settings from the dashboard, the state of an update |

## The engine

### Jobs

Every change is a job, run in order per environment, one at a time per environment. Builds (create, update) are limited by `SPAWNER_BUILD_CONCURRENCY`; stop, start, sleep, wake and delete run alongside. A create or an update goes through:

1. **preparing**: the memory and disk guards (a build waits up to two minutes for them, then fails with the code `capacity`), then the sources: a git worktree at the ref, or an upload checked entry by entry (no absolute paths, `..`, links leaving the archive, devices or hard links). The project's own source comes first, and its manifest is read before the others: public exposures, `idle: never` and other repositories are refused unless the project allows them, so that nothing else is cloned for a branch that names a repository the project does not list.
2. **validating**: the compose policy, the interpolation with the project's variables, the limits. Each issue is logged with its path and a hint, and the Dockerfiles are checked for layers that would copy the code before the dependencies.
3. **building**: `docker compose up -d --build --wait` (with `fresh`, `down --volumes` first). On an update, the services that mount files of a source are recreated afterwards, since Compose would keep them on the replaced directory.
4. **seeding**: on a create, or with `fresh` or `reseed`.
5. **routing**: Traefik joins the environment's network, and the routes file is written.

The environment ends `ready` with an expiry, or `failed` with the phase and the error (and an expiry if it had none); the timeline records the start, the end and the duration of each job. After a successful deploy, the images the update replaced are removed, and so is the code of the sources that no service mounts and no `env_file` lives in: only the build needed it, and every rebuild checks out or receives the sources again.

A delete archives the services' logs, then removes the routes, runs `compose down --volumes`, and removes the project's images, the worktrees and the environment's directory.

### Routing

`router.service.ts` writes `_spawner.yaml` (the dashboard and the preview protection middlewares) and one file per environment. Traefik never resolves a bare name: it reaches Spawner as `spawner.spawner-core` and each exposed service as `<service>.<compose project>_default`, and joins environment networks with a lower gateway priority (`GwPriority` -1) than spawner-core. Docker's embedded DNS answers a bare name from the first of a container's networks that knows it, and registers service names, aliases and hostnames there: hence the naming rules of the compose policy.

- Team URLs use the `spawner-preview-gate` middleware, public URLs `spawner-public-gate`: a forwardAuth to `GET /api/v1/auth/verify` (or `verify-public`, which lets everything through), with only the Accept, Cookie, X-Spawner-Preview, Origin and Access-Control-Request-Method headers. Spawner answers with the request's cookies minus its own, which Traefik passes on (`authResponseHeaders: Cookie`) instead of the original ones; the preview header is removed too. [Security](security.md#protected-previews) gives the order of the checks.
- Sleeping and stopped environments are routed to Spawner's waiting page (`publishPlaceholder`): Traefik's `replacePath` to `/api/v1/wake`, still behind `spawner-preview-auth` for team URLs, which keeps the cookies and the preview header for the waiting page to check access again.
- At startup, the awake environments without a pending job are published again, so that route files of an older version and a recreated Traefik catch up.

An environment is ready once Traefik serves its hosts.

### Lifecycle

- `activity.service.ts` records the last activity of an environment, at most once a minute: a request let through by forwardAuth, a deploy, a start or a wake-up, a command, logs read, a terminal, a preview token.
- `lifecycle.service.ts`, every minute: an awake environment (`ready` or `degraded`) idle for longer than its idle time gets a `sleep` job (its status is `sleeping` from the start, its URLs lead to the waiting page, then its containers stop); expired environments are deleted, by the actor "Spawner (expired)". A visit to a team URL of a sleeping environment queues a `wake` job when the server has the memory; a wake-up recreates the containers from their images if they are gone.
- `reconcile.service.ts`, at startup and every minute: an awake environment with a service exited, restarting or unhealthy is `degraded` with the reason, and `ready` again once all run; one whose containers are gone, or left in a transitional status without a job, fails.
- `cleanup.service.ts`: what deleted environments left (containers, volumes, networks, images, routes, directories), images of previous builds that no container runs, and uploads older than a day go automatically. Resources labelled for environments this installation does not know, and unused git mirrors, wait for an admin (`POST /api/v1/system/cleanup`). Spawner never runs a global prune.
- Creating an environment needs the person's quota (409, code `quota`) and room for a typical environment of the project (503, code `capacity`); starting and waking need the memory.

### Supervision

- `metrics-collector.service.ts`: every 30 seconds, one-shot Docker stats of every container (environments, Spawner's own Compose project, other containers) and the host from `/proc`; one point per minute and scope in `metric_points`; the last sample kept in memory for the pages.
- `docker-events.service.ts`: the Docker events of environment containers (die, oom, health_status) into the timeline, reconnecting with `since`.
- `disk.service.ts`: `docker system df` every 15 minutes and after each job, attributed to the environments (`disk.ts`).
- `usage.service.ts`: the charts (1 hour to 30 days, from points or rollups), the system overview and its alerts, the capacity, the usage of a project.
- `retention.service.ts`: 15-minute rollups, and the purges (points 48 hours; rollups, disk, events and terminals 30 days; deleted environments 7 days).

### Updates

`releases.ts` (pure) compares versions and picks the newest update a server may take. `updates.service.ts` reads the list of releases every 6 hours (`SPAWNER_RELEASES_URL`, `file://` in tests). On request, it downloads the new image and starts `spawner-upgrade`, a container of that image that runs its `/app/install.sh --upgrade` as root, on the host network, with the Docker socket, the installation directory (from the Compose label `working_dir`) and the data directory. The run is kept in `settings` (`update.run`) and settled by whichever Spawner comes up: succeeded, or failed when the installer went back to the previous version. Only a container of the Compose project `spawner`, running a release image tagged with its own version, can update itself.

### Naming

- Compose project: `spn-<project>--<env>`; containers, volumes and the `default` network follow Compose's naming.
- Labels on every service: `dev.spawner.env` (environment id), `dev.spawner.project`, `dev.spawner.env-name`, `dev.spawner.service`.
- Hosts: `<env>--<project>.<preview domain>` for the entrypoint, `<exposure>--<env>--<project>.<preview domain>` for the other exposures.
- Slugs: projects up to 20 characters, environments up to 29, exposures up to 10.

### The data directory

```text
<SPAWNER_DATA_DIR>/
  mirrors/<hash>/                    bare partial mirror of a repository (--filter=blob:none), shared
  envs/<id>/src/_primary/            the project repository: git worktree or extracted upload
  envs/<id>/src/<source>/            the other sources
  envs/<id>/compose.rendered.yaml
  traefik/<id>.yaml                  routes of an environment; traefik/_spawner.yaml for the dashboard
  jobs/<id>.log                      job logs (the last 5 jobs of each environment)
  archives/<id>/<service>.jsonl.gz   last 1 MiB of each service's output, after a delete (7 days)
  terminals/<session>.log            terminal recordings (30 days)
  uploads/                           archives waiting for their job
  keys/                              deploy keys and known_hosts
  secret.key                         the master secret, when SPAWNER_SECRET is not set
```

It is mounted at the same path inside the Spawner container: the compose files Spawner renders use these paths.

## The dashboard (apps/web)

Vue 3 with the Composition API (`<script setup>` everywhere), Vue Router, Pinia, Tailwind CSS and PrimeVue.

- `services/api.ts` calls the API, typed with `@spawner/types`, and adds the `X-Spawner-Client` header to every change.
- `stores/auth.ts` holds the session; navigation guards send anonymous visitors to the login page. Pages poll while a job runs.
- Passkeys go through `@simplewebauthn/browser`.
- The interface hides what the API would refuse (`canManage` in `utils/environment.ts`); the API decides.
- The terminal is a Socket.IO client in `components/XtermTerminal.vue`, on the dashboard's origin.

The look comes from one set of tokens, so the light and dark themes cannot drift apart:

- `styles/tokens.css` defines the colors as CSS variables, light by default and dark under `html.dark`; every text color keeps 4.5:1 on its surface. The accent is the brand violet `#574b89` in light and the logo's `#6e54ff` in dark. It also holds the sizes: a type scale (`--fs-2xs` to `--fs-2xl`) and the heights of controls (`--control-sm`, `--control`, `--control-lg`), so the whole interface grows or shrinks from there.
- `style.css` holds the component classes (`btn`, `card`, `badge` and its `tone-*`, `table`, `alert`, `chip`, `tabs`, `console`...) on top of Tailwind, whose colors (`bg-surface`, `text-fg-3`, `border-line`...) and text sizes (`text-xs` to `text-2xl`, replacing Tailwind's) are the same tokens (`tailwind.config.js`). Templates use them, never Tailwind's palette, an arbitrary size (`text-[13px]`) or `dark:` variants.
- `theme/preset.ts` is PrimeVue's Aura in these colors, both surface scales running from light to dark as Aura expects. PrimeVue's styles sit in a CSS layer between Tailwind's base and utilities, so a utility class wins over them, and the unlayered rules at the end of `style.css` size them.
- `composables/useTheme.ts` keeps the user's choice (light, dark or the system's) and sets `html.dark`; an inline script in `index.html` applies the same rule before the first paint. Charts read the token values of the theme in effect (`resolveColor` in `utils/palette.ts`).
- Icons come from `lucide-vue-next`; Geist, Geist Mono and the wordmark's Chakra Petch (bold, Latin only) are bundled (Fontsource), so the dashboard loads nothing from another site.

The shell: `AppSidebar.vue` (navigation, the server's domain and version, the update an admin can install, the theme, the account), `AppTopbar.vue` (breadcrumbs: a route's `meta.crumbs`, or what a page sets with `setBreadcrumbs` once its subject is loaded; the update too where the sidebar is a drawer, both from `useAvailableUpdate`), and `CommandPalette.vue` (Ctrl+K or Cmd+K: environments, projects, pages and a few actions). Sign-in pages and the CLI approval have `meta.layout: 'focus'` and stand alone; the approval names the account the CLI will act as. Shared pieces: `ActionMenu.vue` (a PrimeVue popup menu with Lucide icons), `SegmentedControl.vue`, `EnvironmentStatus.vue`, `SourceLabel.vue`, `UserAvatar.vue`, `Logo.vue` (the mark, drawn in SVG, and the wordmark). Confirmations go through `useNotification`'s `confirmAction`, rendered by the dialog in `App.vue`.

| View | |
|---|---|
| `Home.vue` | Live environments by status, the reader's quota, free memory, how many more environments fit, recent environments, projects, the CLI |
| `ProjectList.vue`, `ProjectDetail.vue` | Projects (created and edited by admins in `ProjectDialog.vue`); what a project uses, what one environment costs, how many more fit, its variables |
| `EnvironmentList.vue` | A table of the environments, filtered by name, branch or owner, by owner, project and status, and those deleted in the last 7 days; created in `EnvironmentDialog.vue` (also from the palette, through `?new=1`), which reads `spawner.yaml` to offer a branch per source and shows the URL to come |
| `EnvironmentDetail.vue` | Banners for crash loops, sleep, failures and running jobs above the tabs: overview (services with their memory, URLs, sources, lifecycle, share links, disk), logs (`LogViewer.vue`), resources (`ResourcePanel.vue`, `UsageChart.vue`), timeline (`TimelinePanel.vue`), jobs (`JobsPanel.vue`, `JobLog.vue`, with the phase a deploy is at or failed in), terminal; a deleted environment opens read-only, with its archived logs |
| `Login.vue`, `InviteAccept.vue` | Passkey login, GitHub when configured; an invitation link: a name, then a passkey |
| `DeviceApproval.vue` | Approves a CLI login: the user types the code, which the page never reads from the URL |
| `Account.vue` | Name, passkeys, linked GitHub, installing the CLI and the MCP server, API tokens |
| `Team.vue` | Members, roles and reactivations (each confirmed first), deactivation, links for a new passkey, invitations |
| `Settings.vue`, `Audit.vue`, `GitSettings.vue` | Limits (`LimitsSettings.vue`), GitHub login; the audit trail and terminal recordings; deploy keys |
| `SystemOverview.vue` | Alerts, the host now and over time, the disk breakdown, capacity per project, every container, updates, cleanup |

## The CLI (apps/cli)

One bundle, `dist/spawner.cjs`, made by esbuild: CommonJS so that it runs saved without an extension, minified. Every dependency is a dev dependency, so nothing is installed at runtime.

- `src/main.ts`, `src/cli.ts`: the commander program. Each action gets `{ output, cwd, ctx }`, returns its exit code, and never calls `process.exit`.
- `src/runtime.ts`: the Node.js version check, and `findProgram`, the absolute path of a program in the absolute `PATH` entries, by which `git` and the browser opener run. A bare name would be looked up in the worktree first on Windows, and relative `PATH` entries resolve against it everywhere. On Windows, `NoDefaultCurrentDirectoryInExePath` is also set in the CLI's own environment before anything starts.
- `src/ops/`: the operations, shared by the commands and the MCP server: `up.ts` (local check with the project's permissions and variables, packing, create or update, wait), `envs.ts` (status with the timeline and crash loops, list, stats, capacity, url, share, stop, start, down, extend), `logs.ts`, `exec.ts`, `auth.ts` (device login, whoami, logout, tokens), `init.ts`, `shell.ts` (the Socket.IO terminal).
- `src/mcp.ts`: `spawner mcp`, the MCP tools over the same operations, on stdio.
- `src/context.ts`: the server connection, the target (project from `spawner.yaml` or `--project`, environment from the branch), waiting for jobs; `ensureAwake` wakes a sleeping environment before `exec`, `shell`, `url` and `logs --follow`.
- `src/archive.ts`: what is sent (`git ls-files`, default excludes, `upload.include`) and the tar.gz (no hard links, symbolic links checked).
- `src/check.ts`: `spawner.yaml` and the compose file validated with `@spawner/core` and the server's limits (`GET /api/v1/info`).
- `src/config.ts`: `~/.config/spawner/credentials.json` (mode 0600), `SPAWNER_URL` and `SPAWNER_TOKEN`.
- `src/errors.ts`: `CliError` and the [exit codes](cli.md#exit-codes).

Messages for people go to stderr and results to stdout (only JSON with `--json`); errors carry a stable `code` and a `hint`; external programs run through `execFile` with argument arrays.

## Releases

`scripts/release.sh` versions and tags a release, and a tag starts `.github/workflows/release.yml`: images on GHCR for amd64 and arm64, the CLI on npm through trusted publishing, and a GitHub release with `install.sh`, the CLI bundle and their checksums. See [scripts](../scripts/README.md#releasesh).
