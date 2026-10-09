# Changelog

## Unreleased

- **Smaller hardening**:
  - Previews: a cookie a preview sets under the name of Spawner's no longer locks its visitors out; share links opened on public URLs never reach the application; the waiting page of a public URL no longer says why its environment failed; logging out takes the preview cookie off the browser; the cache of preview hosts is bounded.
  - The dashboard's page has a Content-Security-Policy that runs its own scripts only; every answer carries `Referrer-Policy`, and over HTTPS `Strict-Transport-Security`.
  - Accounts: passkeys must verify their user (a PIN, a fingerprint); names are unique, whatever their case; renames and linked GitHub accounts are audited, and every audit event records the address of its request; the CLI approval page says when and from where the login started. Removing someone from the GitHub organization does not deactivate them in Spawner: do it on the Team page.
  - Compose: an environment has 4 CPUs and 4096 processes to share between its services (`SPAWNER_ENV_CPUS`, `SPAWNER_ENV_PIDS`), as it has its memory, and no service gets raw sockets (`NET_RAW`). A file asking more CPUs or processes than that is refused.
  - Uploads: links are followed through the links they lead to once extracted.
  - CLI: `spawner login` opens http and https URLs only; untracked `.env-*`, `.npmrc`, private keys and `*.pem` files stay home like `.env` files; a Dockerfile is read only when it is a regular file of 1 MiB at most; the MCP server fences what comes from the environment and tells the model to read it as data.
- **A harder installation**:
  - The installer no longer makes a token of the installation with every scope (`SPAWNER_BOOTSTRAP_TOKEN`) unless given one; installations that have one keep it until you empty its line in `.env`.
  - It refuses a version older than the installed one (its database only migrates forward; `--allow-downgrade` after restoring a backup), a data directory other than the installation's, and system directories; it never makes new secrets over an installation that lost them, never upgrades without a backup (it starts Postgres for it), writes `.env` and `dns.env` in one move, keeps a trailing `=` of their values, and no longer shows the DNS credentials typed.
  - The data directory is mode 700, rendered compose files and logs are readable by Spawner only, Traefik runs without capabilities but binding ports, Postgres and Traefik have memory limits, Spawner's code belongs to root, and Prisma's telemetry is off. A local install over HTTP warns that it serves every interface; the development stack listens on 127.0.0.1.
  - git reaches GitHub, GitLab and Bitbucket with the host keys they publish, even the first time.
- **Source repositories are chosen by admins**: the other sources of `spawner.yaml` must come from repositories listed in the project (Projects, Edit, "Source repositories"); `spawner up` refuses the others before sending anything. A branch could otherwise make Spawner clone any repository its deploy keys reach, or an address of the internal network. The upgrade lists for each project the repositories its live environments already use.
- **Terminals and log streams close when their access goes**: deactivating a user, changing their role or revoking a token now closes the terminals and the streams of logs they had open, at once, and an expired token's within 30 seconds.
- **Uploads stop at their first limit**: an archive is read as a stream that stops at the first file, byte or decompressed byte over the limits, so that a compression bomb costs no more than a legitimate archive; a person has 5 deploys of uploaded code waiting to start at most.
- **Environments no longer reach the cloud's metadata or the server's services**: the code of a branch could read the credentials of the server from the metadata service of its cloud (AWS, GCP, Azure, Hetzner, OVH...), or call a service listening on the server. A new `spawner-firewall` container loads rules for every container of Docker's bridge networks: the metadata addresses are refused, but for DNS, and the server answers on DNS, HTTP and HTTPS only. The installer also has Docker load them before it starts, so that they hold from boot on: after an update from the dashboard, run `install.sh --upgrade` once on the server for that part.
- **What you download can be verified**: the images, `install.sh` and the CLI bundle of a release carry build provenance attestations (`gh attestation verify install.sh -R Flosk6/Spawner`). The `install.sh` of a release names the digest of its image, and updates from the dashboard read it there: both run the image the release built, whatever its tag points to later. Postgres and Traefik are pinned by digest.

## 2.1.0

A new dashboard, and patched dependencies.

- **A new dashboard**: a sidebar with breadcrumbs, dense tables, one status badge everywhere, environment pages with their services as cards (memory of each), a lifecycle card, and jobs that show the phase they are at or failed in. Search everything with Ctrl+K (Cmd+K on a Mac). Every page works on a phone.
- **Light and dark themes that hold**, or the system's: the dark theme no longer has buttons, menus and banners you could not read, and the page no longer flashes light before it turns dark. The waiting page of sleeping environments follows the same colors.
- The dashboard loads no font from another site any more: they are bundled.
- **Patched dependencies**: the packages Dependabot flagged, among them protobufjs (code execution, through dockerode) and proxy-addr (IP spoofing through trusted subnets, used by Express).

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
