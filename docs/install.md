# Installing Spawner

Spawner runs on one Linux server dedicated to previews. One command installs it, with Docker if needed, and prints the link that creates the first admin account.

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh | sudo bash
```

## Before you start

**A server** dedicated to previews: environments run code from branches nobody has reviewed yet, so never put production or anything sensitive on the same machine ([security](security.md)).

| | Minimum | Advised |
|---|---|---|
| System | Ubuntu 22.04 or 24.04, Debian 12; amd64 or arm64 | Ubuntu 24.04 |
| Memory | 2 GiB | 8 GiB or more: memory decides how many environments run at once ([density](density.md)) |
| Disk | 20 GiB free | 80 GiB or more: images, volumes and build caches |
| Network | ports 80 and 443 free, reachable from the internet | |

**A domain for the previews**, such as `preview.example.com`, with one DNS record pointing to the server:

```text
*.preview.example.com.   A   203.0.113.10
```

Environments get `<env>--<project>.preview.example.com` and the dashboard `spawner.preview.example.com`: one level under the domain, so that one wildcard certificate covers them all. A domain of its own (rather than a subdomain of your company's main domain) keeps the cookies of your other sites away from the previews.

**For the certificate**, Spawner uses Let's Encrypt with one of two methods:

- **One wildcard certificate** (advised): Traefik proves it owns the domain through your DNS provider's API. You need an API token of the provider. New environments get HTTPS at once, without any limit.
- **One certificate per URL**: nothing to set up, but each new URL waits a few seconds for its certificate, and Let's Encrypt allows about 50 new certificates a week per domain. Fine to try Spawner, short for a team.

## The installation

Run the command above on the server, as root. The installer:

1. checks the system, the memory, the disk and the ports;
2. asks three questions: the domain, an e-mail for Let's Encrypt, and the DNS provider with its credentials;
3. checks that `*.<domain>` resolves to the server, and warns if not;
4. installs Docker (from get.docker.com) if it is missing, and configures it for many short-lived environments (below);
5. below 8 GiB of memory, offers compressed swap in memory (zram);
6. writes `/opt/spawner` (a Compose file, its secrets) and starts Postgres, Traefik and Spawner from the images on GHCR, then waits for the dashboard and its certificate;
7. prints the dashboard URL, a link valid one hour that creates the first admin account, and the commands that install the CLI.

It takes a few minutes. Open the admin link, choose a name and create a passkey: accounts have no password. Then invite the team from the Team page.

### Without questions

Every answer can be given as an option, or as the environment variable in brackets:

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh | sudo bash -s -- \
  --domain preview.example.com --email ops@example.com \
  --dns-provider cloudflare --dns-env CF_DNS_API_TOKEN=... --yes
```

| Option | |
|---|---|
| `--domain <domain>` | Domain of the previews [`SPAWNER_DOMAIN`] |
| `--email <address>` | Let's Encrypt account, for expiry notices [`SPAWNER_EMAIL`] |
| `--dns-provider <code>` | `cloudflare`, `ovh`, `hetzner`, `scaleway`, `digitalocean`, `route53`, `gandiv5`, another [lego code](https://go-acme.github.io/lego/dns/), or `none` for one certificate per URL [`SPAWNER_DNS_PROVIDER`] |
| `--dns-env KEY=VALUE` | A credential of the DNS provider, repeatable (or the variable itself) |
| `--version <version>` | Version to install, or `latest` (default: the installer's own) [`SPAWNER_VERSION`] |
| `--zram yes\|no` | Compressed swap, offered below 8 GiB [`SPAWNER_ZRAM`] |
| `--min-disk <GiB>` | Free disk required, 20 by default [`SPAWNER_MIN_DISK_GB`] |
| `--memory-limit <size>` | Memory of the Spawner container, such as `1536m` or `2g` (default `1g`, at least `512m`): Spawner uses about 150 MiB at rest, plus the git and `docker compose` processes it runs during builds (give `2g` to large monorepos), and the limit keeps it from taking the server's memory if something goes wrong [`SPAWNER_MEMORY_LIMIT`] |
| `--tls off` | Plain HTTP, for a local install (below) [`SPAWNER_TLS`] |
| `--image <image>` | An image of your own instead of `ghcr.io/flosk6/spawner` [`SPAWNER_IMAGE`] |
| `--yes` | Ask nothing; fail when an answer is missing |

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

The credentials go to `/opt/spawner/dns.env`, readable by root only, and only Traefik receives them.

## What the installer changes on the server

- **Docker**, if it is missing, from get.docker.com.
- **`/etc/docker/daemon.json`**, adding the settings that are not there yet (it never overwrites yours), then restarts Docker:
  - `log-driver: local`, 3 files of 10 MB per container: compressed logs with a cap;
  - `builder.gc`: the build cache is kept under 15 % of the disk (between 5 and 20 GB);
  - `default-address-pools` in /24: room for hundreds of environment networks;
  - `live-restore`: containers keep running while Docker restarts;
  - on a Docker installed by the installer only, `"containerd-snapshotter": false`: images are stored once (overlay2) rather than twice. On an existing Docker it changes nothing, since switching would hide the images already there.
- **zram**, if you accept it: `zram-tools`, half of the memory, zstd.
- **`/opt/spawner`**: `compose.yaml`, `.env` (settings and secrets), `dns.env`, `backups/`; mode 700.
- **`/var/lib/spawner`**: the data directory (repository mirrors, environment sources, routes, job logs, deploy keys).

Nothing else: no Node.js on the host, no system upgrade, no cron. Spawner itself, Postgres and Traefik run as containers named `spawner`, `spawner-postgres` and `spawner-traefik`.

## Upgrading

When a new version is out, admins see it on the System page of the dashboard, with an **Update** button: Spawner backs its database up, restarts on the new version, and goes back to the previous one if the new one does not start ([operations](operations.md#upgrading)). Nothing to run on the server.

The installer does the same from the server:

```bash
curl -fsSL https://github.com/Flosk6/Spawner/releases/latest/download/install.sh | sudo bash -s -- --upgrade
```

It backs the database up to `/opt/spawner/backups/` (the 5 most recent are kept), downloads the images of the new version and restarts Spawner, which applies its database migrations; if the new version does not start, it puts the previous one back. Environments keep running. `--version 2.1.0` picks a version; release notes are on the [releases page](https://github.com/Flosk6/Spawner/releases).

Running the installer again without `--upgrade` keeps everything as it is: the version, the domain, the secrets, the memory of the Spawner container. Give an option to change a value, such as `--dns-provider` to move from one certificate per URL to a wildcard, or `--memory-limit 2g`.

## Removing Spawner

```bash
sudo bash install.sh --uninstall           # stops Spawner and its environments; the data stays
sudo bash install.sh --uninstall --purge   # deletes Spawner, every environment with its data, and /var/lib/spawner
```

`--purge` asks you to type "delete everything", unless `--yes`. It removes only what Spawner created: containers, volumes, networks and images with its labels, and its own directories. Docker and its settings stay.

## A local install

To try Spawner on a laptop or a VM, without a domain, over plain HTTP:

```bash
sudo bash install.sh --tls off --domain localtest.me --yes
```

Every subdomain of `localtest.me` resolves to 127.0.0.1: the dashboard is `http://spawner.localtest.me`, environments `http://<env>--<project>.localtest.me`. Over plain HTTP, browsers allow passkeys on `localhost` only, so a local install lets invitations log in without one. To work on Spawner itself, see the [README](../README.md#development).

## When something goes wrong

| Symptom | What to check |
|---|---|
| `port 80 is taken` | Another web server (nginx, Apache, Caddy) runs on the server. Spawner needs ports 80 and 443 for its proxy: stop it, or use another server. |
| No certificate after a few minutes | `docker logs spawner-traefik`. Usually the DNS record (`dig +short spawner.<domain>` must give the server's address) or the provider's credentials. Let's Encrypt retries by itself. |
| `the images could not be downloaded` | The server must reach `ghcr.io`. Check `--version`: it must be a published release. |
| The admin link expired | `docker exec -u node spawner node dist/admin.js invite --role admin` prints a new one. |
| Spawner does not start | `docker logs spawner`, and `docker compose --project-directory /opt/spawner ps`. |
| Spawner restarts by itself | `docker inspect -f '{{.State.OOMKilled}}' spawner`: `true` means it reached its memory limit. Rerun the installer with `--memory-limit 2g`. |

More in [operations](operations.md).
