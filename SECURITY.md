# Security policy

## Reporting a vulnerability

Report it privately, through [Report a vulnerability](https://github.com/Flosk6/Spawner/security/advisories/new) (the Security tab of the repository). Never in a public issue, a discussion or a pull request.

Include what you can: the version (`/api/v1/info` on the server, `spawner --version`), the part involved, how to reproduce it, and what an attacker gains. You get an answer within a week. The fix ships in a release, with a security advisory that credits you, unless you would rather not be named.

## Supported versions

Only the latest release gets security fixes. Upgrade with the Update button of the dashboard, or `install.sh --upgrade`.

## Scope

Spawner runs code from branches nobody has reviewed yet: its [trust model](docs/security.md#trust-model) says what it protects. Reports that matter most:

- the code of a branch, a compose file or an agent reaching the host, Spawner (its database, its secrets, the Docker socket), another environment, or traffic meant for them;
- access to the dashboard, the API, a protected preview or a terminal without the right session, token, role or share link;
- the installer or the release chain running or publishing something it should not.

Out of scope: what an admin can do (admins are trusted), what anyone with access to the server can do, and the limits listed in [what Spawner does not do (yet)](docs/security.md#what-spawner-does-not-do-yet).
