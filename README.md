# Spawner

> Preview environments for every branch, on your own server.
>
> **License:** AGPL-3.0 | **Copyright © 2025 Florian-mfr**

Spawner runs a copy of your application for each branch on a VPS, with its own URL, database and logs, so the whole team can test any branch in real time. Developers and coding agents create, update and delete environments from the `spawner` CLI, its MCP server, the dashboard or the API, run commands in them and read their logs, while the code keeps living in their local worktrees: uncommitted changes included, nothing to push.

```text
$ cd ~/code/blog-feat-login            # an agent's worktree, branch feat/login
$ spawner up --wait
feat-login (blog) is ready
  web  https://feat-login--blog.preview.example.com
$ spawner exec feat-login db -- psql -U app -c "insert into users (name) values ('ada')"
$ spawner logs feat-login api --errors
$ spawner share feat-login             # a link for someone without an account
$ spawner down feat-login
```

Previews are protected: teammates open them once logged in, agents with a short token, and anyone else through a temporary share link.

**Status:** the v1 rewrite is under way on the `v1` branch. The environment engine (milestone M1), team access (M2: invitations, passkeys, tokens, protected previews), the CLI with its MCP server (M3), supervision (M4) and the lifecycle (M5: sleep, expiry, quotas, cleanup) are done; the one-command installer and the release come next.

## How it works

A project describes its environment in its own repository, in a `.spawner/` directory:

```yaml
# .spawner/spawner.yaml
version: 1
project: example
exposures:
  - { name: web, service: app, port: 3000 }
seed:
  - { service: app, run: [node, seed.js] }
ttl: 24h
```

```yaml
# .spawner/compose.yaml: a regular Docker Compose file
services:
  db:
    image: postgres:18-alpine
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app }
  app:
    build: ..
    environment:
      DATABASE_URL: postgres://app:app@db:5432/app
      PUBLIC_URL: ${SPAWNER_URL}
```

For each environment, Spawner:

1. checks out the branch (or receives the worktree as an archive),
2. validates the compose file against a security policy: no host mounts, no privileged containers, no host network, limits on memory, CPU and processes,
3. builds and starts it in its own Docker network, then runs the seed,
4. publishes its URLs through Traefik: `https://<env>--<project>.preview.example.com`.

Updates keep the data; `fresh` starts from scratch. See [examples/node-postgres](examples/node-postgres) for a complete project.

## The CLI, for people and agents

Every server serves its CLI (Node.js 20 or later):

```bash
curl -fsSL https://spawner.preview.example.com/api/v1/cli/spawner -o ~/.local/bin/spawner && chmod +x ~/.local/bin/spawner
spawner login https://spawner.preview.example.com     # approve the code in the dashboard
cd my-project && spawner init                          # .spawner/, and the instructions for coding agents
spawner up --wait --json                               # the environment of the current branch
```

`spawner up` checks `.spawner/` locally with the server's rules before sending the worktree, then follows the build. Every command has a `--json` output and stable exit codes (4: the environment failed, with the end of the build log; 7: the compose file was refused). For agents that prefer tools, `spawner mcp` is an MCP server with the same operations:

```json
{ "mcpServers": { "spawner": { "command": "spawner", "args": ["mcp"] } } }
```

See [docs/cli.md](docs/cli.md) for every command and output, and [docs/manifest.md](docs/manifest.md) for `.spawner/`.

## Many environments on one server

Memory is what runs out first, so environments nobody uses go to sleep: after 2 hours without a visit or an action, their containers stop and their data stays. The next visit to one of their URLs wakes them up within seconds (the browser gets a page that reloads by itself), and so do `spawner exec`, `shell`, `url` and `logs --follow`. Environments expire after 72 hours unless someone deploys or extends them. Each person may own 5 environments, and Spawner refuses a new one, or a wake-up, when the server lacks the memory or disk for it; an admin changes these limits from the settings page.

On disk, environments share what they can: the image an update replaces is removed at once, the code of a source is removed once the build no longer needs it, and Spawner warns about Dockerfiles that keep environments from sharing their dependencies. Every minute, Spawner checks its environments against Docker and removes what deleted ones left behind, never anything that is not its own.

## What the dashboard shows

- **An environment**: its URLs and services, logs filtered by service, errors and text (followed live, downloadable), CPU and memory of each service over time, its disk, a timeline of crashes, out-of-memory kills, failed healthchecks and jobs, and a terminal into any service. When a service crashes in a loop, the page says which one and why ("app: out of memory (limit 512 MiB)"); `spawner status` says the same.
- **A deleted environment** stays readable for 7 days: its logs are archived when it is deleted, so a failure can still be understood after the fact.
- **The server** (admins): alerts (disk, memory, crash loops), the host over 30 days, the disk taken by each environment, every container, and how many more environments of each project fit (`spawner capacity`).
- **A project**: what one of its environments costs (memory, disk, build time), and its variables: values the compose files use as `${NAME}`, secret ones encrypted and masked in job logs.

## Quick start (local)

Requirements: Docker with Compose v2, Node.js 22 and pnpm 8.

```bash
cp .env.example .env    # set SPAWNER_DATA_DIR to an absolute path, and a SPAWNER_BOOTSTRAP_TOKEN
docker compose up -d --build
docker logs spawner     # shows the link that creates the first admin account
```

The dashboard is at `http://spawner.localtest.me` (every subdomain of localtest.me resolves to 127.0.0.1). Open the first admin link there; accounts have no password, they log in with passkeys (over plain HTTP, browsers allow passkeys on `localhost` only, so a local install lets invitations log in without one). Invite the team from the Team page.

Then install the CLI from `http://spawner.localtest.me/api/v1/cli/spawner` and log in to `http://spawner.localtest.me`, as above. With the API directly, using the bootstrap token of the installation (personal tokens are created from your account page):

```bash
TOKEN=<your SPAWNER_BOOTSTRAP_TOKEN>
API=http://localhost:8080/api/v1

# A project: a repository holding .spawner/ (rootDir for a monorepo)
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' $API/projects \
  -d '{"slug":"example","name":"Example","repoUrl":"https://github.com/Flosk6/Spawner.git","defaultRef":"v1","rootDir":"examples/node-postgres"}'

# An environment from a branch...
curl -H "Authorization: Bearer $TOKEN" $API/envs -F project=example -F env=demo -F 'primary={"ref":"v1"}'

# ...or from a local worktree: the archive stands for the repository, rootDir applies inside it
tar -czf /tmp/worktree.tar.gz --exclude node_modules examples/node-postgres
curl -H "Authorization: Bearer $TOKEN" $API/envs -F project=example -F env=local -F primary=@/tmp/worktree.tar.gz
```

Each change answers with a job: follow it with `GET /api/v1/jobs/<id>/logs/stream`. Then `GET /api/v1/envs/<id>` gives the URLs, `POST /api/v1/envs/<id>/exec` runs a command in a service, `GET /api/v1/envs/<id>/logs/<service>` reads its output, and `POST /api/v1/envs/<id>/preview-token` gives the header an agent sends to call the protected URLs:

```bash
HEADER=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" $API/envs/<id>/preview-token | jq -r .token)
curl -H "X-Spawner-Preview: $HEADER" http://demo--example.localtest.me/
```

The full API is described in [CLAUDE.md](CLAUDE.md#api-endpoints).

## Production

On an Ubuntu 22.04+ VPS dedicated to previews, with Docker and a DNS record `*.preview.yourdomain.com` pointing to it:

```bash
git clone -b v1 https://github.com/Flosk6/Spawner.git spawner && cd spawner
./configure.sh          # writes .env.production and starts docker-compose.production.yml
```

The script prints the dashboard URL, `https://spawner.preview.yourdomain.com`, and a link valid one hour to create the admin account. Certificates are obtained per host for now; a one-command installer with a wildcard certificate comes with milestone M6.

## Security

- **Compose policy**: an allowlist checked before anything runs, with tests for each refused case ([fixtures](packages/core/test/fixtures/compose/forbidden))
- **Isolation**: one network per environment; Traefik routes through files and never gets the Docker socket
- **No shell**: git and Docker Compose run with argument arrays and a minimal environment; the host environment never reaches the compose files
- **Uploads**: archives are checked entry by entry (no absolute paths, `..`, escaping links, devices)
- **Accounts**: no passwords. Invitation links create accounts with a passkey; GitHub login (by organization and team) is optional. Members manage their own environments, admins everything; everything is in an audit trail
- **Tokens**: personal API tokens with scopes (`envs:read`, `envs:write`, `envs:exec`, `preview`, `admin`), an expiry and an optional project; only their hash is stored. The CLI logs in through a device code approved in the browser and stores its token readable by its owner only
- **Previews**: Traefik asks Spawner before each request to a protected URL; teammates pass with a cookie set by the dashboard, agents with a one-hour header token, guests with a share link that expires
- **CSRF**: the dashboard session is a `__Host-` cookie, and every change made without a token needs a header that other origins, previews included, cannot send
- **Deploy keys**: read-only SSH keys per repository
- **Terminals**: closed after 15 minutes without input or 4 hours, and recorded for the admins (30 days)
- **Public URLs**: an exposure is public (`auth: none`) only in a project an admin allowed

Run Spawner on a server dedicated to previews: environments run code from branches that have not been reviewed yet.

## Development

```
apps/
├── api/        # NestJS, Prisma (PostgreSQL), environment engine; serves the web app and the CLI in production
├── cli/        # The spawner CLI and MCP server, bundled into one file
└── web/        # Vue 3, Vite, Tailwind CSS, PrimeVue
packages/
├── core/       # Manifest, compose policy and rendering (pure, shared with the CLI)
├── types/      # API types shared by the web app and the CLI
└── utils/      # Git input validators
examples/       # Projects ready to deploy
```

```bash
pnpm install && pnpm build
pnpm dev                    # API on :3000, web on :8080
pnpm lint && pnpm typecheck && pnpm test
scripts/e2e-engine.sh       # a local stack, then environments through the API, the CLI and MCP
```

## License

**AGPL-3.0** - Free to use, modify, and distribute. If you run Spawner as a SaaS, you must share your source code with users.

**Copyright © 2025 Florian-mfr** - See [LICENSE](LICENSE) | Commercial license available for proprietary use.
