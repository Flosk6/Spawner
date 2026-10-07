# Spawner

> Preview environments for every branch, on your own server, for your team and its coding agents.
>
> **License:** AGPL-3.0 | **Copyright © 2025 Florian-mfr**

Spawner runs a copy of your application for each branch, with its own URLs, database and logs, on a server you own. Developers, reviewers and coding agents create one in seconds from a branch or straight from a worktree, uncommitted changes included, then open it, run commands in it, read its logs, share it, and delete it. Environments nobody uses go to sleep, and many fit on one server.

```text
$ cd ~/code/blog-feat-login          # an agent's worktree, branch feat/login
$ spawner up --wait
feat-login (blog) is ready
  web  https://feat-login--blog.preview.example.com
  api  https://api--feat-login--blog.preview.example.com
$ spawner exec feat-login db -- mysql -uapp -papp app -e "insert into users (name) values ('ada')"
$ spawner logs feat-login api --errors
$ spawner share feat-login           # a link for someone without an account
$ spawner down feat-login
```

## Quick start

On a server dedicated to previews (Ubuntu 22.04 or 24.04, Debian 12; 8 GiB of memory advised), with a DNS record `*.preview.example.com` pointing to it:

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh | sudo bash
```

The installer asks for the domain, an e-mail and your DNS provider (for one wildcard certificate), installs Docker if needed, starts Spawner, and prints the link that creates the first admin account. Then, on your machine, in a project:

```bash
npm install -g spawner-cli && spawner login https://spawner.preview.example.com
spawner init && spawner up --wait
```

`spawner init` writes `.spawner/` (a manifest and a Docker Compose file, to adjust) and the instructions for coding agents. See [installing](docs/install.md), and [the examples](examples): [Node.js and PostgreSQL](examples/node-postgres), [Laravel, Next.js and MySQL](examples/laravel-next-mysql).

## How it works

```text
                            *.preview.example.com
                                     |
   browser, agent, CLI ---------> Traefik --------- asks Spawner before each request
                                     |
          +--------------------------+--------------------------+
          |                          |                          |
   spawner.<domain>       feat-login--blog.<domain>     main--blog.<domain>
   dashboard and API      its own network:              its own network:
   (Spawner, Postgres)    web, api, db                  web, api, db
```

A project describes its environment in its repository, in `.spawner/`: a manifest that names its URLs and its seed, and a regular Docker Compose file.

```yaml
# .spawner/spawner.yaml
version: 1
project: blog
exposures:
  - { name: web, service: web, port: 3000 }
  - { name: api, service: api, port: 8000 }
seed:
  - { service: api, run: [php, artisan, migrate, --seed, --force] }
```

For each environment, Spawner checks out the branch or receives the worktree, checks the compose file against a security policy, builds and starts it on its own Docker network, seeds it, and routes its URLs through Traefik with HTTPS. Updates keep the data. Every change is a job with a live log; the dashboard, the CLI, its MCP server and the API all drive the same jobs.

## For coding agents

An agent tests its own work in a real environment, from its worktree, without pushing:

- `spawner up --wait --json`, then every command with `--json` and stable exit codes (4: the environment failed, with the end of the build log; 6: no room; 7: `.spawner/` refused, with what to fix);
- `spawner url --with-token` gives the header that opens protected URLs, for curl or Playwright;
- `spawner exec` runs a command in any service; `spawner logs --errors` keeps the error lines, stack traces whole; `spawner status` says which service crashed and why;
- `spawner mcp` offers the same operations as MCP tools (Claude Code, Codex, Cursor...);
- each agent on its own branch gets its own environment and database; agents deploying at once do not get in each other's way.

See [coding agents](docs/agents.md) and [the CLI](docs/cli.md).

## Many environments on one server

- **Sleep**: after 2 hours without a visit or an action, an environment's containers stop; the next visit wakes it up within seconds.
- **Shared layers**: environments share their base images and dependencies; each one only adds its code and build output (about 4 MiB for the Laravel example). Spawner warns about Dockerfiles that prevent it.
- **Capacity**: Spawner says how many more environments of each project fit, from what they really use, and refuses one the server has no room for.
- **Lifetime and quotas**: environments expire after 72 hours unless someone deploys them again; 5 per person. Spawner cleans up what deleted environments leave, and nothing else.

See [density](docs/density.md).

## Supervision

Each environment has its logs (by service, errors only, live, downloadable), the CPU and memory of each service over time, its disk, a timeline of crashes, out-of-memory kills, failing healthchecks and jobs, and a terminal into any service. A deleted environment stays readable for 7 days. Admins see the server: alerts, 30 days of history, every container, and the room left.

## Security

Branches run unreviewed code, so Spawner treats them as such: compose files are checked against an allowlist (no host mounts, privileged containers, host network or Docker socket), each environment has its own network, Traefik has no Docker socket, and the server is meant for previews only. Accounts have no passwords (invitations and passkeys, GitHub optional); tokens have scopes and expiries; previews are protected by default, and Spawner's cookies never reach the applications. Everything is in an audit trail. See [security](docs/security.md).

## Documentation

- [Installing](docs/install.md): requirements, DNS providers, options, upgrades, removal
- [Concepts](docs/concepts.md): projects, environments, jobs, lifecycle, accounts, protected previews
- [The manifest](docs/manifest.md): `.spawner/spawner.yaml`, the compose file and its rules
- [The CLI and the MCP server](docs/cli.md)
- [Coding agents](docs/agents.md): Claude Code, Codex, Cursor
- [Security](docs/security.md)
- [Operations](docs/operations.md): backups, restores, disk, monitoring
- [Density](docs/density.md): Dockerfiles and databases that make environments cheap
- [Spawner and the alternatives](docs/comparison.md): when Coolify, Dokploy, Preevy or hosted previews fit better
- [Changelog](CHANGELOG.md)

## Development

```text
apps/
├── api/        NestJS, Prisma (PostgreSQL), the environment engine; serves the web app and the CLI in production
├── cli/        The spawner CLI and MCP server, bundled into one file
└── web/        Vue 3, Vite, Tailwind CSS, PrimeVue
packages/
├── core/       Manifest, compose policy and rendering (pure, shared with the CLI)
├── types/      API types shared by the web app and the CLI
└── utils/      Git input validators
examples/       Projects ready to deploy
scripts/        End-to-end tests, the capacity check, the release
```

Requirements: Docker with Compose v2, Node.js 22 and pnpm 8.

```bash
pnpm install && pnpm build
cp .env.example .env            # set SPAWNER_DATA_DIR to an absolute path
docker compose up -d --build    # Postgres, Traefik and Spawner on http://spawner.localtest.me
docker logs spawner             # the link that creates the first admin account
pnpm dev                        # or the API on :3000 and the web app on :8080, with hot reload
pnpm lint && pnpm typecheck && pnpm test
scripts/e2e-engine.sh           # end to end: a local stack, environments through the API, the CLI and MCP
```

Every subdomain of `localtest.me` resolves to 127.0.0.1. Over plain HTTP, browsers allow passkeys on `localhost` only, so a local install lets invitations log in without one. See [scripts](scripts/README.md) for the tests.

## License

**AGPL-3.0**: free to use, modify and distribute. If you run a modified Spawner as a service for others, you must share your source code with its users.

**Copyright © 2025 Florian-mfr**. See [LICENSE](LICENSE). A commercial license is available for proprietary use.
