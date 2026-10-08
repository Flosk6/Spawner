# API

The dashboard, the CLI and the MCP server all go through this API; scripts and CI can too. It lives under `https://spawner.<preview domain>/api/v1`. The shapes it answers are typed in [`packages/types`](../packages/types/src/index.ts).

## Authentication

Send a personal token as a bearer token:

```bash
curl -H "Authorization: Bearer spn_..." https://spawner.preview.example.com/api/v1/envs
```

Tokens come from the account page, `spawner token create`, or `spawner login`. The installation's `SPAWNER_BOOTSTRAP_TOKEN` works the same way, with every scope and no user. A request without a token uses the dashboard session, and must then carry the `X-Spawner-Client` header on any change (CSRF).

A token needs the scope of what it does, never more than its owner's role allows:

| Scope | Routes |
|---|---|
| `envs:read` | Reading environments, jobs, logs, timelines, metrics, projects |
| `envs:write` | Creating, updating, stopping, starting, sleeping, waking, extending, sharing and deleting environments |
| `envs:exec` | `exec`, and the terminal ticket |
| `preview` | Preview tokens |
| `admin` | The routes marked admin below |

Changing an environment, sharing it, running commands in it and opening its terminal also need its owner or an admin. A token restricted to a project sees that project only.

Errors are JSON with `statusCode` and `message`. Refusals for lack of room carry a `code` and a `hint`: `quota` (409, the person has as many environments as allowed) or `capacity` (503, the server lacks memory or disk). A failed job has an `errorCode`: `invalid`, `capacity`, `upload` or `interrupted`.

## Access (`/api/v1/auth`)

- `GET /session` (public): the logged-in user and the login methods available.
- `GET /whoami`: who makes the request, `{ via, user, scopes, token }` (what `spawner whoami` shows).
- `POST /logout`.
- `POST /passkey/options`, `POST /passkey` (public): passkey login.
- `GET /github`, `GET /github/callback`: GitHub login, or `?link=true` to link GitHub to the account. `/api/auth/github/callback`, the route of 1.x, forwards to it.
- `POST /device` (public): starts a CLI login. `{ "clientName": "claude-laptop" }` gives `{ deviceCode, userCode, verificationUri, interval }`.
- `POST /device/token` (public): polled by the CLI with `{ "deviceCode": "..." }`. It answers 400 `{ error: "authorization_pending" | "slow_down" | "access_denied" | "expired_token" }` until it gives the token.
- `GET /device/:userCode`, `POST /device/approve`: approval from the dashboard, `{ "userCode": "BCDF-GHJK", "approve": true }`.
- `POST /ws-ticket`: a one-time ticket for the terminal (30 seconds).
- `GET /verify`, `GET /verify-public` (public, for Traefik): the forwardAuth checks of protected and public URLs; they answer 200 with the request's cookies minus Spawner's. See [security](security.md#protected-previews).
- `GET /preview?next=<preview URL>` (public): sets the preview cookie for a logged-in user, then goes back to the preview.

## Team and account

- `POST /api/v1/invites` (admin): `{ "role": "member", "note": "Grace", "ttlHours": 24 }`, or `{ "userId": 3 }` for a new passkey of an existing user. Answers the link once.
- `GET /api/v1/invites`, `DELETE /api/v1/invites/:id` (admin): pending invitations.
- `GET /api/v1/invites/open/:token`, `POST .../passkey-options`, `POST .../accept` (public): using an invitation, `{ "name": "Grace", "credential": <registration>, "passkeyName": "MacBook" }`.
- `GET /api/v1/users`, `PATCH /api/v1/users/:id` (admin): `{ "role": "admin" }`, `{ "isActive": false }`.
- `GET /api/v1/me`, `PATCH /api/v1/me`: the account (renaming it needs a dashboard session). `POST /me/passkeys/options`, `POST /me/passkeys`, `DELETE /me/passkeys/:id`, `DELETE /me/identities/:id`.
- `GET /api/v1/tokens` (`?all=true` for admins), `POST /api/v1/tokens`, `DELETE /api/v1/tokens/:id`: `{ "name": "ci", "scopes": ["envs:read"], "expiresInDays": 30, "project": "blog" }`. The token is answered once. A token created with another token gets at most its scopes, expires with it at the latest, and is revoked with it.
- `GET /api/v1/settings/github`, `PUT /api/v1/settings/github` (admin).
- `GET /api/v1/settings/limits`, `PUT /api/v1/settings/limits` (admin): `{ values, defaults, overridden }`; send `{ "idleSeconds": "30m", "envsPerUser": 3, "envMemoryBytes": "1g" }`, or null for the server's default.
- `GET /api/v1/audit?before=<id>&action=env.` (admin).

## Projects (`/api/v1/projects`)

- `GET /`: the projects, with the count of live environments.
- `GET /:slug`: a project, with the names of its variables.
- `GET /:slug/branches?source=front`: branches of the project's repository, or of another source of its manifest.
- `GET /:slug/manifest?ref=`: `spawner.yaml` at a ref (the default branch otherwise): name, sources with their default branches, exposures, issues.
- `GET /:slug/usage`: environments by status, memory and disk now, and what one environment typically costs (memory, disk, build time).
- `GET /:slug/variables`, `PUT /:slug/variables/:name`, `DELETE /:slug/variables/:name` (admin): `{ "value": "sk_test", "secret": true }`. Secret values are never answered again.
- `POST /` (admin): `{ "slug": "blog", "name": "Blog", "repoUrl": "git@github.com:acme/blog.git", "defaultRef": "main", "rootDir": ".", "allowPublic": false }`.
- `PATCH /:slug`, `DELETE /:slug` (admin): a project with live environments cannot be deleted.

## Environments (`/api/v1/envs`)

- `GET /`: the list; `?project=blog`, `?project=blog&slug=feat-login`, `?mine=true`, `?deleted=true` for those deleted in the last 7 days.
- `GET /:id`: status, owner and token, URLs, exposures, sources, last job, CPU and memory of the last sample (`usage`), when it sleeps (`idleSeconds`, `sleepsAt`). A deleted environment stays readable 7 days (`deletedAt`), with its logs, timeline and metrics.
- `POST /`: creates an environment. Multipart; answers 202 with `{ environment, job }`.
  - fields `project`, `env`, `createdVia` (`ui`, `cli`, `mcp`, `api`), `ttl` (such as `24h`, instead of the manifest's);
  - `primary`: JSON `{ "ref": "feat/login" }` to deploy the project's repository from git (its default branch when absent);
  - `sources`: JSON `{ "front": { "ref": "develop" } }` for the other sources taken from git;
  - files `primary` and `source:<name>`: gzip tar archives of worktrees, instead of git.
- `POST /:id/update`: redeploys, with the same fields, plus `fresh=true` to drop the data and `reseed=true` to replay the seed.
- `POST /:id/stop`, `POST /:id/start`, `DELETE /:id`: jobs (202).
- `POST /:id/sleep`, `POST /:id/wake`: puts it to sleep now, wakes it up (202); `job` is null when there is nothing to do. Starting and waking answer 503 (`code: "capacity"`) without the memory.
- `POST /:id/extend`: `{ "ttl": "24h" }`, the environment now expires 24 hours from now (10 minutes to the server's maximum).
- `POST /:id/exec`: `{ "service": "db", "argv": ["psql", "-c", "select 1"], "timeoutSec": 120, "stdin": "<base64>" }` answers `{ exitCode, stdout, stderr, truncated, timedOut }`. `stdin` is optional (1 MiB); JSON bodies may reach 2 MiB.
- `GET /:id/services`: the containers, with state, health, restarts, out-of-memory kill and exit code; `?usage=true` adds CPU, memory (without reclaimable cache), limit and writable layer size, measured now.
- `GET /:id/logs?service=api,db&tail=200&since=<ISO>&until=<ISO>&grep=users&errors=true`: the output of the services, merged in time order, as `{ lines: [{ service, stream, time, text }] }`. With filters, the last matches among the last 5000 lines of each service; with `errors=true`, an error cut by the tail is kept from its first line. `follow=true` streams server-sent events (one line per event, a `: keep-alive` comment every 15 seconds, `event: end` once every service stopped). `format=text` downloads them as a text file. A deleted environment answers from its archive.
- `GET /:id/logs/:service?tail=200`: one service's output, as text.
- `GET /:id/events?limit=50&before=<id>`: the timeline, newest first, and the crash loops of the last 10 minutes, `{ events, crashLoops }`.
- `GET /:id/metrics?range=24h`: CPU and memory of the environment and of each service (`1h`, `6h`, `24h`, `7d`, `30d`; 360 points at most).
- `GET /:id/disk`: images, volumes, writable layers and sources of the environment, at the last measure.
- `GET /:id/jobs`: the last jobs, newest first, with who asked.
- `POST /:id/preview-token`: `{ header: "X-Spawner-Preview", token, expiresAt }`, to call a protected URL (one hour, this environment only).
- `POST /:id/share` (`{ "ttlHours": 24 }`), `GET /:id/shares`, `DELETE /:id/shares/:shareId`: share links.

## Jobs (`/api/v1/jobs`)

- `GET /:id`: status, phase, error, `errorCode`, `actor`.
- `GET /:id/logs`: the log, as text.
- `GET /:id/logs/stream`: the log as server-sent events, one line per event, until the job ends; a `ping` event every 15 seconds.

## Deploy keys (`/api/v1/git`, admin)

- `GET /key`, `POST /key/generate`: the global deploy key.
- `GET /keys/repos`, `POST /keys/generate`: keys per repository, `{ "gitRepo": "..." }`.
- `POST /test`: tests access to a repository, `{ "gitRepo": "..." }`.

## System

- `GET /api/v1/system` (admin): the host now (CPU, memory, disk), every container (environments, Spawner, others), the disk breakdown, and the alerts (disk above 80 % with less than 50 GiB free, or below the 10 GiB reserve; memory below the build guard; crash loops; out-of-memory kills of the last hour).
- `GET /api/v1/system/metrics?range=24h` (admin): the host, Spawner and the other containers over time.
- `GET /api/v1/system/capacity`: how many more environments of each project fit, within the reader's quota (`quota: { limit, used, remaining }`), and what limits them. The count is `min((available memory - 1 GiB) / typical memory, (free disk - 10 GiB) / typical disk, quota)`, each environment also needing the build guards free before its build (`buildGuards`).
- `GET /api/v1/system/cleanup`, `POST /api/v1/system/cleanup` (admin): what Spawner owns and no longer needs (`automatic` items go every minute anyway), then removing it all.
- `GET /api/v1/system/update` (admin): `{ current, managed, reason, automaticChecks, checkedAt, checkError, latest, run }`. `POST /api/v1/system/update/check` reads the releases now; `POST /api/v1/system/update` (202) updates to the newest version (409 while jobs run).
- `GET /api/v1/terminals`, `GET /api/v1/terminals/:id/recording` (admin): terminal sessions and what they showed (text, escape codes included).
- `GET|POST... /api/v1/wake` (public, reached through an environment's routes): the waiting page of a sleeping or stopped environment; `?__spawner_wake=status` answers its state.
- `GET /api/v1/healthz`, `GET /api/v1/readyz` (public): Spawner runs; Spawner and its database answer.
- `GET /api/v1/info`: the version, the dashboard URL, the preview domain, the scheme, and the limits the CLI checks a deploy with (compose, upload, ttl, exec, share).
- `GET /api/v1/cli/spawner` (public): the CLI bundle, to save as `spawner`.

## Terminal (WebSocket)

Socket.IO on the dashboard's origin, namespace `/terminal`, WebSocket transport only. Get a ticket from `POST /api/v1/auth/ws-ticket` and pass it in the `token` query parameter; a browser's Origin must be the dashboard's. The ticket keeps the scopes and project of the token that asked for it, and the terminal opens only where its user may run commands.

- Client to server: `start-terminal` `{ environmentId, resourceName, cols, rows }` (`resourceName` is the compose service), `terminal-input` `{ input, resourceName }` (pieces of 4096 UTF-16 code units at most), `terminal-resize` `{ resourceName, cols, rows }`, `stop-terminal` `{ resourceName }`.
- Server to client: `terminal-output`, `terminal-error`, `terminal-exit`.
