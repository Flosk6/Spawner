# Scripts

Tests and tools for working on Spawner. Installing, upgrading and removing a
server is `install.sh`, at the root of the repository; backups and restores
are described in [docs/operations.md](../docs/operations.md).

| Script | What it does | Where it runs |
|---|---|---|
| `e2e-engine.sh` | End-to-end test of the engine, access, the CLI, MCP, supervision and the lifecycle, on a local stack | A developer machine with Docker, and CI |
| `e2e-installer.sh` | End-to-end test of `install.sh`: install, both examples (two branches at once), upgrade, second run, removal | A throwaway Ubuntu machine with sudo: the CI runner |
| `capacity-check.sh` | Fills a real server up to the capacity it announces, checks it holds, then cleans up | Any machine with Node.js, against a server you may fill |
| `release.sh` | Sets the versions, commits and tags a release | A clean checkout |

## e2e-engine.sh

```bash
scripts/e2e-engine.sh           # KEEP=1 leaves the stack running
```

Starts Postgres, Traefik and Spawner from the root `docker-compose.yml` (as
the compose project `spawner-e2e`, data in `local-data/e2e`), then goes through
what a team does: an environment from an uploaded worktree, its protected URL,
an invited teammate with a passkey, `exec`, an update that keeps the data, a
deletion that leaves nothing; an agent with the CLI and the MCP server;
supervision (out-of-memory kills, timeline, metrics, disk); sleep and wake-up,
quotas, capacity, expiry and cleanup. The comment at the top of the script
lists every check.

It needs Docker with Compose, curl, Node.js, tar, git and python3, and port 80:
stop the development stack first (`docker compose down`, without `-v` to keep
its data). It removes only what it created: the compose projects of its own
environments, its stack and its data directory.

- `e2e/teammate.mjs` plays an invited teammate with Node built-ins only: a
  software passkey, the device login of the CLI, a preview opened through the
  dashboard.
- `e2e/mcp.mjs` plays a coding agent that drives `spawner mcp` over stdio.
- `e2e-fixtures/bind-mount/` is a project whose service mounts files of its
  source and writes into them as root.

## e2e-installer.sh

```bash
IMAGE=spawner:ci scripts/e2e-installer.sh
```

Installs Spawner with `install.sh --tls off --domain localtest.me` and an
image built beforehand, deploys `examples/node-postgres` with the CLI the
server serves and asks `spawner mcp` its status (`e2e/mcp-status.mjs`), then
deploys `examples/laravel-next-mysql` from two branches of the same
repository at once and updates both at once. It checks that each environment
serves its own branch and keeps its own data, and that its own part of the
disk holds neither `vendor` nor `node_modules`. It then upgrades (the
database must be backed up, the secrets and environments kept), runs the
installer again without options, and removes everything with `--uninstall
--purge`.

It changes the machine: Docker settings, `/opt/spawner`, `/var/lib/spawner`.
Run it on a throwaway machine only; CI runs it on every pull request.

## capacity-check.sh

```bash
SPAWNER_URL=https://spawner.preview.example.com SPAWNER_TOKEN=<admin token> \
  scripts/capacity-check.sh [project directory] [--yes]
```

The token is an admin's personal token, or the installation's
`SPAWNER_BOOTSTRAP_TOKEN` (in `/opt/spawner/.env`). Spawner announces how many
more environments of each project fit (System page, `spawner capacity`). This
script checks the figure on a real server:
as long as the capacity announces room, it creates one more environment of
the project (`examples/node-postgres` by default) and waits until it is
ready, then checks that the server kept its 1 GiB memory reserve. When the
capacity says 0, one more environment must be refused (exit code 6). At the
end, every environment must still be ready, without any out-of-memory kill.
It deletes everything it created, and puts back the quota it lifts while it
runs.

It takes a while (each environment waits for a new measure of the server)
and keeps the server full during that time: run it before the team relies on
the server, or out of hours. `MAX=5` stops after five environments, without
the refusal check.

## release.sh

```bash
scripts/release.sh 2.1.0        # then: git push origin <branch> v2.1.0
scripts/release.sh 2.1.0-rc.1   # a prerelease: only the tag
```

Write the `CHANGELOG.md` section of the version first: the release notes come
from it. The script sets the version of every `package.json` and the default
version of `install.sh`, commits, and makes an annotated tag. Pushing the tag
starts `.github/workflows/release.yml`, which publishes the images on GHCR
(`linux/amd64`, `linux/arm64`), the CLI on npm (`spawner-cli`, when the
`NPM_TOKEN` secret is set) and the GitHub release with `install.sh`, the CLI
bundle and their checksums.
