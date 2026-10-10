# Installing Spawner

Spawner, the self-hosted preview environment manager, installs on a Linux server dedicated to previews with one command, which also sets up Docker if needed.

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh | sudo bash
```

The installer ends with the link that creates the first admin account. [The quickstart](quickstart.md) goes from there to a first environment.

## Before you start

**A server** dedicated to previews: environments run code from branches nobody has reviewed yet, so never put production or anything sensitive on the same machine ([security](security.md)).

| Requirement | Minimum | Advised |
|---|---|---|
| System | Ubuntu 22.04 or 24.04, Debian 12; amd64 or arm64 | Ubuntu 24.04 |
| Memory | 4 GiB | 8 GiB or more: memory decides how many environments run at once |
| Disk | 20 GiB free | 80 GiB or more: images, volumes and build caches |
| Network | ports 80 and 443 free, reachable from the internet | |

**Memory**: Spawner keeps 1 GiB free, counts 2 GiB for an environment of a project until it has measured what that project's environments really use, and makes each build wait until 2 GiB are available. A 4 GiB server leaves about 3 GiB available once Spawner runs: enough for a first environment, after which `spawner capacity` says how many more fit. Below 4 GiB, the installer warns (and below 2 GiB it stops): no environment fits with these defaults. Lower them on the Settings page of the dashboard, to what one environment of your application needs: **Memory of an environment** and **Memory available before a build** (or `SPAWNER_ENV_MEMORY` and `MIN_REQUIRED_FREE_MEMORY_GB`, [configuration](configuration.md#lifecycle-and-limits)).

**A domain for the previews**, such as `preview.example.com`, with one DNS record pointing to the server:

```text
*.preview.example.com.   A   203.0.113.10
```

Environments get `<env>--<project>.preview.example.com` and the dashboard `spawner.preview.example.com`: one level under the domain, so that one wildcard certificate covers them all. A domain of its own (rather than a subdomain of your company's main domain) keeps the cookies of your other sites away from the previews.

**For the certificate**, Spawner uses Let's Encrypt with one of two methods:

- **One wildcard certificate** (advised): Traefik proves it owns the domain through your DNS provider's API. You need an API token of the provider. New environments get HTTPS at once, without any limit.
- **One certificate per URL**: nothing to set up, but each new URL waits a few seconds for its certificate, and Let's Encrypt allows about 50 new certificates a week per domain. Enough to try Spawner, too few for a team.

**Coming from Spawner 1.x**: nothing carries over. Install 2.x on a fresh server.

### Verifying the installer

Each release attests where its files come from: `install.sh`, the CLI bundle and the images were built by this repository's release workflow from the tagged commit. With the [GitHub CLI](https://cli.github.com), check the installer before you run it:

```bash
curl -fsSLO https://github.com/Flosk6/Spawner/releases/latest/download/install.sh
gh attestation verify install.sh -R Flosk6/Spawner
sudo bash install.sh
```

The installer of a release names the digest of its image: it runs the image that release built, whatever the tag points to later, and the Postgres and Traefik images are pinned by digest too. `gh attestation verify oci://ghcr.io/flosk6/spawner:<version> -R Flosk6/Spawner` checks an image. Without the GitHub CLI, compare the installer with the release's checksums: `curl -fsSLO https://github.com/Flosk6/Spawner/releases/latest/download/SHA256SUMS`, then `sha256sum -c --ignore-missing SHA256SUMS`.

## The installation

Run the command above on the server, as root. The installer:

1. checks the system, the memory, the disk and the ports;
2. asks three questions: the domain of the previews, a contact e-mail for the Let's Encrypt account (Traefik requires one), and the DNS provider with its credentials (tokens and keys do not show as you type them);
3. checks that `*.<domain>` resolves to the server, and warns if not;
4. installs Docker (from get.docker.com) if it is missing, and configures it for many short-lived environments (below);
5. below 8 GiB of memory, offers compressed swap in memory (zram);
6. writes `/opt/spawner` (a Compose file, its secrets, the firewall rules of the environments) and starts Postgres and Traefik (images from Docker Hub, pinned by digest), Spawner and its firewall (Spawner's image, from GHCR), then waits for the dashboard and its certificate;
7. prints the dashboard URL, a link valid one hour that creates the first admin account, and the commands that install the CLI.

It takes a few minutes. Open the admin link, choose a name and create a passkey: accounts have no password. [The quickstart](quickstart.md#install-the-cli-and-log-in) goes on with the CLI, a first project and the team.

### Reading the installer first

Each release publishes `install.sh` with a `SHA256SUMS` file. To check the download and read the script before running it as root:

```bash
release=https://github.com/Flosk6/Spawner/releases/latest/download
curl -fsSLO "$release/install.sh"
curl -fsSLO "$release/SHA256SUMS"
sha256sum --ignore-missing -c SHA256SUMS      # install.sh: OK
less install.sh
sudo bash install.sh
```

The checksum comes from the same release: it catches a truncated or corrupted download, not a release someone tampered with. Reading the script is what tells you what it does. A downloaded copy also takes every option below, such as `sudo bash install.sh --uninstall`.

### Unattended install

Every answer can be given as an option:

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh \
  | sudo bash -s -- --domain preview.example.com --email ops@example.com \
      --dns-provider cloudflare --dns-env CF_DNS_API_TOKEN=... --yes
```

| Option | What it sets |
|---|---|
| `--domain <domain>` | Domain of the previews [`SPAWNER_DOMAIN`] |
| `--email <address>` | Contact address of the Let's Encrypt account [`SPAWNER_EMAIL`] |
| `--dns-provider <code>` | `cloudflare`, `ovh`, `hetzner`, `scaleway`, `digitalocean`, `route53`, `gandiv5`, another [lego code](https://go-acme.github.io/lego/dns/), or `none` for one certificate per URL [`SPAWNER_DNS_PROVIDER`] |
| `--dns-env KEY=VALUE` | A credential of the DNS provider, repeatable (or the variable itself, such as `CF_DNS_API_TOKEN`) |
| `--version <version>` | Version to install, or `latest` (default: the installer's own) [`SPAWNER_VERSION`] |
| `--zram yes\|no` | Compressed swap, offered below 8 GiB [`SPAWNER_ZRAM`] |
| `--min-disk <GiB>` | Free disk required, 20 by default [`SPAWNER_MIN_DISK_GB`] |
| `--memory-limit <size>` | Memory of the Spawner container, such as `1536m` or `2g` (default `1g`, at least `512m`): Spawner uses about 150 MiB at rest, plus the git and `docker compose` processes it runs during builds (give `2g` to large monorepos), and the limit keeps it from taking the server's memory if something goes wrong [`SPAWNER_MEMORY_LIMIT`] |
| `--tls letsencrypt\|off` | `letsencrypt` by default; `off` for plain HTTP, for a local install (below) [`SPAWNER_TLS`] |
| `--image <image>` | An image of your own instead of `ghcr.io/flosk6/spawner` [`SPAWNER_IMAGE`] |
| `--yes`, `-y` | Ask nothing; fail when an answer is missing. Below 8 GiB, it also turns zram on, unless `--zram no` |
| `--allow-downgrade` | Install a version older than the installed one, after restoring a backup of its database ([operations](operations.md#upgrading)) |
| `--help`, `-h` | The options, and where this page is |

The options with a variable in brackets can also be given as that environment variable. `sudo` starts the installer with a clean environment, so variables exported in your shell do not reach it: put them on the `sudo` command line, or run the installer as root.

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh \
  | sudo SPAWNER_DOMAIN=preview.example.com SPAWNER_EMAIL=ops@example.com \
      bash -s -- --yes
```

A value on a command line lands in the shell's history and, while the installer runs, in the process list. For the DNS provider's token, read it into a variable as root instead, without echo:

```bash
sudo -i
read -rs CF_DNS_API_TOKEN && export CF_DNS_API_TOKEN    # paste it, then Enter
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh \
  | bash -s -- --domain preview.example.com --email ops@example.com \
      --dns-provider cloudflare --yes
```

### DNS providers

| Provider | Credentials | Where to get them |
|---|---|---|
| Cloudflare | `CF_DNS_API_TOKEN` | My Profile, API Tokens: a token with the permissions Zone: Read and DNS: Edit on the zone |
| OVH | `OVH_ENDPOINT` (`ovh-eu`), `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY` | `https://eu.api.ovh.com/createToken/`, with GET, POST and DELETE on `/domain/zone/*` |
| Hetzner | `HETZNER_API_TOKEN` | An API token with read and write access to the project holding the zone |
| Scaleway | `SCW_SECRET_KEY` | IAM, API keys, with the DNS permission |
| DigitalOcean | `DO_AUTH_TOKEN` | API, Tokens, with write access |
| Route 53 | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | An IAM user allowed `route53:GetChange`, `route53:ListHostedZonesByName`, `route53:ListResourceRecordSets` and `route53:ChangeResourceRecordSets` |
| Gandi | `GANDIV5_PERSONAL_ACCESS_TOKEN` | A personal access token allowed to manage the domain's technical configuration |
| Others | as listed for the provider on [the lego documentation](https://go-acme.github.io/lego/dns/) | `--dns-provider <code> --dns-env KEY=VALUE ...` |

The credentials go to `/opt/spawner/dns.env`, readable by root only, and only Traefik receives them; the answers typed for credentials are not shown. With Cloudflare, keep the DNS record "DNS only" (not proxied): Traefik serves the certificates itself.

## What the installer changes on the server

- **Docker**, if it is missing, from get.docker.com.
- **`/etc/docker/daemon.json`**, adding the settings that are not there yet (it never overwrites yours), then restarts Docker:
  - `log-driver: local`, 3 files of 10 MB per container: compressed logs with a cap;
  - `builder.gc`: the build cache is kept under 15 % of the disk (between 5 and 20 GB);
  - `default-address-pools` in /24: enough addresses for hundreds of environment networks;
  - `live-restore`: containers keep running while Docker restarts;
  - on a Docker installed by the installer only, `"containerd-snapshotter": false`: images are stored once (overlay2) rather than twice. On an existing Docker it changes nothing, since switching would hide the images already there.
- **zram**, if you accept it (or with `--yes`): `zram-tools`, half of the memory, zstd.
- **nftables** (`nft`), if it is missing, and **`/etc/systemd/system/docker.service.d/spawner-firewall.conf`**: Docker loads the rules of `/opt/spawner/firewall.nft` before it starts any container, so that after a reboot no environment runs a moment without them ([security](security.md#isolation)). The rules sit in a table of their own (`inet spawner`), which Docker, ufw and firewalld leave alone.
- **`/opt/spawner`**: `compose.yaml`, `.env` (settings and secrets), `dns.env`, `spawner.env` (settings of your own, never overwritten), `firewall.nft`, `backups/`; mode 700.
- **`/var/lib/spawner`**: the data directory (repository mirrors, environment sources, routes, job logs, deploy keys), mode 700.

Nothing else: no Node.js on the host, no system upgrade, no cron. Spawner itself, Postgres and Traefik run as containers named `spawner`, `spawner-postgres` and `spawner-traefik`; `spawner-firewall` loads the rules of the environments again every minute.

## Network

**Inbound**: ports 80 and 443, which Traefik publishes (plus your SSH). Nothing else is published: Spawner's API answers through Traefik only, and its database and the services of the environments are not reachable from outside. If a firewall filters the server, open 80 and 443.

**Outbound**, the server reaches:

- during the installation: `api.ipify.org` (the server's public address, to check the DNS record), get.docker.com and Docker's package repository (when Docker is missing), the distribution's mirrors (zram), `ghcr.io` (Spawner's image), Docker Hub (Postgres and Traefik), and GitHub (the installer itself, and the latest version for `--version latest`);
- for certificates: Let's Encrypt, and with a wildcard certificate the DNS provider's API and the resolvers `1.1.1.1` and `8.8.8.8` on port 53;
- every 6 hours, `api.github.com` for the list of releases (`SPAWNER_UPDATE_CHECK=false` stops it), and `ghcr.io` when an admin updates Spawner;
- `github.com` and `api.github.com` at each GitHub login, when it is turned on;
- for environments: the git hosts of your repositories, the registries of the images your compose files use, and whatever the applications themselves call ([security](security.md)).

**No telemetry.** Spawner sends nothing about your server, your projects or your people; the request for the list of releases carries only Spawner's version, in its `User-Agent`. Traefik's own version check and usage statistics are turned off, and the dashboard loads nothing from another site.

## Upgrading

Admins update Spawner from the dashboard (**Update to X** on the System page, once a new version is out), with nothing to run on the server. The installer does the same from the server:

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh \
  | sudo bash -s -- --upgrade
```

`--version 2.1.0` picks a version. [Operations](operations.md#upgrading) describes what an upgrade does and how to go back.

Running the installer again without `--upgrade` keeps everything as it is: the version, the domain, the secrets, the memory of the Spawner container. Give an option to change a value, such as `--dns-provider` to move from one certificate per URL to a wildcard, or `--memory-limit 2g`.

## Removing Spawner

To stop Spawner and its environments, keeping the data (rerun the installer to start again):

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh \
  | sudo bash -s -- --uninstall
```

To delete everything Spawner created:

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh \
  | sudo bash -s -- --uninstall --purge
```

`--purge` asks you to type "delete everything", unless `--yes`. It deletes:

- every environment, with its containers, volumes, networks and images;
- Spawner's database and certificates;
- `/var/lib/spawner`;
- the firewall rules (the table `inet spawner`) and Docker's drop-in `spawner-firewall.conf`;
- `/opt/spawner`, **its backups and `.env` included**, which holds the master secret: copy `/opt/spawner/backups/` and `.env` elsewhere first if you may come back ([operations](operations.md#restoring)).

What stays: Docker and its settings, nftables, zram, the images of Spawner, Postgres and Traefik, the images environments pulled (a database's, for example), Docker's build cache, and `/etc/cron.d/spawner-backup` if you created it ([operations](operations.md#backups)).

## A local install

The installer needs Ubuntu or Debian: a server, a Linux laptop or a Linux VM. To try Spawner there, without a domain, over plain HTTP:

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh \
  | sudo bash -s -- --tls off --domain localtest.me --yes
```

It changes Docker's settings and restarts Docker (above), and below 8 GiB turns zram on: add `--zram no` to keep your machine as it is.

Every subdomain of `localtest.me` resolves to 127.0.0.1, on the machine that runs the browser: the dashboard is `http://spawner.localtest.me`, environments `http://<env>--<project>.localtest.me`. In a VM, open them from a browser inside the VM, or forward the VM's port 80 to the host's. Over plain HTTP, browsers allow passkeys on `localhost` only, so a local install lets invitations log in without one.

**On macOS**, the installer does not run. The repository's own stack does, with Docker Desktop or OrbStack:

```bash
git clone https://github.com/Flosk6/Spawner.git && cd Spawner
cp .env.example .env          # then set SPAWNER_DATA_DIR to an absolute path
docker compose up -d --build  # builds and starts Spawner, Postgres, Traefik
docker logs spawner           # the link that creates the first admin account
```

Put the data directory under your home, which Docker Desktop shares with its VM. The stack builds the code checked out (`git checkout v2.1.0` for a release) and serves the dashboard on `http://spawner.localtest.me`, and on `http://localhost:8080`, where browsers allow passkeys. It is the stack Spawner's own tests run, for a trial, not for a team. On Windows, use a Linux VM.

## When something goes wrong

| Symptom | What to check |
|---|---|
| `... is not supported: Ubuntu 22.04 or 24.04, or Debian 12` | The installer is tested on those systems. On another one (Ubuntu 26.04, Debian 13), `SPAWNER_SKIP_OS_CHECK=1` tries anyway: `curl ... \| sudo SPAWNER_SKIP_OS_CHECK=1 bash`. |
| `port 80 is taken` | Another web server (nginx, Apache, Caddy) runs on the server. Spawner needs ports 80 and 443 for its proxy: stop it, or use another server. |
| `the Docker Compose plugin is missing` | Docker came from the distribution's packages. On Ubuntu, `apt-get install docker-compose-v2`; elsewhere, install [Docker's own packages](https://docs.docker.com/engine/install/), which include `docker-compose-plugin`. |
| No certificate after a few minutes | `docker logs spawner-traefik`. Usually the DNS record (`dig +short spawner.<domain>` must give the server's address) or the provider's credentials. Let's Encrypt retries by itself. |
| `the images could not be downloaded` | The server must reach `ghcr.io`. Check `--version`: it must be a published release. |
| The admin link expired | `docker exec -u node spawner node dist/admin.js invite --role admin` prints a new one, valid 24 hours. |
| `... holds an installation this installer did not make` | `/opt/spawner/.env` was not written by this installer (its first line is not the installer's): a Spawner 1.x, or another tool's file. Back `/opt/spawner` up, remove it, and run the installer again. |
| Spawner does not start | `docker logs spawner`, and `docker compose --project-directory /opt/spawner ps`. |
| Spawner restarts by itself | `docker inspect -f '{{.State.OOMKilled}}' spawner`: `true` means it reached its memory limit. Rerun the installer with `--memory-limit 2g`. |
| A container cannot reach a service of the server | On purpose: containers reach the server on DNS, HTTP and HTTPS only (`/opt/spawner/firewall.nft`). Publish the service on a port, or run it in the environment. `nft list table inet spawner` shows the rules in place. |

Problems with environments, once Spawner runs, are in [troubleshooting](troubleshooting.md); running a server day to day in [operations](operations.md).
