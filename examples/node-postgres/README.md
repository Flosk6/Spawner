# Example: Node.js + PostgreSQL

The smallest useful Spawner project, also used by the end-to-end test
(`scripts/e2e-engine.sh`): an HTTP app, a PostgreSQL database seeded on the
first deploy, one exposure.

- `.spawner/spawner.yaml` declares the project, the exposure and the seed step.
- `.spawner/compose.yaml` is a regular Compose file; `${SPAWNER_URL}` and
  `${SPAWNER_ENV}` are filled in by Spawner.
