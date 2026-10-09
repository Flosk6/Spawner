#!/usr/bin/env bash
#
# End-to-end test of install.sh, in local mode, on a throwaway Ubuntu machine
# with Docker and sudo (the CI runner):
#   1. installs Spawner with an image built beforehand (--image, tagged with
#      its version as a release image is), over HTTP on localtest.me, and
#      checks the dashboard and the first admin link
#   2. deploys examples/node-postgres with the CLI downloaded from the server,
#      calls its URL with a preview token, and asks the MCP server its status;
#      the environment reaches neither the metadata service of the cloud the
#      runner lives in nor a service of the host, but the previews and the
#      internet; the rules load before Docker, and come back when flushed
#   3. two agents deploy examples/laravel-next-mysql from two branches of the
#      same repository at once, then update both at once: each environment
#      serves its own branch and keeps its own data, and its own part of the
#      disk holds neither vendor nor node_modules (shared between them)
#   4. updates from the dashboard (the API of its Update button) to a newer
#      version, then to a version that does not start: Spawner goes back to
#      the version before by itself, with its database
#   5. upgrades with the installer: the database is backed up, the
#      environment keeps running
#   6. runs it again without options: the secrets stay
#   7. removes everything with --uninstall --purge: nothing may be left, the
#      rules and Docker's drop-in included
#
# Usage: IMAGE=spawner:ci scripts/e2e-installer.sh
# It changes the machine (Docker settings, /opt/spawner, /var/lib/spawner):
# never run it on a machine you care about.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
IMAGE=${IMAGE:-spawner:ci}
WORK="$(mktemp -d)"
DASHBOARD="http://spawner.localtest.me"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() {
  printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2
  sudo docker logs --tail 60 spawner 2>&1 || true
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
secret() { sudo grep "^$1=" /opt/spawner/.env | cut -d= -f2; }
# feed VERSION: the list of releases Spawner reads (SPAWNER_RELEASES_URL), with this one only.
feed() {
  printf '[{"tag_name":"v%s","name":"Spawner %s","html_url":"https://example.invalid/v%s","prerelease":false,"draft":false}]\n' "$1" "$1" "$1" |
    sudo tee /var/lib/spawner/e2e-releases.json >/dev/null
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
# replace FILE FROM TO: replaces a text in a file.
replace() {
  node -e "const fs = require('fs'); const [file, from, to] = process.argv.slice(1); const text = fs.readFileSync(file, 'utf8'); if (!text.includes(from)) process.exit(1); fs.writeFileSync(file, text.replace(from, to))" "$@" \
    || fail "$2 is not in $1"
}

step "Installing in local mode"
VERSION=$(sed -n 's/^DEFAULT_VERSION="\(.*\)"$/\1/p' install.sh)
# Tagged with its version, as a release image is: the dashboard then offers updates.
INSTALLED="spawner-e2e:$VERSION"
sudo docker tag "$IMAGE" "$INSTALLED"
sudo mkdir -p /opt/spawner
echo "SPAWNER_RELEASES_URL=file:///var/lib/spawner/e2e-releases.json" | sudo tee /opt/spawner/spawner.env >/dev/null
sudo bash install.sh --tls off --domain localtest.me --image "$INSTALLED" --yes --min-disk 5 | tee "$WORK/install.log"
grep -q "Spawner $VERSION is running" "$WORK/install.log" || fail "the installer should end with its summary, for Spawner $VERSION"
[ "$(secret SPAWNER_VERSION)" = "$VERSION" ] || fail "the installation should be of Spawner $VERSION, not $(secret SPAWNER_VERSION)"
grep -q "First admin   http://spawner.localtest.me/invite/" "$WORK/install.log" || fail "the installer should print the first admin link"
[ "$(curl -fsS "$DASHBOARD/api/v1/healthz" | json 'v.status')" = "ok" ] || fail "the dashboard should answer through Traefik"
for file in .env dns.env spawner.env; do
  [ "$(sudo stat -c %a "/opt/spawner/$file")" = "600" ] || fail "$file should be readable by root only, not $(sudo stat -c %a "/opt/spawner/$file")"
done
sudo grep -q '"log-driver": "local"' /etc/docker/daemon.json || fail "Docker should keep compressed, capped logs"
SPAWNER_TOKEN=$(secret SPAWNER_BOOTSTRAP_TOKEN)
export SPAWNER_URL="$DASHBOARD" SPAWNER_TOKEN SPAWNER_CONFIG_DIR="$WORK/cli-config"
pass "install.sh set Spawner up: the dashboard answers on $DASHBOARD, the first admin link is printed"

step "Deploying with the CLI, calling the MCP server"
curl -fsS "$DASHBOARD/api/v1/cli/spawner" -o "$WORK/spawner"
spawner() { node "$WORK/spawner" "$@"; }
api POST /projects -H 'Content-Type: application/json' \
  -d '{"slug":"example","name":"Example","repoUrl":"https://github.com/Flosk6/Spawner.git"}' | json 'v.slug' >/dev/null
cp -R "$ROOT/examples/node-postgres" "$WORK/app"
rm -rf "$WORK/app/node_modules"
cd "$WORK/app"
up=$(spawner up e2e-demo --wait --json) || fail "spawner up failed: $up"
env_id=$(echo "$up" | json 'v.environment.id')
[ "$(echo "$up" | json 'v.environment.status')" = "ready" ] || fail "the environment should be ready: $up"
url=$(spawner url e2e-demo --with-token --json)
page=$(curl -fsS -H "Host: $(echo "$url" | json 'new URL(v.url).host')" -H "X-Spawner-Preview: $(echo "$url" | json 'v.header.value')" http://127.0.0.1/)
[[ "$page" == *"Hello from Spawner (e2e-demo)"* ]] || fail "the environment should answer through Traefik: $page"
node "$ROOT/scripts/e2e/mcp-status.mjs" "$WORK/spawner" "$WORK/app" e2e-demo
cd "$ROOT"
pass "spawner up deployed examples/node-postgres; its URL answers with a preview token"

step "Fencing the environments in"
sudo nft list table inet spawner >/dev/null || fail "the rules of firewall.nft should be loaded"
sudo systemctl cat docker | grep -q '^ExecStartPre=-.*nft -f /opt/spawner/firewall.nft$' || fail "Docker should load firewall.nft before it starts"
app=$(sudo docker ps --filter "label=dev.spawner.env=$env_id" --filter label=dev.spawner.service=app --format '{{.Names}}')
# reach URL: what the environment's app gets for a request there (the status, or the error code).
reach() {
  sudo docker exec "$app" node -e "
    const request = require('http').get(process.argv[1], { headers: { Metadata: 'true' }, timeout: 5000 }, (response) => { console.log(response.statusCode); process.exit(0); });
    request.on('error', (error) => { console.log(error.code); process.exit(0); });
    request.on('timeout', () => { console.log('timeout'); process.exit(0); });" "$1"
}
metadata="http://169.254.169.254/metadata/instance?api-version=2021-02-01"
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H Metadata:true "$metadata")" = "200" ]; then
  pass "the runner reads its cloud's metadata service"
fi
[ "$(reach "$metadata")" = "ECONNREFUSED" ] || fail "the environment should be refused the metadata service, not: $(reach "$metadata")"
gateway=$(sudo docker network inspect spn-example--e2e-demo_default -f '{{(index .IPAM.Config 0).Gateway}}')
python3 -m http.server 18181 --bind 0.0.0.0 >/dev/null 2>&1 &
listener=$!
for _ in $(seq 1 20); do curl -fs -o /dev/null "http://$gateway:18181/" && break; sleep 0.5; done
[ "$(reach "http://$gateway:18181/")" = "ECONNREFUSED" ] || fail "the environment should be refused a service of the host, not: $(reach "http://$gateway:18181/")"
kill "$listener"
[ "$(reach "http://$gateway/api/v1/healthz")" = "404" ] || fail "the environment should still reach Traefik on the host, not: $(reach "http://$gateway/api/v1/healthz")"
[ "$(sudo docker exec "$app" node -e "fetch('https://github.com', { method: 'HEAD' }).then((response) => console.log(response.ok), () => console.log(false))")" = "true" ] \
  || fail "the environment should still reach the internet"
sudo nft delete table inet spawner
for _ in $(seq 1 40); do sudo nft list table inet spawner >/dev/null 2>&1 && break; sleep 2; done
sudo nft list table inet spawner >/dev/null 2>&1 || fail "spawner-firewall should load the rules again within a minute"
pass "the environment reaches neither the metadata service nor the host's other services, but Traefik and the internet; the rules load before Docker and come back"

step "Two agents deploy examples/laravel-next-mysql from two branches at once"
api POST /projects -H 'Content-Type: application/json' \
  -d '{"slug":"blog","name":"Blog","repoUrl":"https://github.com/Flosk6/Spawner.git"}' | json 'v.slug' >/dev/null
BLOG="$WORK/blog"
HELLO="$WORK/blog-hello"
mkdir -p "$BLOG"
cp -R "$ROOT/examples/laravel-next-mysql/." "$BLOG/"
git -C "$BLOG" init -q -b main
git -C "$BLOG" add -A
git -C "$BLOG" -c user.name=e2e -c user.email=e2e@example.com -c commit.gpgsign=false commit -q -m "blog"
git -C "$BLOG" worktree add -q -b feat/hello "$HELLO"
replace "$HELLO/web/app/page.js" "<h1>Blog</h1>" "<h1>Blog, feat/hello</h1>"
# both_up NAME: runs spawner up --wait in both worktrees at once.
both_up() {
  (cd "$BLOG" && spawner up --wait --json >"$WORK/main-$1.json" 2>"$WORK/main-$1.err") &
  local main_pid=$!
  (cd "$HELLO" && spawner up --wait --json >"$WORK/hello-$1.json" 2>"$WORK/hello-$1.err") &
  local hello_pid=$!
  wait "$main_pid" || fail "spawner up ($1) failed in main: $(cat "$WORK/main-$1.json") $(tail -20 "$WORK/main-$1.err")"
  wait "$hello_pid" || fail "spawner up ($1) failed in feat/hello: $(cat "$WORK/hello-$1.json") $(tail -20 "$WORK/hello-$1.err")"
}
# blog ENV [EXPOSURE] [PATH]: a request to an environment of the blog, with a preview token.
blog() {
  local url
  url=$(cd "$BLOG" && spawner url "$1" "${2:-web}" --with-token --json)
  curl -fsS -H "Host: $(echo "$url" | json 'new URL(v.url).host')" -H "X-Spawner-Preview: $(echo "$url" | json 'v.header.value')" "http://127.0.0.1${3:-/}"
}
both_up create
main_id=$(json 'v.environment.id' <"$WORK/main-create.json")
hello_id=$(json 'v.environment.id' <"$WORK/hello-create.json")
[ "$(json 'v.action + " " + v.environment.slug + " " + v.environment.status' <"$WORK/main-create.json")" = "created main ready" ] || fail "main should be created: $(cat "$WORK/main-create.json")"
[ "$(json 'v.action + " " + v.environment.slug + " " + v.environment.status' <"$WORK/hello-create.json")" = "created feat-hello ready" ] || fail "feat-hello should be created: $(cat "$WORK/hello-create.json")"
[[ "$(blog main)" == *"<h1>Blog</h1>"*"One environment per branch"* ]] || fail "main should list the seeded posts: $(blog main)"
[[ "$(blog feat-hello)" == *"<h1>Blog, feat/hello</h1>"* ]] || fail "feat-hello should serve its own branch"
[ "$(blog main api /posts | json 'v.length')" = "2" ] || fail "the API of main should list the 2 seeded posts"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: api--main--blog.localtest.me" -H 'Accept: application/json' http://127.0.0.1/)" = "401" ] \
  || fail "the API should need a token"
(cd "$BLOG" && spawner exec main db -- mysql -uapp -papp app -e "INSERT INTO posts (title, body) VALUES ('From an agent', 'Added with spawner exec')") >/dev/null 2>&1 \
  || fail "spawner exec should insert a post in the database of main"
[[ "$(blog main)" == *"From an agent"* ]] || fail "main should show the post added with spawner exec"
[[ "$(blog feat-hello)" != *"From an agent"* ]] || fail "feat-hello has a database of its own"
pass "main and feat/hello were created at once; each serves its branch from its own database, behind a token"

replace "$BLOG/web/app/page.js" "<h1>Blog</h1>" "<h1>Blog, updated</h1>"
replace "$HELLO/web/app/page.js" "<h1>Blog, feat/hello</h1>" "<h1>Blog, feat/hello, updated</h1>"
both_up update
[ "$(json 'v.action' <"$WORK/main-update.json") $(json 'v.action' <"$WORK/hello-update.json")" = "updated updated" ] || fail "both environments should be updated"
[[ "$(blog main)" == *"<h1>Blog, updated</h1>"*"From an agent"* ]] || fail "main should serve its update and keep its data"
[[ "$(blog feat-hello)" == *"<h1>Blog, feat/hello, updated</h1>"* ]] || fail "feat-hello should serve its update"
pass "both were updated at once, data kept"

shared_deps='v.disk ? v.disk.imagesSharedBytes > 400 * 1024 ** 2 && v.disk.imagesUniqueBytes < 50 * 1024 ** 2 : false'
for _ in $(seq 1 60); do
  [ "$(api GET "/envs/$main_id/disk" | json "$shared_deps")" = "true" ] && [ "$(api GET "/envs/$hello_id/disk" | json "$shared_deps")" = "true" ] && break
  sleep 5
done
for id in "$main_id" "$hello_id"; do
  disk=$(api GET "/envs/$id/disk")
  [ "$(echo "$disk" | json "$shared_deps")" = "true" ] || fail "the dependencies should be shared, not in the environment's own part: $disk"
done
pass "each environment's own part is $(api GET "/envs/$main_id/disk" | json '(v.disk.imagesUniqueBytes / 1024 ** 2).toFixed(1)') MiB of images; $(api GET "/envs/$main_id/disk" | json '(v.disk.imagesSharedBytes / 1024 ** 2).toFixed(0)') MiB are shared (vendor, node_modules, base images)"

(cd "$BLOG" && spawner down main --json >/dev/null && spawner down feat-hello --json >/dev/null) || fail "spawner down should delete both environments"
for id in "$main_id" "$hello_id"; do
  [ -z "$(sudo docker ps -aq --filter "label=dev.spawner.env=$id")" ] && [ -z "$(sudo docker volume ls -q --filter "label=dev.spawner.env=$id")" ] \
    || fail "the environment $id left containers or volumes"
done
pass "both are deleted, without leftovers"

step "Updating from the dashboard"
IFS=. read -r major minor patch <<<"${VERSION%%-*}"
NEXT="$major.$minor.$((patch + 1))"
BROKEN="$major.$minor.$((patch + 2))"
printf 'FROM %s\nENV SPAWNER_VERSION=%s\n' "$INSTALLED" "$NEXT" | sudo docker build -q -t "spawner-e2e:$NEXT" - >/dev/null
printf 'FROM %s\nENV SPAWNER_VERSION=%s\nENTRYPOINT ["false"]\n' "$INSTALLED" "$BROKEN" | sudo docker build -q -t "spawner-e2e:$BROKEN" - >/dev/null
feed "$NEXT"
[ "$(api POST /system/update/check | json 'v.managed + " " + (v.latest && v.latest.version)')" = "true $NEXT" ] || fail "the dashboard should offer $NEXT"
[ "$(api POST /system/update -o /dev/null -w '%{http_code}')" = "202" ] || fail "the update to $NEXT should start"
wait_update succeeded 400 || fail "the update to $NEXT should succeed, not end $(update_state): $(api GET /system/update)"
[ "$(api GET /info | json 'v.version')" = "$NEXT" ] || fail "Spawner should run $NEXT"
[ "$(api GET "/envs/$env_id" | json 'v.status')" = "ready" ] || fail "the environment should survive the update"
[ -z "$(sudo docker ps -aq --filter 'name=^spawner-upgrade$')" ] || fail "the update container should be gone"
[ -n "$(sudo find /opt/spawner/backups -name "spawner-*-$VERSION.sql.gz" -size +1k)" ] || fail "the update should back the database up"
pass "the dashboard updated Spawner from $VERSION to $NEXT, database backed up, environment kept"

feed "$BROKEN"
api POST /system/update/check >/dev/null
[ "$(api POST /system/update -o /dev/null -w '%{http_code}')" = "202" ] || fail "the update to $BROKEN should start"
wait_update failed 500 || fail "the update to $BROKEN should fail, not end $(update_state)"
[ "$(api GET /info | json 'v.version')" = "$NEXT" ] || fail "Spawner should be back on $NEXT"
[[ "$(api GET /system/update | json 'v.run.error')" == *"went back to the previous one"* ]] || fail "the dashboard should say Spawner went back"
[ "$(api GET "/envs/$env_id" | json 'v.status')" = "ready" ] || fail "the environment should survive the failed update"
sudo grep -q "^SPAWNER_VERSION=$NEXT$" /opt/spawner/.env || fail "the files of the installation should be those of $NEXT again"
pass "an update to a version that does not start went back to $NEXT by itself, database restored"

step "Upgrading"
secret_before=$(secret SPAWNER_SECRET)
echo "SPAWNER_BUILD_CONCURRENCY=3" | sudo tee -a /opt/spawner/spawner.env >/dev/null
sudo bash install.sh --upgrade --image "$IMAGE" --yes | tee "$WORK/upgrade.log"
[ -n "$(sudo find /opt/spawner/backups -name 'spawner-*.sql.gz' -size +1k)" ] || fail "the upgrade should back the database up"
[ "$(secret SPAWNER_SECRET)" = "$secret_before" ] || fail "the upgrade should keep the secrets"
[ "$(api GET "/envs/$env_id" | json 'v.status')" = "ready" ] || fail "the environment should survive the upgrade"
[ "$(sudo docker exec spawner printenv SPAWNER_BUILD_CONCURRENCY)" = "3" ] || fail "the settings of spawner.env should survive the upgrade and apply"
pass "the upgrade backed the database up and kept the secrets, spawner.env and the environment"

step "Running it again"
sudo bash install.sh --yes | tee "$WORK/again.log"
[ "$(secret SPAWNER_SECRET)" = "$secret_before" ] || fail "running it again should keep the secrets"
[ "$(secret SPAWNER_PREVIEW_DOMAIN)" = "localtest.me" ] || fail "running it again should keep the domain"
[ "$(curl -fsS "$DASHBOARD/api/v1/healthz" | json 'v.status')" = "ok" ] || fail "the dashboard should answer after a second run"
pass "a second run keeps the domain, the secrets and the environment"

step "Removing everything"
sudo bash install.sh --uninstall --purge --yes
[ -z "$(sudo docker ps -aq --filter label=dev.spawner.env)" ] || fail "environment containers are left"
[ -z "$(sudo docker volume ls -q --filter label=dev.spawner.env)" ] || fail "environment volumes are left"
[ -z "$(sudo docker ps -aq --filter name='^spawner')" ] || fail "Spawner's containers are left"
[ ! -e /opt/spawner ] && [ ! -e /var/lib/spawner ] || fail "Spawner's files are left"
! sudo nft list table inet spawner >/dev/null 2>&1 || fail "the rules of firewall.nft are left"
[ ! -e /etc/systemd/system/docker.service.d/spawner-firewall.conf ] || fail "Docker's drop-in is left"
pass "--uninstall --purge removed Spawner, its environments and its data"

step "All installer checks passed"
