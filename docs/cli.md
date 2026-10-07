# The spawner CLI and MCP server

`spawner` creates, updates and deletes preview environments from a worktree on your machine, runs commands in them and reads their logs. It is built for coding agents as much as for people: every command has a `--json` output and stable exit codes, and `spawner mcp` exposes the same operations as MCP tools.

## Install

The CLI is one JavaScript file that needs Node.js 20 or later. Every Spawner server serves the CLI of its own version:

```bash
mkdir -p ~/.local/bin
curl -fsSL https://spawner.preview.example.com/api/v1/cli/spawner -o ~/.local/bin/spawner
chmod +x ~/.local/bin/spawner
```

From a clone of this repository: `pnpm install && pnpm build`, then link `apps/cli/dist/spawner.cjs` into your `PATH`. The npm package comes with the first release.

## Log in

```bash
spawner login https://spawner.preview.example.com
```

The CLI shows a code and opens the dashboard, where you approve it (device flow, as `gh auth login` does). It receives a personal token named after the machine (`--name` to choose), valid 90 days, with the scopes `envs:read`, `envs:write`, `envs:exec` and `preview`, and stores it in `~/.config/spawner/credentials.json` (mode 0600; `$XDG_CONFIG_HOME` is honored).

- `spawner whoami` shows the server, the user and the token in use.
- `spawner logout` revokes the token and forgets it.
- Without a login, `SPAWNER_URL` and `SPAWNER_TOKEN` give the server and a token: for CI jobs and agents in containers. They win over the stored login.
- For an agent of its own, create a dedicated token, restricted to a project if you like: `spawner token create --name claude --project blog --expires 30d`. Environments it creates show "Florian via claude".

## Which project, which environment

Commands run in a project directory: the one holding `.spawner/spawner.yaml`, or any directory below it. The project is the one the manifest names; `-p, --project <slug>` (or `SPAWNER_PROJECT`) overrides it, so that commands work from anywhere.

The environment is named after the current git branch: `feat/login` gives `feat-login`, lowercased, and cut with a short hash suffix past 29 characters. Give the name explicitly when HEAD is detached, outside git, or for another environment: `spawner status feat-login`.

`-C <dir>` runs a command as if started in another directory.

## Commands

| Command | What it does |
|---|---|
| `login [url]`, `logout`, `whoami` | Authentication |
| `init` | Creates `.spawner/spawner.yaml` and `.spawner/compose.yaml`, and offers to add the instructions for coding agents to `CLAUDE.md` or `AGENTS.md` |
| `up [env]` | Creates or updates the environment of the worktree. `--wait` waits until it is ready |
| `status [env]` | Status, URLs, sources, expiry, last job, and each service: state, health, restarts, out-of-memory kills |
| `ls` | Environments of the current project (all projects outside one, or with `--all`); `--mine` |
| `logs [env] [service]` | Output of the services, merged; or the log of the last job with `--job` |
| `exec <env> <service> -- <command...>` | Runs a command and exits with its exit code |
| `shell <env> <service>` | Interactive terminal (for people; agents use `exec`) |
| `stats [env]` | CPU, memory, disk, restarts and out-of-memory kills of each service, right now |
| `url [env] [exposure]` | Prints a URL; `--with-token` adds the header that opens the protected URL |
| `share [env]` | A link that opens the environment without an account, `--ttl 24h` by default |
| `stop`, `start`, `down [env]` | Stops, starts, deletes. They wait for the job unless `--no-wait` |
| `extend [env] --ttl 3d` | Postpones the expiry: the environment now expires in 3 days |
| `token create`, `token ls`, `token revoke` | Personal tokens |
| `mcp` | The MCP server, on stdio |

Global options: `--json`, `-q, --quiet` (no progress messages), `-C <dir>`. `spawner <command> --help` lists the options of each command.

### up

```bash
spawner up --wait                                  # the worktree, uncommitted changes included
spawner up --wait --source front=../blog-front     # another repository of spawner.yaml, from a local worktree
spawner up --wait --ref front=develop              # another repository, from git (the default ref otherwise)
spawner up --wait --ref app=main                   # this project itself from git, without uploading
spawner up --wait --fresh                          # drop the data (volumes) first
spawner up --wait --reseed                         # replay the seed steps
spawner up --wait --ttl 24h                        # lifetime, instead of spawner.yaml's
```

Before sending anything, `up` checks `spawner.yaml` and the compose file with the same code and the same limits as the server: a refused file fails in a second, with every issue and its path (exit code 7). It also checks that `spawner.yaml` sits where the project expects it (its root directory, for a monorepo).

What is sent: the files git sees in the worktree (`git ls-files --cached --others --exclude-standard`), so uncommitted work is included and ignored files are not. Untracked `node_modules/`, `vendor/` and `.env` files stay home; `upload.include` in `spawner.yaml` names ignored files to send anyway (globs: `config/*.local.php`, `**/*.pem`). Outside git, every file but `.git/`, `node_modules/`, `vendor/` and `.env` files. Git submodules are skipped with a warning. Symbolic links stay links; a link pointing outside the repository is refused before upload. Limits come from the server (100 MiB compressed, 50,000 files, 1 GiB extracted by default).

For a monorepo, only the project directory (the one holding `.spawner/`) is sent, at its place in the repository.

`--wait` follows the job (`--timeout 30m` by default) and prints the URLs; `--logs` streams the build log meanwhile. When the job fails, the end of its log goes to stderr, and `spawner logs <env> --job` prints all of it.

### logs

```bash
spawner logs feat-login                  # every service, the last 200 lines
spawner logs feat-login api --errors     # only error lines, with their stack traces
spawner logs feat-login api,db -f        # follow
spawner logs feat-login --grep users --since 10m -t
spawner logs feat-login --job            # the log of the last job (build, start, seed)
```

`--errors` keeps the lines that report an error: JSON lines with an error level (pino, bunyan, winston and other structured loggers), other lines containing words such as `error`, `exception`, `fatal`, `panic`, `traceback` or `uncaught`, and the lines that continue them (stack frames, indented lines). The stream does not count: Postgres, Python's logging or nginx write routine messages to stderr. Filters apply on the server, so `--tail 50 --errors` gives the last 50 error lines among the last 5,000 lines of each service; when the tail would cut an error, the output starts at its first line, which usually names the cause.

Spawner only sees what services write to stdout and stderr: with Laravel, set `LOG_CHANNEL: stderr` in the compose file.

### exec

```bash
spawner exec feat-login db -- psql -U app -d app -c "select count(*) from users"
spawner exec -i feat-login db -- psql -U app -d app < seed.sql
```

The command is an argument array: no shell runs it on the server unless you call one (`-- sh -c "..."`). Its stdout and stderr come back (1 MiB each), and `spawner` exits with its exit code. `-i` sends the CLI's standard input (1 MiB at most). `--timeout` is 120 seconds by default, 600 at most.

### url

```bash
curl -H "X-Spawner-Preview: $(spawner url feat-login --with-token --json | jq -r .header.value)" "$(spawner url feat-login)"
```

Previews are protected: teammates pass with the cookie the dashboard sets, agents with the `X-Spawner-Preview` header. The token is valid one hour, for this environment only; Traefik removes it before the request reaches the application. For Playwright, set it in `extraHTTPHeaders`.

## JSON output

With `--json`, stdout carries one JSON document (or one object per line for `logs --follow`); messages for people go to stderr. The shapes are those of the API, described in [`packages/types`](../packages/types/src/index.ts).

| Command | Output |
|---|---|
| `up` | `{ action: "created" \| "updated", environment, job, uploads: [{ source, files, bytes, archiveBytes }], warnings, waited, timedOut, logTail? }` |
| `status` | `{ environment, services: ServiceState[] }` |
| `ls` | `{ environments: Environment[] }` |
| `stats` | `{ environment, services: ServiceUsage[] }` |
| `logs` | `{ lines: [{ service, stream, time, text }] }`; with `--follow`, one line object per line; with `--job`, `{ job, lines: string[] }`, or `{ job, text }` per line with `--follow` |
| `exec` | `{ env, service, exitCode, stdout, stderr, truncated, timedOut }` |
| `url` | `{ project, env, exposure, url, urls, header?: { name, value }, expiresAt? }` |
| `share` | `{ env, id, url, expiresAt }` |
| `stop`, `start`, `down` | `{ environment, job, waited, timedOut, logTail? }` |
| `extend` | `{ environment }` |
| `login` | `{ server, user, token: { id, name, scopes, expiresAt }, credentials }` |
| `whoami` | `{ server, source, serverVersion, via, user, scopes, token }` |
| `token create` | `{ token, info }`; `token ls`: `{ tokens }`; `token revoke`: `{ revoked }` |
| `init` | `{ project, files, agentsFile, warnings }` |

Errors, with `--json`: `{ "error": { "code": "not_found", "message": "...", "hint": "...", "status": 404 } }` on stdout. A refused compose file adds `issues: [{ code, path, message, hint }]`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Error (unknown environment, network, server) |
| 2 | Usage: wrong arguments, no project here, no branch to name the environment after |
| 3 | Authentication: not logged in, token expired or revoked, or not allowed (a member acting on someone else's environment) |
| 4 | The environment failed: the end of the job log is on stderr |
| 5 | Timeout: the job goes on on the server |
| 6 | Capacity: the server lacks memory to build |
| 7 | `spawner.yaml` or the compose file was refused |

`exec` exits with the exit code of the command it ran, once it ran.

## MCP server

`spawner mcp` runs an MCP server on stdio, with the same code, the same credentials and the same rights as the CLI. For Claude Code, in `.mcp.json` at the root of the project:

```json
{ "mcpServers": { "spawner": { "command": "spawner", "args": ["mcp"] } } }
```

| Tool | Parameters |
|---|---|
| `spawner_up` | `path`, `env`, `sources` ({ name: path }), `refs` ({ name: ref }), `fresh`, `reseed`, `ttl`, `wait` (true), `timeout_sec` (1200). Sends progress notifications |
| `spawner_status` | `env`, `project`, `path` |
| `spawner_list` | `project`, `mine` |
| `spawner_logs` | `env`, `service`, `tail`, `since`, `grep`, `errors_only`, `job` |
| `spawner_exec` | `env`, `service`, `command` (array), `stdin`, `timeout_sec` |
| `spawner_stats` | `env`, `project`, `path` |
| `spawner_url` | `env`, `exposure`, `with_token` |
| `spawner_share` | `env`, `ttl` |
| `spawner_down` | `env` (required). Marked destructive, so the client asks for confirmation |

`path` is the worktree, by default the first root the client shares, else the directory the server runs in. Failures come back as tool errors with the hint and, for a failed build, the end of its log. The interactive terminal is not exposed: `spawner_exec` returns exit codes an agent can use.

## Instructions for coding agents

`spawner init` offers to add this to `CLAUDE.md` or `AGENTS.md` (or `spawner init --agents CLAUDE.md`):

```markdown
## Preview environments (Spawner)

This project runs preview environments on Spawner: one per branch, with its own URLs and database.

- To test end to end, run `spawner up --wait --json` from the worktree root. It creates or updates the
  environment of the current branch and prints its name and URLs. Add `--source <name>=<path>` to send
  another repository of spawner.yaml from a local worktree.
- Use the returned URLs. For curl or Playwright, get the auth header with
  `spawner url <env> --with-token --json`.
- Commands in the database: `spawner exec <env> db -- <command>` (`-i` sends stdin, such as a SQL file).
- Debugging: `spawner logs <env> <service> --errors`, and `spawner status <env> --json` for restarts and
  out-of-memory kills.
- If `spawner up` exits with code 4, read the log tail it printed, fix the cause, then retry. Code 7 means
  .spawner/ was refused: fix what it lists.
- To show the result to someone without an account: `spawner share <env>`.
- When the task is done and validated, run `spawner down <env>`.
```
