# Security

Spawner runs code from branches nobody has reviewed yet, written by people and by coding agents. This page says what it protects, how, and what it leaves to you.

## Trust model

- **Trusted**: admins and members of the team. They run code on the server: that is what the tool is for.
- **Contained**: the code of the branches, the compose files, and the agents, which can make mistakes or follow instructions planted in what they read (prompt injection).
- **Protected**: the host (no root access from an environment), Spawner itself (its database, its secrets, the Docker socket), the other environments, and the accounts of the team.

The server is **dedicated to previews**: never run production, or anything holding sensitive data, on the same machine. Give previews test data only.

## The compose policy

A compose file can do almost anything to the host it runs on: mount `/`, run privileged containers, join the host network. Spawner reads each file, fills in its variables, and checks the result against an allowlist before Docker sees it. A refused file stops the deploy before any action, with the path of each issue and a hint, and the refusal is audited.

| | Allowed | Refused | Set by Spawner |
|---|---|---|---|
| Services | `image`, `build`, `command`, `entrypoint`, `environment`, `env_file`, `depends_on`, `healthcheck`, `working_dir`, `user`, `expose`, `volumes`, `tmpfs`, `read_only`, `init`, `labels`, `hostname`, `extra_hosts`, `platform`, `pull_policy`, `tty`, `stdin_open`, `stop_signal`, `stop_grace_period`, `cap_drop`, `shm_size` (1 GiB at most), `mem_limit`, `cpus`, `deploy.resources.limits` (within the limits) | `privileged`, `cap_add`, `devices`, `gpus`, `network_mode`, `pid`, `ipc`, `uts`, `userns_mode`, `cgroup_parent`, `runtime`, `sysctls`, `security_opt`, `ports`, `container_name`, `volumes_from`, `external_links`, `profiles`, `extends`, lifecycle hooks | `restart`, `logging`, memory, CPU and process limits, `no-new-privileges` |
| Builds | `context` and `dockerfile` inside a source, `args`, `target`, `platform` | `network`, `ssh`, `secrets`, `privileged`, `entitlements`, `additional_contexts` | labels |
| Volumes | named volumes declared in the file, `tmpfs`, files mounted from a source | host paths outside the sources, `name`, `external`, `driver`, `driver_opts` | the project prefix |
| Networks | networks declared in the file | `external`, `name`, `ipv4_address`, custom drivers, `enable_ipv6: true` | Traefik's attachment |
| Files | `env_file` inside a source | any path outside the sources, symbolic links leaving them | |
| Top level | `services`, `volumes`, `networks`, `x-*` | `include`, `secrets`, `configs`, `models` | `name` |
| Labels | anything else | `traefik.*`, `com.docker.*`, `dev.spawner.*` | `dev.spawner.*` |

Paths are resolved (`realpath`) against the sources of the environment, after interpolation: a symbolic link in a branch cannot point a mount at the host. Variables come from Spawner only (`${SPAWNER_URL}`, `${SPAWNER_SRC_API}`...) and from the project's variables; any other `${...}` is an error, so Spawner's own environment, which holds its secrets, never reaches a compose file. The test suite holds a [refused file](../packages/core/test/fixtures/compose/forbidden) for each known way around these rules: a volume named after Spawner's database, a `bind` driver option on `/`, an external network, `env_file: /proc/self/environ`, a symbolic link to `/` in an upload, among others.

Service names, network aliases and hostnames are the names Docker's DNS answers for on an environment's network, which Traefik shares. They must be single lowercase DNS labels without dots, so that none can pass for a name qualified by a network such as `spawner.spawner-core`, and names starting with `spawner` or `spn-` are reserved.

## Isolation

- **One network per environment.** Services of an environment reach each other by name; other environments and Spawner's own containers are not on their network.
- **Traefik has no Docker socket.** It reads its routes from files Spawner writes, and joins each environment's network to reach its exposed services only.
- **Traefik never follows a bare name.** It reaches Spawner as `spawner.spawner-core` and each exposed service by its name qualified by its environment's network (`<service>.spn-<project>--<env>_default`), and joins environment networks with a lower priority than Spawner's own: Docker's DNS answers a bare name from the first network that knows it, so an environment could otherwise receive the dashboard's traffic or another environment's.
- **Every container** gets `no-new-privileges`, a memory limit (512 MiB per service by default, 2 GiB per environment), a CPU limit, a process limit (512), a restart policy, and compressed logs with a cap.
- **The Spawner container** has a memory limit (1 GiB by default, `install.sh --memory-limit`): if the API runs out of memory, it restarts without taking the server down.
- **Uploads** are checked entry by entry before extraction: no absolute paths, no `..`, no links leaving the archive, no devices or hard links, and limits on size and file count. The check reads the archive as a stream and stops at the first limit crossed, the decompressed size included, so a compression bomb costs no more than a legitimate archive. A person has 5 deploys of uploaded code waiting to start at most, since each keeps its archives on disk until it runs.
- **Git** runs without a shell, with a minimal environment, no system configuration, `ssh` and `https` only, SSH in batch mode against a known_hosts file, the repository URL after `--`, and validated refs. Deploy keys are read-only and per repository.
- **External programs** (git, docker compose) run with argument arrays, never through a shell.
- **Logs** of services are served as `text/plain` with `nosniff`.

## Access

- **No passwords.** Accounts start from a one-use invitation link (24 hours), then log in with passkeys (WebAuthn). GitHub login is optional, restricted to an organization and a team when they are set, and checked at every login.
- **Sessions** last 24 hours, in a `__Host-` cookie over HTTPS, so previews (on subdomains) can neither read nor overwrite it.
- **CSRF**: every change made without a token must carry an `X-Spawner-Client` header, which a page on another origin cannot send without a CORS preflight that only the dashboard's origin passes.
- **Framing**: no page or answer of Spawner can be shown in a frame (`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`). Previews share the dashboard's site, so a branch could otherwise frame the dashboard with a visitor's session and steer a click. Role changes and reactivations on the Team page ask for confirmation.
- **Rate limits** per user (per address without one), tighter on the login routes.
- **Personal tokens** (`spn_<prefix>_<secret>`) are shown once; Spawner stores their SHA-256 only. They carry scopes (never more than their owner's role: a demoted admin's tokens lose `admin` at once), an expiry (90 days by default) and optionally a project, and can be revoked. A token restricted to a project never has the `admin` scope, which reaches the whole installation. A token created with another token depends on it: it expires with it at the latest, and is revoked with it. The CLI receives its token through a device code its user types and approves in the dashboard (the page never takes the code from a link), and stores it readable by its owner only.
- **Roles**: members act on their own environments only (create, update, share, delete, run commands, open terminals); they read the others. Projects, the team, settings, deploy keys and the audit trail are for admins.
- **Terminals** open with a one-time ticket (30 seconds) that keeps the scopes of who asked for it, check the dashboard's origin, close after 15 minutes without input or 4 hours, and are recorded for the admins (30 days).
- **Open connections lose access with their owner.** A terminal or a stream of logs reads its user and token again when that user is deactivated or gets another role, when one of their tokens is revoked, and every 30 seconds for expiries: it closes as soon as they would no longer open it. Their Socket.IO server opens a WebSocket only for a valid ticket (no long-polling), takes messages of 64 KiB at most, and serves nothing but `/terminal`.
- **The CLI** runs `git` and the browser opener by their absolute paths, found in the absolute directories of the `PATH`: never from the worktree a branch checked out, where Windows would look first (and every platform for relative `PATH` entries). On Windows it also sets `NoDefaultCurrentDirectoryInExePath` for the programs it starts. Give MCP clients on Windows absolute paths too (see [agents](agents.md)).
- **Audit**: logins, invitations, tokens, device approvals, passkeys, projects, environment actions, commands (truncated), terminals, refused compose files and settings changes, kept 90 days.

## Protected previews

Before each request to a protected URL (`auth: team`, the default), Traefik asks Spawner, sending only the `Accept`, `Cookie`, `X-Spawner-Preview`, `Origin` and `Access-Control-Request-Method` headers. Spawner lets the request through for:

1. CORS preflights (`OPTIONS` with `Origin` and `Access-Control-Request-Method`), which browsers send without credentials; they neither count as activity nor wake a sleeping environment;
2. an `X-Spawner-Preview` header: a token valid one hour for one environment, for agents and scripts; Traefik removes it before the request reaches the application;
3. a share link (`?__spawner_share=`), answered by a redirect that sets a cookie valid for that environment only, and checked against its link at every request: revoking the link closes it to whoever opened it;
4. the team's preview cookie (12 hours), set on the preview domain by the dashboard for an active member;
5. a share cookie.

Otherwise a browser goes to the login page and other clients get a 401. Public URLs (`auth: none`) skip the access check; an admin allows them per project.

**Spawner's cookies never reach an application.** The team's preview cookie and the share cookies are set on the whole preview domain, so browsers send them to every preview. For every request, public URLs included, Spawner answers Traefik with the request's cookies minus its own, and Traefik passes the request on with those: the code of a branch cannot read, then replay, what opens the other previews. The preview token header is removed the same way.

Previews still share the preview domain with each other and with the dashboard: an application can set a cookie for the whole domain, which the other previews then receive. Spawner's own cookies are signed, and its session cookie (`__Host-`) is bound to the dashboard. Use a domain dedicated to previews rather than a subdomain of your company's main domain, so that previews never see the cookies of your other sites.

## Secrets

- **The master secret** (`SPAWNER_SECRET`, in `/opt/spawner/.env`, mode 600) derives the keys that sign tokens, encrypt settings and sign sessions. Keep a copy: without it, the encrypted settings and the secret project variables cannot be read back after a restore.
- **Project variables** marked secret are encrypted at rest, never shown again, and masked in job logs. They still reach the containers as environment variables: anyone who may run commands in an environment can read them. Give previews test credentials only.
- **DNS credentials** (`/opt/spawner/dns.env`, mode 600) go to Traefik alone.
- **The Docker socket** is mounted into Spawner: whoever controls Spawner controls the host. That is why the API checks every request, compose files go through the policy, and the server must be dedicated to previews.

## Updates

Every 6 hours, Spawner reads the list of releases from GitHub (`api.github.com`, nothing sent but the request); `SPAWNER_UPDATE_CHECK=false` stops it. An update from the dashboard needs an admin, and installs only the newest release of that list, from the repository of the image Spawner already runs. Spawner uses the Docker socket it already holds to start the installer of the new version in a short-lived container, as root, with the installation directory and the data directory: the same power the installer has when you run it. Each update is in the audit trail, with how it ended.

## What Spawner does not do (yet)

- **Outbound traffic** from environments is not filtered: a branch can call any address on the internet. Do not put previews on a network that reaches private services.
- **User namespaces** (`userns-remap`) are not set: a process running as root in a container is root on the host's kernel, held back by the namespaces, `no-new-privileges` and the absence of capabilities and devices. Keep Docker and the kernel up to date (enable `unattended-upgrades` on Ubuntu).
- **Members see every environment's logs**: do not log secrets.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub ([Report a vulnerability](https://github.com/Flosk6/Spawner/security/advisories/new), in the Security tab), never in a public issue. The [security policy](../SECURITY.md) says what to include and what is in scope.
