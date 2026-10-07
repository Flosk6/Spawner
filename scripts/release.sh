#!/usr/bin/env bash
#
# Prepares a release: sets the version of every package.json and the
# default version of install.sh, commits, and tags. Pushing the tag starts
# the Release workflow (.github/workflows/release.yml), which publishes the
# images, the CLI and the GitHub release.
#
# Usage: scripts/release.sh 2.0.1        (then: git push origin <branch> v2.0.1)
#        scripts/release.sh 2.1.0-rc.1   (a prerelease: versions stay, only the tag is made)
#
# Write the CHANGELOG.md section of the version first: its text becomes the
# release notes.

set -euo pipefail
cd "$(dirname "$0")/.."

version=${1:?usage: scripts/release.sh <version>}
version=${version#v}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "error: $version is not a version" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "error: commit or stash your changes first" >&2; exit 1; }
! git rev-parse -q --verify "refs/tags/v$version" >/dev/null || { echo "error: v$version already exists" >&2; exit 1; }

if [[ "$version" != *-* ]]; then
  grep -q "^## $version$" CHANGELOG.md || { echo "error: CHANGELOG.md has no \"## $version\" section" >&2; exit 1; }
  for file in package.json apps/*/package.json packages/*/package.json; do
    # shellcheck disable=SC2016 # JavaScript, not shell
    node -e '
      const fs = require("fs");
      const [file, version] = process.argv.slice(1);
      const text = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, text.replace(/"version": "[^"]*"/, `"version": "${version}"`));
    ' "$file" "$version"
  done
  sed -i.bak "s/^DEFAULT_VERSION=\"[^\"]*\"$/DEFAULT_VERSION=\"$version\"/" install.sh && rm install.sh.bak
  git add package.json apps/*/package.json packages/*/package.json install.sh
  git diff --cached --quiet || git commit -q -m "chore(release): $version"
fi

git tag -a "v$version" -m "Spawner $version"
echo "Tagged v$version. Publish it with: git push origin $(git branch --show-current) v$version"
