# Contributing

Thank you for your interest in Spawner.

## Issues welcome, pull requests not yet

Spawner has a single maintainer for now. Bug reports, questions and ideas are welcome as [issues](https://github.com/Flosk6/Spawner/issues/new/choose). Pull requests from outside are not accepted at this stage, and are closed without review: an issue is the way to get a change into Spawner.

Security issues never go in an issue: see [SECURITY.md](SECURITY.md).

## Reporting a bug

Use the bug report form. What helps most:

- the version of the server (`/api/v1/info`, or the dashboard) and of the CLI (`spawner --version`);
- the server: distribution, `docker version`, memory;
- what you ran, what you expected, and what happened;
- the log of the failed job (`spawner logs <env> --job`, or the Jobs tab of the environment), and `docker logs spawner` if Spawner itself misbehaves, without secrets.

When the problem comes from a project's `.spawner/` directory, its `spawner.yaml` and compose file help too.

## Proposing a feature

Start from the problem: what you want to do, with which kind of project, and whether people or coding agents drive it. Check [the documentation](README.md#documentation) and [how Spawner compares](docs/comparison.md) first: some needs are covered differently, or left out on purpose.

## Working on your own copy

The [Apache-2.0 license](LICENSE) lets you fork Spawner, change it and run it as you like. [Development](README.md#development) explains how to build and run it, [architecture](docs/architecture.md) how it is built, and [scripts](scripts/README.md) how to test it. [AGENTS.md](AGENTS.md) holds the same rules for coding agents. The code follows a few rules:

- external programs (git, docker compose) run with argument arrays, never through a shell;
- the compose policy is an allowlist: every change to it comes with a fixture in `packages/core/test/fixtures/compose/`;
- tests sit next to the code they cover (`*.spec.ts`), and the end-to-end tests cover what units cannot (`scripts/e2e-engine.sh`);
- functions are documented with JSDoc, and there are no emojis in code, messages or docs.
