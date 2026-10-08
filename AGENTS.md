# AGENTS.md

Guidance for coding agents, and people, working on Spawner's own code. Claude Code reads it through `CLAUDE.md`.

Spawner is a self-hosted preview environment manager: one copy of a project per branch, on a server of your own, each with its own URLs, for a team and the coding agents working for it. A project is a git repository holding a `.spawner/` directory (a manifest and a Docker Compose file). Spawner checks it out, or receives it as an archive from a local worktree, checks the compose file against a security policy, builds and runs it as a Compose project, seeds it and routes its URLs through Traefik. [Concepts](docs/concepts.md) describes it from the user's side.

## Read before changing

| To change | Read first |
|---|---|
| The engine, jobs, lifecycle, supervision, updates, the dashboard, the CLI | [Architecture](docs/architecture.md) |
| Access, previews, routing, the compose policy, the terminal, the installer | [Security](docs/security.md), then the architecture |
| A route of the API | Its controller ([where each route lives](docs/architecture.md#routes)), and `packages/types` for what it answers |
| A setting of the server | [Configuration](docs/configuration.md) |
| What `.spawner/` accepts | [The manifest](docs/manifest.md) |
| A command or an output of the CLI, a tool of the MCP server | [The CLI](docs/cli.md) |
| The end-to-end tests, the release | [Scripts](scripts/README.md) |

These pages are the documentation users read: a change of behavior updates the page that describes it, in the same change, and `CHANGELOG.md` for what users will notice.

## Layout

A pnpm workspace built with Turborepo:

- `apps/api`: NestJS (port 3000), Prisma and PostgreSQL, the environment engine; in production it also serves the dashboard and the CLI bundle
- `apps/web`: the dashboard, Vue 3 with Vite, Tailwind CSS and PrimeVue
- `apps/cli`: the `spawner` CLI and MCP server, bundled by esbuild into one file (`dist/spawner.cjs`) with no runtime dependency
- `packages/core`: manifest, interpolation, compose policy and rendering, log error filter, capacity; pure functions (no I/O but `realpath`), shared by the API and the CLI
- `packages/types`: the shapes the API answers, shared by the dashboard and the CLI
- `packages/utils`: validators of git inputs (repository URLs, refs)
- `examples/`: projects ready to deploy, checked by the tests
- `scripts/`: end-to-end tests, the capacity check, the release
- `install.sh` (the server installer), `Dockerfile` (the single image), `docker-compose.yml` (the local stack)

Packages depend on each other through `workspace:*`. Shared packages must be built before the apps run: `pnpm build` builds the dependencies first.

## Rules

- **No emojis**, in code, comments, messages, logs or docs.
- **No shell.** External programs (git, docker compose, ssh-keygen) run through `run()` in `apps/api/src/modules/engine/process.ts`, or `execFile` in the CLI, with an argument array and a minimal environment. Never build a command string.
- **Never modify the data directory** (`SPAWNER_DATA_DIR`, `local-data/` in development). It holds the mirrors and worktrees Spawner checked out: a bug in a deployed project is fixed in that project's repository by its people. Say what to change instead.
- **The compose policy is an allowlist.** Every change to it comes with a fixture (below).
- **The API decides.** The dashboard hides what the API would refuse (`canManage` in `apps/web/src/utils/environment.ts`), but every check lives in the API.
- **The dashboard draws with its tokens.** Colors come from `apps/web/src/styles/tokens.css` through the classes of `apps/web/src/style.css` and Tailwind's token colors (`bg-surface`, `text-fg-3`...): never Tailwind's palette, a raw color or a `dark:` variant in a template, so both themes stay right. [The dashboard](docs/architecture.md#the-dashboard-appsweb) lists the pieces.
- **Comments**: JSDoc on functions, methods and classes, about intent and what the code does not say; no comments inside functions but for really tricky logic. Fix a misleading comment when you touch its code.
- **Docs** are in English. User and operator documentation goes to `docs/`.
- **Prettier** is set up for `apps/api` and `apps/web`, but the tree is not formatted with it yet: do not run `pnpm format` in a change about something else.

## Commands

```bash
pnpm install && pnpm build                # required before anything else
pnpm dev                                  # the API (watch) and the dashboard (Vite on :8080, proxying /api and the terminal to VITE_API_URL)
pnpm api:dev                              # the API only (pnpm web:dev: the dashboard only)
pnpm --filter @spawner/cli build          # apps/cli/dist/spawner.cjs: link it into your PATH as spawner
pnpm lint                                 # read-only; pnpm --filter @spawner/api lint:fix fixes the API
pnpm typecheck
pnpm test                                 # Vitest
scripts/e2e-engine.sh                     # end to end: needs Docker and port 80; KEEP=1 leaves the stack up
```

The full stack (Postgres, Traefik, Spawner) runs with `docker compose up -d --build` at the root, after `cp .env.example .env` with `SPAWNER_DATA_DIR` set to an absolute path. The dashboard is then `http://spawner.localtest.me` (or `http://localhost:8080`), and environments `http://<env>--<project>.localtest.me`: every subdomain of localtest.me resolves to 127.0.0.1.

First login: `docker logs spawner` prints a link that creates the first admin, or `docker exec -u node spawner node dist/admin.js invite --role admin` prints a new one. Over plain HTTP, browsers allow passkeys on localhost only: open the link on `http://spawner.localtest.me` to log in without a passkey, or on `http://localhost:8080` to create one.

Dependencies go to the package that uses them (`pnpm --filter @spawner/api add <package>`); the root takes build tools only (`pnpm add -w -D`). The CLI has dev dependencies only: esbuild bundles them.

## Tests

- Vitest. Specs (`*.spec.ts`) sit next to the code they cover and are left out of builds (`tsconfig.build.json`). The `src/testing/` directories hold helpers, never built nor bundled.
- API specs load `reflect-metadata` (`apps/api/vitest.config.mts`): instantiate services directly rather than through the Nest container when you can. The collectors (metrics, Docker events, disk) do not start under `NODE_ENV=test`; the end-to-end test covers them.
- Real programs where it matters: git mirrors on local `file://` repositories, uploads with hostile archives built by hand, passkeys with a software authenticator (`apps/api/src/testing/soft-authenticator.ts`, P-256, attestation "none") whose answers go through the real WebAuthn verification.
- The CLI: archives and workspaces on real git repositories (`src/testing/repo.ts`); operations, commands and the MCP server against `fakeFetch` (`src/testing/fake-api.ts`), which answers routes such as `"GET /envs/:id"`; MCP tools called by the SDK's client over an in-memory transport.
- The compose policy: `packages/core/test/fixtures/compose/` holds files it must refuse (`forbidden/`, each starting with `# expect: <code> <path>`) or accept (`allowed/`). `packages/core/src/examples.spec.ts` checks every `examples/*/.spawner/` against the policy and the layer warnings.
- Security fixes keep a test: `common/frame-headers.spec.ts` (no framing), `terminal.gateway.spec.ts` (raw Engine.IO against the real Socket.IO server: tickets, origins, transports, message sizes), and the engine end-to-end test (frame headers, polling refused, routing through qualified names with an impostor next to Traefik, Spawner's cookies kept from the applications). Add to them when you fix a vulnerability.
- `scripts/e2e-engine.sh` covers what units cannot; the comment at its top lists every check. `scripts/e2e-installer.sh` changes the machine it runs on: CI only.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, build, the image, and both end-to-end tests on every pull request and every push to `master`. Actions are pinned by commit SHA (Dependabot bumps them weekly); the binfmt and BuildKit images are pinned by digest and bumped by hand.

## Common tasks

**Changing the compose policy**: edit `packages/core/src/compose/validate.ts` (and `render.ts` if the rendered file changes), add a fixture to `forbidden/` or `allowed/`, run `pnpm --filter @spawner/core test`, then `scripts/e2e-engine.sh`. The full rules are in [security](docs/security.md#the-compose-policy), summed up in [the manifest](docs/manifest.md#rules).

**Changing the database**: edit `apps/api/prisma/schema.prisma` and add a migration directory to `apps/api/prisma/migrations/` (`prisma migrate diff --from-schema-datamodel <previous schema> --to-schema-datamodel prisma/schema.prisma --script`). The image applies migrations at startup, and they only go forward.

**Debugging an environment** of the local stack:

```bash
curl -H "Authorization: Bearer $SPAWNER_BOOTSTRAP_TOKEN" http://localhost:8080/api/v1/jobs/<job id>/logs
docker ps -a --filter "label=dev.spawner.env=<environment id>"
docker compose -p spn-<project>--<env> -f <data dir>/envs/<id>/compose.rendered.yaml ps
cat <data dir>/traefik/<id>.yaml                   # its routes
docker logs spawner
```

**A release** is the maintainer's: write the version's section of `CHANGELOG.md`, then `scripts/release.sh <version>` ([scripts](scripts/README.md#releasesh)). Never push a tag on your own.
