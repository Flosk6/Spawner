# Operating a Spawner server

Running a Spawner server day to day: where its files are, settings and GitHub login, backups and restores, upgrades, disk, monitoring, accounts and secrets.

## Where things are

| Path | What it holds |
|---|---|
| `/opt/spawner/compose.yaml` | The stack: `spawner`, `spawner-postgres`, `spawner-traefik`, `spawner-firewall`. Written by the installer; rerun it rather than editing this file |
| `/opt/spawner/.env` | Version, domain, memory of the Spawner container (`SPAWNER_MEMORY_LIMIT`), and the secrets: `SPAWNER_SECRET`, `POSTGRES_PASSWORD`, and `SPAWNER_BOOTSTRAP_TOKEN` when the installer was given one |
| `/opt/spawner/dns.env` | Credentials of the DNS provider, for Traefik |
| `/opt/spawner/spawner.env` | Settings of your own (below); the installer never overwrites it |
| `/opt/spawner/firewall.nft` | The rules for the containers of Docker's bridge networks, which Docker loads before it starts ([security](security.md#isolation)); copied from the image by each run of the installer |
| `/opt/spawner/backups/` | Database backups taken by upgrades |
| `/var/lib/spawner/` | Data: repository mirrors (`mirrors/`), sources and rendered compose files of the environments (`envs/`), Traefik routes (`traefik/`), job logs (`jobs/`), archived logs (`archives/`), terminal recordings (`terminals/`), uploads waiting for their job (`uploads/`), the working directory of git and Compose (`home/`), deploy keys (`keys/`) |
| Docker volumes `spawner_postgres-data`, `spawner_traefik-certs` | Spawner's database and the certificates |

The data directory is mounted at the same path inside the `spawner` container: the compose files Spawner renders use these paths. Never edit what is under it by hand.

```bash
cd /opt/spawner
docker compose --env-file .env ps          # the stack
docker logs -f spawner                     # Spawner's own logs
docker logs spawner-traefik                # certificates, routing errors
docker ps --filter label=dev.spawner.env   # the containers of the environments
```

## Settings

Most limits change from the dashboard, on the **Settings** page (under Admin in the sidebar): lifetime, longest lifetime, sleep, environments per person, memory of an environment and its maximum, build guards. GitHub login is configured there too (below). Other settings go to `/opt/spawner/spawner.env`, one `VARIABLE=value` per line, then:

```bash
docker compose --project-directory /opt/spawner --env-file /opt/spawner/.env up -d
```

The variables, their defaults, and those the installer sets itself are listed in [configuration](configuration.md).

The Spawner container may use 1 GiB of memory: rerun the installer with `--memory-limit 2g` to change it ([install](install.md#unattended-install)).

### GitHub login

Passkeys are enough; GitHub login is an option for a team that lives in a GitHub organization.

1. In GitHub, create an OAuth app in the organization's settings (Developer settings, OAuth Apps). Its homepage is the dashboard; its authorization callback URL is the one the Settings page shows, `https://spawner.<domain>/api/v1/auth/github/callback`.
2. On the Settings page, under GitHub login: the app's **Client ID** and a **Client secret**, the **Organization**, optionally a **Team** (its slug, as in its URL), then **Allow logging in with GitHub**, and **Save**.

With an organization, its members (of the team, when one is set) get a member account at their first GitHub login, without an invitation; without one, only accounts that linked GitHub themselves can use it. [Security](security.md#github-login) says who may log in and what Spawner checks at each login. The client secret is stored encrypted with the master secret. The `GITHUB_*` variables configure the same thing ([configuration](configuration.md#access)); once saved from the Settings page, the page wins.

## Backups

Environments are disposable: they come back from their branches, so they are not part of a backup. What matters is Spawner's database (projects, accounts, passkeys, tokens, settings, audit) and its secrets.

1. **The database**, every day. In `/etc/cron.d/spawner-backup`:

   ```text
   15 3 * * * root docker exec spawner-postgres pg_dump -U spawner -d spawner | gzip > /opt/spawner/backups/daily-$(date +\%a).sql.gz
   ```

   This keeps one backup per day of the week. Upgrades add their own (`spawner-<date>-<version>.sql.gz`, the 5 most recent kept).
2. **`/opt/spawner/.env`**, with `dns.env` and `spawner.env`, once and after each change: without `SPAWNER_SECRET`, a restored database cannot decrypt the settings (GitHub login) and the secret variables of the projects.
3. **Off the server**: copy the whole `/opt/spawner` elsewhere (`rsync`, `rclone`, your provider's backup service). A backup on the same disk does not survive the disk.

Deploy keys (`/var/lib/spawner/keys/`) can be generated again from the dashboard, but each must then be added again to its repository: copy that directory too if you have many.

## Restoring

On the same server:

```bash
docker stop spawner
docker exec spawner-postgres psql -U spawner -d postgres \
  -c 'DROP DATABASE spawner WITH (FORCE)' -c 'CREATE DATABASE spawner'
gunzip -c /opt/spawner/backups/daily-Mon.sql.gz \
  | docker exec -i spawner-postgres psql -q -U spawner -d spawner
docker start spawner
```

Spawner applies the migrations of its version at startup, so a backup of an older version restores into a newer one (not the other way round).

On a new server:

1. Copy `/opt/spawner` of the old server to the new one, at the same place: at least `.env` (the secrets, the domain, the version), with `dns.env`, `spawner.env` and the backup you restore from `backups/`.
2. To keep the deploy keys, copy `/var/lib/spawner/keys/` too, with `rsync -a` (it keeps their owner and modes).
3. Run the installer. It finds the installation from its `.env`, keeps its secrets, its domain and its version, so that the backup matches, and writes `compose.yaml` again; upgrade afterwards.
4. Restore the database as above, then point the DNS record to the new server.

Environments of the old server are then listed as failed, their containers being gone: redeploy them (`spawner up`, or **Redeploy** on the page of one built from git) or delete them.

## Upgrading

**From the dashboard.** Spawner looks for new versions every 6 hours. When one is out, admins see "Spawner X is available" at the bottom of the sidebar (an **Update** button in the top bar on a phone). The System page links its release notes and shows an **Update to X** button. Spawner then:

1. downloads the image of the new version;
2. starts a short-lived container of it (`spawner-upgrade`) that runs that version's installer with `--upgrade`: the database is backed up to `/opt/spawner/backups/`, the files of the installation are written, and the stack restarts on the new version, which applies its migrations;
3. if the new version does not start, puts the previous one back: its files, and its database as the backup holds it.

The dashboard is away for about a minute, environments keep running, and the page reloads by itself on the new version. Spawner restarts, so it refuses to update while jobs run: try again once they end. A server running a release is offered releases only; one running a prerelease (such as `2.1.0-rc.1`) is offered prereleases too.

**With the installer**, the same steps from the server: to pick a version, or when the dashboard cannot update (a server running an image of your own, which `--image` must name again):

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh \
  | sudo bash -s -- --upgrade
```

`--version 2.1.0` picks a version. If the new version does not start, the installer goes back to the previous one by itself. To go back later, restore the backup the upgrade took (it holds the database of the previous version), then install that version with `--upgrade --version <previous> --allow-downgrade`: migrations only go forward, so the installer refuses an older version without that option.

**The CLI** checks `.spawner/` with its own copy of the rules: after an upgrade, everyone moves to the server's version (`npm install -g spawner-cli@2.1.0`); `spawner whoami` shows both versions ([the CLI](cli.md#versions-and-updates)).

**Traefik and Postgres** are pinned to a minor or major version (`traefik:v3.7`, `postgres:17-alpine`), and each upgrade pulls their latest patch. To take one between two releases of Spawner:

```bash
cd /opt/spawner
docker compose --env-file .env pull traefik postgres
docker compose --env-file .env up -d
```

The previews and the dashboard are away for a few seconds while the containers are replaced.

## Disk

The System page shows what takes the disk: images (what each environment shares and what is its own), build cache, volumes, sources, logs. Spawner keeps it in check by itself:

- the image an update replaces is removed at once, and the code of a source once the build no longer needs it;
- Docker's build cache stays under 15 % of the disk (`builder.gc`, set by the installer);
- repository mirrors are partial (`--filter=blob:none`) and shared by the environments of a repository; on a Docker it installed, the installer keeps the classic image store (overlay2), which stores each layer once rather than twice;
- containers write compressed logs, 30 MB at most each;
- every minute, Spawner removes what deleted environments left behind; the **Cleanup** card of the System page lists the rest it owns and no longer uses (repository mirrors, files of unknown environments), to remove by hand.

On the page of an environment, the **Disk** card (Overview tab) splits its images into its own part and the part it shares: dependencies in its own part mean a Dockerfile copies the code before installing them ([the manifest](manifest.md#making-environments-cheap)). The page of a project gives what one environment typically costs (memory, disk, build time) and how many more fit.

**Never run `docker system prune` or `docker container prune` on a Spawner server.** Sleeping and stopped environments are stopped containers: a prune deletes them and their networks (with `-a`, their images too; with `--volumes`, their data), and an environment whose images are gone cannot wake up any more. Use the Cleanup card, which only touches what Spawner owns.

When the disk fills up anyway: delete the environments nobody uses any more, shorten their lifetime (Settings), or grow the disk. A build waits up to two minutes for 10 GiB free (**Disk free before a build**, in Settings), then fails; a new environment is refused when what it typically adds would leave less than 10 GiB free.

## Monitoring

- `https://spawner.<domain>/api/v1/healthz` answers `{"status":"ok"}` while Spawner runs; `/api/v1/readyz` checks its database too (503 when it cannot reach it). Point an uptime monitor at it.
- The System page raises alerts:
  - disk: a warning above 80 % used with less than 50 GiB free, critical above 90 % used with less than 20 GiB free, or below 10 GiB free;
  - memory: less available than a build waits for;
  - an environment's service crashing in a loop (3 crashes or out-of-memory kills in 10 minutes);
  - out-of-memory kills in the last hour.
- Alerts show on the System page only: Spawner sends no e-mail or message. An uptime monitor that also checks the certificate's expiry covers what matters most.
- Certificates: Traefik renews them by itself, ahead of their expiry. When a renewal fails (a revoked DNS token, a changed DNS record), `docker logs spawner-traefik` says why; Let's Encrypt no longer sends expiry e-mails.
- `docker stats` shows the containers live; the System page keeps 30 days of history.

## Accounts

- A new admin account when nobody can log in: `docker exec -u node spawner node dist/admin.js invite --role admin` prints a link valid 24 hours (`--hours 1` to `168`).
- Someone lost their passkeys: an admin sends them a link for a new one (Team, the menu of the person: **Link for a new passkey**).
- Someone leaves: **Deactivate** them (Team, the menu of the person). Their sessions and tokens stop working at once, their preview cookies within a minute; their environments stay until they expire or an admin deletes them.
- People of the GitHub organization get a member account at their first GitHub login, when GitHub login is on (above). **Make admin**, in their menu on the Team page, gives one of them every right.

## Secrets

- **The bootstrap token** (`SPAWNER_BOOTSTRAP_TOKEN` in `.env`) has every scope, no user and no quota, for scripts of the installation: give CI a personal token restricted to a project instead ([CI](ci.md)). The installer makes one only when given one, as the other answers it takes from the environment ([unattended install](install.md#unattended-install)); installations from 2.1 and before have one: empty its line in `.env` to turn it off, or change it, then `docker compose --project-directory /opt/spawner --env-file /opt/spawner/.env up -d`.
- **The master secret** (`SPAWNER_SECRET`) signs sessions and tokens and encrypts settings and secret variables. Changing it logs everyone out, invalidates every personal token and makes the encrypted settings and secret variables unreadable: do it only if it leaked, then set the GitHub login and the secret variables again.
- **The database password** (`POSTGRES_PASSWORD`) never leaves the server; the database is not reachable from outside the stack.
