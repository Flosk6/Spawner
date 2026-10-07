# Concepts

Spawner runs one copy of an application per branch, on a server of your own, each with its own URLs, database and logs. This page describes the pieces; [install](install.md) sets a server up, [the manifest](manifest.md) describes a project, [the CLI](cli.md) drives it.

```text
                         *.preview.example.com
                                  |
  browser, agent, CLI --------> Traefik ---- asks Spawner before each request (protected URLs)
                                  |
           +----------------------+-----------------------+
           |                      |                       |
   spawner.<domain>      feat-login--blog.<domain>   main--blog.<domain>
   dashboard and API     environment network         environment network
   (Spawner, Postgres)   web, api, db                web, api, db
```

## Projects and sources

A **project** is an application Spawner knows how to run: a slug (`blog`), a repository, a default branch and, for a monorepo, the directory holding `.spawner/`. Admins create projects from the dashboard.

The repository holds `.spawner/spawner.yaml` (the manifest) and a Docker Compose file. An application spread over several repositories names the others in the manifest: each repository is a **source** (`api`, `front`), checked out next to the others. See [the manifest](manifest.md).

## Environments

An **environment** is one running copy of a project, named after a branch (`feat/login` gives `feat-login`). Each source comes from:

- **git**: a branch, a tag or a commit. Spawner keeps one partial mirror per repository and checks out a worktree per environment, so two environments never share a working copy. A deploy key (read-only, per repository) gives access to private repositories.
- **an upload**: the CLI sends a worktree as an archive, uncommitted changes included. This is how agents and developers test what they have not pushed.

Each environment is a Compose project (`spn-<project>--<env>`) with its own Docker network, volumes and containers. Its services reach each other by name (`http://api:8000`); nothing else reaches them but Traefik.

### URLs

The **exposures** of the manifest become URLs: the entrypoint on `<env>--<project>.<domain>`, the others on `<exposure>--<env>--<project>.<domain>`. One level under the domain, so that one wildcard certificate covers them all.

### Jobs

Every change is a **job**, in a queue in Spawner's database: create, update, stop, start, sleep, wake, delete. An environment runs one job at a time; builds wait for each other (one at a time below 8 GiB of memory, two above), other jobs run alongside. A create or an update goes through these phases, each logged:

1. **preparing**: memory and disk checks, then the sources (git checkout or upload, checked entry by entry);
2. **validating**: the manifest, the compose file against the [policy](security.md#the-compose-policy), the variables, the limits;
3. **building**: `docker compose up --build --wait`;
4. **seeding**: the seed steps of the manifest, on the first deploy (or with `--reseed`, `--fresh`);
5. **routing**: Traefik joins the environment's network and gets its routes.

An update keeps the volumes, so the database survives; `--fresh` starts from scratch.

### Statuses

| Status | Meaning |
|---|---|
| `ready` | Running, every healthcheck passing |
| `degraded` | A service stopped or crashes in a loop; the timeline says which and why |
| `sleeping` | Stopped after a while without activity; the next visit wakes it up |
| `stopped` | Stopped by someone; `start` restarts it |
| `failed` | The last job failed, at the phase and with the error shown |
| `deleted` | Gone; its page, timeline and last logs stay readable 7 days |
| `queued`, `preparing`, `validating`, `building`, `seeding`, `routing`, `starting`, `stopping`, `waking`, `deleting` | A job is running |

### Lifetime, sleep and limits

- **Expiry**: an environment lives 72 hours by default (the manifest's `ttl`, at most 14 days). Each deploy starts the count again; `spawner extend` postpones it. An expired environment is deleted with everything it owns.
- **Sleep**: after 2 hours without a visit or an action (the manifest's `idle`), its containers stop; volumes and images stay. The next visit to one of its URLs shows a waiting page and wakes it up within seconds; the CLI wakes it up before `exec`, `shell`, `url` and `logs --follow`.
- **Quota**: 5 environments per person, sleeping ones included.
- **Capacity**: Spawner refuses a new environment, a start or a wake-up when the server lacks the memory (or, for a new one, the disk) that an environment of the project typically uses. `spawner capacity` and the System page say how many more fit.
- **Resources**: 2 GiB of memory per environment (512 MiB per service unless the compose file says otherwise), 1 CPU and 512 processes per service.

Admins change these values from the settings page. See [density](density.md) for what makes environments cheap.

## People and access

### Accounts and roles

There are no passwords. An admin sends an **invitation link** (one use, 24 hours); the new member chooses a name and creates a **passkey**, then logs in with it. GitHub login is optional (an organization and a team can restrict it).

| | admin | member |
|---|---|---|
| Create environments, and update, share, delete their own | yes | yes |
| Run commands and open terminals in their own environments | yes | yes |
| Read every environment, its logs and resources | yes | yes |
| Act on other people's environments | yes | no |
| Projects, team, settings, deploy keys, audit, system | yes | no |

### Tokens

Scripts, CI jobs and agents use **personal tokens** (`spn_...`), created from the account page or with `spawner token create`, or received by the CLI through a device login (`spawner login`: a code approved in the dashboard). A token has scopes, never more than its owner's role allows:

| Scope | Allows |
|---|---|
| `envs:read` | List environments, read logs and resources |
| `envs:write` | Create, update, share, stop, delete |
| `envs:exec` | Run commands and open terminals |
| `preview` | Get preview tokens, to call protected URLs |
| `admin` | Projects, team, settings |

A token may be restricted to one project, expires (90 days by default) and can be revoked. Environments record who created them and through what: "Grace via claude-laptop".

### Protected previews

URLs are protected by default (`auth: team`): before each request, Traefik asks Spawner whether to let it through.

- **Teammates** pass with a cookie the dashboard sets on the preview domain once they are logged in.
- **Agents and scripts** send a header, `X-Spawner-Preview`, valid one hour for one environment (`spawner url --with-token`). Spawner removes it before the request reaches the application.
- **Guests** get a **share link** (`spawner share`, 24 hours by default), which opens that environment only.
- Anyone else: a browser goes to the login page, other clients get a 401.

An exposure with `auth: none` is public, for webhooks or a public page, if an admin allowed it for the project.

### Audit

Logins, invitations, tokens, environment actions, commands run in services, terminals, refused compose files and settings changes are recorded for 90 days; admins read them on the Audit page.

## Supervision

Spawner samples the CPU and memory of every container every 30 seconds (kept 30 days), measures the disk of each environment (what it shares with others and what is its own), and follows Docker's events: restarts, crashes with their exit code, out-of-memory kills, failing healthchecks. They make an environment's **timeline**, next to its jobs. Logs of the services can be filtered by service, errors and text, followed live and downloaded; when an environment is deleted, the end of each service's logs is kept 7 days.
