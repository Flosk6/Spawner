# Density: many environments on one server

Memory is what runs out first: a running environment holds its memory, a stopped one only takes disk. So Spawner puts to sleep what nobody uses, and stores once what environments have in common. This page explains what it does by itself, what your Dockerfiles and compose files can do, and how to measure the result.

For an idea of the figures: [the Laravel, Next.js and MySQL example](../examples/laravel-next-mysql) runs in about 320 MiB of memory, and each of its environments adds about 4 MiB of images of its own; the 830 MiB of base images and dependencies are shared by all of them.

## Memory

### Sleep

An environment without a visit or an action for 2 hours goes to sleep: its containers stop, its volumes and images stay, and the next visit wakes it up within seconds (the browser gets a waiting page that reloads by itself). Visits through the protected URLs, CLI and MCP commands and dashboard actions count as activity; public URLs (`auth: none`) do not, so that a bot cannot keep an environment awake.

Set `idle` in the manifest for a project that needs another delay (`idle: 30m`, at least 10 minutes), or `idle: never` if an admin allows it for the project. Admins change the default for everyone (Settings).

### Databases for previews

A preview database holds test data that a seed recreates. It needs neither replication nor instrumentation, and may lose its last transactions if the server crashes. Defaults made for production waste hundreds of megabytes per environment.

MySQL 8:

```yaml
  db:
    image: mysql:8.4
    command:
      - --skip-log-bin                       # no binary log (kept 30 days by default)
      - --performance-schema=OFF             # hundreds of MiB on its own
      - --innodb-buffer-pool-size=64M
      - --innodb-redo-log-capacity=16M       # instead of 100M
      - --innodb-flush-log-at-trx-commit=2   # a faster seed
```

PostgreSQL:

```yaml
  db:
    image: postgres:18-alpine
    command: ["postgres", "-c", "shared_buffers=32MB", "-c", "max_wal_size=256MB", "-c", "synchronous_commit=off"]
```

`synchronous_commit=off` may lose the last transactions in a crash, without corrupting the database, unlike `fsync=off`, which Spawner does not recommend.

### Limits

Each service gets 512 MiB unless the compose file says otherwise (`mem_limit`, or `deploy.resources.limits.memory`), within the 2 GiB of an environment. Limits do not reserve anything: a service only takes what it uses. They decide what happens when one leaks: an out-of-memory kill of that service, shown on the timeline, rather than the whole server swapping.

The capacity Spawner announces uses what environments of the project really use (the median over the last day), not their limits, so generous limits do not waste room.

### Builds

A build can take far more memory than the running application: `next build` or a webpack build may take a few GiB for a minute. Builds run one at a time below 8 GiB of memory (two above), and each waits until 2 GiB are free before it starts. With less than 8 GiB, the installer offers zram, a compressed swap in memory that gives idle pages somewhere to go.

## Disk

### Layers shared between environments

Docker stores identical image layers once. Two environments of the same project share their base image and, if the Dockerfile installs the dependencies before copying the code, their dependencies too: each only pays for its own code and build output.

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./     # 1. the lock file only
RUN npm ci                                 # 2. the dependencies: the same layer for every environment with this lock file
COPY . .                                   # 3. the code: each environment's own
RUN npm run build
```

Copying the whole code first (`COPY . .` then `npm ci`) gives each environment its own copy of `node_modules`: hundreds of MiB each. Spawner warns about it in the job log and in `spawner up`.

The same goes for other ecosystems:

```dockerfile
# PHP
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader
COPY . .
RUN composer dump-autoload --optimize

# Python
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Ruby
COPY Gemfile Gemfile.lock ./
RUN bundle install
COPY . .
```

A branch that changes its lock file gets its own dependency layer, which other environments of that branch share in turn.

Also:

- a `.dockerignore` that leaves out `node_modules`, `vendor`, `.git` and build outputs: they would change the code layer and slow every build;
- Next.js in `standalone` mode makes smaller images, but copies the dependencies it needs into the build output, so into each environment's own part. With many environments of the same project, a shared `node_modules` layer and `next start` cost less in total, as in the example. The disk view tells which is cheaper for you;
- the same base image tag across the services and projects of the server (`node:22-alpine` everywhere rather than three variants).

### What Spawner does by itself

| | |
|---|---|
| Images stored once | On a Docker it installs, the installer keeps the classic image store (overlay2): Docker 29's default stores each layer twice, compressed and not |
| Replaced images | Removed as soon as an update succeeds |
| Sources | The code of a source is removed once it is built, unless a service mounts files of it; each update brings it back |
| Repository mirrors | Partial (`--filter=blob:none`), branches and tags only, shared by all the environments of a repository |
| Build cache | Kept under 15 % of the disk by Docker's garbage collector |
| Logs | Compressed, 3 files of 10 MB per container at most |
| Leftovers | What deleted environments leave behind is removed within a minute |

### Measuring

- **The Disk tab of an environment** splits its images into its own part and the part it shares, and adds its volumes, the files its containers wrote and its sources. Dependencies in the own part mean a Dockerfile copies the code before installing them.
- **The project page** gives the cost of a typical environment: memory, own disk, build time.
- **The System page** shows the whole disk (images, build cache, volumes, logs) and how many more environments of each project fit. `spawner capacity` says the same from a terminal.
