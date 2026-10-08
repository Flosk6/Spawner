# Coding agents

A coding agent that changes an application needs to run it: open the page it changed, call the API, look at the database, read the error. Spawner gives each agent a real environment of its branch, from its own worktree, with uncommitted changes, and the commands to work with it. Agents use the same `spawner` CLI as people, or its MCP server.

## What an agent does

```bash
spawner up --wait --json                              # the environment of the current branch, from this worktree
spawner url --with-token --json                       # the URL and the header that opens it
curl -H "X-Spawner-Preview: $TOKEN" https://feat-login--blog.preview.example.com/api/users
spawner exec feat-login db -- psql -U app -c "select count(*) from users"
spawner logs feat-login api --errors                  # only the error lines, a stack trace kept whole
spawner status feat-login --json                      # restarts, out-of-memory kills, failing healthchecks
spawner share feat-login                              # a link for a reviewer without an account
spawner down feat-login
```

Every command prints JSON with `--json`, and exits with a code the agent can act on: 4 when the environment failed (the end of the build log is on stderr), 6 when the quota or the server's capacity is reached, 7 when `.spawner/` was refused (with the list of issues). See [the CLI](cli.md) for the outputs.

## Setting an agent up

1. **Install the CLI** on the machine the agent runs on (Node.js 20 or later): `npm install -g spawner-cli`, or the copy every server serves at `/api/v1/cli/spawner`.
2. **Log in**: `spawner login https://spawner.preview.example.com`, then type the code it shows in the dashboard and approve the login. The CLI stores a personal token named after the machine. An agent running elsewhere (a container, CI, a cloud agent) gets a token of its own instead, given as environment variables:

   ```bash
   spawner token create --name claude --project blog --expires 30d   # shown once
   export SPAWNER_URL=https://spawner.preview.example.com SPAWNER_TOKEN=spn_...
   ```

   Environments it creates show its name ("Ada via claude"). A token restricted to a project cannot touch the others; without `envs:exec` (`--scopes envs:read,envs:write,preview`) it cannot run commands.
3. **Tell it how**: when it creates `.spawner/`, `spawner init` offers to add a short section to `CLAUDE.md` or `AGENTS.md` that tells the agent when and how to use Spawner. Commit it with the rest: every agent working on the repository reads it. For a project set up by hand, copy the section from [the CLI docs](cli.md#instructions-for-coding-agents).
4. **Optionally, the MCP server**, for agents that prefer tools to commands: `spawner mcp`, configured as below. It offers the same operations (`spawner_up`, `spawner_status`, `spawner_logs`, `spawner_exec`, `spawner_url`, `spawner_share`, `spawner_down`...), with the same credentials.

### Claude Code

The CLI works as is: allow it in `.claude/settings.json` so the agent does not ask each time.

```json
{ "permissions": { "allow": ["Bash(spawner *)"] } }
```

For the MCP server, `claude mcp add spawner -- spawner mcp`, or in `.mcp.json` at the root of the project:

```json
{ "mcpServers": { "spawner": { "command": "spawner", "args": ["mcp"] } } }
```

Instructions go to `CLAUDE.md`.

### Codex

Codex reads `AGENTS.md`, where `spawner init` puts the instructions. The MCP server goes to `~/.codex/config.toml`:

```toml
[mcp_servers.spawner]
command = "spawner"
args = ["mcp"]
```

In a sandbox without network access, Codex cannot reach the server: allow the network for the commands that call `spawner`.

### Cursor

Cursor reads `AGENTS.md` too. The MCP server goes to `.cursor/mcp.json`:

```json
{ "mcpServers": { "spawner": { "command": "spawner", "args": ["mcp"] } } }
```

### Other agents

Any agent that runs shell commands can use the CLI; any MCP client can use `spawner mcp` over stdio. The working directory decides the project and the branch, so start the agent in its worktree, or pass `-C <dir>` (CLI) or `path` (MCP).

## Several agents at once

Give each agent its own git worktree and branch: each gets its own environment, named after the branch, with its own database. Two agents that deploy at the same time never share a working copy on the server, and their builds queue when the server is busy. When the front lives in another repository, `spawner up --source front=../front-feat-login` sends that worktree too.

The quota (5 environments per person by default) counts the environments of all the agents of a person: `spawner ls --mine` lists them, and the instructions ask agents to delete their environment once the work is validated. Environments nobody uses go to sleep, then expire.

## What an agent cannot do

An agent acts with its token's rights, as its owner would: it can create, change and delete its owner's environments, and run commands in them. It cannot reach the server itself: compose files are checked against a [policy](security.md#the-compose-policy) (no host mounts, no privileged containers, no host network), and environments only see their own network. Give agents tokens restricted to a project and with an expiry, and revoke them from the account page when they are no longer needed.
