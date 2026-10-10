# Example: Laravel, Next.js and MySQL

A Laravel API, a Next.js front and a MySQL database, in one repository: what a
team typically previews. The end-to-end test of the installer
(`scripts/e2e-installer.sh`) deploys it from two branches at once.
[The examples page](../../docs/examples.md) describes both examples.

```text
.spawner/spawner.yaml   the project, two URLs (web, api) and the seed
.spawner/compose.yaml   db (MySQL), api (Laravel), web (Next.js)
api/                    Laravel 13: GET and POST /posts, served by php artisan serve
web/                    Next.js 16: one page that lists the posts through the API
```

## Try it

On a Spawner server, an admin creates the project `blog` (Projects, New
project): repository `https://github.com/Flosk6/Spawner.git`, default branch
`master`, directory `examples/laravel-next-mysql`. Then, in a clone of the
repository, from this directory (the CLI sends this directory with your
changes; a copy of it in a repository of its own would need a project whose
directory is `.`):

```bash
spawner up demo --wait        # without a name, the environment is named after the branch
spawner url demo              # https://demo--blog.<domain>; spawner url demo api: https://api--demo--blog.<domain>
spawner exec demo db -- mysql -uapp -papp app -e "insert into posts (title, body) values ('From an agent', 'Added with spawner exec')"
spawner logs demo api --errors
spawner down demo
```

## What it shows

- **Two URLs**: `web` is the entrypoint (`<env>--blog.<domain>`), `api` gets
  `api--<env>--blog.<domain>`. The compose file passes them to the services
  (`${SPAWNER_URL_API}`, `${SPAWNER_URL_WEB}`).
- **Calls between services stay inside the environment**: the front reads the
  posts from `http://api:8000` on the server side, without a token or TLS. The
  public API URL is only a link for the browser.
- **Shared dependencies**: both Dockerfiles copy `composer.lock` and
  `package-lock.json`, install the dependencies, and only then copy the code.
  Environments with the same lock files share the `vendor` and `node_modules`
  layers: on the Disk card of an environment (Overview tab), its own part is a
  few megabytes (the code and the build), the dependencies are in the shared
  part. The front is not built in `standalone` mode, which would copy the
  dependencies into each environment's own part.
- **A database for previews**: MySQL without binary log or performance schema,
  with small buffers: about 220 MiB of memory once seeded, and the whole
  environment about 320 MiB. A preview may lose its last transactions if the
  server crashes; it is seeded again.
- **Errors in the logs**: `LOG_CHANNEL=stderr` sends Laravel's errors to the
  service output, where `spawner logs --errors` finds them. Laravel writes to
  `storage/logs/laravel.log` by default, which Spawner does not read.
- **No APP_KEY**: the API has no sessions and encrypts nothing, so it needs no
  key. An application that does would add `APP_KEY: ${APP_KEY}` to the `api`
  service and set `APP_KEY` as a secret variable of the project (Projects,
  the project, Variables): `php artisan key:generate --show` prints one.
- **Behind Traefik**: both servers listen on `0.0.0.0`, where Traefik reaches
  them, and the API trusts the proxy (`trustProxies(at: '*')`), so the URLs it
  builds keep `https`. Only Traefik and the other services of the environment
  reach it.

## Two repositories instead of one

When the front lives in its own repository, keep `.spawner/` in the API
repository, add the front's repository to the project's source repositories
(Projects, Edit), and declare the front as a source:

```yaml
# .spawner/spawner.yaml of the API repository
name: api
sources:
  front: { repo: git@github.com:acme/blog-front.git, default_ref: main }
```

```yaml
# .spawner/compose.yaml: build: ${SPAWNER_SRC_FRONT} instead of ../web
  web:
    build: ${SPAWNER_SRC_FRONT}
```

`spawner up --source front=../blog-front` sends a worktree of the front too;
otherwise Spawner checks out its default branch, or `--ref front=<branch>`.
