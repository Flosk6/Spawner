# Changelog

## Unreleased

- **A new dashboard**: a sidebar with breadcrumbs, dense tables, one status badge everywhere, environment pages with their services as cards (memory of each), a lifecycle card, and jobs that show the phase they are at or failed in. Search everything with Ctrl+K (Cmd+K on a Mac).
- **Light and dark themes that hold**, or the system's: the dark theme no longer has buttons, menus and banners you could not read, and the page no longer flashes light before it turns dark. The waiting page of sleeping environments follows the same colors.
- The dashboard loads no font from another site any more: they are bundled.

## 2.0.0

A rewrite of Spawner: preview environments for every branch, for teams and the coding agents working for them, on a server of your own. Nothing carries over from 1.x: install 2.0 on a fresh server.

- **Environments from Docker Compose**: a project describes its environment in `.spawner/` (a manifest and a compose file), checked against a security policy before anything runs. Environments come from a branch, a tag, a commit, or an uploaded worktree with its uncommitted changes, from one or several repositories.
- **The `spawner` CLI and its MCP server**, for people and coding agents: `up` from a worktree, `exec` in a service, logs with an error filter, URLs with a preview token, share links; `--json` everywhere and stable exit codes. `npm install -g spawner-cli`.
- **Access without passwords**: invitation links and passkeys, optional GitHub login, roles, personal tokens with scopes, a device flow for the CLI. Previews are protected: teammates pass with their session, agents with a short token, guests with a share link, and the applications never see what opens the other previews. Everything goes to an audit trail.
- **Supervision**: CPU and memory of every container over 30 days, disk per environment, a timeline of crashes, out-of-memory kills and jobs, crash loop alerts, logs kept 7 days after a deletion, terminals with limits and recordings.
- **Lifecycle and density**: environments sleep after 2 hours without activity and wake up on the next visit, expire after 72 hours, and count against a quota per person; Spawner refuses an environment the server has no room for, removes replaced images and the code a build no longer needs, and cleans up what deleted environments leave, nothing else.
- **One-command install**: `install.sh` sets up Docker, a wildcard certificate through your DNS provider (or one per host), and the stack from the images on GHCR; it upgrades (with a database backup) and uninstalls too.
- **Updates from the dashboard**: Spawner sees new versions and updates itself in one click, backing its database up first and going back to the previous version if the new one does not start.
- **Examples and documentation**: Node.js with PostgreSQL, and Laravel, Next.js and MySQL; guides for installing, agents, security, operations and density.

Spawner is now licensed under Apache-2.0; the release candidates up to 2.0.0-rc.2 were published under AGPL-3.0.

Upgrading from 2.0.0-rc.1 or rc.2, which have security issues fixed here: run `install.sh --upgrade`, then redeploy or delete the environments created with them. Compose files now need service names, network aliases and hostnames that are lowercase DNS labels without dots, not starting with `spawner` or `spn-`, and no IPv6 network; and the CLI asks for the device code to be typed in the dashboard. Guests who opened a share link before the upgrade open it again.
