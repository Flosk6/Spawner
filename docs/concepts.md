# Concepts

Spawner is an open source, self-hosted preview environment manager: a copy of your app for each git branch, on your own server, with its own URLs, database and logs, for teams and their coding agents. Such copies are also called preview environments, ephemeral environments, review apps or per-branch environments; these docs say **environment**, or **preview** for short.

This page describes the pieces. [Install](install.md) sets a server up, [the quickstart](quickstart.md) deploys a first project, [the manifest](manifest.md) describes a project, [the CLI](cli.md) drives it.

```text
 browser, agent, CLI
         |
         v
 Traefik (*.preview.example.com)
   asks Spawner before each request
   to a protected URL
         |
         +-- spawner.<domain>
         |     dashboard and API
         |     (Spawner, Postgres)
         |
         +-- feat-login--blog.<domain>
         |     its own network:
         |     web, api, db
         |
         +-- main--blog.<domain>
               its own network:
               web, api, db
```

Every request goes through Traefik, the proxy in front of the server: it sends the dashboard's requests to Spawner, and an environment's to its services, on that environment's own Docker network. People use the dashboard and the `spawner` CLI; coding agents use the CLI too, or its MCP server (Model Context Protocol: how agents such as Claude Code, Codex and Cursor call tools).

## Projects and sources

A **project** is an application Spawner knows how to run: a **slug** (`blog`, the short name in its URLs), a repository, a default branch, for a monorepo the directory holding `.spawner/`, and the other repositories its sources may come from. An admin registers it in the dashboard (**Projects**, **New project**); its slug must be the `project` of its `spawner.yaml`. [The quickstart](quickstart.md) goes through it.

The repository holds `.spawner/spawner.yaml` (the manifest) and a Docker Compose file. An application spread over several repositories names the others in the manifest: each repository is a **source** (`api`, `front`), checked out next to the others, among those an admin listed for the project. See [the manifest](manifest.md).

## Environments

An **environment** is one running copy of a project, named after a branch (`feat/login` gives `feat-login`). Each source comes from:

- **git**: a branch, a tag or a commit. Spawner keeps one partial mirror per repository and checks out a git worktree per environment, so two environments never share a working copy. Private repositories are reached over SSH with a read-only **deploy key**, one per repository, which an admin generates on the **Git keys** page.
- **an upload**: the CLI sends the directory it runs in as an archive, uncommitted changes included. These docs call that directory a **worktree**: a clone, a `git worktree` of one, or any directory holding the project. This is how agents and developers test what they have not pushed.

Each environment is a Compose project (`spn-<project>--<env>`) with its own Docker network, volumes and containers. Its services reach each other by name (`http://api:8000`); nothing else reaches them but Traefik.

### URLs

The **exposures** of the manifest become URLs: the entrypoint on `<env>--<project>.<preview domain>`, the others on `<exposure>--<env>--<project>.<preview domain>`. One level under the preview domain, so that one wildcard certificate covers them all.

### Jobs

Every change is a **job**, in a queue in Spawner's database: create, update, stop, start, sleep, wake, delete. An environment runs one job at a time; builds wait for each other (one at a time below 8 GiB of memory, two above), other jobs run alongside. A create or an update goes through these phases, each logged:

1. **preparing**: memory and disk checks, then the sources (git checkout or upload, checked entry by entry);
2. **validating**: the manifest, the compose file against the [policy](security.md#the-compose-policy), the variables, the limits;
3. **building**: `docker compose up --build --wait`, until every service runs and passes its healthcheck;
4. **seeding**: on the first deploy (or with `--reseed`, `--fresh`), the **seed**: the commands of the manifest that fill the environment with test data, such as migrations and fixtures;
5. **routing**: Traefik joins the environment's network and gets its routes.

An update keeps the volumes, so the database survives; `--fresh` starts from scratch. In the dashboard, an update is **Redeploy**; **Redeploy and replay the seed** is `--reseed`, and **Redeploy from scratch** is `--fresh`.

### Statuses

| Status | Meaning |
|---|---|
| `ready` | Running, every healthcheck passing |
| `degraded` | A service stopped or crashes in a loop; the [timeline](#supervision) says which and why |
| `sleeping` | Stopped after a while without activity; the next visit to one of its team URLs wakes it up |
| `stopped` | Stopped by someone; `start` restarts it |
| `failed` | The last job failed, at the phase and with the error shown |
| `deleted` | Gone; its page, timeline and last logs stay readable 7 days |
| `queued`, `preparing`, `validating`, `building`, `seeding`, `routing`, `starting`, `stopping`, `waking`, `deleting` | A job is running |

### Lifetime, sleep and limits

- **Expiry**: an environment lives 72 hours by default (the manifest's `ttl`, at most 14 days by default). Each deploy starts the count again; `spawner extend` postpones it. An expired environment is deleted with everything it owns.
- **Sleep**: after 2 hours without activity (the manifest's `idle`), its containers stop; volumes and images stay. The next visit to one of its team URLs shows a waiting page and wakes it up within seconds. Public URLs (`auth: none`) neither count as activity nor wake it up, so that a bot cannot keep an environment awake: while it sleeps, they answer 503. The CLI wakes an environment up before `exec`, `shell`, `url` and `logs --follow`, when you may act on it.
- **Quota**: 5 environments per person by default, sleeping ones included; admins count too.
- **Capacity**: Spawner refuses a new environment, a start or a wake-up when the server lacks the memory (or, for a new one, the disk) that an environment of the project typically uses. `spawner capacity`, the **Overview** page and each project's page say how many more fit.
- **Resources**: the memory of an environment, 2 GiB unless its manifest asks for more (4 GiB at most by default), is shared by its services ([memory limits](manifest.md#memory-limits)). Each service gets 1 CPU and 512 processes unless its compose file says otherwise, up to 2 CPUs and 2048 processes.

On the **Settings** page, admins change the lifetime and the longest lifetime, the time before sleeping, the environments per person, the memory of an environment and its maximum, and the free memory and disk a build waits for. The CPU and process limits are fixed. [The manifest](manifest.md#making-environments-cheap) says what makes an environment cheap.

## People and access

### Accounts and roles

There are no passwords. An admin sends an **invitation link** (one use, valid 24 hours by default, a week at most); the new member chooses a name and creates a **passkey**, then logs in with it. GitHub login is optional: once an admin sets it up with an organization, a member of that organization (or of its team, when one is set) who logs in with GitHub for the first time gets a member account, without an invitation. See [GitHub login](security.md#github-login).

| Action | admin | member |
|---|---|---|
| Create environments, and update, share, delete their own | yes | yes |
| Run commands and open terminals in their own environments | yes | yes |
| Read every environment, its logs and resources | yes | yes |
| Act on other people's environments | yes | no |
| Projects, team, settings, deploy keys, audit, system | yes | no |

Admins act on other people's environments from the dashboard, or with a token holding the `admin` scope, which they create on the **Account and tokens** page: the token `spawner login` receives never has it.

### Tokens

Scripts, CI jobs and agents use **personal API tokens** (`spn_...`), created on the **Account and tokens** page (**API tokens**) or with `spawner token create`, or received by the CLI through a device login (`spawner login`: a code approved in the dashboard). A token has scopes, never more than its owner's role allows:

| Scope | Allows |
|---|---|
| `envs:read` | List environments, read logs and resources |
| `envs:write` | Create, update, share, stop, delete |
| `envs:exec` | Run commands and open terminals |
| `preview` | Get preview tokens, to call protected URLs |
| `admin` | Projects, team, settings |

A token may be restricted to one project, expires (90 days by default, a year at most) and can be revoked. Environments record who created them and through what: "Grace via claude-laptop".

The installation also has a **bootstrap token** (`SPAWNER_BOOTSTRAP_TOKEN`, in `/opt/spawner/.env`), with every scope and no user, for scripts of the server itself. Its environments have no owner and count against no quota: give agents and CI a personal token instead.

### Protected previews

URLs are protected by default (`auth: team`): before each request, Traefik asks Spawner whether to let it through.

- **Teammates** pass with a cookie the dashboard sets on the preview domain once they are logged in.
- **Agents and scripts** send a header, `X-Spawner-Preview`, valid one hour for one environment (`spawner url --with-token`). Spawner removes it before the request reaches the application.
- **Guests** get a **share link** (`spawner share`, or the **Share** card of the environment in the dashboard), which opens that environment only: 24 hours by default, 14 days at most. Revoking it on that card closes it at once.
- Anyone else: a browser goes to the login page, other clients get a 401.

An exposure with `auth: none` is public, for a webhook or a public page, if an admin allowed it for the project.

### Audit

Logins, invitations, tokens, environment actions, commands run in services, terminals, refused compose files and settings changes are recorded for 90 days; admins read them on the Audit page.

## Supervision

Spawner samples the CPU and memory of every container every 30 seconds (kept 30 days), measures the disk of each environment (what it shares with others and what is its own), and follows Docker's events: restarts, crashes with their exit code, out-of-memory kills, failing healthchecks. They make an environment's **timeline**, next to its jobs. Logs of the services can be filtered by service, errors and text, followed live and downloaded; when an environment is deleted, the end of each service's logs is kept 7 days.

## What Spawner does not do

- **Production, scaling or several servers.** One installation runs on one server, dedicated to previews, with Docker Compose: no Kubernetes, no cluster.
- **Environments for pull requests on its own.** Nothing watches the git host yet, so no environment starts by itself when a pull request opens. A CI job can call `spawner up` for each pull request and `spawner down` when it closes: see [previews for pull requests](ci.md).
- **Private image registries.** Images come from public registries, or are built from the sources. Repositories may live on any git host: over SSH with a deploy key, or over HTTPS when they are public.
- **Single sign-on beyond GitHub login, or permissions per project.** There is no OIDC or SAML, and every member sees the environments of every project ([access](security.md#access)).
- **More isolation than containers give.** Environments share the server's kernel, and their outbound traffic is filtered for the cloud's metadata and the server's own services only. See [what the security model leaves to you](security.md#what-spawner-does-not-do-yet).
- **Servers other than Linux.** The installer needs Ubuntu or Debian, on amd64 or arm64 ([install](install.md)).
