# Operations

Running a Spawner server day to day: where things are, backups, restores, upgrades, disk, monitoring. [Install](install.md) covers the installation itself.

## Where things are

| Path | What it holds |
|---|---|
| `/opt/spawner/compose.yaml` | The stack: `spawner`, `spawner-postgres`, `spawner-traefik`, `spawner-firewall`. Written by the installer; rerun it rather than editing this file |
| `/opt/spawner/.env` | Version, domain, memory of the Spawner container (`SPAWNER_MEMORY_LIMIT`), and the secrets: `SPAWNER_SECRET`, `POSTGRES_PASSWORD`, `SPAWNER_BOOTSTRAP_TOKEN` |
| `/opt/spawner/dns.env` | Credentials of the DNS provider, for Traefik |
| `/opt/spawner/spawner.env` | Settings of your own (below); the installer never overwrites it |
| `/opt/spawner/firewall.nft` | The rules for the containers of Docker's bridge networks, which Docker loads before it starts ([security](security.md#isolation)); copied from the image by each run of the installer |
| `/opt/spawner/backups/` | Database backups taken by upgrades |
| `/var/lib/spawner/` | Data: repository mirrors (`mirrors/`), sources and rendered compose files of the environments (`envs/`), Traefik routes (`traefik/`), job logs (`jobs/`), archived logs (`archives/`), terminal recordings (`terminals/`), deploy keys (`keys/`) |
| Docker volumes `spawner_postgres-data`, `spawner_traefik-certs` | Spawner's database and the certificates |

The data directory is mounted at the same path inside the `spawner` container: the compose files Spawner renders use these paths. Never edit what is under it by hand.

```bash
cd /opt/spawner
docker compose --env-file .env ps                 # the stack
docker logs -f spawner                            # Spawner's own logs
docker logs spawner-traefik                       # certificates, routing errors
docker ps --filter label=dev.spawner.env          # the containers of the environments
```

## Settings

Most limits change from the dashboard (System, Settings): lifetimes, sleep, quota per person, memory per environment, build guards. GitHub login is configured there too. Other settings go to `/opt/spawner/spawner.env`, one `VARIABLE=value` per line, then:

```bash
docker compose --project-directory /opt/spawner --env-file /opt/spawner/.env up -d
```

The variables, their defaults, and those the installer sets itself are listed in [configuration](configuration.md).

The Spawner container may use 1 GiB of memory: rerun the installer with `--memory-limit 2g` to change it ([install](install.md#without-questions)).

## Backups

Environments are disposable: they come back from their branches, so they are not part of a backup. What matters is Spawner's database (projects, accounts, passkeys, tokens, settings, audit) and its secrets.

1. **The database**, every day. In `/etc/cron.d/spawner-backup`:

   ```text
   15 3 * * * root docker exec spawner-postgres pg_dump -U spawner -d spawner | gzip > /opt/spawner/backups/daily-$(date +\%a).sql.gz
   ```

   This keeps one backup per day of the week. Upgrades add their own (`spawner-<date>-<version>.sql.gz`, the 5 most recent kept).
2. **`/opt/spawner/.env`**, once, and after each change: without `SPAWNER_SECRET`, a restored database cannot decrypt the settings (GitHub login) and the secret variables of the projects.
3. **Off the server**: copy `/opt/spawner/backups/` and `.env` elsewhere (`rsync`, `rclone`, your provider's backup service). A backup on the same disk does not survive the disk.

Deploy keys (`/var/lib/spawner/keys/`) can be generated again from the dashboard, but each must then be added again to its repository: copy that directory too if you have many.

## Restoring

On the same server:

```bash
docker stop spawner
docker exec spawner-postgres psql -U spawner -d postgres -c 'DROP DATABASE spawner WITH (FORCE)' -c 'CREATE DATABASE spawner'
gunzip -c /opt/spawner/backups/daily-Mon.sql.gz | docker exec -i spawner-postgres psql -q -U spawner -d spawner
docker start spawner
```

Spawner applies the migrations of its version at startup, so a backup of an older version restores into a newer one (not the other way round).

On a new server: copy the old `/opt/spawner/.env` and `dns.env` to `/opt/spawner/` first, then run the installer (it keeps the secrets and the domain it finds), restore the database as above, and point the DNS record to the new server. Environments of the old server are listed as failed, their containers being gone: redeploy them (`spawner up`) or delete them.

## Upgrading

**From the dashboard.** Spawner looks for new versions every 6 hours. When one is out, admins see it in a banner and on the System page, with its release notes and an **Update** button. Spawner then:

1. downloads the image of the new version;
2. starts a short-lived container of it (`spawner-upgrade`) that runs that version's installer with `--upgrade`: the database is backed up to `/opt/spawner/backups/`, the files of the installation are written, and the stack restarts on the new version, which applies its migrations;
3. if the new version does not start, puts the previous one back: its files, and its database as the backup holds it.

The dashboard is away for about a minute, environments keep running, and the page reloads by itself on the new version. An update waits for running jobs to end, since Spawner restarts. A server on a release is offered releases only; a server on a prerelease (`2.1.0-rc.1`) is offered prereleases too.

**With the installer**, the same steps by hand, for a server installed another way or to pick a version:

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh | sudo bash -s -- --upgrade
```

`--version 2.1.0` picks a version. If the new version does not start, the installer goes back to the previous one by itself. To go back later, install the previous version with `--upgrade --version <previous>` and restore the backup the upgrade took: migrations only go forward.

## Disk

The System page shows what takes the disk: images (what each environment shares and what is its own), build cache, volumes, sources, logs. Spawner keeps it in check by itself:

- the image an update replaces is removed at once, and the code of a source once the build no longer needs it;
- Docker's build cache stays under 15 % of the disk (`builder.gc`, set by the installer);
- repository mirrors are partial (`--filter=blob:none`) and shared by the environments of a repository; on a Docker it installed, the installer keeps the classic image store (overlay2), which stores each layer once rather than twice;
- containers write compressed logs, 30 MB at most each;
- every minute, Spawner removes what deleted environments left behind; the cleanup panel (System) lists the rest it owns and no longer uses (repository mirrors, files of unknown environments), to remove by hand.

The Disk tab of an environment splits its images into its own part and the part it shares: dependencies in its own part mean a Dockerfile copies the code before installing them ([the manifest](manifest.md#making-environments-cheap)). The project page gives the cost of a typical environment: memory, own disk, build time.

**Never run `docker system prune` or `docker container prune` on a Spawner server.** Sleeping and stopped environments are stopped containers: a prune deletes them, and their images and networks, and they cannot wake up any more. Use the cleanup panel, which only touches what Spawner owns.

When the disk fills up anyway: delete the environments nobody uses any more, shorten their lifetime (Settings), or grow the disk. Spawner refuses builds below 10 GiB free.

## Monitoring

- `https://spawner.<domain>/api/v1/healthz` answers `{"status":"ok"}` while Spawner runs; `/api/v1/readyz` checks its database too. Point an uptime monitor at it.
- The System page raises alerts: disk above 80 %, memory below what builds need, environments crashing in a loop, out-of-memory kills.
- `docker stats` shows the containers live; the System page keeps 30 days of history.

## Accounts

- A new admin link when nobody can log in: `docker exec -u node spawner node dist/admin.js invite --role admin` (valid one hour; `--hours N` for longer).
- Someone lost their passkeys: an admin sends them a link for a new one (Team, the key button of the person: "Link for a new passkey").
- Someone leaves: deactivate them (Team). Their sessions and tokens stop working at once, their preview cookies within a minute; their environments stay until they expire or an admin deletes them.

## Secrets

- **The bootstrap token** (`SPAWNER_BOOTSTRAP_TOKEN` in `.env`) has every scope, for scripts of the installation: change it in `.env`, then `docker compose --project-directory /opt/spawner --env-file /opt/spawner/.env up -d`.
- **The master secret** (`SPAWNER_SECRET`) signs sessions and tokens and encrypts settings and secret variables. Changing it logs everyone out, invalidates every personal token and makes the encrypted settings and secret variables unreadable: do it only if it leaked, then set the GitHub login and the secret variables again.
- **The database password** (`POSTGRES_PASSWORD`) never leaves the server; the database is not reachable from outside the stack.
