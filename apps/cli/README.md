# spawner-cli

The command line and MCP server of [Spawner](https://github.com/Flosk6/Spawner): preview environments for every branch, on your own server. Developers and coding agents create, update and delete environments from a worktree (uncommitted changes included), run commands in them and read their logs.

```bash
npm install -g spawner-cli
spawner login https://spawner.preview.example.com   # approve the code in the dashboard
cd my-project && spawner init                        # .spawner/, and the instructions for coding agents
spawner up --wait                                    # the environment of the current branch
spawner exec feat-login db -- psql -U app -c "select count(*) from users"
spawner logs feat-login api --errors
spawner share feat-login                             # a link for someone without an account
spawner down feat-login
```

Every command has a `--json` output and stable exit codes. For agents that prefer tools, `spawner mcp` is an MCP server with the same operations:

```json
{ "mcpServers": { "spawner": { "command": "spawner", "args": ["mcp"] } } }
```

It needs Node.js 20 or later, and a Spawner server: [install one](https://github.com/Flosk6/Spawner/blob/master/docs/install.md) with a single command. Every server also serves its own CLI at `/api/v1/cli/spawner`.

Commands, JSON outputs and exit codes: [docs/cli.md](https://github.com/Flosk6/Spawner/blob/master/docs/cli.md).

License: AGPL-3.0.
