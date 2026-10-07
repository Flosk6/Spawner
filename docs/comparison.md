# Spawner and the alternatives

Spawner does one thing: preview environments of every branch, on one server of your own, for a team and the coding agents working for it. Other tools cover some of that, and sometimes much more. This page says when another tool fits better.

## In short

| | Spawner | Self-hosted PaaS (Coolify, Dokploy) | Previews in CI (Preevy) | Hosted previews (Vercel, Netlify, Render, Railway...) |
|---|---|---|---|---|
| What it is for | Previews of branches, nothing else | Running your applications, production included; previews of pull requests as one feature | A preview per pull request, created by CI | Hosting, with previews of each pull request or branch |
| Where it runs | One server of yours, dedicated to previews | Your servers | Machines your CI creates in your cloud account | Their platform |
| Source of a preview | A branch, a tag, a commit, or a worktree with its uncommitted changes | A pull request | A pull request, from CI | A push or a pull request |
| Full stack (database, API, front, several repositories) | Yes, from Docker Compose | Yes | Yes, from Docker Compose | Mostly the front end; full stacks on some platforms |
| For coding agents | CLI with JSON outputs and exit codes, MCP server, logs filtered by errors, `exec` in any service | Through their API | Through CI | Through their CLI and API |
| Untrusted compose files | Checked against a policy before they run | Run as they are | Run as they are, each on its own machine | Not applicable |
| Many environments on one machine | Sleep and wake-up, shared layers, capacity | Not their focus | One machine per preview | Not your concern, but billed |

## When to prefer a self-hosted PaaS (Coolify, Dokploy)

Coolify and Dokploy run your applications, databases and their backups, on one or several servers, with a dashboard, domains and certificates; both can deploy a preview of each pull request.

Prefer them when you also want to host production or staging, when previews of pull requests are enough (rather than any branch or a local worktree), and when the people who deploy are trusted to run anything on the server. Spawner does not host production, and is not meant to: it assumes the server runs unreviewed code and treats compose files accordingly.

Spawner fits better when previews are the point: many short-lived environments of every branch, created by people and agents from their worktrees, protected by default, put to sleep when unused, on a server sized for them.

## When to prefer previews in CI (Preevy and similar)

Preevy takes a Docker Compose file and, from CI, brings a pull request up on a machine it provisions in your cloud account, then shares its URLs.

Prefer this model when each preview must be isolated on a machine of its own, when previews only matter for pull requests, or when your organization already provisions everything from CI. It costs a machine per preview and a few minutes of provisioning each time; Spawner keeps many environments on one server and creates them in seconds once their layers are built, but they share that server's kernel.

## When to prefer hosted previews (Vercel, Netlify, Render, Railway...)

If your application is mostly a front end, or already runs on one of these platforms, their previews come with nothing to operate: use them. Spawner is for stacks that need their own database, API and services next to each other, on infrastructure you control, at a fixed cost.

## When to prefer Kubernetes tooling

On a team that runs Kubernetes, a namespace per branch (Argo CD's pull request generator, Okteto, vcluster, or Helm in CI) reuses what you know and what you have. Spawner is for teams without a cluster, or that do not want one for previews: one server, Docker Compose, one installer.

## What Spawner does not do

- Production hosting, scaling, several servers: one server per installation.
- Pull request automation (an environment when a pull request opens, a comment with its URL): planned after 2.0; today, CI can call `spawner up` from the branch.
- Private image registries: images are public, or built from the sources. Repositories may live on any git host (SSH or HTTPS, with a deploy key).
- Single sign-on (OIDC) and permissions per project: planned.
- Isolation stronger than containers: environments share the server's kernel. See [security](security.md).
