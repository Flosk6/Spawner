# The Spawner CLI and MCP server

The Spawner CLI, `spawner`, creates, updates and deletes preview environments from a worktree on your machine, runs commands in them and reads their logs. It is built for coding agents as much as for people: every command but `shell` and `mcp` prints JSON with `--json`, exit codes are stable, and `spawner mcp` is an MCP (Model Context Protocol) server with nine tools for the main operations.

A **worktree**, on this page, is the directory `spawner` runs in: a clone, a `git worktree` of one, or any directory holding the project. [Coding agents](agents.md) shows how to set agents up, and [previews for pull requests](ci.md) how to run the CLI from CI.

## Install

The CLI is one JavaScript file that needs Node.js 20 or later:

```bash
npm install -g spawner-cli@<version>    # your server's, shown in the dashboard's sidebar; npm audit signatures checks its provenance
```

Every Spawner server also serves the CLI of its own version, for machines without npm:

```bash
mkdir -p ~/.local/bin
curl -fsSL https://spawner.preview.example.com/api/v1/cli/spawner \
  -o ~/.local/bin/spawner
chmod +x ~/.local/bin/spawner
```

Each GitHub release also has the bundle as `spawner`, which `gh attestation verify spawner -R Flosk6/Spawner` checks. From a clone of the Spawner repository: `pnpm install && pnpm build`, then link `apps/cli/dist/spawner.cjs` into your `PATH`.

### Versions and updates

Keep the CLI on the version of the server. Before it sends anything, the CLI checks `spawner.yaml` and the compose file with its own copy of the server's rules: a CLI of another version can refuse a file the server would accept, or send one the server then refuses. Nothing warns when the versions differ: `spawner whoami` prints both, and `spawner --version` the CLI's.

To update, install the server's version (`spawner whoami` shows it):

```bash
npm install -g spawner-cli@2.1.0
```

Or download the server's copy again, as above: it always has the server's version.

## Log in

```bash
spawner login https://spawner.preview.example.com
```

The CLI shows a code and opens the dashboard's `/device` page, where you type that code and approve the login (device flow, as `gh auth login` does). The code expires in 10 minutes. The page never takes the code from a link: only enter a code from a login you started yourself.

The CLI then receives a personal API token named after the machine, valid 90 days, with the scopes `envs:read`, `envs:write`, `envs:exec` and `preview`, never `admin`, even for an admin. It stores the token in its [credentials file](#environment-variables-and-files).

| Option | Meaning |
|---|---|
| `[url]` | The dashboard's URL; by default `SPAWNER_URL`, else the server of the last login |
| `--name <name>` | Name of the token, shown on your environments ("Ada via ada-mbp"); the machine's name by default |
| `--no-browser` | Print the page's address without opening a browser |

- `spawner whoami` shows the server, the user, the token in use and its scopes, and the versions of the server and the CLI.
- `spawner logout` revokes the token of the current server and forgets it.
- Without a login, `SPAWNER_URL` and `SPAWNER_TOKEN` give the server and a token: for CI jobs and agents in containers. They win over the stored login.
- An agent of its own gets a [token](#token) of its own.

## Environment variables and files

| Variable | Meaning |
|---|---|
| `SPAWNER_URL` | The server, instead of the last one logged in to. Without `SPAWNER_TOKEN`, it picks the stored login of that server |
| `SPAWNER_TOKEN` | A personal API token (`spn_...`), used instead of the stored login: for CI jobs and agents in containers |
| `SPAWNER_PROJECT` | The project of the commands that name an environment, when `-p` is not given ([which project](#which-project-which-environment)) |
| `SPAWNER_CONFIG_DIR` | The directory of the credentials file |
| `XDG_CONFIG_HOME` | When set, the credentials file goes to `$XDG_CONFIG_HOME/spawner` |
| `NO_COLOR` | No colors. `FORCE_COLOR` (other than `0`) forces them, and `TERM=dumb` turns them off. Otherwise colors appear on a terminal only, and never on stdout with `--json` |

The credentials file, `credentials.json`, lives in `SPAWNER_CONFIG_DIR` when it is set, else in `$XDG_CONFIG_HOME/spawner`, else in:

| System | Directory |
|---|---|
| Linux, macOS | `~/.config/spawner` |
| Windows | `%APPDATA%\spawner` |

On Linux and macOS, only its owner can read it (mode 0600, in a directory of mode 0700).

It holds one login per server. `spawner login` to a second server adds it and makes it the current one; `SPAWNER_URL` picks another one for a command; `spawner logout` forgets the current one and switches to another stored server.

## Which project, which environment

Commands run in a project directory: the one holding `.spawner/spawner.yaml`, or any directory below it. The project is the one the manifest names.

The commands that act on one environment (`status`, `logs`, `exec`, `shell`, `stats`, `url`, `share`, `stop`, `start`, `sleep`, `wake`, `down`, `extend`) take `-p, --project <slug>`, or read `SPAWNER_PROJECT`, and both win over the manifest. With an environment name and one of them, they work from any directory. The other commands differ:

- `up` has no `-p`: it deploys the project of the manifest it finds.
- `ls -p` lists the environments of one project; `ls` does not read `SPAWNER_PROJECT`.
- `capacity -p` keeps one project, `init -p` names the project of a new manifest, and `token create -p` restricts a token to a project.

The environment is named after the current git branch: `feat/login` gives `feat-login`, lowercased, and cut with a short hash suffix past 29 characters. Give the name explicitly when HEAD is detached (in CI), outside git, or for another environment: `spawner status feat-login`. A name has lowercase letters, digits and single dashes, 29 characters at most.

`-C, --dir <dir>` runs a command as if started in another directory.

## Commands

Global options go before or after the command: `--json` ([JSON output](#json-output)), `-q, --quiet` (no progress messages), `-C, --dir <dir>`, `-v, --version` and `-h, --help`. `spawner <command> --help` lists the options of a command.

| Command | What it does |
|---|---|
| [`login [url]`, `logout`, `whoami`](#log-in) | Authentication |
| [`init`](#init) | Creates `.spawner/`, and offers to add the instructions for coding agents |
| [`up [env]`](#up) | Creates or updates the environment of the worktree |
| [`status [env]`](#status) | Status, URLs, services and last events of an environment |
| [`ls`](#ls) | Lists environments |
| [`logs [env] [service]`](#logs) | Output of the services, or the log of a job |
| [`exec <env> <service> -- <command...>`](#exec) | Runs a command in a service and exits with its exit code |
| [`shell <env> <service>`](#shell) | Interactive terminal, for people |
| [`stats [env]`](#stats) | CPU, memory, disk, restarts and out-of-memory kills, right now |
| [`capacity`](#capacity) | How many more environments of each project fit on the server |
| [`url [env] [exposure]`](#url) | A URL, and the header that opens it |
| [`share [env]`](#share) | A link that opens the environment without an account |
| [`stop`, `start`, `sleep`, `wake`, `down`](#stop-start-sleep-wake-down) | Stops, starts, puts to sleep, wakes up, deletes |
| [`extend [env]`](#extend) | Postpones the expiry |
| [`token create`, `token ls`, `token revoke`](#token) | Personal API tokens |
| [`mcp`](#mcp-server) | The MCP server, on stdio |

### init

```bash
spawner init
```

Creates `.spawner/spawner.yaml` and `.spawner/compose.yaml` in the current directory, then says what comes next: an admin registers the project in the dashboard ([quickstart](quickstart.md)). It guesses:

- **the project's slug**, from the name of the git repository's top directory (`My_App` gives `my-app`), or of the current directory outside git;
- **the port**, from the first `EXPOSE` of a `Dockerfile` in the current directory, else 3000. Without a `Dockerfile`, it warns: the compose file it writes builds the app from that directory (`build: ..`);
- **the database**, from the dependencies: `pg`, `postgres` or `pg-promise` in `package.json`, or `psycopg` in `requirements.txt` or `pyproject.toml`, add a PostgreSQL service; `mysql`, `mysql2`, `mysqlclient`, `PyMySQL` or `mysql-connector` add a MySQL one. Otherwise none.

A Laravel project (`laravel/framework` in `composer.json`) also gets `APP_URL` and `LOG_CHANNEL: stderr`. The manifest has one exposure, `web`, on the service `app`, a lifetime of 72 hours and a seed in comments; [the manifest](manifest.md) describes the rest.

| Option | Meaning |
|---|---|
| `-p, --project <slug>` | The project's slug |
| `--port <port>` | The app's port |
| `--db postgres\|mysql\|none` | The database service |
| `--agents [file]` | Add the [instructions for coding agents](#instructions-for-coding-agents) to this file without asking: `CLAUDE.md` or `AGENTS.md`, whichever the project has, else `AGENTS.md` |
| `--no-agents` | Do not add them |
| `--force` | Replace the files of an existing `.spawner/` |

On a terminal, `init` asks before adding the instructions; without a terminal or with `--json`, it adds them only with `--agents`.

### up

| Option | Meaning |
|---|---|
| `[env]` | The environment; by default, the branch's |
| `-w, --wait` | Wait until the environment is ready, then print its URLs |
| `--timeout <duration>` | How long `--wait` waits: `30m` by default (`90` means 90 seconds) |
| `--logs` | Stream the build log while waiting (implies `--wait`) |
| `--source <name>=<path>` | Send another source of `spawner.yaml` from a local directory; repeatable |
| `--ref <name>=<ref>` | Take a source from git at a branch, tag or commit; repeatable. The project's own source (`app` unless `name` says otherwise) deploys this project from git, without an upload |
| `--fresh` | On an update, drop the data (volumes) first |
| `--reseed` | On an update, replay the seed steps |
| `--ttl <duration>` | Lifetime, such as `24h`: from 10 minutes to the longest lifetime (14 days by default); `ttl` of `spawner.yaml` otherwise |

```bash
spawner up --wait
spawner up --wait --source front=../blog-front
spawner up --wait --ref front=develop
spawner up --wait --ref app=main --ttl 24h
spawner up --wait --fresh
```

In the dashboard, an update is **Redeploy**; **Redeploy and replay the seed** is `--reseed`, and **Redeploy from scratch** is `--fresh`.

Before sending anything, `up` checks `spawner.yaml` and the compose file with the same code and the same limits as the server: a refused file fails in a second, with every issue and its path (exit code 7, [the issues](manifest.md#when-spawner-is-refused)). It also stops when the project is not registered on the server (`project "blog" is not registered on https://...`), and when `spawner.yaml` is not where the project expects it, its directory for a monorepo (`spawner.yaml is in apps/blog, but project blog expects it in the root`, exit code 2).

What is sent: the files git sees in the worktree (`git ls-files --cached --others --exclude-standard`), so uncommitted work is included and ignored files are not.

- Untracked `node_modules/` and `vendor/` directories and local secrets are not sent: `.env` files (`.env.local`, `.env-staging`...), `.npmrc`, `.yarnrc.yml`, `.pypirc`, `.netrc`, `.git-credentials`, `.pgpass`, `.dockercfg`, private SSH keys (`id_ed25519`...) and `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`. `upload.include` in `spawner.yaml` names ignored files to send anyway (globs: `config/*.local.php`, `**/*.pem`).
- A file the compose file uses, such as an `env_file`, must be sent too: commit it, or add it to `upload.include`. The local check reads the worktree, where the file exists, so only the server notices it is missing.
- Outside git, every file is sent but `.git/`, `node_modules/`, `vendor/` and the local secrets above.
- Git submodules are skipped with a warning. Symbolic links stay links; a link pointing outside the repository is refused before upload.
- For a monorepo, only the project's directory (the one holding `.spawner/`) is sent, at its place in the repository.
- Limits come from the server: 100 MiB compressed, 50,000 files and 1 GiB extracted by default.

`--wait` follows the job and prints the URLs. When the job fails, the end of its log goes to stderr, and `spawner logs <env> --job` prints all of it.

### status

```bash
spawner status feat-login
```

The environment's status, URLs, sources, expiry and last job; each service (state, health, restarts, out-of-memory kills); and the last 20 events of its timeline: services that crashed, ran out of memory or turned unhealthy (from Docker events), and the jobs that changed it. A service that crashed three times in ten minutes is called out with its cause:

```text
api failed 3 times in 10 minutes, last cause: out of memory (limit 512 MiB)
```

Reading the status does not count as activity: it does not keep an environment awake. Options: `[env]`, `-p`.

### ls

Lists the live environments of the current project, or of every project outside one. Also `spawner list`.

| Option | Meaning |
|---|---|
| `-p, --project <slug>` | One project |
| `-a, --all` | Every project, even inside one |
| `--mine` | Only yours |

### logs

```bash
spawner logs feat-login
spawner logs feat-login api --errors
spawner logs feat-login api,db -f
spawner logs feat-login --grep users --since 10m -t
spawner logs feat-login --job
```

| Option | Meaning |
|---|---|
| `[service]` | A service, or several separated by commas; all of them by default, merged in time order |
| `-n, --tail <lines>` | The last lines: 200 by default, 5,000 at most |
| `-f, --follow` | Keep printing new lines, until the services stop or Ctrl-C |
| `--since <time>` | From a duration ago (`10m`, `2h`) or a date (`2026-10-07T10:00:00Z`) |
| `--grep <text>` | Only the lines containing this text, ignoring case |
| `--errors` | Only the lines reporting errors, with their stack traces |
| `-t, --timestamps` | Show the time of each line |
| `--job [id]` | The log of a job (build, start, seed) instead: the last one by default. With `-f`, follow it until the job ends |

`--errors` keeps the lines that report an error:

- JSON lines with an error level (pino, bunyan, winston and other structured loggers);
- other lines containing words such as `error`, `exception`, `fatal`, `panic`, `traceback` or `uncaught`;
- the lines that continue them: stack frames, indented lines.

The stream does not count: Postgres, Python's logging or nginx write routine messages to stderr. Filters apply on the server, among the last 5,000 lines of each service: `--tail 50 --errors` gives the last 50 error lines. When the tail would cut an error, the output starts at its first line, which usually names the cause.

Spawner only sees what services write to stdout and stderr: with Laravel, set `LOG_CHANNEL: stderr` in the compose file.

### exec

```bash
spawner exec feat-login db -- psql -U app -d app -c "select 1"
spawner exec -i feat-login db -- psql -U app -d app < seed.sql
```

The command is an argument array: no shell runs it on the server unless you call one (`-- sh -c "..."`). Its stdout and stderr come back, 1 MiB each (`truncated` says when they were cut). It needs the `envs:exec` scope, and runs in your own environments (in any, with a token holding `admin`).

| Option | Meaning |
|---|---|
| `-i, --stdin` | Send the CLI's standard input to the command, 1 MiB at most |
| `--timeout <duration>` | 120 seconds by default, 600 at most |
| `-p, --project <slug>` | The project |

`spawner` exits with the exit code of the command, or 5 when the command did not finish within `--timeout`. A command's exit code can be any number, Spawner's own 1 to 7 included: with `--json`, a failure of Spawner prints `{ "error": ... }`, and a command that ran prints its `exitCode` and `timedOut`.

### shell

```bash
spawner shell feat-login api
```

An interactive terminal in a service, the same as the dashboard's: it needs a terminal (agents use `exec`), the `envs:exec` scope and the right to act on the environment, and it closes after 15 minutes without input or 4 hours. `spawner` exits with the shell's exit code.

### stats

```bash
spawner stats feat-login
```

The CPU, memory and disk of each service right now, with its restarts and out-of-memory kills. Options: `[env]`, `-p`.

### capacity

```bash
spawner capacity
```

How many more environments of each project fit on the server, and what limits them (`limitedBy`): the lowest of these counts.

- **Memory**: what the server can hand out now, minus 1 GiB kept free, divided by what an environment of the project typically uses: the median of the last day, or its declared limits before any ran.
- **Disk**: the free disk, minus 10 GiB kept free, divided by what an environment of the project adds.
- **Builds**: each environment is built first, so the count leaves the last one what a build waits for: 2 GiB of memory and 10 GiB of disk by default.
- **Quota**: what your quota leaves: 5 environments per person by default, sleeping ones included.

The server refuses with exit code 6 a new environment beyond your quota, and a new environment, a start or a wake-up when it lacks the memory, or for a new environment the disk. A build that does not find what it waits for within two minutes fails with the same code. `-p, --project <slug>` shows one project.

### url

```bash
spawner url feat-login
spawner url feat-login api --with-token
```

Prints the URL of an exposure, the entrypoint by default. Previews are protected: teammates pass with the cookie the dashboard sets, agents and scripts with the `X-Spawner-Preview` header. `--with-token` adds that header, with a preview token valid one hour for this environment only; it takes the `preview` scope. Traefik removes it before the request reaches the application.

```bash
token=$(spawner url feat-login --with-token --json | jq -r .header.value)
curl -H "X-Spawner-Preview: $token" "$(spawner url feat-login)"
```

For Playwright, set the header in `extraHTTPHeaders`.

### share

```bash
spawner share feat-login --ttl 3d
```

A link that opens the environment without an account, for anyone who has it, until it expires: `--ttl` in whole hours or days, 24 hours by default, 14 days at most. Like the other changes, it is for the owner of the environment or an admin.

### stop, start, sleep, wake, down

```bash
spawner stop feat-login
spawner down feat-login --no-wait
```

- `stop` stops the containers; the data stays. `start` starts them again.
- `sleep` puts the environment to sleep now: its containers stop, its data stays, and the next visit to one of its team URLs wakes it up. `wake` wakes it up.
- `down` deletes the environment and everything it holds: containers, data, URLs. Its page, timeline and last logs stay readable 7 days.

They wait for the job unless `--no-wait`, 10 minutes at most (`--timeout`). `start` and `wake` need the memory of a typical environment of the project, or exit with code 6. These commands, like `up` on an existing environment, `share` and `extend`, are for the owner of the environment or an admin.

### extend

```bash
spawner extend feat-login --ttl 3d
```

The environment now expires 3 days from now. `--ttl` is required: from 10 minutes to the longest lifetime, 14 days by default.

### token

```bash
spawner token create --name claude --project blog --expires 30d
spawner token ls
spawner token revoke spn_ab12cd34
```

`token create` prints a personal API token, once, on stdout:

| Option | Meaning |
|---|---|
| `--name <name>` | Required, 40 characters at most: shown on the environments it creates ("Ada via claude") |
| `--scopes <scopes>` | Comma-separated, among `envs:read`, `envs:write`, `envs:exec`, `preview` and `admin`: all but `admin` by default, never more than the token in use holds |
| `--expires <duration>` | Whole days: 90 by default, 365 at most |
| `-p, --project <slug>` | Restrict the token to one project; it then cannot hold `admin` |

A token created this way depends on the token that creates it, your login's: it expires with it at the latest, and is revoked with it, by `spawner logout` too. Create the tokens that must outlive your login (CI, an agent running for months) on the dashboard's **Account and tokens** page.

- `token ls` (or `token list`) lists your tokens; `-a, --all` lists everyone's, with a token holding `admin` (without it, yours only).
- `token revoke <token>` revokes a token by its id or its start (`spn_ab12cd34`), and the tokens created with it.

## Sleeping environments

An environment sleeps after a while without activity (2 hours by default, `idle` in `spawner.yaml`): its containers stop, its data stays. The next visit to one of its team URLs wakes it up: a browser gets a page that reloads by itself within seconds, an agent calling it a 503 to retry. Public URLs (`auth: none`) do not wake it up: `spawner wake` does.

`exec`, `shell`, `url` and `logs --follow` wake it up first and say so on stderr. Waking an environment up from the CLI takes the right to act on it: a member gets exit code 3 on someone else's sleeping environment, which a visit to its URL wakes up.

Requests to its URLs, deploys, commands, logs and terminals count as activity; reading its status does not.

## JSON output

With `--json`, stdout carries one JSON document (or one object per line for `logs --follow`); messages for people go to stderr. The shapes are those of the API, described in [`packages/types`](../packages/types/src/index.ts).

| Command | Output |
|---|---|
| `up` | `{ action: "created" \| "updated", environment, job, uploads: [{ source, files, bytes, archiveBytes }], warnings, waited, timedOut, logTail? }`. `environment.url` is the entrypoint's URL, `environment.urls` every URL by exposure |
| `status` | `{ environment, services: ServiceState[], events: TimelineEvent[], crashLoops: CrashLoop[] }` |
| `ls` | `{ environments: Environment[] }` |
| `stats` | `{ environment, services: ServiceUsage[] }` |
| `capacity` | `{ host: { availableMemoryBytes, freeDiskBytes, reserves, buildGuards }, quota: { limit, used, remaining } \| null, projects: [{ project, name, places, byMemory, byDisk, byQuota, limitedBy, memoryBytes, diskBytes, basedOn }] }`; `places` is null until the first sample of the server's memory and disk |
| `logs` | `{ lines: [{ service, stream, time, text }] }`; with `--follow`, one line object per line |
| `logs --job` | `{ job, lines: string[] }`, with the job object; with `--follow`, `{ job, text }` per line, with the job's id |
| `exec` | `{ env, service, exitCode, stdout, stderr, truncated, timedOut }` |
| `url` | `{ project, env, exposure, url, urls, header?: { name, value }, expiresAt? }` |
| `share` | `{ env, id, url, expiresAt }` |
| `stop`, `start`, `sleep`, `wake`, `down` | `{ environment, job, waited, timedOut, logTail? }`; `job` is null when there was nothing to do |
| `extend` | `{ environment }` |
| `login` | `{ server, user, token: { id, name, scopes, expiresAt }, credentials }` |
| `logout` | `{ server, revoked }` |
| `whoami` | `{ server, source, serverVersion, via, user, scopes, token }`; `source` is `env` for `SPAWNER_TOKEN`, `credentials` for a login |
| `token create` | `{ token, info }`; `token ls`: `{ tokens }`; `token revoke`: `{ revoked }` |
| `init` | `{ project, files, agentsFile, warnings }` |

Errors print on stdout too, with `--json`:

```json
{
  "error": {
    "code": "not_found",
    "message": "no environment \"feat-login\" in project \"blog\"",
    "hint": "list them with: spawner ls --project blog; create it with: spawner up feat-login"
  }
}
```

- `code` is stable: the [table below](#exit-codes) lists them.
- `status` and `body` come with an error the API answered: its HTTP status, and its answer as it is.
- `issues: [{ code, path, message, hint }]` comes with a file refused before upload ([the codes](manifest.md#when-spawner-is-refused)).

A job that fails is not an error: `up` and the commands above print their usual result, with `job.status` at `"failed"`, `job.error`, `job.errorCode` (`invalid` for a refused file, `capacity`, `upload`, `interrupted`, or null) and `logTail`, and exit with code 4, 6 or 7.

## Exit codes

| Code | Meaning | Error codes |
|---|---|---|
| 0 | Success | |
| 1 | Error: unknown environment, unregistered project, network, server | `not_found`, `conflict`, `network`, `server_error`, `bad_request`, `rate_limited`, `too_large`, `upload_too_large`, `upload_refused`, `not_ready`, `not_running`, `not_spawner`, `config_invalid`, `terminal`, `interrupted`, `internal` |
| 2 | Usage: wrong arguments, no project here, no branch to name the environment after | `usage` |
| 3 | Authentication: not logged in, token expired or revoked, or not allowed (someone else's environment, a missing scope, a token restricted to another project) | `not_logged_in`, `unauthorized`, `forbidden`, `expired`, `denied`, `login_failed`; `terminal` when the terminal is refused |
| 4 | The environment failed: the end of the job log is on stderr | `wake_failed`, or a failed job |
| 5 | Timeout: the job keeps running on the server. Also when the server did not answer within 60 seconds, a sleeping environment did not wake up within 5 minutes, or a command of `exec` did not finish within its `--timeout` | `timeout` |
| 6 | Quota or capacity: you have as many environments as a person may, or 5 deploys of uploaded code waiting to start, or the server lacks the memory or disk (the hint says what to free) | `quota`, `capacity`, or a failed job with `errorCode` `capacity` |
| 7 | `spawner.yaml` or the compose file was refused | `refused`, or a failed job with `errorCode` `invalid` |

`exec` exits with the exit code of the command it ran, once it ran (see [exec](#exec)). [Troubleshooting](troubleshooting.md) goes from the codes 3, 4, 6 and 7 to their usual causes.

## MCP server

`spawner mcp` runs an MCP (Model Context Protocol) server on stdio, with the same code, the same credentials and the same rights as the CLI. What comes from the environment (logs, job logs) is fenced between markers the environment cannot guess, and its instructions tell the model to read it as data: the code of a branch writes it, and could try to steer the agent that reads it. [Coding agents](agents.md) shows how to add it to Claude Code, Codex, Cursor, VS Code, Gemini CLI and others, Windows included.

It has nine tools, for the main operations. The other commands (`init`, `login`, `logout`, `whoami`, `capacity`, `stop`, `start`, `sleep`, `wake`, `extend`, `shell`, `token`) have no tool: an agent runs them with the CLI. In the table, **target** stands for three parameters: `env` (the branch's environment by default), `project` (the manifest's by default) and `path`.

| Tool | Parameters | Returns |
|---|---|---|
| `spawner_up` | `path`, `env`, `sources` (`{ name: path }`), `refs` (`{ name: ref }`), `fresh`, `reseed`, `ttl`, `wait` (true), `timeout_sec` (1200) | The JSON of `up`, with a `note` when the wait timed out. Sends progress notifications |
| `spawner_status` | target | The JSON of `status` |
| `spawner_list` | `project` (every project without it), `mine` | `{ environments }` |
| `spawner_logs` | target, `service` (one), `tail` (200, 5,000 at most), `since`, `grep`, `errors_only`, `job` (true for the last job's log) | Text, one line per entry: `<service> \| <text>`; with `job`, `job <id> (<type>, <status>)` then its log. Both between two marker lines its content cannot guess, to read as data |
| `spawner_exec` | target, `service` and `command` (an array), both required, `stdin` (text), `timeout_sec` (120, 600 at most) | The JSON of `exec`: `exitCode`, `stdout`, `stderr`... |
| `spawner_stats` | target | The JSON of `stats` |
| `spawner_url` | target, `exposure`, `with_token` | The JSON of `url` |
| `spawner_share` | target, `ttl` (whole hours, `24h` by default) | `{ env, id, url, expiresAt }` |
| `spawner_down` | target, `env` required | The JSON of `down`, once the environment is deleted |

`path` is the worktree: by default the first root the client shares, else the directory the MCP server runs in. Failures come back as tool errors: `error (<code>): <message>`, then the hint, and for a failed job the end of its log, fenced the same way. The interactive terminal is not exposed: `spawner_exec` returns exit codes an agent can use.

Each tool carries MCP annotations: `spawner_status`, `spawner_list`, `spawner_logs`, `spawner_stats` and `spawner_url` are read-only; `spawner_exec` and `spawner_down` are destructive. Whether a client asks before calling a destructive tool depends on the client and its permission settings ([coding agents](agents.md)).

## Instructions for coding agents

`spawner init` offers to add this to `CLAUDE.md` or `AGENTS.md` (or `spawner init --agents CLAUDE.md`). With `--db none`, the line on commands names a service instead of `db`. For a project set up already, copy it by hand:

```markdown
## Preview environments (Spawner)

This project runs preview environments on Spawner: one per branch, with its own URLs and database.

- To test end to end, run `spawner up --wait --json` from the worktree root. It creates or updates the
  environment of the current branch and prints its name and URLs. Add `--source <name>=<path>` to send
  another repository of spawner.yaml from a local worktree.
- Use the returned URLs. For curl or Playwright, get the preview token header with
  `spawner url <env> --with-token --json`.
- Commands in the database: `spawner exec <env> db -- <command>` (`-i` sends stdin, such as a SQL file).
- Debugging: `spawner logs <env> <service> --errors`, and `spawner status <env> --json` for restarts and
  out-of-memory kills.
- If `spawner up` exits with code 4, read the log tail it printed, fix the cause, then retry. Code 7 means
  .spawner/ was refused: fix what it lists. Code 6 means your quota or the server's capacity is reached:
  `spawner ls --all --mine --json` lists your environments; delete those whose work is done, or ask a person.
- To show the result to someone without an account: `spawner share <env>`.
- When the task is done and validated, run `spawner down <env>`.
```
