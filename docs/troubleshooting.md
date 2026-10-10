# Troubleshooting

When a Spawner preview environment does not start, does not answer or does not wake up: the message you see, what it means, and what to do.

Problems with the installation itself are in [install](install.md#when-something-goes-wrong). For everything else, three commands show most causes:

```bash
spawner status <env>             # each service, its restarts, the last events
spawner logs <env> --job         # the log of the last job: build, start, seed
spawner logs <env> <service> --errors
```

In the dashboard, the page of the environment has the same: its services, the **Jobs** tab, the **Logs** tab. The CLI's exit codes are in [the CLI](cli.md#exit-codes).

## The project is not registered

```text
error: project "blog" is not registered on https://spawner.preview.example.com
an admin creates it in the dashboard (Projects), with the repository and the directory of .spawner/
```

Spawner only runs the projects an admin registered, under the slug that `project` gives in `.spawner/spawner.yaml`. An admin adds it (**Projects**, **New project**), or fixes a slug that differs by a letter ([quickstart](quickstart.md#register-the-project)).

In a monorepo, the project also says where `.spawner/` is:

```text
error: spawner.yaml is in apps/blog, but project blog expects it in the root
an admin sets the project's root directory in the dashboard (Projects)
```

The project's **Directory** (Projects, the project, **Edit**) must be the directory that holds `.spawner/`, relative to the root of the repository.

## Not logged in (exit code 3)

```text
error: invalid, expired or revoked token
the token is invalid, expired or revoked: run spawner login https://spawner.preview.example.com
```

A login lasts 90 days, and the tokens of a deactivated account stop working. Without any login on the machine, the message is `not logged in`. Run `spawner login` again; `spawner whoami` shows the server, the account and the token in use. In CI, `SPAWNER_URL` and `SPAWNER_TOKEN` win over the stored login.

## Quota or capacity (exit code 6)

Every person may own 5 live environments by default, sleeping ones included:

```text
error: You have 5 environments, the most a person may have (sleeping ones included)
delete one you no longer need (spawner ls, then spawner down <env>), or ask an admin to raise the limit
```

The server refuses a new environment, a start or a wake-up when it lacks the memory (or, for a new one, the disk) that an environment of the project typically uses:

```text
error: Not enough memory on the server: 2.6 GiB available, about 2.0 GiB needed with 1.0 GiB kept free
put an environment to sleep or delete one (spawner ls), or try again later
```

A build also waits up to two minutes for 2 GiB of memory available, then fails with the same exit code:

```text
master failed during preparing: Insufficient memory: 1.40GB available, 2.00GB required. Please wait for other builds to complete or free up memory.
```

Uploads queue too: a person may have 5 deploys of uploaded code waiting to start, since each keeps its archive on the server until it runs.

```text
error: You have 5 deploys of uploaded code waiting to start, the most a person may have
wait for one of them to start (spawner status shows its job), then deploy again
```

`spawner capacity` says how many more environments of each project fit, and what limits them. To make some capacity: `spawner sleep <env>` or `spawner down <env>` on environments nobody uses, a smaller `limits.memory` in `spawner.yaml` ([the manifest](manifest.md#memory-limits)), or a bigger server. Until a project's environments have run, Spawner counts their declared memory, 2 GiB by default: on a server below 4 GiB, an admin lowers **Memory of an environment** and **Memory available before a build** in Settings ([install](install.md#before-you-start)).

## The compose file is refused (exit code 7)

```text
error: refused before upload:
  services.app.ports: ports is not allowed (host ports are never published; declare an exposure in spawner.yaml)
fix these in .spawner/, then run spawner up again
```

`spawner up` checks `.spawner/` before sending anything, with the server's rules. Each line gives where (a path in the compose file, or `spawner.yaml: ...`), what, and in parentheses how to fix it. The compose policy is an allowlist: a key it does not know is refused too ([security](security.md#the-compose-policy), [the manifest](manifest.md#rules)). With `--json`, each issue also has a `code`: [the manifest](manifest.md#when-spawner-is-refused) lists them and what each one means.

A source taken from a repository the project does not list is refused the same way, before anything is sent: an admin adds the repository under **Source repositories**, in the project's settings.

```text
  spawner.yaml: sources.front.repo: source "front" comes from git@github.com:acme/blog-front.git, which is not among the source repositories of this project (ask an admin to add it to the source repositories in the project settings)
```

The server checks again, during validating: an environment started from the dashboard, or by a CLI of another version, fails there, with the same list in the job log (and `spawner up --wait` exits with code 7).

## The build fails (exit code 4)

```text
--- end of the job log (spawner logs master --job) ---
...
master failed during building: docker exited with code 1
...
Fix the cause, then run spawner up again.
```

The CLI prints the end of the job log; `spawner logs <env> --job` gives all of it. During building, it is the output of `docker compose up --build`: usually a step of a Dockerfile, which fails the same way on your machine (`docker build .`). During preparing, it is the checkout of a repository (see the deploy key in [the quickstart](quickstart.md#register-the-project)) or the upload.

During seeding, a step of `seed` failed:

- `seed step "npm run seed" exited with code 1`: its output is in the job log;
- `service "app" is not running`: the service the step runs in stopped;
- `seed step timed out after 10 minutes`.

## The environment never gets ready

The job fails during building, and its log ends with one of:

```text
container spn-blog--master-app-1 is unhealthy
container spn-blog--master-app-1 exited (1)
application not healthy after 5m0s
```

Spawner waits until every service runs and passes its healthcheck, 5 minutes at most. `spawner logs <env> app --errors` shows why a service exits: a missing variable, a database it cannot reach. A healthcheck runs inside the container: check its command, its interval and its `retries`, so that a slow start still fits in the 5 minutes (`SPAWNER_START_TIMEOUT_SECONDS`, [configuration](configuration.md#engine)).

## The URL answers Bad Gateway

Traefik reaches each exposed service from another container, at `http://<service>:<port>`. "Bad Gateway" means nothing answers there, though the environment may say `ready`, since a healthcheck reaches `127.0.0.1` from inside:

- the application listens on `127.0.0.1` or `localhost`, as many development servers do by default: make it listen on `0.0.0.0` (`--host 0.0.0.0` for Vite, `--hostname 0.0.0.0` for `next dev`, `-b 0.0.0.0` for Rails, `--host=0.0.0.0` for `php artisan serve` and Flask);
- it listens on another port than the exposure's `port` in `spawner.yaml`.

A Vite development server that answers `Blocked request. This host (...) is not allowed` needs the preview domain in `server.allowedHosts`, such as `['.preview.example.com']`. [Your application behind Spawner](manifest.md#your-application-behind-spawner) lists what else an application needs.

## A service cannot reach the server or the cloud

The containers of an environment reach the server itself on DNS, HTTP and HTTPS only, and never the metadata service of a cloud (`169.254.169.254`, among others): the code of a branch could otherwise read the server's cloud credentials, or call a service listening on the server ([security](security.md#isolation)). A connection to another port of the server, such as a database installed on it, is refused at once. Run what the application needs (a database, a cache, a mail catcher) as a service of its compose file instead; addresses on the internet stay reachable.

## A service restarts or runs out of memory

`spawner status <env>` calls out a service that crashed three times in ten minutes, with its cause:

```text
api failed 3 times in 10 minutes, last cause: out of memory (limit 512 MiB)
```

A service without `mem_limit` gets an equal share of the memory the others leave in the environment, 512 MiB at most: give a heavy one a `mem_limit` of its own, and the environment more memory with `limits.memory` if needed ([the manifest](manifest.md#memory-limits)). Otherwise `spawner logs <env> <service> --errors` shows why it exits.

## The preview asks to log in

Every URL is protected unless its exposure says `auth: none`:

- **In a browser**, a teammate passes once logged in to the dashboard, in the same browser: the login page sends them back to the preview. If it keeps asking, the dashboard is not a host of the preview domain: Spawner warns about it at startup (`FRONTEND_URL`, [configuration](configuration.md#access)).
- **curl, Playwright, scripts and agents** get a 401, `{"error":"preview_auth_required", ...}`, without the header `X-Spawner-Preview`. `spawner url <env> --with-token` gives it, valid one hour for that environment ([the CLI](cli.md#url)).
- **Someone without an account** opens a share link: `spawner share <env>`, or the **Share** card on the page of the environment, which also revokes it.
- **A webhook or a public page**: `auth: none` on its exposure, once an admin turns on **Allow public URLs** for the project.

## A sleeping environment does not wake up

An environment sleeps after 2 hours without visits or actions; the next visit to one of its team URLs wakes it up. The waiting page says why it does not:

- "its public URLs do not wake it up": visits to `auth: none` URLs never count, so that a bot cannot keep an environment awake. Wake it with `spawner wake <env>` or **Wake up** on its page; for a webhook receiver, a longer `idle`, or `idle: never` if the project allows it.
- "Not enough memory on the server": waking needs the memory of a typical environment, as a creation does (above).
- "Someone stopped it": `spawner start <env>`.

Agents and scripts get a 503 with `Retry-After` while it wakes up: retry. An environment whose images someone deleted by hand (`docker system prune -a`) cannot wake up: redeploy it with `spawner up`.

## The CLI and the server versions differ

```text
$ spawner whoami
Ada (admin) on https://spawner.preview.example.com (Spawner 2.1.0, CLI 2.0.0)
```

The CLI checks `.spawner/` with its own copy of the rules, so a CLI older or newer than the server can refuse what the server accepts, or accept what it refuses. Install the server's version: `npm install -g spawner-cli@2.1.0`, or the copy the server serves ([the CLI](cli.md#versions-and-updates)).

## Certificates and DNS

- **A URL does not resolve**: the DNS record is missing or has not spread. `dig +short anything.preview.example.com` must give the server's address. The record covers one level, `*.preview.example.com`, which is where every URL lives (`feat-login--blog.preview.example.com`).
- **The browser warns about the certificate**: Traefik has none for that host yet. `docker logs spawner-traefik` says why: usually the DNS provider's credentials, for a wildcard certificate, or Let's Encrypt's limit of about 50 new certificates a week, with one certificate per URL. Move to a wildcard certificate by running the installer again with `--dns-provider` ([install](install.md#dns-providers)).
- **With Cloudflare**, keep the record "DNS only": Traefik serves the certificates, not Cloudflare's proxy.

## The disk is full

```text
master failed during preparing: Insufficient disk: 8.4GB free, 10.0GB required
```

A build needs 10 GiB free by default, and a new environment is refused when it would leave less. The System page shows what takes the disk (images, build cache, volumes, sources, logs) and raises an alert before it is full. Delete the environments nobody uses (the **Environments** page lists them all), shorten their **Lifetime** in Settings, remove what the **Cleanup** card lists, or grow the disk. Never run `docker system prune` on a Spawner server: it deletes sleeping environments ([operations](operations.md#disk)).
