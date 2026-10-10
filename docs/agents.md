# Preview environments for coding agents

Claude Code, Codex, Cursor and other coding agents can run the app they change in a Spawner preview environment, with its own URLs, database and logs. Spawner builds it on your server from the agent's worktree, uncommitted changes included, and the agent drives it with the `spawner` CLI or through its MCP (Model Context Protocol) server: it opens the page it changed, calls the API, looks at the database, reads the error.

The agent's machine needs no Docker and runs none of the app: it needs Node.js, the CLI and a token. Each branch gets its own copy of the whole Docker Compose stack, so agents on different branches never compete for ports or share a database, and teammates open the same URLs to check the result.

## What an agent does

```bash
# the environment of the current branch, from this worktree
spawner up --wait --json

# the preview token that opens its protected URLs, valid one hour
token=$(spawner url --with-token --json | jq -r .header.value)
curl -H "X-Spawner-Preview: $token" \
  https://feat-login--blog.preview.example.com/api/users

spawner exec feat-login db -- psql -U app -c "select count(*) from users"

# only the error lines, a stack trace kept whole
spawner logs feat-login api --errors

# restarts, out-of-memory kills, failing healthchecks
spawner status feat-login --json

# a link for a reviewer without an account
spawner share feat-login

spawner down feat-login
```

Commands print JSON with `--json`, and exit with a code the agent can act on ([all of them](cli.md#exit-codes)):

| Code | What the agent does |
|---|---|
| 4 | The environment failed: read the end of the build log on stderr (all of it: `spawner logs <env> --job`), fix the cause, run `spawner up` again |
| 6 | The quota or the server's capacity is reached: `spawner ls --all --mine --json` lists the environments of the token's owner; delete those whose work is done (`spawner down <env>`), or ask a person. `spawner capacity` says how many more fit, and what limits them |
| 7 | `.spawner/` was refused: fix each issue it lists, at its path |
| 5 | The job keeps running on the server: follow it with `spawner status <env> --json` |
| 3 | Not logged in, or not allowed: ask a person. A login needs someone to approve it in the dashboard |

## Setting an agent up

1. **Install the CLI** on the machine the agent runs on (Node.js 20 or later): `npm install -g spawner-cli`, or the copy every server serves at `/api/v1/cli/spawner` ([install](cli.md#install)).
2. **Log in**: `spawner login https://spawner.preview.example.com`, then type the code it shows in the dashboard and approve the login. The CLI stores a personal API token named after the machine, and the agents of that machine use it. An agent running elsewhere (a container, a cloud agent) gets a token of its own instead, given as environment variables:

   ```bash
   # the token is shown once
   spawner token create --name claude --project blog --expires 30d
   export SPAWNER_URL=https://spawner.preview.example.com
   export SPAWNER_TOKEN=spn_...
   ```

   Environments it creates show its name ("Ada via claude"). A token restricted to a project cannot touch the others; without `envs:exec` (`--scopes envs:read,envs:write,preview`) it cannot run commands. A token made with `spawner token create` expires with your login at the latest: create one that must last longer on the dashboard's **Account and tokens** page.
3. **Tell it how**: when it creates `.spawner/`, `spawner init` offers to add a short section to `CLAUDE.md` or `AGENTS.md` that tells the agent when and how to use Spawner ([the section](cli.md#instructions-for-coding-agents)). Commit it with the rest: every agent working on the repository reads it. For a project set up already, copy the section by hand.
4. **Optionally, the MCP server**, for agents that prefer tools to commands: `spawner mcp`, configured as below, with the same credentials as the CLI. It has nine tools for the main operations: `spawner_up`, `spawner_status`, `spawner_list`, `spawner_logs`, `spawner_exec`, `spawner_stats`, `spawner_url`, `spawner_share` and `spawner_down` ([their parameters](cli.md#mcp-server)). For the rest, such as `capacity`, `wake` or `extend`, the agent runs the CLI.

Claude Code reads `CLAUDE.md`; Codex, Cursor, Copilot in VS Code and Devin Desktop read `AGENTS.md`, and Gemini CLI does once told to (below). A project that keeps its instructions in `AGENTS.md` gives them to Claude Code with a `CLAUDE.md` holding the line `@AGENTS.md`, as Spawner's own repository does.

### Claude Code

The CLI works as is. For the MCP server, run `claude mcp add spawner -- spawner mcp`, or share it with the team in `.mcp.json` at the root of the project, which VS Code reads too:

```json
{
  "mcpServers": {
    "spawner": { "type": "stdio", "command": "spawner", "args": ["mcp"] }
  }
}
```

Claude Code asks before it first uses the servers of a project's `.mcp.json`. Permission rules in `.claude/settings.json` let the agent work without asking each time, and still ask before deleting an environment or handling tokens:

```json
{
  "permissions": {
    "allow": ["Bash(spawner *)", "mcp__spawner__*"],
    "ask": [
      "Bash(spawner down *)",
      "Bash(spawner token *)",
      "mcp__spawner__spawner_down"
    ]
  }
}
```

An `ask` rule wins over an `allow` rule. Remove the two `down` rules to let the agent delete its environments once the work is validated, as its instructions say; add `mcp__spawner__spawner_exec` to confirm each command it runs over MCP.

These rules are a convenience, not a security boundary: a Bash rule matches the command as the agent writes it, so `spawner --json down feat-login` escapes the `ask` rule above. What bounds an agent is its token: its scopes, its project and its expiry ([below](#what-an-agent-cannot-do)).

### Codex

Codex reads `AGENTS.md`. `codex mcp add spawner -- spawner mcp` adds the MCP server to `~/.codex/config.toml`, where its tool timeout needs raising: `spawner_up` waits up to 20 minutes for a build (`timeout_sec`, 1200 seconds by default), and Codex gives up on a tool call after 60 seconds unless told otherwise.

```toml
[mcp_servers.spawner]
command = "spawner"
args = ["mcp"]
tool_timeout_sec = 1500
```

Codex passes MCP servers only a few environment variables, `HOME` and `PATH` among them. An agent that uses `SPAWNER_URL` and `SPAWNER_TOKEN` rather than a login needs `env_vars = ["SPAWNER_URL", "SPAWNER_TOKEN"]` in that table, plus `SPAWNER_CONFIG_DIR` or `XDG_CONFIG_HOME` if you set them.

For the CLI, mind the sandbox: in Codex's default sandbox mode, `workspace-write`, the commands it runs have no network, so `spawner` cannot reach the server. Allow it in the same file:

```toml
[sandbox_workspace_write]
network_access = true
```

### Cursor

Cursor reads `AGENTS.md`. The MCP server goes to `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "spawner": { "type": "stdio", "command": "spawner", "args": ["mcp"] }
  }
}
```

Cursor asks before it uses an MCP tool, unless you allow it.

### VS Code with GitHub Copilot

Copilot reads `AGENTS.md` (the `chat.useAgentsMdFile` setting turns it on or off). VS Code reads the MCP servers of `.mcp.json` at the root of the project: the file of the [Claude Code](#claude-code) section serves both. VS Code's own `.vscode/mcp.json` works too, with the same server under a top-level `servers` object instead of `mcpServers`.

### Gemini CLI

Gemini CLI reads `GEMINI.md` unless told otherwise, and stops waiting for an MCP tool after 10 minutes, half of what `spawner_up` may wait. In `.gemini/settings.json`:

```json
{
  "context": { "fileName": ["AGENTS.md", "GEMINI.md"] },
  "mcpServers": {
    "spawner": { "command": "spawner", "args": ["mcp"], "timeout": 1500000 }
  }
}
```

`timeout` is in milliseconds. Gemini CLI keeps the variables whose names look like secrets, such as `SPAWNER_TOKEN`, from the servers it starts: an agent that uses one names it in the server's `env`, as `"env": { "SPAWNER_URL": "$SPAWNER_URL", "SPAWNER_TOKEN": "$SPAWNER_TOKEN" }`.

### Devin Desktop (formerly Windsurf)

Devin Desktop reads `AGENTS.md`. Its MCP servers are set for the user, in `~/.config/devin/mcp_config.json` (`%APPDATA%\devin\mcp_config.json` on Windows):

```json
{ "mcpServers": { "spawner": { "command": "spawner", "args": ["mcp"] } } }
```

### Other agents

Any agent that runs shell commands can use the CLI; any MCP client can start `spawner mcp` over stdio. The working directory decides the project and the branch, so start the agent in its worktree, or pass `-C <dir>` to the CLI. Over MCP, tools work in the first root the client shares, else in the directory the server started in: a client that starts servers outside the project, or shares no root, gives each tool the worktree as `path`.

### Windows

On Windows, an agent started in a worktree looks for `spawner`, and the `node` it runs, in that worktree before the `PATH`, where a branch could commit a `spawner.cmd`. Give the MCP client absolute paths instead (`npm root -g` prints the directory holding `spawner-cli`):

```json
{
  "mcpServers": {
    "spawner": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\Users\\ada\\AppData\\Roaming\\npm\\node_modules\\spawner-cli\\spawner.cjs",
        "mcp"
      ]
    }
  }
}
```

Set `NoDefaultCurrentDirectoryInExePath=1` in the user's environment as well. The CLI itself runs `git` and the browser by their absolute paths.

## Several agents at once

Give each agent its own git worktree and branch: each gets its own environment, named after the branch, with its own database. Two agents that deploy at the same time never share a working copy on the server, and their builds queue when the server is busy. When the front lives in another repository, `spawner up --source front=../front-feat-login` sends that worktree too; an admin lists that repository among the project's source repositories first.

The quota (5 environments per person by default) counts the environments of all the agents of a person, sleeping ones included: `spawner ls --all --mine` lists them, and the instructions ask agents to delete their environment once the work is validated. Environments nobody uses go to sleep, then expire.

## What an agent cannot do

An agent acts with its token's rights, as its owner would: it can create, change and delete its owner's environments, and run commands in them. It cannot reach the server itself: compose files are checked against a [policy](security.md#the-compose-policy) (no host mounts, no privileged containers, no host network), and an environment does not reach the networks of the others. Give agents tokens restricted to a project and with an expiry, and revoke them on the **Account and tokens** page when they are no longer needed.
