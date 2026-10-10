# Example: Node.js and PostgreSQL

The smallest useful Spawner project: an HTTP app, a PostgreSQL database seeded
on the first deploy, one URL. The end-to-end tests (`scripts/e2e-engine.sh`,
`scripts/e2e-installer.sh`) and the capacity check (`scripts/capacity-check.sh`)
deploy it. [The examples page](../../docs/examples.md) describes both examples.

```text
.spawner/spawner.yaml   the project (example), one URL (web), the seed
.spawner/compose.yaml   db (PostgreSQL 18), app (built from the Dockerfile)
server.js               GET / (a greeting), /users (JSON), /health
seed.js                 creates the users table and adds one user
```

## Try it

On a Spawner server, an admin creates the project `example` (Projects, New
project): repository `https://github.com/Flosk6/Spawner.git`, default branch
`master`, directory `examples/node-postgres`. Then, in a clone of the
repository, from this directory (the CLI sends it with your changes):

```bash
spawner up demo --wait        # without a name, the environment is named after the branch
spawner url demo              # https://demo--example.<domain>
spawner exec demo db -- psql -U app -d app -c "select * from users"
spawner logs demo app
spawner down demo
```

## What it shows

- `.spawner/compose.yaml` is a regular Compose file; Spawner fills in
  `${SPAWNER_URL}` and `${SPAWNER_ENV}`.
- The seed step (`node seed.js`) runs in `app` on the first deploy, and again
  with `spawner up --reseed` or `--fresh`.
- Healthchecks every 2 seconds: the app starts once the database accepts
  connections, and the environment is ready once the app answers on `/health`.
- The Dockerfile installs the dependencies before copying the code, so
  environments share that layer.
