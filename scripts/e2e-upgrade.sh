#!/usr/bin/env bash
#
# End-to-end test of the upgrade a server takes at the next release, from the
# latest release to this build, on a throwaway Ubuntu machine with Docker and
# sudo (the CI runner). The release is the latest GitHub lists when the test
# starts: its install.sh comes from that tag, checked against the release's
# SHA256SUMS. Once with each way to upgrade:
#   1. installs the release with its own install.sh, over HTTP on
#      localtest.me; with the CLI that server serves, deploys
#      examples/node-postgres twice, adds a row to the database of each, and
#      puts the second to sleep
#   2. upgrades to the image built beforehand, either
#      - with this build's install.sh --upgrade, on a server whose Traefik
#        gave up its routes: files 0640 as Spawner 2.1 wrote them, in a
#        directory 0700, and Traefik restarted on them answers its own 404 on
#        every URL, as after the update from 2.1 to 2.2. The installer must
#        make them readable and start Traefik again
#      - or from the dashboard (the API of its Update button): the release's
#        Spawner starts this build's installer, offered as its next version.
#        The release runs under a local name there: an update takes the image
#        from the repository of the one running, and the installer pulls the
#        images of the official repository
#   3. checks through Traefik, never the API's own port: the database of the
#      release was backed up; the route directory and files are readable
#      (755, 644); the dashboard answers its page and its health, not
#      Traefik's 404; the awake environment answers a 401 without a token
#      and its page with one, its row kept; the sleeping one gets the
#      waiting page, then wakes up with its row
#   4. removes everything with --uninstall --purge
#
# Usage: IMAGE=spawner:ci scripts/e2e-upgrade.sh
# It changes the machine (Docker settings, /opt/spawner, /var/lib/spawner):
# never run it on a machine you care about. What it does before an upgrade
# runs on the release: keep it to what that release can do.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
IMAGE=${IMAGE:-spawner:ci}
WORK="$(mktemp -d)"
DASHBOARD="http://spawner.localtest.me"
REPOSITORY="https://github.com/Flosk6/Spawner"
DATA=/var/lib/spawner
export SPAWNER_URL="$DASHBOARD" SPAWNER_TOKEN="" SPAWNER_CONFIG_DIR="$WORK/cli-config"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
# fail MESSAGE: stops the test with the last logs of Spawner and Traefik, on
# stderr, so that they show from a command substitution too.
fail() {
  printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2
  { sudo docker logs --tail 60 spawner; sudo docker logs --tail 20 spawner-traefik; } >&2 2>&1 || true
  exit 1
}
pass() { printf '\033[32mok\033[0m %s\n' "$*"; }
json() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);const r=($1);console.log(typeof r==='string'?r:JSON.stringify(r))})"
}
api() {
  local method=$1 path=$2
  shift 2
  curl -sS -X "$method" -H "Authorization: Bearer $SPAWNER_TOKEN" "$DASHBOARD/api/v1$path" "$@"
}
spawner() { node "$WORK/spawner" "$@"; }
# preview ENV TOKEN [PATH]: a request to an environment of the project, through Traefik, with a preview token.
preview() {
  curl -sS --max-time 10 -H "Host: $1--example.localtest.me" -H "X-Spawner-Preview: $2" "http://127.0.0.1${3:-/}"
}
# feed VERSION: the list of releases Spawner reads (SPAWNER_RELEASES_URL), with this one only.
feed() {
  printf '[{"tag_name":"v%s","name":"Spawner %s","html_url":"https://example.invalid/v%s","prerelease":false,"draft":false}]\n' "$1" "$1" "$1" |
    sudo tee "$DATA/e2e-releases.json" >/dev/null
}
# update_state: the state of the last update started from the dashboard, or "away" while Spawner restarts.
update_state() {
  api GET /system/update 2>/dev/null | json '(v.run && v.run.state) || "none"' 2>/dev/null || echo away
}
# wait_update STATE SECONDS: waits until the last update has this state.
wait_update() {
  for _ in $(seq 1 $(($2 / 3))); do
    [ "$(update_state)" = "$1" ] && return 0
    sleep 3
  done
  return 1
}

# install_release LOG [OPTION...]: installs the release with its own
# install.sh, its Spawner reading the list of releases from a file of the
# test, then takes the CLI that server serves.
install_release() {
  local log=$1
  shift
  SPAWNER_TOKEN=$(openssl rand -hex 24)
  sudo mkdir -p /opt/spawner
  echo "SPAWNER_RELEASES_URL=file://$DATA/e2e-releases.json" | sudo tee /opt/spawner/spawner.env >/dev/null
  sudo env SPAWNER_BOOTSTRAP_TOKEN="$SPAWNER_TOKEN" bash "$WORK/release/install.sh" --tls off --domain localtest.me --yes --min-disk 5 "$@" 2>&1 | tee "$log" ||
    fail "the installer of $RELEASE failed: $(tail -5 "$log")"
  grep -q "Spawner $RELEASE is running" "$log" || fail "the installer of $RELEASE should end with its summary"
  feed "$RELEASE"
  curl -fsS "$DASHBOARD/api/v1/cli/spawner" -o "$WORK/spawner"
}

# deploy NAME: deploys examples/node-postgres as the environment NAME with the
# release's CLI, adds a row of its own to its database, and prints its id.
deploy() {
  local up out
  up=$(cd "$WORK/app" && spawner up "$1" --wait --json) || fail "spawner up $1 failed: $up"
  [ "$(echo "$up" | json 'v.environment.status')" = "ready" ] || fail "$1 should be ready: $up"
  out=$(cd "$WORK/app" && spawner exec "$1" db -- psql -U app -d app -c "INSERT INTO users (name) VALUES ('$1 before the upgrade')" 2>&1) ||
    fail "spawner exec should add a row to the database of $1: $out"
  echo "$up" | json 'v.environment.id'
}

# before_upgrade: on the release, the project and two environments with a
# row of their own each, the second asleep. Sets AWAKE and ASLEEP, their ids.
before_upgrade() {
  local asleep
  [ "$(api POST /projects -H 'Content-Type: application/json' \
    -d '{"slug":"example","name":"Example","repoUrl":"https://github.com/Flosk6/Spawner.git"}' | json 'v.slug')" = "example" ] ||
    fail "the project should be created on $RELEASE"
  AWAKE=$(deploy e2e-awake)
  ASLEEP=$(deploy e2e-asleep)
  asleep=$(cd "$WORK/app" && spawner sleep e2e-asleep --json) || fail "spawner sleep failed: $asleep"
  [ "$(echo "$asleep" | json 'v.environment.status')" = "sleeping" ] || fail "e2e-asleep should sleep: $asleep"
  pass "on $RELEASE, with its CLI: e2e-awake and e2e-asleep deployed, a row added to each, e2e-asleep asleep"
}

# upgraded: what the upgraded server serves, through Traefik.
upgraded() {
  local code token
  [ -n "$(sudo find /opt/spawner/backups -name "spawner-*-$RELEASE.sql.gz" -size +1k)" ] || fail "the upgrade should back the database of $RELEASE up"
  [ "$(sudo stat -c %a "$DATA/traefik")" = "755" ] || fail "the route directory should be readable by Traefik, not $(sudo stat -c %a "$DATA/traefik")"
  [ -z "$(sudo find "$DATA/traefik" -name '*.yaml' ! -perm 644)" ] ||
    fail "the routes should be readable by Traefik: $(sudo find "$DATA/traefik" -name '*.yaml' ! -perm 644 -exec stat -c '%a %n' {} +)"
  code=$(curl -s -o "$WORK/dashboard.html" -w '%{http_code}' --max-time 10 "$DASHBOARD/")
  [ "$code" = "200" ] && grep -q '<div id="app">' "$WORK/dashboard.html" ||
    fail "the dashboard should answer through Traefik, not $code: $(head -c 200 "$WORK/dashboard.html")"
  [ "$(curl -fsS "$DASHBOARD/api/v1/healthz" | json 'v.status')" = "ok" ] || fail "the API should answer through Traefik"
  pass "the database of $RELEASE was backed up; Traefik reads its routes (755, 644) and serves the dashboard"

  [ "$(api GET "/envs/$AWAKE" | json 'v.status')" = "ready" ] || fail "e2e-awake should still be ready: $(api GET "/envs/$AWAKE")"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: e2e-awake--example.localtest.me" -H 'Accept: application/json' http://127.0.0.1/)
  [ "$code" = "401" ] || fail "without a token, e2e-awake should answer a 401 through Traefik, not $code"
  token=$(api POST "/envs/$AWAKE/preview-token" | json 'v.token')
  [[ "$(preview e2e-awake "$token")" == *"Hello from Spawner (e2e-awake)"* ]] || fail "e2e-awake should answer through Traefik: $(preview e2e-awake "$token")"
  [[ "$(preview e2e-awake "$token" /users)" == *"e2e-awake before the upgrade"* ]] || fail "e2e-awake should keep its data: $(preview e2e-awake "$token" /users)"
  pass "e2e-awake: a 401 without a token, its page with one, its data kept"

  [ "$(api GET "/envs/$ASLEEP" | json 'v.status')" = "sleeping" ] || fail "e2e-asleep should still sleep: $(api GET "/envs/$ASLEEP")"
  token=$(api POST "/envs/$ASLEEP/preview-token" | json 'v.token')
  code=$(curl -s -o "$WORK/wake.html" -D "$WORK/wake.headers" -w '%{http_code}' --max-time 10 \
    -H "Host: e2e-asleep--example.localtest.me" -H "X-Spawner-Preview: $token" -H 'Accept: text/html' http://127.0.0.1/)
  [ "$code" = "503" ] && grep -qi '^x-spawner-wake:' "$WORK/wake.headers" && grep -q 'Waking up: e2e-asleep (example)' "$WORK/wake.html" ||
    fail "a visit to e2e-asleep should get the waiting page, not $code: $(head -c 300 "$WORK/wake.html")"
  for _ in $(seq 1 60); do
    [[ "$(preview e2e-asleep "$token" /users)" == *"e2e-asleep before the upgrade"* ]] && break
    sleep 2
  done
  [[ "$(preview e2e-asleep "$token" /users)" == *"e2e-asleep before the upgrade"* ]] ||
    fail "the visit should wake e2e-asleep up, its data kept: $(preview e2e-asleep "$token" /users)"
  pass "e2e-asleep: the waiting page, then its page once awake, its data kept"
}

# remove: --uninstall --purge with this build's installer, which must leave nothing.
remove() {
  sudo bash install.sh --uninstall --purge --yes >"$WORK/uninstall.log" 2>&1 || fail "--uninstall --purge failed: $(tail -5 "$WORK/uninstall.log")"
  [ -z "$(sudo docker ps -aq --filter label=dev.spawner.env)" ] && [ -z "$(sudo docker ps -aq --filter name='^spawner')" ] ||
    fail "--uninstall --purge should leave no container"
  [ ! -e /opt/spawner ] && [ ! -e "$DATA" ] || fail "--uninstall --purge should leave no file"
  pass "--uninstall --purge removed everything"
}

step "Finding the latest release"
# GitHub's redirect names the tag of the latest release: the test keeps to
# it, even when another release comes out while it runs.
location=$(curl -fsS -o /dev/null -w '%{redirect_url}' "$REPOSITORY/releases/latest/download/install.sh") || fail "GitHub does not answer"
TAG=$(printf '%s\n' "$location" | sed -n 's|^.*/releases/download/\(v[^/]*\)/install\.sh$|\1|p')
[ -n "$TAG" ] || fail "the latest release could not be found: $location"
RELEASE=${TAG#v}
mkdir -p "$WORK/release"
curl -fsSL "$REPOSITORY/releases/download/$TAG/install.sh" -o "$WORK/release/install.sh" &&
  curl -fsSL "$REPOSITORY/releases/download/$TAG/SHA256SUMS" -o "$WORK/release/SHA256SUMS" ||
  fail "the install.sh of $TAG and its SHA256SUMS could not be downloaded"
(cd "$WORK/release" && sha256sum --ignore-missing -c SHA256SUMS) >/dev/null || fail "the install.sh of $TAG does not match its SHA256SUMS"
cp -R "$ROOT/examples/node-postgres" "$WORK/app"
rm -rf "$WORK/app/node_modules"
pass "the latest release is $RELEASE; its install.sh matches its checksum"

step "Installing $RELEASE"
install_release "$WORK/install.log"
before_upgrade

step "Upgrading with install.sh a server whose Traefik gave up its routes"
# Routes as Spawner 2.1 wrote them, in a closed directory: Traefik, once
# restarted, answers its own 404 on every URL, as on servers updated from 2.1
# to 2.2. The upgrade must make them readable, and start Traefik again.
sudo chmod 700 "$DATA/traefik"
sudo find "$DATA/traefik" -name '*.yaml' -exec chmod 640 {} +
sudo docker restart spawner-traefik >/dev/null
for _ in $(seq 1 15); do
  [ "$(curl -s --max-time 5 "$DASHBOARD/api/v1/healthz")" = "404 page not found" ] && break
  sleep 1
done
[ "$(curl -s --max-time 5 "$DASHBOARD/api/v1/healthz")" = "404 page not found" ] ||
  fail "Traefik should answer its own 404 once it cannot read its routes, not: $(curl -s --max-time 5 "$DASHBOARD/api/v1/healthz")"
sudo bash install.sh --upgrade --image "$IMAGE" --yes 2>&1 | tee "$WORK/upgrade.log" || fail "install.sh --upgrade failed: $(tail -5 "$WORK/upgrade.log")"
grep -q "made readable by Traefik" "$WORK/upgrade.log" || fail "install.sh should say it made the routes readable"
[ "$(sudo docker inspect -f '{{.Config.Image}}' spawner)" = "$IMAGE" ] || fail "Spawner should run $IMAGE, not $(sudo docker inspect -f '{{.Config.Image}}' spawner)"
pass "Traefik answered its own 404 everywhere; install.sh --upgrade moved $RELEASE to this build and made the routes readable"
upgraded
remove

step "Installing $RELEASE under a local name"
# The image of the release, as its install.sh names it, and this build
# offered as the next version, both in the repository the dashboard then
# updates from.
digest=$(sed -n 's/^IMAGE_DIGEST="\(.*\)"$/\1/p' "$WORK/release/install.sh")
published="ghcr.io/flosk6/spawner:$RELEASE"
[ -z "$digest" ] || published="ghcr.io/flosk6/spawner@$digest"
sudo docker pull -q "$published" >/dev/null || fail "the image of $RELEASE could not be pulled: $published"
sudo docker tag "$published" "spawner-e2e:$RELEASE"
IFS=. read -r major minor patch <<<"${RELEASE%%-*}"
NEXT="$major.$minor.$((patch + 1))"
printf 'FROM %s\nENV SPAWNER_VERSION=%s\n' "$IMAGE" "$NEXT" | sudo docker build -q -t "spawner-e2e:$NEXT" - >/dev/null
install_release "$WORK/install-local.log" --image "spawner-e2e:$RELEASE"
before_upgrade

step "Updating from the dashboard"
feed "$NEXT"
[ "$(api POST /system/update/check | json 'v.managed + " " + (v.latest && v.latest.version)')" = "true $NEXT" ] ||
  fail "the dashboard of $RELEASE should offer $NEXT: $(api GET /system/update)"
[ "$(api POST /system/update -o /dev/null -w '%{http_code}')" = "202" ] || fail "the update to $NEXT should start"
wait_update succeeded 400 || fail "the update to $NEXT should succeed, not end $(update_state): $(api GET /system/update)"
[ "$(api GET /info | json 'v.version')" = "$NEXT" ] || fail "Spawner should run this build, as $NEXT"
pass "the dashboard of $RELEASE updated Spawner to this build, as $NEXT"
upgraded
remove

step "All upgrade checks passed"
