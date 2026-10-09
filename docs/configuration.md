# Configuration

Spawner reads its settings from the environment of its container. This page lists them all; [install](install.md) covers the options of the installer, and [the CLI](cli.md#log-in) the variables of the CLI (`SPAWNER_URL`, `SPAWNER_TOKEN`, `SPAWNER_PROJECT`).

## Where settings go

**From the dashboard** (System, Settings), admins change the lifetimes, the idle time before sleeping, the quota per person, the memory of an environment and the build guards, and configure the GitHub login. What they set there wins over the variables below, which stay the defaults: a field left empty goes back to them.

**On a server installed by `install.sh`**, your own settings go to `/opt/spawner/spawner.env`, one `VARIABLE=value` per line, which the installer never overwrites. Apply a change with:

```bash
docker compose --project-directory /opt/spawner --env-file /opt/spawner/.env up -d
```

The installer sets some variables itself, in `/opt/spawner/compose.yaml` and `/opt/spawner/.env`: they win over `spawner.env`. Change them by running the installer again with the matching option (`--domain`, `--dns-provider`, `--memory-limit`...). They are marked "installer" below.

**On the local stack** (`docker-compose.yml`), the root `.env` sets the variables the compose file passes on; add a line to the `spawner` service's `environment` for any other.

## Access

| Variable | Default | |
|---|---|---|
| `FRONTEND_URL` | `<scheme>://spawner.<preview domain>` | The dashboard's URL. It must be a host of the preview domain: the dashboard sets the preview cookie on that domain |
| `SPAWNER_SECRET` | generated into `<data dir>/secret.key` | Master secret, from which the keys that sign tokens and sessions and encrypt settings derive (installer) |
| `SESSION_SECRET` | derived from the master secret | Signs the session cookie |
| `SESSION_MAX_AGE` | `86400000` (24 hours) | Dashboard sessions, in milliseconds |
| `SPAWNER_BOOTSTRAP_TOKEN` | none | Bearer token of the installation, with every scope and no user, for scripts and CI; the installer sets it only when given one |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | none | GitHub login, until it is configured from the settings page |
| `GITHUB_ORG`, `GITHUB_TEAM` | none | Restrict the GitHub login to the members of an organization, and of a team |
| `GITHUB_CALLBACK_URL` | `<dashboard>/api/v1/auth/github/callback` | The OAuth callback |

## Application

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | Port of the API |
| `DATABASE_URL` | | PostgreSQL connection string (installer) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `localhost`, `5432`, `spawner`, `spawner`, `spawner` | The same database, for the session store (installer) |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | The Docker socket (installer) |
| `WEB_DIST_PATH` | none (`/app/web` in the image) | The built dashboard the API serves |
| `SPAWNER_CLI_PATH` | none (`/app/cli/spawner` in the image) | The CLI bundle served at `/api/v1/cli/spawner`; `apps/cli/dist/spawner.cjs` in development |
| `SPAWNER_VERSION` | the version of `apps/api/package.json` | The version `/api/v1/info` reports, set in the image by the release build |
| `NODE_ENV` | | `production` on a server (installer); under `test`, the collectors do not start |

## Engine

| Variable | Default | |
|---|---|---|
| `SPAWNER_DATA_DIR` | `/var/lib/spawner` | The data directory. It must be mounted at the same path in the Spawner container: the compose files Spawner renders use these paths (installer) |
| `GIT_KEYS_PATH` | `<data dir>/keys` | Deploy keys and known_hosts |
| `SPAWNER_PREVIEW_DOMAIN` | `localtest.me` | Domain of the previews (installer) |
| `SPAWNER_TLS` | `off` | `letsencrypt` or `off` (installer) |
| `SPAWNER_TLS_RESOLVER` | `letsencrypt` | Traefik's certificate resolver |
| `SPAWNER_TLS_WILDCARD` | `false` | `true` when Traefik gets one wildcard certificate by DNS-01: routes then ask for `*.<preview domain>` rather than a certificate per host (installer, with a DNS provider) |
| `SPAWNER_TRAEFIK_ENTRYPOINT` | `web`, or `websecure` with TLS | Traefik entrypoint of the routes |
| `SPAWNER_TRAEFIK_CONTAINER` | `spawner-traefik` | The Traefik container, attached to each environment's network (installer) |
| `SPAWNER_DASHBOARD_HOST` | `spawner.<preview domain>` | Host of the dashboard's route |
| `SPAWNER_DASHBOARD_UPSTREAM` | `http://spawner.spawner-core:3000` | Where Traefik sends the dashboard's traffic. Qualify it by Spawner's network: Traefik also joins every environment network, and Docker's DNS answers a bare name from the first network that knows it. Spawner warns at startup about a bare name (installer) |
| `SPAWNER_BUILD_CONCURRENCY` | 1 below 8 GiB of memory, 2 above | Builds at once |
| `SPAWNER_START_TIMEOUT_SECONDS` | `300` | How long services may take to start |
| `SPAWNER_JOB_TIMEOUT_SECONDS` | `1800` | How long a whole job may take |
| `SPAWNER_UPLOAD_MAX` | `100m` | Largest worktree upload, compressed |
| `SPAWNER_UPLOAD_MAX_FILES` | `50000` | Files in an upload |
| `SPAWNER_UPLOAD_MAX_EXTRACTED` | `1g` | Size of an upload once extracted; the decompressed archive may hold 4 KiB more per file, for the tar headers |

## Lifecycle and limits

The settings page overrides all of these but `ENABLE_MEMORY_CHECK`.

| Variable | Default | |
|---|---|---|
| `SPAWNER_ENV_TTL` | `72h` | Lifetime of an environment, prolonged by each deploy |
| `SPAWNER_ENV_TTL_MAX` | `14d` | The longest lifetime a manifest or `spawner extend` may ask for |
| `SPAWNER_ENV_IDLE` | `2h` | Time without activity before an environment sleeps; `never` turns sleeping off |
| `SPAWNER_ENVS_PER_USER` | `5` | Live environments a person may own, sleeping ones included; `0` for no limit |
| `SPAWNER_ENV_MEMORY` | `2g` | Memory of an environment, unless its manifest says otherwise |
| `SPAWNER_ENV_MEMORY_MAX` | `4g` | The most memory an environment gets, whatever its manifest asks |
| `SPAWNER_ENV_CPUS` | `4` | CPUs of an environment, shared by its services as its memory is (1 per service by default) |
| `SPAWNER_ENV_PIDS` | `4096` | Processes of an environment, shared the same way (512 per service by default) |
| `MIN_REQUIRED_FREE_MEMORY_GB` | `2` | Free memory a build waits for, up to two minutes, before it fails (code `capacity`) |
| `MIN_REQUIRED_FREE_DISK_GB` | `10` | Free disk a build waits for, the same way |
| `ENABLE_MEMORY_CHECK` | `true` | `false` turns the memory guard off |

## Updates

| Variable | Default | |
|---|---|---|
| `SPAWNER_UPDATE_CHECK` | `true` | `false`: Spawner no longer looks for new versions every 6 hours (the System page can still check) |
| `SPAWNER_RELEASES_URL` | GitHub's API for `Flosk6/Spawner` | The list of releases; `file://` in tests |

## Development and tests

| Variable | Default | |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Where the dashboard's dev server (`pnpm web:dev`) sends `/api` and the terminal |
| `SPAWNER_ALLOW_LOCAL_REPOS` | `false` | Accept `file://` repositories. Tests only |
| `SPAWNER_HTTP_PORT` | `80` | Port of Traefik on the local stack |
