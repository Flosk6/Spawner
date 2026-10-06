# Spawner

> Preview environments for every branch, on your own server.
>
> **License:** AGPL-3.0 | **Copyright © 2025 Florian-mfr**

Spawner runs a copy of your application for each branch on a VPS, with its own URL, database and logs, so the whole team can test any branch in real time. Developers and coding agents create, update and delete environments from the dashboard or the API, run commands in them and read their logs, while the code keeps living in their local worktrees.

**Status:** the v1 rewrite is under way on the `v1` branch. The environment engine and its API are done (milestone M1); team access, the CLI and the installer come next.

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

## Quick start (local)

Requirements: Docker with Compose v2, Node.js 22 and pnpm 8.

```bash
cp .env.example .env    # set SPAWNER_DATA_DIR to an absolute path, and a SPAWNER_BOOTSTRAP_TOKEN
docker compose up -d --build
```

The dashboard is at `http://spawner.localtest.me` (every subdomain of localtest.me resolves to 127.0.0.1). With the API:

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

Each change answers with a job: follow it with `GET /api/v1/jobs/<id>/logs/stream`. Then `GET /api/v1/envs/<id>` gives the URLs, `POST /api/v1/envs/<id>/exec` runs a command in a service, `GET /api/v1/envs/<id>/logs/<service>` reads its output. The full API is described in [CLAUDE.md](CLAUDE.md#api-endpoints).

## Production

On an Ubuntu 22.04+ VPS dedicated to previews, with Docker and a DNS record `*.preview.yourdomain.com` pointing to it:

```bash
git clone -b v1 https://github.com/Flosk6/Spawner.git spawner && cd spawner
./configure.sh          # writes .env.production and starts docker-compose.production.yml
```

The dashboard is then at `https://spawner.preview.yourdomain.com`. Certificates are obtained per host for now; a one-command installer with a wildcard certificate comes with milestone M6.

## Security

- **Compose policy**: an allowlist checked before anything runs, with tests for each refused case ([fixtures](packages/core/test/fixtures/compose/forbidden))
- **Isolation**: one network per environment; Traefik routes through files and never gets the Docker socket
- **No shell**: git and Docker Compose run with argument arrays and a minimal environment; the host environment never reaches the compose files
- **Uploads**: archives are checked entry by entry (no absolute paths, `..`, escaping links, devices)
- **Access**: GitHub OAuth (team based) for the dashboard, a bootstrap token for the API until personal tokens arrive; changes made with a browser session need a header that other origins cannot send
- **Deploy keys**: read-only SSH keys per repository

Run Spawner on a server dedicated to previews: environments run code from branches that have not been reviewed yet.

## Development

```
apps/
├── api/        # NestJS, Prisma (PostgreSQL), environment engine; serves the web app in production
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
scripts/e2e-engine.sh       # creates, calls, updates and deletes an environment on a local stack
```

## License

**AGPL-3.0** - Free to use, modify, and distribute. If you run Spawner as a SaaS, you must share your source code with users.

**Copyright © 2025 Florian-mfr** - See [LICENSE](LICENSE) | Commercial license available for proprietary use.
