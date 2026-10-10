# Configuring a Spawner server

Every setting of a Spawner server: the environment variables its container reads, their defaults, and which ones the dashboard's Settings page overrides.

[Install](install.md) covers the options of the installer, and [the CLI](cli.md#environment-variables-and-files) the variables of the CLI (`SPAWNER_URL`, `SPAWNER_TOKEN`, `SPAWNER_PROJECT`).

## Where settings go

**From the dashboard**, on the **Settings** page, admins change the lifetimes, the idle time before sleeping, the environments per person, the memory of an environment and its maximum, and the build guards, and configure the GitHub login. What they set there wins over the variables below, which stay the defaults: a field left empty goes back to them, and shows them as its placeholder.

**On a server installed by `install.sh`**, your own settings go to `/opt/spawner/spawner.env`, one `VARIABLE=value` per line, which the installer never overwrites. Apply a change with:

```bash
docker compose --project-directory /opt/spawner --env-file /opt/spawner/.env up -d
```

The installer sets some variables itself, in `/opt/spawner/compose.yaml` and `/opt/spawner/.env`: they win over `spawner.env`. Change them by running the installer again with the matching option (`--domain`, `--dns-provider`, `--memory-limit`...). They are marked "installer" below.

**On the local stack** (`docker-compose.yml`), the root `.env` sets the variables the compose file passes on; add a line to the `spawner` service's `environment` for any other.

**Formats**: durations take a unit (`30m`, `72h`, `14d`); sizes are `512m` or `2g` (a plain number is bytes); counts are whole numbers. A value Spawner cannot read falls back to the default without a warning: `SPAWNER_ENV_TTL=72` or `=3days` gives `72h`, and `MIN_REQUIRED_FREE_MEMORY_GB=1.5` reads `1`. The Settings page shows the limits in force.

## Access

| Variable | Default | Description |
|---|---|---|
| `FRONTEND_URL` | `<scheme>://spawner.<preview domain>` | The dashboard's URL. It must be a host of the preview domain: the dashboard sets the preview cookie on that domain, and Spawner warns at startup when it is not |
| `SPAWNER_SECRET` | generated into `<data dir>/secret.key` | Master secret, from which the keys that sign tokens and sessions and encrypt settings derive (installer) |
| `SESSION_SECRET` | derived from the master secret | Signs the session cookie |
| `SESSION_MAX_AGE` | `86400000` (24 hours) | Dashboard sessions, in milliseconds |
| `SPAWNER_BOOTSTRAP_TOKEN` | none | Bearer token of the installation, with every scope, no user, no quota and no expiry, for scripts of the installation; the installer sets it only when given one. CI gets a personal token restricted to a project instead ([CI](ci.md)) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | none | GitHub login, until it is configured from the Settings page ([operations](operations.md#github-login)) |
| `GITHUB_ORG`, `GITHUB_TEAM` | none | The organization, and the team, whose members may log in with GitHub; they get a member account at their first login |
| `GITHUB_CALLBACK_URL` | `<dashboard>/api/v1/auth/github/callback` | The OAuth callback |

## Application

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port of the API |
| `DATABASE_URL` | none | PostgreSQL connection string (installer) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `localhost`, `5432`, `spawner`, `spawner`, `spawner` | The same database, for the session store (installer) |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | The Docker socket (installer) |
| `WEB_DIST_PATH` | none (`/app/web` in the image) | The built dashboard the API serves |
| `SPAWNER_CLI_PATH` | none (`/app/cli/spawner` in the image) | The CLI bundle served at `/api/v1/cli/spawner`; `apps/cli/dist/spawner.cjs` in development |
| `SPAWNER_VERSION` | the version of `apps/api/package.json` | The version `/api/v1/info` reports, set in the image by the release build |
| `NODE_ENV` | none | `production` on a server (installer); under `test`, the collectors do not start |

## Engine

| Variable | Default | Description |
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
| `SPAWNER_START_TIMEOUT_SECONDS` | `300` | How long the services of an environment may take to run and pass their healthchecks, after a build or a start (`docker compose --wait-timeout`) |
| `SPAWNER_JOB_TIMEOUT_SECONDS` | `1800` | Longest run of one `docker compose` command: a build with its start, a stop, a removal. Git fetches and seed steps have their own limit, 10 minutes each |
| `SPAWNER_UPLOAD_MAX` | `100m` | Largest worktree upload, compressed |
| `SPAWNER_UPLOAD_MAX_FILES` | `50000` | Files in an upload |
| `SPAWNER_UPLOAD_MAX_EXTRACTED` | `1g` | Size of an upload once extracted; the decompressed archive may hold 4 KiB more per file, for the tar headers |

## Lifecycle and limits

The Settings page overrides all of these but `ENABLE_MEMORY_CHECK`, `SPAWNER_ENV_CPUS` and `SPAWNER_ENV_PIDS`.

| Variable | Default | Description |
|---|---|---|
| `SPAWNER_ENV_TTL` | `72h` | Lifetime of an environment, prolonged by each deploy |
| `SPAWNER_ENV_TTL_MAX` | `14d` | The longest lifetime a manifest or `spawner extend` may ask for |
| `SPAWNER_ENV_IDLE` | `2h` | Time without activity before an environment sleeps; `never` (or `0`) turns sleeping off |
| `SPAWNER_ENVS_PER_USER` | `5` | Live environments a person may own, sleeping ones included; `0` for no limit |
| `SPAWNER_ENV_MEMORY` | `2g` | Memory of an environment, for all its services, unless its manifest says otherwise. Until a project's environments have run, Spawner counts this much for each new one when it checks the capacity |
| `SPAWNER_ENV_MEMORY_MAX` | `4g` | The most memory an environment gets, whatever its manifest asks |
| `SPAWNER_ENV_CPUS` | `4` | CPUs of an environment, shared by its services as its memory is (1 per service by default) |
| `SPAWNER_ENV_PIDS` | `4096` | Processes of an environment, shared the same way (512 per service by default) |
| `MIN_REQUIRED_FREE_MEMORY_GB` | `2` | Memory available a build waits for, up to two minutes, before it fails (code `capacity`); whole GiB, `0` turns the guard off |
| `MIN_REQUIRED_FREE_DISK_GB` | `10` | Free disk a build waits for, the same way |
| `ENABLE_MEMORY_CHECK` | `true` | `false` turns the memory guard of builds off; the capacity check of new environments stays |

On a server with less than 4 GiB of memory, lower `SPAWNER_ENV_MEMORY` and `MIN_REQUIRED_FREE_MEMORY_GB` (or their fields in Settings), or no environment fits ([install](install.md#before-you-start)).

## Updates of Spawner

| Variable | Default | Description |
|---|---|---|
| `SPAWNER_UPDATE_CHECK` | `true` | `false`: Spawner no longer looks for new versions every 6 hours (the System page can still check) |
| `SPAWNER_RELEASES_URL` | GitHub's API for `Flosk6/Spawner` | The list of releases; `file://` in tests |

## Development and tests

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Where the dashboard's dev server (`pnpm web:dev`) sends `/api` and the terminal |
| `SPAWNER_ALLOW_LOCAL_REPOS` | `false` | Accept `file://` repositories. Tests only |
| `SPAWNER_HTTP_PORT` | `80` | Port of Traefik on the local stack |
