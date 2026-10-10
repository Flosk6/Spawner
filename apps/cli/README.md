# spawner-cli

The command line and MCP server of [Spawner](https://spawner.run). Spawner is an open source, self-hosted preview environment manager: a copy of your app for each git branch, on your own server, with its own URLs, database and logs, for teams and their coding agents.

With `spawner`, developers and coding agents create, update and delete environments from a worktree, uncommitted changes included, run commands in them and read their logs.

## Install

```bash
npm install -g spawner-cli
```

It needs Node.js 20 or later, and a Spawner server: [install one](https://spawner.run/docs/install/) with a single command. Every server also serves the CLI of its own version at `/api/v1/cli/spawner`.

## Log in

```bash
spawner login https://spawner.preview.example.com
```

Type the code it shows in the dashboard and approve the login: the CLI stores a personal token. In CI or a container, `SPAWNER_URL` and `SPAWNER_TOKEN` replace the login.

## Commands

```bash
# write .spawner/, and offer to add the instructions for coding agents
spawner init

# the environment of the current branch, from this worktree
spawner up --wait

# run a command in a service
spawner exec feat-login db -- psql -U app -c "select * from users"

# only the error lines, stack traces kept whole
spawner logs feat-login api --errors

# a link for someone without an account
spawner share feat-login

spawner down feat-login
```

Before the first `spawner up` of a project, an admin adds the project in the dashboard (Projects, New project). The other commands: `status`, `ls`, `stats`, `capacity`, `url`, `shell`, `stop`, `start`, `sleep`, `wake`, `extend`, `token`, `whoami` and `logout`.

Commands print JSON with `--json` and exit with stable codes: 4 when the environment failed, 6 when the quota or the server's capacity is reached, 7 when `.spawner/` was refused.

## MCP server

`spawner mcp` is an MCP server on stdio, with the login and the rights of the CLI. In Claude Code:

```bash
claude mcp add spawner -- spawner mcp
```

In a project's `.mcp.json`, or Cursor's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "spawner": { "command": "spawner", "args": ["mcp"] }
  }
}
```

It has nine tools: `spawner_up`, `spawner_status`, `spawner_list`, `spawner_logs`, `spawner_exec`, `spawner_stats`, `spawner_url`, `spawner_share` and `spawner_down`. `spawner_exec` and `spawner_down` are marked destructive: whether a client asks before running them depends on the client and its permission settings.

## Documentation

- [The CLI and the MCP server](https://spawner.run/docs/cli/): every command, JSON outputs, exit codes
- [Coding agents](https://spawner.run/docs/agents/): Claude Code, Codex, Cursor, and the instructions `spawner init` adds
- [Quick start](https://spawner.run/docs/quickstart/): from a fresh server to the first environment

Source: [github.com/Flosk6/Spawner](https://github.com/Flosk6/Spawner). License: [Apache-2.0](https://github.com/Flosk6/Spawner/blob/master/LICENSE).
