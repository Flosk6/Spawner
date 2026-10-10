# Examples

Two projects ready to deploy sit in the [`examples/`](../examples/) directory of the repository: Node.js with PostgreSQL, and Laravel, Next.js and MySQL. Each holds its application and its `.spawner/` directory, and runs as it is on a Spawner server. The tests check both against the [compose policy](security.md#the-compose-policy), and the end-to-end test of the installer deploys both on every pull request of Spawner.

## Node.js and PostgreSQL

[`examples/node-postgres`](../examples/node-postgres/) is the smallest useful project: one service of its own, one database, one URL.

- **`app`**: a Node.js 22 HTTP server (`server.js`, with the `pg` client). Its page gives the environment's name, its URL and the number of users; `/users` lists them as JSON; `/health` answers once the database does.
- **`db`**: PostgreSQL 18, with the settings of [databases for previews](manifest.md#databases-for-previews).

What it shows:

- **One exposure**, `web` on port 3000, which is the entrypoint. The compose file passes `${SPAWNER_URL}` and `${SPAWNER_ENV}` to the app.
- **A seed**: `node seed.js` runs in `app` on the first deploy, creates the `users` table and adds one user.
- **Healthchecks** on both services, every 2 seconds: the app starts once the database accepts connections (`condition: service_healthy`), and the environment is ready once the app answers on `/health`.
- **A Dockerfile that shares its layers**: it installs the dependencies before copying the code.
- **A shorter lifetime**: `ttl: 24h`.

```yaml
# examples/node-postgres/.spawner/spawner.yaml
version: 1
project: example
exposures:
  - name: web
    service: app
    port: 3000
seed:
  - service: app
    run: [node, seed.js]
ttl: 24h
```

## Laravel, Next.js and MySQL

[`examples/laravel-next-mysql`](../examples/laravel-next-mysql/) is what a team typically previews: a front, an API and a database, in one repository.

- **`web`**: Next.js 16, one page that lists the posts, read from the API on the server side.
- **`api`**: Laravel 13 on PHP 8.4, `GET` and `POST /posts`, served by `php artisan serve`.
- **`db`**: MySQL 8.4, with the settings of [databases for previews](manifest.md#databases-for-previews).

What it shows:

- **Two exposures**: `web` is the entrypoint (`<env>--blog.<preview domain>`), `api` gets `api--<env>--blog.<preview domain>`. The compose file passes them to the services as `${SPAWNER_URL_WEB}` and `${SPAWNER_URL_API}`.
- **Calls between services inside the environment**: the front reads the posts from `http://api:8000`, without a token or TLS; the public API URL is only a link for the browser.
- **A seed**: `php artisan migrate --seed --force` runs in `api` on the first deploy, creates the table and adds two posts.
- **Healthchecks in a chain**: `db` answers `mysqladmin ping`, then `api` starts and answers on Laravel's `/up`, then `web` starts.
- **Shared layers**: both Dockerfiles install the dependencies (`composer.lock`, `package-lock.json`) before copying the code, so environments with the same lock files share the `vendor` and `node_modules` layers.
- **An application behind the proxy**: both servers listen on `0.0.0.0`, the API trusts the proxy so that the URLs it builds keep `https`, and Laravel logs to stderr (`LOG_CHANNEL: stderr`), where `spawner logs --errors` finds its errors. See [your application behind Spawner](manifest.md#your-application-behind-spawner).

Once seeded, an environment of this example runs in about 320 MiB of memory. Each new environment adds about 4 MiB of images of its own: the 830 MiB of base images and dependencies are shared by all of them ([making environments cheap](manifest.md#making-environments-cheap)).

Its [README](../examples/laravel-next-mysql/README.md) says more, and how to split it over two repositories with a source.

## Trying one

On a Spawner server ([the quickstart](quickstart.md) sets one up), an admin registers the example as a project: **Projects**, **New project**, with any name and these fields.

| Field | Node.js and PostgreSQL | Laravel, Next.js and MySQL |
|---|---|---|
| Slug | `example` | `blog` |
| Repository | `https://github.com/Flosk6/Spawner.git` | `https://github.com/Flosk6/Spawner.git` |
| Default branch | `master` | `master` |
| Directory | `examples/node-postgres` | `examples/laravel-next-mysql` |

The slug is the `project` of the example's `spawner.yaml`. The repository is public, so it needs no deploy key.

Then, with the CLI logged in to the server, from the example's directory in a clone of the repository:

```bash
git clone https://github.com/Flosk6/Spawner.git
cd Spawner/examples/node-postgres
spawner up demo --wait        # without a name: the branch, master
spawner url demo              # https://demo--example.<preview domain>
spawner exec demo db -- psql -U app -d app -c "select * from users"
spawner down demo
```

`spawner up` sends the example's directory from your clone, with your changes: edit `server.js`, run it again, and the environment shows the change. The page of the environment says `Hello from Spawner (demo) at https://demo--example.<preview domain>: 1 user(s)`.

For the Laravel example, from `Spawner/examples/laravel-next-mysql`, the database is MySQL: `spawner exec demo db -- mysql -uapp -papp app -e "select title from posts"`.

Without the CLI, an environment of the example also comes from git: **New environment** in the dashboard, the project, the branch `master`.
