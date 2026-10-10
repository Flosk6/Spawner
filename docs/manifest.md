# The .spawner/ directory: spawner.yaml and the compose file

A project tells Spawner how to run it with two files in a `.spawner/` directory of its repository (`spawner init` creates them):

- `spawner.yaml`, the manifest: the project, its URLs, its seed, its other repositories;
- a Docker Compose file, `compose.yaml` by default: the services, as for `docker compose`, with a few rules.

In a monorepo, `.spawner/` sits in the directory of the application, and an admin gives that directory (**Directory**) when registering the project in the dashboard. [The quickstart](quickstart.md) goes from a new server to a first environment.

## spawner.yaml

```yaml
version: 1
project: blog          # slug of the project on Spawner
name: api              # this repository's source
compose: compose.yaml  # relative to .spawner/

sources:               # other repositories
  front:
    repo: git@github.com:acme/blog-front.git
    default_ref: develop

exposures:             # the URLs; the first one is
  - name: web          # the entrypoint
    service: front
    port: 3000
  - name: api
    service: api
    port: 8000

seed:                  # test data, after the first start
  - service: api
    run: [php, artisan, migrate, --seed, --force]

ttl: 72h               # lifetime from the last deploy
idle: 2h               # sleep after this long unused
upload:
  include: [.env.preview]  # ignored files to send too
limits:
  memory: 2g           # for the whole environment
```

`version`, `project` and `exposures` are required; every other key has a default. A key the manifest does not know is refused (`spawner.yaml: Unrecognized key: "env"`). `spawner up` checks the file before sending anything, and the server checks it again at each deploy; the refusals quoted below are the lines `spawner up` prints ([when .spawner/ is refused](#when-spawner-is-refused)).

### version

Required: `1`, the only version. `version: 2` gives `spawner.yaml: version: Invalid input: expected 1`.

### project

Required: the slug of the project, as an admin registered it in the dashboard (**Projects**, **New project**, **Slug**). Lowercase letters, digits and single dashes, starting with a letter, 20 characters at most; it is part of every URL.

`spawner up` finds the project by this slug: until an admin registers it, it stops with `project "blog" is not registered on https://spawner.preview.example.com`.

### name

Optional, `app` by default: the name of this repository's own source, the one holding `.spawner/`. It gives the variable `SPAWNER_SRC_<NAME>` (`SPAWNER_SRC_APP` by default) and the `--ref <name>=<branch>` of `spawner up`. Same rules as a project slug, and different from the names under `sources`.

### compose

Optional, `compose.yaml` by default: the path of the compose file, relative to `.spawner/`, inside the project's directory. `../docker-compose.yml` uses a file at the root of the project, provided it follows the [rules](#rules). An absolute path is refused: `spawner.yaml: compose: compose must be a path relative to .spawner/`.

### sources

Optional: the other repositories of the application, when it spreads over several. Each key is a source name (same rules as a project slug, 20 characters at most), with:

- `repo` (required): the repository, over SSH (`git@github.com:acme/blog-front.git`) or HTTPS (`https://github.com/acme/blog-front.git`, public repositories only). A private repository needs a deploy key: an admin generates one per repository on the **Git keys** page, then adds its public key to the repository, read-only.
- `default_ref` (optional, `main` by default): the branch, tag or commit deployed when `spawner up` asks for nothing else. `--ref front=<branch>` takes another one from git, `--source front=<directory>` sends a local worktree.

Each `repo` must be one of the project's source repositories, which an admin lists in the project's settings (**Source repositories**), written the same way; otherwise the deploy is refused, by `spawner up` before anything is sent: `spawner.yaml: sources.front.repo: source "front" comes from git@github.com:acme/blog-front.git, which is not among the source repositories of this project`. A branch thus never makes Spawner clone a repository the project does not use, with its deploy keys.

Each source is checked out next to the others; `SPAWNER_SRC_<SOURCE>` gives its path, for build contexts and mounts. A name that breaks the rules gives `spawner.yaml: sources.<name>: Invalid key in record`.

### exposures

Required, from 1 to 10: the URLs of the environment, each routed to a port of a service.

- `name` (required): lowercase letters, digits and single dashes, starting with a letter, 10 characters at most, unique. It names the URL and the variables `SPAWNER_URL_<NAME>` and `SPAWNER_HOST_<NAME>`.
- `service` (required): a service of the compose file, attached to its `default` network.
- `port` (required): the port the service listens on inside the environment, from 1 to 65535. Nothing is published on the server.
- `entrypoint` (optional): `true` for the exposure served without a prefix (see [URLs](#urls)). At most one says so; without one, the first exposure is the entrypoint.
- `auth` (optional): `team` (default) protects the URL ([protected previews](concepts.md#protected-previews)); `none` makes it public, for a webhook or a public page. An admin allows public URLs per project (**Allow public URLs**, in the project's settings); otherwise the deploy is refused, by `spawner up` before anything is sent: `spawner.yaml: exposures[0].auth: exposure "hooks" is public (auth: none), which this project does not allow`. A public URL does not wake a sleeping environment: see [idle](#idle).

Without exposures: `spawner.yaml: exposures: Invalid input: expected array, received undefined`.

### seed

Optional: the steps that fill a new environment with test data (migrations, fixtures). They run in order once its services are up: on the first deploy, then again with `spawner up --reseed` or `--fresh` (in the dashboard, **Redeploy and replay the seed** or **Redeploy from scratch**). Each step has:

- `service` (required): a service of the compose file. It must be running: in a service that has exited, the deploy fails with `service "api" is not running`.
- `run` (required): the command, as an argument array, run in the service without a shell. Call one when you need it: `[sh, -c, "npm run seed && npm run fixtures"]`. A string is refused: `spawner.yaml: seed[0].run: Invalid input: expected array, received string`.

Each step has 10 minutes; its output goes to the job log. A step that exits with another code than 0 fails the deploy, at the seeding phase. `--reseed` runs the steps on the data already there: write steps that can run twice, or use `--fresh`, which deletes the data first.

### ttl

Optional: how long the environment lives after its last deploy, as a duration such as `24h`, `1h30m` or `14d` (units `s`, `m`, `h`, `d`). Without it, the server's lifetime applies (72 hours by default). The server's longest lifetime (14 days by default) caps it without a message. Each deploy starts the count again, without shortening an extension; `spawner up --ttl` and `spawner extend` override it. An expired environment is deleted with its data.

A number is refused: `spawner.yaml: ttl: Invalid input: expected string, received number`.

### idle

Optional: how long the environment may go without activity before it goes to sleep. Without it, the server's setting applies (2 hours by default). A duration of at least `10m`, or `never`.

Requests to its team URLs, deploys, commands, logs and terminals count as activity. A sleeping environment's containers stop and its data stays; the next visit to one of its team URLs wakes it up within seconds. **Public URLs (`auth: none`) neither keep it awake nor wake it up**: while it sleeps, they answer 503 (`environment_asleep` to an API client, a waiting page to a browser). For a webhook, use `idle: never`, or `spawner wake` before testing.

`idle: never` keeps the environment awake, and its memory taken. An admin allows it per project (**Allow environments that never sleep**); otherwise: `spawner.yaml: idle: idle: never keeps the environment awake, which this project does not allow`. Below 10 minutes: `spawner.yaml: idle: idle must be at least 10m (or never)`.

### upload

Optional. `include` lists files that git ignores but `spawner up` sends anyway, as globs relative to the project's directory: `.env.preview`, `config/*.local.php`, `**/*.pem`. Without it, `spawner up` sends what git sees in the worktree, uncommitted changes included, and leaves out untracked `node_modules/`, `vendor/` and `.env` files ([what is sent](cli.md#up)).

### limits

Optional. `memory` is the memory of the whole environment, which its services share ([memory limits](#memory-limits)): a size such as `512m`, `1.5g` or `2g` (1g = 1024 MiB). Without it, the server's setting applies (2 GiB by default). The server's maximum (4 GiB by default) caps it without a message; admins change both on the **Settings** page. `limits` takes no other key: `spawner.yaml: limits: Unrecognized key: "cpus"`.

### URLs

The entrypoint is served on `<env>--<project>.<preview domain>`, the other exposures on `<exposure>--<env>--<project>.<preview domain>`: `feat-login--blog.preview.example.com`, `api--feat-login--blog.preview.example.com`. The environment's name comes from the branch (29 characters at most), so that the longest name still fits in one DNS label, under one wildcard certificate.

## The compose file

A regular Docker Compose file, which Spawner reads, checks and rewrites before running it with `docker compose`. Example for Laravel, Next.js and MySQL, with the front in its own repository (the `front` source above):

```yaml
services:
  db:
    image: mysql:8.4
    command:                # a database for previews
      - --skip-log-bin
      - --performance-schema=OFF
      - --innodb-buffer-pool-size=64M
      - --innodb-redo-log-capacity=16M
      - --innodb-flush-log-at-trx-commit=2
    environment:
      MYSQL_DATABASE: app
      MYSQL_USER: app
      MYSQL_PASSWORD: app
      MYSQL_ROOT_PASSWORD: root
    volumes:
      - db-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-proot"]
      interval: 3s
      retries: 60

  api:
    build:
      context: ${SPAWNER_SRC_API}
      dockerfile: .spawner/Dockerfile
    environment:
      APP_URL: ${SPAWNER_URL_API}
      FRONTEND_URL: ${SPAWNER_URL_WEB}
      LOG_CHANNEL: stderr   # errors in spawner logs
      DB_HOST: db
      DB_DATABASE: app
      DB_USERNAME: app
      DB_PASSWORD: app
    depends_on:
      db: { condition: service_healthy }

  front:
    build:
      context: ${SPAWNER_SRC_FRONT}
      args:
        NEXT_PUBLIC_API_URL: ${SPAWNER_URL_API}

volumes:
  db-data:
```

### Paths

- Relative paths start from the directory of the compose file, `.spawner/` by default. `build: ..` builds the project's directory, the same as `${SPAWNER_SRC_APP}`; `build: .` would build `.spawner/` itself.
- Build contexts, Dockerfiles, `env_file` and mounted files stay inside the sources: the project's directory, and the repositories under `sources`. In a monorepo, the project's directory is the one an admin gave (**Directory**), so no path reaches the rest of the repository: `services.web.build.context: build context "../../.." resolves outside the environment sources`. When a Dockerfile needs the root of the repository (a pnpm, Yarn or Turborepo workspace with one lock file), put `.spawner/` at the root and give the project the directory `.`.
- A file the compose file uses must reach the server: committed, or named in `upload.include`. `spawner up` checks the paths in your worktree, so an untracked `.env` passes there and fails on the server (`compose.path_not_found`). An `env_file` entry may say `required: false`.

### Variables

The file is filled in with Spawner's variables and the project's variables only, never with the server's environment, which holds Spawner's secrets.

| Variable | Value |
|---|---|
| `SPAWNER_PROJECT`, `SPAWNER_ENV` | `blog`, `feat-login` |
| `SPAWNER_URL` | URL of the entrypoint |
| `SPAWNER_URL_<EXPOSURE>` | `SPAWNER_URL_API=https://api--feat-login--blog.preview.example.com` |
| `SPAWNER_HOST_<EXPOSURE>` | the same host, without the scheme |
| `SPAWNER_SRC_<SOURCE>` | path of a source on the server, for build contexts and mounts; `SPAWNER_SRC_APP` (after `name`) is the project's directory |
| Project variables | set by an admin on the project page (**Variables**): `${STRIPE_KEY}` |

`<EXPOSURE>` and `<SOURCE>` are uppercased, with `-` turned into `_`. Services reach each other on the environment's network by service name (`http://api:8000`), without authentication.

The syntax is Compose's:

| Written | Gives |
|---|---|
| `${VAR}`, `$VAR` | The value; an error when the variable does not exist |
| `${VAR:-default}`, `${VAR-default}` | `default` when `VAR` is unset or empty; without `:`, only when it is unset |
| `${VAR:?message}`, `${VAR?message}` | An error saying `message` when `VAR` is unset or empty; without `:`, only when it is unset |
| `${VAR:+other}`, `${VAR+other}` | `other` when `VAR` is set and not empty; without `:`, whenever it is set |
| `$$` | A literal `$` |

Every string of the file is filled in, commands and healthchecks included, so a variable of the container's shell needs `$$`:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"]
```

With a single `$`, the file is refused: `services.db.healthcheck.test[1]: unknown variable POSTGRES_USER (only SPAWNER_* and project variables exist; write ${POSTGRES_USER:-value} for an optional one)`.

**Project variables** fill in the file like Spawner's: a service gets one only if the file passes it, under `environment:` (`STRIPE_KEY: ${STRIPE_KEY}`). Their names use uppercase letters, digits and `_`, not starting with `SPAWNER_`. A change applies at the next deploy. Secret values are stored encrypted, never shown again, and masked in job logs.

### Rules

Spawner runs compose files from branches nobody has reviewed, so it accepts only what cannot reach the host. [Security](security.md#the-compose-policy) lists every key allowed, refused or set, and the limits; what you will meet most:

- no `ports`: declare an exposure in `spawner.yaml`, and Traefik routes it;
- volumes are named volumes, `tmpfs`, or files mounted from a source, never host paths;
- `build` contexts, Dockerfiles and `env_file` stay inside a source ([paths](#paths));
- no `privileged`, `cap_add`, `devices`, `network_mode`, `pid`, `ipc`, `security_opt`, `sysctls`, `ulimits` or `container_name`, no external volumes or networks, no `enable_ipv6: true`;
- under `deploy`, only `resources` and `replicas: 1`;
- no labels starting with `traefik.`, `com.docker.` or `dev.spawner.`;
- at most 30 services, and per service 2 CPUs, 2048 processes, 1 GiB of `shm_size` and 60 seconds of `stop_grace_period`.

Service names, network `aliases` and `hostname` become DNS names on the environment's network: lowercase letters, digits, `-` and `_`, without dots and not ending with `-`, 63 characters at most (`domainname` may hold a domain). Names starting with `spawner` or `spn-` are reserved for Spawner.

Spawner sets on every service: its memory, CPU and process limits ([memory limits](#memory-limits)), `no-new-privileges`, no raw sockets (`NET_RAW` dropped), `restart: unless-stopped` and capped local logs. The file's own `restart` and `logging` are replaced.

### When .spawner/ is refused

`spawner up` checks `spawner.yaml` and the compose file before sending anything, with the same code and the same limits as the server, and lists every issue:

```text
$ spawner up
error: refused before upload:
  services.api.ports: ports is not allowed (host ports are never published; declare an exposure in spawner.yaml)
  services.api.volumes[0]: bind mount source "/var/run/docker.sock" resolves outside the environment sources (paths must stay inside the repositories declared in spawner.yaml)
fix these in .spawner/, then run spawner up again
```

Each line gives the path of the key, the problem and, in parentheses, what to do; the exit code is 7. The check stops at the first stage that fails, in this order: `spawner.yaml`, the variables, then the policy. Once a stage passes, the next run lists the issues of the next one. With `--json`, each issue also carries one of the codes below ([JSON output](cli.md#json-output)). The server checks again at each deploy, environments from git included: a refused file fails the job at the validating phase, with the same lines in its log, and goes to the audit trail.

| Code | What it means |
|---|---|
| `yaml.invalid` | The file is not valid YAML, or gives a key twice |
| `yaml.too_large` | `spawner.yaml` is above 64 KiB, or the compose file above 1 MiB |
| `manifest.invalid` | A key of `spawner.yaml` is missing, unknown or wrong ([the keys](#spawneryaml)) |
| `manifest.public_exposure` | `auth: none`, in a project that does not allow public URLs |
| `manifest.always_on` | `idle: never`, in a project that does not allow environments that never sleep |
| `slug.invalid` | A project, environment or source name breaks the naming rules |
| `variables.invalid` | A project variable has a name that cannot be used: an admin renames it |
| `interpolation.invalid` | A `$` that starts no variable, or a `${` never closed: write `$$` for a literal `$` |
| `interpolation.unknown_variable` | A variable that neither Spawner nor the project sets: `$$` for a shell variable, a default (`${VAR:-value}`), or a project variable |
| `interpolation.required_variable` | `${VAR:?message}` while `VAR` is not set |
| `compose.invalid` | A value of the wrong shape: a name that is not a DNS label, a service without `image` or `build`, a size or a duration that cannot be read |
| `compose.forbidden_key` | A key the policy refuses, such as `ports` or `privileged`: the hint says what to do instead |
| `compose.unknown_key` | A key the policy does not know, often a typo: the hint gives the closest one |
| `compose.path_outside_sources` | A path that leaves the sources: a host path, `~`, `..` past the project's directory, a symbolic link pointing out |
| `compose.path_not_found` | A path inside the sources that does not exist: on the server, a file neither committed nor sent |
| `compose.undefined_reference` | A volume, network or service used but not declared, including the service of an exposure or of a seed step |
| `compose.limit_exceeded` | Above a limit: memory, CPUs, processes, services, `shm_size`, `stop_grace_period`, replicas |
| `compose.not_exposable` | An exposed service that is not on the `default` network: add `default` to its networks |

## Your application behind Spawner

What an application needs to run in an environment, besides its compose file:

- **Listen on every interface** (`0.0.0.0`), on the exposure's port, in plain HTTP. Traefik reaches the service by its name on the environment's network and handles TLS itself. A server bound to `localhost` or `127.0.0.1` in its container cannot be reached, and its URL answers 502 Bad Gateway. Development servers often bind to localhost by default: `next start --hostname 0.0.0.0`, `php artisan serve --host=0.0.0.0`, `vite --host 0.0.0.0`.
- **Trust the proxy.** Requests reach the application over HTTP from Traefik, with `X-Forwarded-Proto: https` and the original `Host`. An application that builds absolute URLs or sets secure cookies must trust these headers, or it writes `http://` links: `$middleware->trustProxies(at: '*')` in Laravel, `app.set('trust proxy', true)` in Express. Only Traefik and the environment's own services reach it.
- **Take its URLs from Spawner**: `${SPAWNER_URL}` and `${SPAWNER_URL_<EXPOSURE>}` under `environment:`, never a host written in the code or in a `.env` file. Between services, use the service name (`http://api:8000`): no token, no TLS, no round trip through Traefik.
- **Values read at build time** (Next.js's `NEXT_PUBLIC_*`, Vite's `import.meta.env`) go in `build.args`, since each environment builds its own image. Declare the `ARG` after installing the dependencies, so that the dependency layer stays shared ([below](#dockerfiles-that-share-their-layers)).
- **Accept the preview hosts.** A server that checks the `Host` header refuses names it does not know: list the preview domain, such as `server.allowedHosts: ['.preview.example.com']` for Vite's development server, or `ALLOWED_HOSTS` for Django.
- **Calls from the browser to another exposure** cross origins: the API must allow the front's origin (CORS) with credentials, and a protected URL needs the team's cookie (`credentials: 'include'` in `fetch`). Calling the API from the server side, as [the Laravel example](../examples/laravel-next-mysql/) does, needs neither.

### Healthchecks

A deploy runs `docker compose up --wait`: Spawner waits until every service runs, and every service with a healthcheck reports healthy, for 5 minutes at most (`SPAWNER_START_TIMEOUT_SECONDS`, [configuration](configuration.md)). Past that, the deploy fails at the building phase. A service without a healthcheck counts as started as soon as its container runs, so its environment can be ready a few seconds before the application answers.

`depends_on` with `condition: service_healthy` starts a service once the one it needs is healthy, such as an API once its database accepts connections. Docker runs the first check after `interval`, 30 seconds unless the file says otherwise: give a short one (`interval: 2s`), or `start_period` with a short `start_interval` (Docker Engine 25 or later) to check often only while the service starts.

### Logs

Spawner sees what services write to stdout and stderr. Laravel writes to `storage/logs/laravel.log` by default: set `LOG_CHANNEL: stderr`. Next.js and the official nginx images already write to the standard output.

## Making environments cheap

Memory is what runs out first: a running environment holds its memory, a sleeping one only takes disk. Spawner puts to sleep what nobody uses; the project decides how much each environment costs. For example, [the Laravel, Next.js and MySQL example](../examples/laravel-next-mysql/) runs in about 320 MiB of memory, and each of its environments adds about 4 MiB of images of its own: its 830 MiB of base images and dependencies are shared by all its environments.

### Dockerfiles that share their layers

Docker stores identical layers once. An environment then only costs its own layers, provided the Dockerfile installs the dependencies before copying the code:

```dockerfile
FROM node:22-alpine
WORKDIR /app
# The lock file only: the same layer for every
# environment with this lock file
COPY package.json package-lock.json ./
RUN npm ci
# Then each environment's own code
COPY . .
RUN npm run build
```

A comment goes on its own line: Docker reads a `#` after an instruction as one more argument.

The same goes for `composer.json` and `composer.lock` before `composer install`, `requirements.txt` before `pip install`, `Gemfile` and `Gemfile.lock` before `bundle install`. Copying the whole code first gives each environment its own copy of its dependencies, hundreds of MiB each: Spawner warns about it in the job log, and `spawner up` prints the warning too (not with `--json` or `-q`).

Also:

- a `.dockerignore` that leaves out `node_modules`, `vendor`, `.git` and build outputs;
- the same base image tag across the services and projects of the server (`node:22-alpine` everywhere rather than three variants);
- Next.js in `standalone` mode copies the dependencies it needs into the build output, so into each environment's own part: with many environments of a project, a shared `node_modules` layer and `next start` cost less in total, as in the example.

The **Disk** card of an environment (on its **Overview** tab) shows its own part and the part it shares. The code of a source is only needed to build: once an environment is built, Spawner removes it, unless a service mounts files of it or an `env_file` lives in it.

### Databases for previews

A preview database holds test data that the seed recreates. It needs neither replication nor instrumentation, and production defaults waste hundreds of MiB per environment.

MySQL:

```yaml
  db:
    image: mysql:8.4
    command:
      - --skip-log-bin                      # no binary log
      - --performance-schema=OFF            # hundreds of MiB
      - --innodb-buffer-pool-size=64M
      - --innodb-redo-log-capacity=16M
      - --innodb-flush-log-at-trx-commit=2  # faster seed
```

PostgreSQL:

```yaml
  db:
    image: postgres:18-alpine
    command:
      - postgres
      - -c
      - shared_buffers=32MB
      - -c
      - max_wal_size=256MB
      - -c
      - synchronous_commit=off
```

`synchronous_commit=off` may lose the last transactions in a crash, without corrupting the database, unlike `fsync=off`.

### Memory limits

The memory of an environment (`limits.memory`, 2 GiB by default) is shared by its services:

- a service with `mem_limit`, or `deploy.resources.limits.memory`, keeps it. Together, these limits must fit in the environment's memory, or the file is refused (`services ask for 2524 MiB of memory, the environment limit is 2 GiB`);
- the other services share what is left equally, 512 MiB each at most. In 2 GiB, four services without a limit get 512 MiB each, and six get about 340 MiB each; a database given `1536m` leaves about 170 MiB to each of three others. When what is left comes to less than 32 MiB each, the file is refused.

CPUs and processes are shared the same way, within 4 CPUs and 4096 processes per environment (the server's `SPAWNER_ENV_CPUS` and `SPAWNER_ENV_PIDS`): a service keeps its `cpus` or `pids_limit` (or `deploy.resources.limits`), and the others share what is left, 1 CPU and 512 processes each at most. More than the environment has is refused (`services ask for 6 CPUs, the environment limit is 4`), and so is a share below 0.05 CPU or 64 processes.

A limit reserves nothing: it decides what happens when a service leaks, an out-of-memory kill of that service on the timeline rather than the server swapping. The capacity Spawner announces counts what environments of the project really use, or the environment's `limits.memory` until one has run, so generous limits on services do not lower it.

A build can take far more memory than the running application (`next build` may take a few GiB for a minute): builds run one at a time below 8 GiB of memory, and each waits until 2 GiB are free.
