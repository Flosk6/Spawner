# .spawner/: the manifest and the compose file

A project tells Spawner how to run it with two files in a `.spawner/` directory of its repository (`spawner init` creates them):

- `spawner.yaml`, the manifest: the project, the URLs, the seed, the other repositories;
- a Docker Compose file, `compose.yaml` by default: the services, as for `docker compose`, with a few rules.

In a monorepo, `.spawner/` sits in the directory of the application; an admin sets that directory (the project's root directory) when registering the project.

## spawner.yaml

```yaml
version: 1
project: blog                 # slug of the project on Spawner
name: api                     # name of this repository's source (default: app)
compose: compose.yaml         # relative to .spawner/ (default)

sources:                      # other repositories (optional)
  front:
    repo: git@github.com:acme/blog-front.git
    default_ref: develop      # default: main

exposures:                    # the URLs; the first one is the entrypoint unless one says entrypoint: true
  - name: web
    service: front
    port: 3000
    entrypoint: true
  - name: api
    service: api
    port: 8000
    auth: team                # team (default): teammates and agents with a token; none: public, if the project allows it

seed:                         # run once, after the first start (and with --reseed or --fresh)
  - service: api
    run: [php, artisan, migrate, --seed, --force]

ttl: 72h                      # lifetime, prolonged by each deploy (at most the server's maximum)
idle: 2h                      # sleep after this long without activity (at least 10m; default: the server's)
upload:
  include: [.env.preview]     # ignored files the CLI sends anyway (globs)
limits:
  memory: 2g                  # memory of the whole environment, within the server's maximum
```

- Names (`project`, `name`, sources, exposures) use lowercase letters, digits and single dashes, starting with a letter: at most 20 characters for a project, 10 for an exposure. Environments, named after branches, take 29.
- `seed` steps are argument arrays, run in the service without a shell (call `[sh, -c, "..."]` if you need one).
- `auth: none` makes a URL public (webhooks, a public page). An admin allows it per project (Projects, Edit, "Allow public URLs"); otherwise the deploy is refused, by `spawner up` before anything is sent.
- At most 10 exposures.
- `idle`: an environment without visits or actions for this long goes to sleep. Its containers stop, its data stays, and the next visit to one of its URLs wakes it up within seconds. `idle: never` keeps it awake; an admin allows it per project (Projects, Edit, "Allow environments that never sleep").

### URLs

The entrypoint is served on `<env>--<project>.<preview domain>`, the other exposures on `<exposure>--<env>--<project>.<preview domain>`: `feat-login--blog.preview.example.com`, `api--feat-login--blog.preview.example.com`.

## The compose file

A regular Compose file, which Spawner reads, checks and rewrites before running it with `docker compose`. Example for Laravel, Next.js and MySQL:

```yaml
services:
  db:
    image: mysql:8.4
    command:                  # preview profile: no binary log, small buffers
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
      interval: 5s
      retries: 30

  api:
    build:
      context: ${SPAWNER_SRC_API}
      dockerfile: .spawner/Dockerfile
    environment:
      APP_URL: ${SPAWNER_URL_API}
      FRONTEND_URL: ${SPAWNER_URL_WEB}
      LOG_CHANNEL: stderr     # errors in spawner logs
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

### Variables

The file is interpolated with Spawner's variables only; any other `${...}` is an error, so the server's environment never leaks into an environment.

| Variable | Example |
|---|---|
| `SPAWNER_PROJECT`, `SPAWNER_ENV` | `blog`, `feat-login` |
| `SPAWNER_URL` | URL of the entrypoint |
| `SPAWNER_URL_<EXPOSURE>` | `SPAWNER_URL_API=https://api--feat-login--blog.preview.example.com` |
| `SPAWNER_HOST_<EXPOSURE>` | the same host, without the scheme |
| `SPAWNER_SRC_<SOURCE>` | path of a source on the server, for build contexts and mounts |
| Project variables | set by an admin on the project page: `${STRIPE_KEY}`. Secret values are stored encrypted, never shown again, and masked in job logs |

`<EXPOSURE>` and `<SOURCE>` are uppercased, with `-` turned into `_`. Services reach each other on the environment's network by service name (`http://api:8000`), without authentication.

### Rules

Allowed: `image`, `build` (context and Dockerfile inside a source, `args`, `target`), `command`, `entrypoint`, `environment`, `env_file` (inside a source), `depends_on`, `healthcheck`, `working_dir`, `user`, `expose`, `volumes` (named volumes, tmpfs, and files mounted from a source), `tmpfs`, `read_only`, `init`, `labels`, `hostname`, `extra_hosts`, `platform`, `pull_policy`, `tty`, `stdin_open`, `stop_signal`, `stop_grace_period`, `cap_drop`, `shm_size` (1 GiB at most), `mem_limit`, `cpus`, `deploy.resources.limits`, networks declared in the file, `x-*` extensions.

Refused: `ports` (declare an exposure instead), host mounts outside the sources, `privileged`, `cap_add`, `devices`, `network_mode`, `pid`, `ipc`, host namespaces, `security_opt`, `sysctls`, `container_name`, external volumes and networks, `enable_ipv6: true` (environment networks are IPv4 only), `include`, `secrets`, `configs`, labels starting with `traefik.`, `com.docker.` or `dev.spawner.`.

Service names, network `aliases` and `hostname` become DNS names on the environment's network: lowercase letters, digits, `-` and `_`, without dots and not ending with `-`, 63 characters at most (`domainname` may hold a domain). Names starting with `spawner` or `spn-` are reserved for Spawner.

Spawner sets on every service: a memory limit (512 MiB unless given, within the environment's total), CPU and process limits, `no-new-privileges`, `restart: unless-stopped` and capped local logs.

A refused file is reported with the path of the key and a hint, for example `services.api.ports: forbidden (declare an exposure in spawner.yaml)`. `spawner up` checks it before uploading anything (exit code 7).

## Dockerfiles that share their layers

Docker stores identical layers once. An environment then only costs its own layers, provided the Dockerfile installs the dependencies before copying the code:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["npm", "start"]
```

Twenty environments of the same branch base then share one `node_modules` layer. Spawner warns, in the job log and in `spawner up`, about a Dockerfile that copies the whole code before installing its dependencies.

The code of a source is only needed to build: once an environment is built, Spawner removes it, unless a service mounts files of it or an `env_file` lives in it. Every update checks out or receives the code again.

## Logs

Spawner sees what services write to stdout and stderr. Laravel writes to `storage/logs/laravel.log` by default: set `LOG_CHANNEL: stderr`. Next.js and the official nginx images already write to the standard output.
