# Security

Spawner runs code from branches nobody has reviewed yet, written by people and by coding agents. This page says what it protects, how, and what it leaves to you.

## Trust model

- **Trusted**: admins and members of the team. They run code on the server: that is what the tool is for.
- **Contained**: the code of the branches, the compose files, and the agents, which can make mistakes or follow instructions planted in what they read (prompt injection).
- **Protected**: the host (no root access from an environment), Spawner itself (its database, its secrets, the Docker socket), the other environments, and the accounts of the team.

The server is **dedicated to previews**: never run production, or anything holding sensitive data, on the same machine. Give previews test data only.

## The compose policy

A compose file can do almost anything to the host it runs on: mount `/`, run privileged containers, join the host network. Spawner reads each file, fills in its variables, and checks the result against an allowlist before Docker sees it: a key the policy does not list is refused, including keys that later versions of Compose add. A refused file stops the deploy before any action, with the path of each issue and a hint, and the refusal is audited.

The policy keeps a compose file from reaching the host through Docker. It does not review the code that runs in the containers: that code is held back by the [isolation](#isolation) below, and nothing more.

### Services

- **Allowed**: `image`, `build`, `command`, `entrypoint`, `environment`, `env_file`, `depends_on` (with `condition`, `restart`, `required`), `healthcheck` (`test`, `interval`, `timeout`, `retries`, `start_period`, `start_interval`, `disable`), `working_dir`, `user`, `expose`, `volumes`, `tmpfs`, `read_only`, `init`, `labels`, `hostname`, `domainname`, `extra_hosts`, `platform`, `pull_policy`, `tty`, `stdin_open`, `stop_signal`, `stop_grace_period`, `cap_drop`, `shm_size`, `mem_limit`, `mem_reservation`, `memswap_limit`, `cpus`, `pids_limit`, `deploy.resources` (`limits`: `cpus`, `memory`, `pids`; `reservations`: `cpus`, `memory`), `deploy.replicas: 1`, `networks` (with `aliases` only), `links`, `develop` (ignored), and `x-*` extension fields.
- **Refused**: `privileged`, `cap_add`, `devices`, `device_cgroup_rules`, `gpus`, `network_mode`, `pid`, `ipc`, `uts`, `userns_mode`, `cgroup`, `cgroup_parent`, `runtime`, `isolation`, `sysctls`, `security_opt`, `ports`, `container_name`, `volumes_from`, `external_links`, `profiles`, `extends`, lifecycle hooks (`post_start`, `pre_stop`), `oom_kill_disable`, `oom_score_adj`, `ulimits`, `secrets`, `configs`, `label_file`, `use_api_socket`, `provider`, `scale`, `storage_opt`, `blkio_config`, `mac_address`, `credential_spec`, `annotations`, `models`, the CPU keys other than `cpus` (`cpu_shares`, `cpuset`...), and any other key under `deploy` (`restart_policy`, `placement`...).
- **Set by Spawner**: `mem_limit`, `cpus` and `pids_limit` ([limits](#limits)), `security_opt: [no-new-privileges:true]`, `cap_drop: [NET_RAW]` (added to the file's own), `restart: unless-stopped`, `logging` (Docker's `local` driver, 3 files of 10 MB), and its `dev.spawner.*` labels. A `restart` or `logging` in the file is replaced.

### Builds

- **Allowed**: `context` and `dockerfile` inside a source, `dockerfile_inline`, `args`, `target`, `extra_hosts`, `pull`, `no_cache`, `labels`.
- **Refused**: remote contexts (a URL, `git@...`), `network`, `ssh`, `secrets`, `privileged`, `entitlements`, `additional_contexts`, `tags`, `platform` and `platforms` (a service may still set `platform`), `cache_from`, `cache_to`, `shm_size`, `isolation`, `ulimits`, `provenance`, `sbom`.
- **Set by Spawner**: its labels.

### Volumes

- **Allowed**: named volumes declared at the top level (with `labels`), anonymous volumes, `tmpfs`, files and directories mounted from a source (`./config:/etc/app:ro`), and the long syntax with `type: volume` (`nocopy`, `subpath`), `type: bind` (inside a source) or `type: tmpfs` (`size`, `mode`).
- **Refused**: host paths outside the sources, `~`, bind propagation, other mount types (`npipe`, `cluster`, `image`), and at the top level `name`, `external`, `driver`, `driver_opts`.
- **Set by Spawner**: the environment's prefix on volume names, and labels.

### Networks

- **Allowed**: networks declared at the top level, with `labels`, `internal`, `driver: bridge` and `enable_ipv6: false`; for a service, a list of them, or a mapping with `aliases`.
- **Refused**: `external`, `name`, another `driver`, `driver_opts`, `ipam`, `attachable`, `enable_ipv6: true`, and service options other than `aliases` (`ipv4_address`...).
- **Set by Spawner**: labels, and Traefik's attachment to the `default` network.

### Top level and labels

- **Allowed**: `services`, `volumes`, `networks` and `x-*` extension fields (YAML anchors and merge keys work); `name` and `version` are ignored. Labels may hold anything, except the reserved ones below.
- **Refused**: `include`, `secrets`, `configs`, `models`; labels starting with `traefik.`, `com.docker.` or `dev.spawner.`.
- **Set by Spawner**: the Compose project name, `spn-<project>--<env>`, and the `dev.spawner.*` labels it finds its containers, images, volumes and networks by.

### Limits

| What | Limit |
|---|---|
| Services in a file | 30 |
| CPUs of an environment | 4, shared by its services as its memory is (`SPAWNER_ENV_CPUS`) |
| CPUs of a service (`cpus`, or `deploy.resources.limits.cpus`) | 2; without one, its share of what the others leave, 1 at most |
| Processes of an environment | 4096, shared the same way (`SPAWNER_ENV_PIDS`) |
| Processes of a service (`pids_limit`, or `deploy.resources.limits.pids`) | 2048; without one, its share of what the others leave, 512 at most |
| Memory of the services | The environment's memory, shared as [memory limits](manifest.md#memory-limits) explains: 2 GiB by default, 4 GiB at most by default |
| `shm_size` | 1 GiB |
| `stop_grace_period` | 60 seconds |
| The compose file | 1 MiB, 100 YAML aliases |
| `spawner.yaml` | 64 KiB, 50 YAML aliases |

Admins change the memory of an environment and its maximum on the **Settings** page; the CPUs and processes of an environment come from the server's `SPAWNER_ENV_CPUS` and `SPAWNER_ENV_PIDS` ([configuration](configuration.md#lifecycle-and-limits)); the other limits are fixed.

### Paths, variables and names

Build contexts, Dockerfiles, `env_file` entries and mounted files must stay inside the sources of the environment. Paths are resolved (`realpath`) against those sources, after interpolation: a symbolic link in a branch cannot point a mount at the host. Variables come from Spawner only (`${SPAWNER_URL}`, `${SPAWNER_SRC_API}`...) and from the project's variables; any other variable without a default is an error, so Spawner's own environment, which holds its secrets, never reaches a compose file. The test suite holds a [refused file](../packages/core/test/fixtures/compose/forbidden) for each known way around these rules: a volume named after Spawner's database, a `bind` driver option on `/`, an external network, `env_file: /proc/self/environ`, a symbolic link to `/` in an upload, among others.

Service names, network aliases and hostnames are the names Docker's DNS answers for on an environment's network, which Traefik shares. They must be single lowercase DNS labels without dots, so that none can pass for a name qualified by a network such as `spawner.spawner-core`, and names starting with `spawner` or `spn-` are reserved.

## Isolation

- **One network per environment.** Services of an environment reach each other by name; other environments and Spawner's own containers are not on their network.
- **Traefik has no Docker socket.** It reads its routes from files Spawner writes, and joins each environment's network to reach its exposed services only.
- **Traefik never follows a bare name.** It reaches Spawner as `spawner.spawner-core` and each exposed service by its name qualified by its environment's network (`<service>.spn-<project>--<env>_default`), and joins environment networks with a lower priority than Spawner's own: Docker's DNS answers a bare name from the first network that knows it, so an environment could otherwise receive the dashboard's traffic or another environment's.
- **The cloud and the host are out of reach.** The containers of Docker's bridge networks (the environments, their builds, Spawner's own stack) are refused the metadata services of the clouds (`169.254.0.0/16`, Azure's `168.63.129.16`, Alibaba's `100.100.100.200`), where a branch would read the server's cloud credentials, except DNS, which some clouds answer there. Of the host itself, they reach DNS, HTTP and HTTPS only: not SSH, nor the other services listening on it. The rules (`firewall.nft`, a table `inet spawner` that Docker, ufw and firewalld leave alone) are loaded by the `spawner-firewall` container, again every minute, and by Docker before it starts any container.
- **Every container** gets `no-new-privileges`, no raw sockets (`NET_RAW` dropped: no forged packets on the environment's network), a memory, a CPU and a process limit (its share of its environment's: [limits](#limits)), a restart policy, and compressed logs with a cap. A `tmpfs` counts against the memory of its service, as the kernel charges it there.
- **The Spawner container** has a memory limit (1 GiB by default, the installer's `--memory-limit`): if the API runs out of memory, it restarts without taking the server down.
- **Uploads** are checked entry by entry before extraction: no absolute paths, no `..`, no links leaving the archive, no devices or hard links, and limits on size and file count. Once extracted, every link is followed through the links it leads to, as the kernel would: a chain of links that each stay inside cannot leave either. The check reads the archive as a stream and stops at the first limit crossed, the decompressed size included, so a compression bomb costs no more than a legitimate archive. A person has 5 deploys of uploaded code waiting to start at most, since each keeps its archives on disk until it runs.
- **Git** runs without a shell, with a minimal environment, no system configuration, `ssh` and `https` only, SSH in batch mode, the repository URL after `--`, and validated refs. GitHub, GitLab and Bitbucket are reached with the host keys they publish, shipped with Spawner, even the first time; other hosts are trusted on first use, then pinned. Deploy keys are read-only and per repository.
- **Repositories are chosen by admins.** A branch names its other sources in `spawner.yaml`, but Spawner clones, or lists the branches of, only the project's repository and the source repositories an admin listed for it: a branch cannot point Spawner, and the global deploy key, at another repository or at an address of the internal network.
- **External programs** (git, docker compose) run with argument arrays, never through a shell.
- **Logs** of services are served as `text/plain` with `nosniff`.

## Access

- **No passwords.** Accounts log in with passkeys (WebAuthn) that verify their user (a PIN, a fingerprint, a face: a security key without one is refused), or with GitHub once an admin has set it up ([GitHub login](#github-login)). An account starts from a one-use invitation link (24 hours by default, a week at most), or from the first GitHub login of a member of the organization that GitHub login is restricted to.
- **Names are unique**, whatever their case, and cannot hold " via " (what the audit trail puts between a user and their token): nobody can pass for someone else on the dashboard or in the audit trail.
- **Sessions** last 24 hours, in a `__Host-` cookie over HTTPS, so previews (on subdomains) can neither read nor overwrite it.
- **CSRF**: every change made without a token must carry an `X-Spawner-Client` header, which a page on another origin cannot send without a CORS preflight that only the dashboard's origin passes.
- **Framing**: no page or answer of Spawner can be shown in a frame (`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`). Previews share the dashboard's site, so a branch could otherwise frame the dashboard with a visitor's session and steer a click. Role changes and reactivations on the Team page ask for confirmation.
- **The dashboard's page** has a Content-Security-Policy that runs its own scripts only (its inline one by its hash) and connects to its own origin only. Every answer carries `Referrer-Policy: same-origin` (the dashboard's URLs name environments, and invitation links carry their token), `nosniff`, and over HTTPS `Strict-Transport-Security` for a year.
- **Rate limits** per user (per address without one), tighter on the login routes.
- **Personal API tokens** (`spn_<prefix>_<secret>`) are shown once; Spawner stores their SHA-256 only. They carry scopes (never more than their owner's role: a demoted admin's tokens lose `admin` at once), an expiry (90 days by default, a year at most) and optionally a project, and can be revoked. A token restricted to a project never has the `admin` scope, which reaches the whole installation. A token created with another token depends on it: it expires with it at the latest, and is revoked with it. The CLI receives its token through a device code its user types and approves in the dashboard (the page never takes the code from a link, and says when and from which address the login started), and stores it readable by its owner only.
- **Roles**: members act on their own environments only (create, update, share, delete, run commands, open terminals); they read the others. Projects, the team, settings, deploy keys (**Git keys**) and the audit trail are for admins. Admins act on other people's environments from the dashboard, or through a token that holds the `admin` scope; the token `spawner login` receives never does.
- **Terminals** open with a one-time ticket (30 seconds) that keeps the scopes of who asked for it, check the dashboard's origin, close after 15 minutes without input or 4 hours, and are recorded for the admins (30 days).
- **Open connections lose access with their owner.** A terminal or a stream of logs reads its user and token again when that user is deactivated or gets another role, when one of their tokens is revoked, and every 30 seconds for expiries: it closes as soon as they would no longer open it. Their Socket.IO server opens a WebSocket only for a valid ticket (no long-polling), takes messages of 64 KiB at most, and serves nothing but `/terminal`.
- **The CLI** runs `git` and the browser opener by their absolute paths, found in the absolute directories of the `PATH`: never from the worktree a branch checked out, where Windows would look first (and every platform for relative `PATH` entries). On Windows it also sets `NoDefaultCurrentDirectoryInExePath` for the programs it starts. Give MCP clients on Windows absolute paths too (see [agents](agents.md#windows)).
- **Audit**: logins, invitations, renames, linked GitHub accounts, tokens, device approvals, passkeys, projects, environment actions, commands (truncated), terminals, refused compose files and settings changes, with the address and the browser or client of the request that caused them, kept 90 days.

### GitHub login

GitHub login is off until an admin sets it up: an OAuth app of the organization, then the **GitHub login** card of the **Settings** page ([operations](operations.md#github-login) goes through it). Who may then log in with GitHub:

- **With an organization**: its members, or the members of its team when one is set. On their first GitHub login they get an account with the member role, without an invitation. Spawner asks GitHub for the `read:org` scope and checks the membership at every login: someone who leaves the organization can no longer log in with GitHub, but keeps their passkeys, and the sessions and tokens already open, until an admin deactivates the account (**Team**), which closes them all at once.
- **Without an organization**: only accounts that linked GitHub themselves (**Account and tokens**, **Link GitHub**). GitHub is then one more way to log in, never a way in.

The client secret is stored encrypted with the master secret.

## Protected previews

Before each request to a protected URL (`auth: team`, the default), Traefik asks Spawner, sending only the `Accept`, `Cookie`, `X-Spawner-Preview`, `Origin` and `Access-Control-Request-Method` headers. Spawner lets the request through for:

1. CORS preflights (`OPTIONS` with `Origin` and `Access-Control-Request-Method`), which browsers send without credentials; they neither count as activity nor wake a sleeping environment;
2. an `X-Spawner-Preview` header: a token valid one hour for one environment, for agents and scripts; Traefik removes it before the request reaches the application;
3. a share link (`?__spawner_share=`), answered by a redirect that sets a cookie valid for that environment only, and checked against its link at every request: revoking the link closes it to whoever opened it;
4. the team's preview cookie (12 hours), set on the preview domain by the dashboard for an active member, and taken off the browser at logout;
5. a share cookie.

Otherwise a browser goes to the login page and other clients get a 401. Every value of a cookie name counts, since a preview can set a cookie named after Spawner's for the whole domain: it cannot lock its visitors out that way. Public URLs (`auth: none`) skip the access check; an admin allows them per project. They do not wake a sleeping environment either, so that nobody outside the team can keep one awake. A share link opened on a public URL is taken off it by a redirect, and the waiting page of a public URL does not say why its environment failed.

**Spawner's cookies never reach an application.** The team's preview cookie and the share cookies are set on the whole preview domain, so browsers send them to every preview. For every request, public URLs included, Spawner answers Traefik with the request's cookies minus its own, and Traefik passes the request on with those: the code of a branch cannot read, then replay, what opens the other previews. The preview token header is removed the same way.

Previews still share the preview domain with each other and with the dashboard: an application can set a cookie for the whole domain, which the other previews then receive. Spawner's own cookies are signed, and its session cookie (`__Host-`) is bound to the dashboard. Use a domain dedicated to previews rather than a subdomain of your company's main domain, so that previews never see the cookies of your other sites.

## Secrets

- **The master secret** (`SPAWNER_SECRET`, in `/opt/spawner/.env`, mode 600) derives the keys that sign tokens, encrypt settings and sign sessions. Keep a copy: without it, the encrypted settings and the secret project variables cannot be read back after a restore. The installer never makes a new one over an installation that lost it: it stops and says so.
- **The data directory** (`/var/lib/spawner`, mode 700) belongs to the user Spawner runs as, uid 1000, which is also the first user of most cloud images (`ubuntu`, `debian`): treat that account as an admin of Spawner. Rendered compose files (with the secret variables), job logs, archived logs and terminal recordings are readable by Spawner only; Traefik's route files hold no secret.
- **No token of the installation by default.** `SPAWNER_BOOTSTRAP_TOKEN` (every scope, no user, no expiry) exists only when given to the installer; scripts use personal tokens.
- **The stack**: Traefik runs without capabilities but binding ports, Spawner cannot change its own code (it belongs to root), Postgres and Traefik have memory limits, and Prisma's telemetry is off.
- **Project variables** marked secret are encrypted at rest, never shown again, and masked in job logs. They reach a container as environment variables when its compose file passes them (`environment:`): anyone who may run commands in that environment can read them. Give previews test credentials only.
- **DNS credentials** (`/opt/spawner/dns.env`, mode 600) go to Traefik alone.
- **The Docker socket** is mounted into Spawner: whoever controls Spawner controls the host. That is why the API checks every request, compose files go through the policy, and the server must be dedicated to previews.

## Updates

Spawner has no telemetry: it sends nothing to its maintainers. The only request it makes on its own is the update check below; every other connection is one you set up or ask for, and Traefik's version check and anonymous statistics are turned off. [The network section of install](install.md#network) lists every connection a server makes.

Every 6 hours, Spawner reads the list of releases from GitHub (`api.github.com`, nothing sent but the request); `SPAWNER_UPDATE_CHECK=false` stops it. An update from the dashboard needs an admin, and installs only the newest release of that list, from the repository of the image Spawner already runs, pinned to the digest the release's `install.sh` names: a tag moved on the registry afterwards changes nothing. Spawner uses the Docker socket it already holds to start the installer of the new version in a short-lived container, as root, with the installation directory and the data directory: the same power the installer has when you run it. Each update is in the audit trail, with how it ended.

## Releases

A release is built by `.github/workflows/release.yml` from a tag on `master`, which only admins can push, after a reviewer approves its `release` environment; actions are pinned by commit and nothing reads a cache another workflow wrote. Its images, `install.sh` and CLI bundle carry build provenance attestations (`gh attestation verify`, see [installing](install.md#verifying-the-installer)), the `install.sh` of a release names the digest of its image, and releases are immutable once published. The CLI goes to npm through trusted publishing, with its provenance (`npm audit signatures`).

## What Spawner does not do (yet)

- **Outbound traffic** from environments is filtered for the cloud's metadata and the host only (above): a branch can call any other address, on the internet and on the private networks the server reaches. Do not put previews on a network that reaches private services.
- **User namespaces** (`userns-remap`) are not set: a process running as root in a container is root on the host's kernel, held back by the namespaces, `no-new-privileges` and the absence of capabilities and devices. Keep Docker and the kernel up to date (enable `unattended-upgrades` on Ubuntu).
- **Permissions per project** do not exist: members see every environment of every project, and its logs. Do not log secrets.
- **Single sign-on** stops at GitHub login: no OIDC or SAML.

The other limits of Spawner, beyond security, are in [concepts](concepts.md#what-spawner-does-not-do).

## Reporting a vulnerability

Report vulnerabilities privately through GitHub ([Report a vulnerability](https://github.com/Flosk6/Spawner/security/advisories/new), in the Security tab), never in a public issue. The [security policy](../SECURITY.md) says what to include and what is in scope.
