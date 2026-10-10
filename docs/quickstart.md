# Quickstart

From a fresh Linux server to a first preview environment of your app, with its own URLs and database: install Spawner, log in, add a project, run `spawner up`.

Each step links the page that says more. The commands use `preview.example.com` as the domain of the previews: put yours.

## What you need

- **A Linux server dedicated to previews**: Ubuntu 22.04 or 24.04, or Debian 12, amd64 or arm64, with 4 GiB of memory at least (8 GiB or more advised), 20 GiB of free disk, and ports 80 and 443 open. Environments run code from branches nobody has reviewed yet: put nothing else on it ([install](install.md#before-you-start)).
- **A domain for the previews**, with a wildcard DNS record pointing to the server:

  ```text
  *.preview.example.com.   A   203.0.113.10
  ```

  `dig +short anything.preview.example.com` must give the server's address.
- **Optionally, an API token of your DNS provider** (Cloudflare, OVH, Hetzner, Route 53 and others), for one wildcard certificate: every new environment then gets HTTPS at once. Without it, each new URL gets its own certificate, within Let's Encrypt's limit of about 50 a week ([install](install.md#dns-providers)).
- **On your machine**: Node.js 20 or later, git, and the repository of an application that builds with a Dockerfile. No application at hand: deploy [the example](#add-a-project) of Spawner's repository.

## Install the server

On the server, as root:

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh | sudo bash
```

The installer asks for the domain of the previews, an e-mail for the Let's Encrypt account and your DNS provider with its token (or none). It installs Docker if needed, starts Spawner, Postgres and Traefik, waits for the certificate, and ends with:

```text
== Spawner 2.1.0 is running
  Dashboard     https://spawner.preview.example.com
  First admin   https://spawner.preview.example.com/invite/...
```

followed by the commands that install the CLI. [Install](install.md) describes each step, the options for an unattended install, and what the installer changes on the server.

## Create the first admin account

Open the **First admin** link within the hour, type your name and a name for the passkey, then **Create my passkey**: your browser or your phone keeps it. Accounts have no password. You are the first admin: you register projects and invite the team.

The link expired: `docker exec -u node spawner node dist/admin.js invite --role admin` prints a new one.

## Install the CLI and log in

On your machine:

```bash
npm install -g spawner-cli
spawner login https://spawner.preview.example.com
```

```text
Open https://spawner.preview.example.com/device
and enter the code BCDF-GHJK (it expires in 10 minutes).
Waiting for approval...
Logged in to https://spawner.preview.example.com as Ada (admin).
```

The browser opens the dashboard's device page: type the code the CLI shows, **Continue**, then **Approve**. The CLI receives a personal token valid 90 days and keeps it in its credentials file (`~/.config/spawner/credentials.json` on Linux and macOS). [The CLI](cli.md#log-in) has the details, and other ways to install it.

## Add a project

A project is a repository with a `.spawner/` directory: `spawner.yaml`, the manifest, names the project and its URLs; a Docker Compose file describes its services.

**Your application**: in its repository, run `spawner init`.

```text
$ spawner init
Create AGENTS.md with the instructions for coding agents? [Y/n]
Created .spawner/spawner.yaml
Created .spawner/compose.yaml
Added the instructions for coding agents to AGENTS.md

Next: an admin registers the project blog in the dashboard (Projects), then:
  spawner up --wait
Step by step: https://spawner.run/docs/quickstart/
```

- The **slug** of the project (`blog` here) comes from the repository's directory name; `--project <slug>` chooses another. It is part of every URL: 20 characters at most.
- `compose.yaml` gets a service `app`, built from the `Dockerfile` next to `.spawner/`, and a PostgreSQL or MySQL service when `package.json`, `requirements.txt` or `pyproject.toml` names a driver (`--db postgres`, `mysql` or `none` chooses).
- `spawner.yaml` exposes the port of the Dockerfile's first `EXPOSE` (3000 without one, `--port` chooses) as the URL `web`.

Read both files: they are a start, to adjust. The application must listen on `0.0.0.0` (all interfaces) at that port, not on `127.0.0.1`: Traefik reaches it from another container. [The manifest](manifest.md) lists every key and the rules of the compose file. In a monorepo, run `spawner init` in the application's directory.

**Or the example**, a Node.js application with PostgreSQL, seeded with one user. Its `.spawner/` names the project `example`:

```bash
git clone https://github.com/Flosk6/Spawner.git
cd Spawner/examples/node-postgres
```

## Register the project

Spawner only runs projects an admin registered. In the dashboard: **Projects**, **New project**:

| Field | Your application | The example |
|---|---|---|
| Name | Any name, such as `Blog` | `Example` |
| Slug | The slug `spawner init` printed: `project` in `spawner.yaml` | `example` |
| Repository | `git@github.com:acme/blog.git`, or its HTTPS URL; it ends with `.git` | `https://github.com/Flosk6/Spawner.git` |
| Default branch | `main`: deployed when an environment names no branch | `master` |
| Directory | `.`, or the directory of `.spawner/` in a monorepo | `examples/node-postgres` |
| Source repositories | Empty, unless `sources` in `spawner.yaml` names other repositories: one per line, written as there | empty |

Leave **Allow public URLs** and **Allow environments that never sleep** off: the defaults keep every URL behind a login and let idle environments sleep. Then **Create project**.

**A private repository** is read over SSH, with a read-only deploy key: give its SSH URL (`git@...`), then:

1. **Git keys**, in the Admin part of the sidebar, lists the repositories of the projects: **Generate key** on yours, then **View key**.
2. Add the public key to the repository, read-only: on GitHub, Settings, Deploy keys, Add deploy key; on GitLab, Settings, Repository, Deploy keys.
3. Back on the project, **Edit**, then **Test** next to the repository: it says "Connection successful".

`spawner up` sends the code of your directory, so the first environment works before the key is in place. Environments started from the dashboard, or from a branch with `--ref`, need it, and so does every repository that `sources` names in `spawner.yaml`, which an admin also lists under **Source repositories**. They also read `.spawner/` from the branch: commit and push it.

## Start an environment

In the project's directory (the example's, or yours):

```bash
spawner up --wait
```

`up` checks `.spawner/` against the server's rules, sends the files git sees (uncommitted changes included, ignored files not), and follows the job through its phases: preparing, validating, building, seeding, routing. It ends with the URLs:

```text
master (example) is ready
  web  https://master--example.preview.example.com
Expires in 24h. The URLs need a login; for curl or tests: spawner url master --with-token
```

The environment is named after the branch (`master` in a clone of Spawner, `feat-login` for `feat/login`). The first build of a project downloads its base images and installs its dependencies; the next environments reuse the layers that did not change.

Open the URL in the browser where you are logged in to the dashboard: Spawner lets you through. The example answers `Hello from Spawner (master) at https://master--example.preview.example.com: 1 user(s)`. The environment also has a page in the dashboard (**Environments**), with its services, logs, resources and jobs.

The environment sleeps after 2 hours without visits and wakes up at the next one; it is deleted after its lifetime (72 hours by default, 24 for the example), unless someone deploys it again or extends it. `spawner down` deletes it now.

Something failed: the CLI prints the end of the job log, and [troubleshooting](troubleshooting.md) lists the usual causes.

## Invite the team

**Team**, **Invite**: who it is for, the role (**Member** manages their own environments, **Admin** everything), how long the link stays valid (24 hours by default), then **Create the link**. Spawner sends no e-mail: copy the link and send it yourself. The person opens it, chooses a name and creates a passkey, then installs the CLI and runs `spawner login` like you did.

A team that lives in a GitHub organization can log in with GitHub instead ([operations](operations.md#github-login)).

## Next

- [Previews for pull requests](ci.md): an environment per pull request from GitHub Actions or GitLab CI, with its URL in a comment.
- [Coding agents](agents.md): Claude Code, Codex, Cursor and others start environments, run commands in them and read their logs.
- [The examples](examples.md): Node.js with PostgreSQL, and Laravel, Next.js and MySQL with two repositories.
- [The manifest](manifest.md): every key of `.spawner/`, and what makes environments cheap.
- [Concepts](concepts.md): projects, sources, environments, jobs, access.
