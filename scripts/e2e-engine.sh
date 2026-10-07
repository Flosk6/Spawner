#!/usr/bin/env bash
#
# End-to-end test of the environment engine, access and the CLI.
#
# Starts the local stack (Postgres, Traefik, Spawner), then with
# examples/node-postgres sent as an archive through the API:
#   1. creates an environment and waits until it is ready
#   2. calls its URL through Traefik (with an agent's preview token) and
#      checks the seeded data
#   3. checks the URL is protected: anonymous visitors go to the dashboard,
#      API clients get a 401, a share link opens it, and an invited teammate
#      (scripts/e2e/teammate.mjs: passkey, device login, dashboard) opens it
#   4. runs a command in the database service
#   5. updates it with changed code and checks the data was kept
#   6. deletes it and checks nothing is left (containers, volumes,
#      network, images, routing file, sources)
#
# Then an agent's turn, with the spawner CLI downloaded from the server and
# logged in by the device flow (the teammate approves it): from a git
# worktree with an uncommitted change, up --wait --json, the protected URL
# with a preview token, exec (with stdin and exit codes), logs, status,
# stats, shell (in a pseudo-terminal), a share link, a compose file refused
# before upload (exit 7); then
# scripts/e2e/mcp.mjs drives `spawner mcp` (status, url, exec, logs with
# errors_only, up with progress, down), and nothing may be left.
#
# Then, with scripts/e2e-fixtures/bind-mount, a service that mounts files of
# its source and writes into it as root: an update must reach the mounted
# files, and a delete must remove what the container wrote.
#
# Usage: scripts/e2e-engine.sh            (KEEP=1 to leave the stack running)
# Needs: docker with compose, curl, node, tar, git, python3.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

export SPAWNER_DATA_DIR="${SPAWNER_DATA_DIR:-$PWD/local-data/e2e}"
export SPAWNER_HTTP_PORT="${SPAWNER_HTTP_PORT:-80}"
export SPAWNER_BOOTSTRAP_TOKEN="${SPAWNER_BOOTSTRAP_TOKEN:-$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")}"
# The dashboard must be under the preview domain to hand out preview cookies,
# whatever a local .env says.
export FRONTEND_URL=http://spawner.localtest.me
export COPYFILE_DISABLE=1

API="http://127.0.0.1:8080/api/v1"
COMPOSE=(docker compose -p spawner-e2e -f docker-compose.yml)
WORK="$(mktemp -d)"
EXAMPLE=examples/node-postgres

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }
pass() { printf '\033[32mok\033[0m %s\n' "$*"; }

# json 'expression' reads JSON on stdin and prints the expression of v.
json() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);const r=($1);console.log(typeof r==='string'?r:JSON.stringify(r))})"
}

api() {
  local method=$1 path=$2
  shift 2
  curl -sS -X "$method" -H "Authorization: Bearer $SPAWNER_BOOTSTRAP_TOKEN" "$API$path" "$@"
}

# preview HOST [PATH]: a request through Traefik, as an agent with a preview token.
preview() {
  curl -sS --max-time 10 -H "Host: $1" -H "X-Spawner-Preview: ${PREVIEW_TOKEN:-}" "http://127.0.0.1:${SPAWNER_HTTP_PORT}${2:-/}"
}

# status HOST [CURL ARGS...]: the HTTP status of / through Traefik, without credentials.
status() {
  local host=$1
  shift
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: $host" "$@" "http://127.0.0.1:${SPAWNER_HTTP_PORT}/"
}

# Compose projects of the environments the test creates.
TEST_PROJECTS=(spn-example--demo spn-bindmount--bind spn-agent--feat-cli-demo)

# The CLI, as downloaded from the server, with its own configuration.
export SPAWNER_CONFIG_DIR="$WORK/cli-config"
CLI_SERVER="http://spawner.localtest.me:${SPAWNER_HTTP_PORT}"
spawner() { node "$WORK/spawner" "$@"; }

# leftovers ENV_ID: what a deleted environment left behind, if anything.
leftovers() {
  local found=""
  [ -z "$(docker ps -aq --filter "label=dev.spawner.env=$1")" ] || found+=" containers"
  [ -z "$(docker volume ls -q --filter "label=dev.spawner.env=$1")" ] || found+=" volumes"
  [ -z "$(docker network ls -q --filter "label=dev.spawner.env=$1")" ] || found+=" networks"
  [ ! -e "$SPAWNER_DATA_DIR/traefik/$1.yaml" ] || found+=" routing"
  [ ! -e "$SPAWNER_DATA_DIR/envs/$1" ] || found+=" sources"
  echo "$found"
}

# remove_project NAME: containers, volumes, networks and images of a compose project.
remove_project() {
  local filter="label=com.docker.compose.project=$1" ids
  ids=$(docker ps -aq --filter "$filter"); [ -z "$ids" ] || docker rm -f $ids
  ids=$(docker volume ls -q --filter "$filter"); [ -z "$ids" ] || docker volume rm $ids
  ids=$(docker network ls -q --filter "$filter"); [ -z "$ids" ] || docker network rm $ids
  ids=$(docker images -q --filter "$filter"); [ -z "$ids" ] || docker rmi -f $ids
}

cleanup() {
  local code=$?
  cd "$ROOT"
  if [ "$code" -ne 0 ]; then
    echo "--- spawner logs (last 60 lines)"
    docker logs spawner --tail 60 2>&1 || true
  fi
  if [ "${KEEP:-0}" != "1" ]; then
    # A failed run can leave its environments behind; the next run must not reuse their data.
    for project in "${TEST_PROJECTS[@]}"; do
      remove_project "$project" >/dev/null 2>&1 || true
    done
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
    docker run --rm -v "$SPAWNER_DATA_DIR:/data" alpine:3.20 sh -c 'rm -rf /data/*' >/dev/null 2>&1 || true
    rm -rf "$SPAWNER_DATA_DIR"
    rm -rf "$WORK"
  else
    echo "Stack left running; work directory (the CLI and its login): $WORK"
  fi
  exit "$code"
}
trap cleanup EXIT

wait_job() {
  local job=$1 status
  for _ in $(seq 1 300); do
    status=$(api GET "/jobs/$job" | json 'v.status')
    case "$status" in
      succeeded) return 0 ;;
      failed)
        api GET "/jobs/$job/logs"
        fail "job $job failed"
        ;;
    esac
    sleep 2
  done
  fail "job $job did not finish (last status: $status)"
}

archive() {
  tar -C "$1" --exclude node_modules -czf "$2" "$EXAMPLE"
}

step "Starting the local stack"
for project in "${TEST_PROJECTS[@]}"; do
  remove_project "$project" >/dev/null 2>&1 || true
done
mkdir -p "$SPAWNER_DATA_DIR/traefik"
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 180
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:8080/api/v1/readyz" >/dev/null && break
  sleep 2
done
pass "Spawner is up"

step "Installing the CLI from the server"
curl -fsS "$API/cli/spawner" -o "$WORK/spawner"
chmod +x "$WORK/spawner"
pass "spawner $(spawner --version), downloaded from $API/cli/spawner"

step "Creating the project"
api POST /projects -H 'Content-Type: application/json' \
  -d "{\"slug\":\"example\",\"name\":\"Example\",\"repoUrl\":\"https://github.com/Flosk6/Spawner.git\",\"rootDir\":\"$EXAMPLE\"}" | json 'v.slug'

step "Creating the environment from an uploaded worktree"
archive "$PWD" "$WORK/v1.tar.gz"
created=$(api POST /envs -F project=example -F env=demo -F createdVia=cli -F "primary=@$WORK/v1.tar.gz")
env_id=$(echo "$created" | json 'v.environment.id')
job_id=$(echo "$created" | json 'v.job.id')
echo "environment $env_id, job $job_id"
wait_job "$job_id"
host=$(api GET "/envs/$env_id" | json 'v.exposures[0].host')
PREVIEW_TOKEN=$(api POST "/envs/$env_id/preview-token" | json 'v.token')
pass "ready at http://$host"

step "Calling the environment through Traefik"
page=$(preview "$host")
echo "$page"
[[ "$page" == *"Hello from Spawner (demo)"* ]] || fail "unexpected page"
[[ "$page" == *"1 user(s)"* ]] || fail "the seed did not run"
pass "the app answers with the seeded data"

step "Protecting the previews"
[ "$(status "$host" -H 'Accept: text/html')" = "302" ] || fail "an anonymous visitor reached the preview"
redirect=$(curl -s -o /dev/null -w '%{redirect_url}' -H "Host: $host" -H 'Accept: text/html' "http://127.0.0.1:${SPAWNER_HTTP_PORT}/")
[[ "$redirect" == "http://spawner.localtest.me/api/v1/auth/preview?next="* ]] || fail "anonymous visitors should go to the dashboard, not $redirect"
[ "$(status "$host" -H 'Accept: application/json')" = "401" ] || fail "an API client without credentials should get a 401"
pass "anonymous visitors are sent to the dashboard, API clients get a 401"

share=$(api POST "/envs/$env_id/share" -H 'Content-Type: application/json' -d '{"ttlHours":1}' | json 'v.url')
share_path=${share#http://$host}
answer=$(curl -s -D - -o /dev/null -H "Host: $host" "http://127.0.0.1:${SPAWNER_HTTP_PORT}${share_path}")
share_cookie=$(echo "$answer" | grep -i '^set-cookie: spawner_share_' | sed -E 's/^[^:]+: ([^;]+).*/\1/' | tr -d '\r')
[[ "$answer" == *" 302"* && -n "$share_cookie" ]] || fail "the share link should set its cookie: $answer"
[ "$(status "$host" -H "Cookie: $share_cookie" -H 'Accept: text/html')" = "200" ] || fail "the share link cookie should open the preview"
pass "a share link opens the preview without an account"

invite=$(api POST /invites -H 'Content-Type: application/json' -d '{"role":"member","note":"e2e teammate"}' | json 'v.url')
spawner login "$CLI_SERVER" --no-browser --name e2e-agent >"$WORK/login.out" 2>&1 &
login_pid=$!
device_code=""
for _ in $(seq 1 50); do
  device_code=$(grep -oE '[A-Z]{4}-[A-Z]{4}' "$WORK/login.out" | head -1 || true)
  [ -n "$device_code" ] && break
  sleep 0.2
done
[ -n "$device_code" ] || fail "spawner login shows no code: $(cat "$WORK/login.out")"
node scripts/e2e/teammate.mjs "$invite" "http://$host/" "$env_id" "$device_code"
wait "$login_pid" || fail "spawner login failed: $(cat "$WORK/login.out")"
[ "$(spawner whoami --json | json 'v.user.name + " via " + v.token.name')" = "Grace via e2e-agent" ] || fail "the CLI should act as Grace"
pass "the CLI logged in as Grace through the device flow"
first_admin=$("${COMPOSE[@]}" exec -T -u node spawner node dist/admin.js invite --role admin --hours 1)
[[ "$first_admin" == "http://spawner.localtest.me/invite/"* ]] || fail "the admin command should print an invitation: $first_admin"
pass "the admin command prints an invitation"

step "Running a command in the database"
exec_result=$(api POST "/envs/$env_id/exec" -H 'Content-Type: application/json' \
  -d '{"service":"db","argv":["psql","-U","app","-d","app","-tAc","INSERT INTO users (name) VALUES ('"'"'grace'"'"') RETURNING id"]}')
[ "$(echo "$exec_result" | json 'v.exitCode')" = "0" ] || fail "exec failed: $exec_result"
[[ "$(preview "$host")" == *"2 user(s)"* ]] || fail "the inserted user is missing"
pass "exec inserted a user"

step "Updating the code, keeping the data"
mkdir -p "$WORK/tree/$EXAMPLE"
cp -R "$PWD/$EXAMPLE/." "$WORK/tree/$EXAMPLE/"
sed -i.bak "s/Hello from Spawner/Hello again from Spawner/" "$WORK/tree/$EXAMPLE/server.js" && rm "$WORK/tree/$EXAMPLE/server.js.bak"
archive "$WORK/tree" "$WORK/v2.tar.gz"
job_id=$(api POST "/envs/$env_id/update" -F "primary=@$WORK/v2.tar.gz" | json 'v.job.id')
wait_job "$job_id"
page=$(preview "$host")
echo "$page"
[[ "$page" == *"Hello again from Spawner"* ]] || fail "the update was not deployed"
[[ "$page" == *"2 user(s)"* ]] || fail "the update lost the data (or replayed the seed)"
pass "new code, same data"

step "Reading the service logs"
api GET "/envs/$env_id/logs/app?tail=5"
echo

step "Deleting the environment"
job_id=$(api DELETE "/envs/$env_id" | json 'v.job.id')
wait_job "$job_id"
left=$(leftovers "$env_id")
[ -z "$(docker images -q --filter "label=com.docker.compose.project=spn-example--demo")" ] || left+=" images"
[ -z "$left" ] || fail "left behind:$left"
status=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $host" "http://127.0.0.1:${SPAWNER_HTTP_PORT}/")
[ "$status" = "404" ] || fail "the URL still answers ($status)"
pass "nothing left behind"

step "An agent tests its worktree with the CLI"
api POST /projects -H 'Content-Type: application/json' \
  -d '{"slug":"agent","name":"Agent","repoUrl":"https://github.com/Flosk6/Spawner.git"}' | json 'v.slug'
AGENT_REPO="$WORK/agent-repo"
WORKTREE="$WORK/agent-feat"
mkdir -p "$AGENT_REPO"
cp -R "$EXAMPLE/." "$AGENT_REPO/"
rm -rf "$AGENT_REPO/node_modules"
sed -i.bak 's/^project: example$/project: agent/' "$AGENT_REPO/.spawner/spawner.yaml" && rm "$AGENT_REPO/.spawner/spawner.yaml.bak"
git -C "$AGENT_REPO" init -q -b main
git -C "$AGENT_REPO" add -A
git -C "$AGENT_REPO" -c user.name=e2e -c user.email=e2e@example.com -c commit.gpgsign=false commit -q -m "example"
git -C "$AGENT_REPO" worktree add -q -b feat/cli-demo "$WORKTREE"
sed -i.bak "s/Hello from Spawner/Hello from the worktree/" "$WORKTREE/server.js" && rm "$WORKTREE/server.js.bak"
cd "$WORKTREE"

up_json=$(spawner up --wait --json) || fail "spawner up failed: $up_json"
agent_env=$(echo "$up_json" | json 'v.environment.slug')
agent_id=$(echo "$up_json" | json 'v.environment.id')
[ "$agent_env" = "feat-cli-demo" ] || fail "the environment should be named after the branch, not $agent_env"
[ "$(echo "$up_json" | json 'v.environment.status + " " + v.environment.createdVia + " " + v.environment.tokenName + " " + v.environment.owner.name')" = "ready cli e2e-agent Grace" ] \
  || fail "the environment should be ready and Grace's, through e2e-agent: $up_json"
pass "spawner up --wait --json: $agent_env is ready, owned by Grace via e2e-agent"

url_json=$(spawner url --with-token --json)
agent_host=$(echo "$url_json" | json 'new URL(v.url).host')
PREVIEW_TOKEN=$(echo "$url_json" | json 'v.header.value')
page=$(preview "$agent_host")
[[ "$page" == *"Hello from the worktree"* ]] || fail "the uncommitted change is not deployed: $page"
[[ "$page" == *"1 user(s)"* ]] || fail "the seed did not run: $page"
[ "$(status "$agent_host" -H 'Accept: application/json')" = "401" ] || fail "the URL should need a token"
pass "the protected URL serves the uncommitted change, with the token of spawner url"

spawner exec "$agent_env" db -- psql -U app -d app -tAc "INSERT INTO users (name) VALUES ('ada')" >/dev/null || fail "spawner exec failed"
echo "INSERT INTO users (name) VALUES ('grace');" | spawner exec -i "$agent_env" db -- psql -U app -d app >/dev/null || fail "spawner exec -i failed"
set +e
spawner exec "$agent_env" db -- sh -c 'echo to stderr >&2; exit 3' 2>/dev/null
code=$?
set -e
[ "$code" = "3" ] || fail "spawner exec should exit with the command's exit code, not $code"
[ "$(preview "$agent_host" /users | json 'v.length')" = "3" ] || fail "the API should list 3 users"
pass "spawner exec runs commands (with stdin) and returns their exit code; the API lists the new users"

[ "$(spawner logs "$agent_env" app --tail 5 --json | json 'v.lines.length > 0')" = "true" ] || fail "spawner logs returned nothing"
[ "$(spawner status --json | json 'v.services.map((s) => s.name + ":" + s.state + ":" + s.health).sort().join(" ")')" = "app:running:healthy db:running:healthy" ] \
  || fail "spawner status should show healthy services"
[ "$(spawner stats --json | json 'v.services.every((s) => s.memoryBytes > 0)')" = "true" ] || fail "spawner stats should give memory"
[ "$(spawner ls --json | json 'v.environments.map((e) => e.slug).join(",")')" = "$agent_env" ] || fail "spawner ls should list the environment"
set +e
spawner status nope --json >/dev/null
code=$?
set -e
[ "$code" = "1" ] || fail "an unknown environment should exit with 1, not $code"
pass "spawner logs, status, stats and ls"

# A terminal needs a TTY: Python's pty gives one, the typed lines wait in it until the shell reads them.
set +e
shell_out=$(printf 'echo shell-$((6*7))\nexit 5\n' \
  | python3 -c 'import os, pty, signal, sys; signal.alarm(60); sys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))' \
    node "$WORK/spawner" shell "$agent_env" app 2>&1)
code=$?
set -e
[ "$code" = "5" ] || fail "spawner shell should exit with the shell's exit code, not $code: $shell_out"
[[ "$shell_out" == *"shell-42"* ]] || fail "spawner shell should run what is typed: $shell_out"
pass "spawner shell opens a terminal in the service and returns its exit code"

share=$(spawner share --ttl 1h --json | json 'v.url')
answer=$(curl -s -D - -o /dev/null -H "Host: $agent_host" "http://127.0.0.1:${SPAWNER_HTTP_PORT}${share#http://$agent_host}")
share_cookie=$(echo "$answer" | grep -i '^set-cookie: spawner_share_' | sed -E 's/^[^:]+: ([^;]+).*/\1/' | tr -d '\r')
[ "$(status "$agent_host" -H "Cookie: $share_cookie" -H 'Accept: text/html')" = "200" ] || fail "the share link of spawner share should open the URL"
pass "spawner share gives a link that opens the environment"

cp .spawner/compose.yaml "$WORK/compose.yaml"
node -e "const fs = require('fs'); const f = '.spawner/compose.yaml'; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^  app:\n/m, '  app:\n    privileged: true\n'))"
jobs_before=$(api GET "/envs/$agent_id" | json 'v.lastJob.id')
set +e
refused=$(spawner up --json)
code=$?
set -e
cp "$WORK/compose.yaml" .spawner/compose.yaml
[ "$code" = "7" ] || fail "a refused compose file should exit with 7, not $code: $refused"
[[ "$(echo "$refused" | json 'v.error.issues.map((i) => i.path).join(",")')" == *"privileged"* ]] || fail "the refusal should name the key: $refused"
[ "$(api GET "/envs/$agent_id" | json 'v.lastJob.id')" = "$jobs_before" ] || fail "a refused compose file should not reach the server"
pass "a refused compose file stops before the upload, with exit code 7"

step "An agent drives the environment through MCP"
node "$ROOT/scripts/e2e/mcp.mjs" "$WORK/spawner" "$WORKTREE" "$agent_env"
left=$(leftovers "$agent_id")
[ -z "$left" ] || fail "spawner_down left behind:$left"
[ "$(spawner logout --json | json 'v.revoked')" = "true" ] || fail "spawner logout should revoke the token"
set +e
spawner whoami >/dev/null 2>&1
code=$?
set -e
[ "$code" = "3" ] || fail "after logout, the CLI should exit with 3, not $code"
cd "$ROOT"
pass "nothing left behind; logout revoked the token"

step "Serving files mounted from a source"
BIND_FIXTURE=scripts/e2e-fixtures/bind-mount
BIND_FILES=(.spawner www data README.md)
api POST /projects -H 'Content-Type: application/json' \
  -d '{"slug":"bindmount","name":"Bind mount","repoUrl":"https://github.com/Flosk6/Spawner.git"}' | json 'v.slug'
mkdir -p "$WORK/bind"
cp -R "$BIND_FIXTURE/." "$WORK/bind/"
tar -C "$WORK/bind" -czf "$WORK/bind-v1.tar.gz" "${BIND_FILES[@]}"
created=$(api POST /envs -F project=bindmount -F env=bind -F createdVia=cli -F "primary=@$WORK/bind-v1.tar.gz")
bind_id=$(echo "$created" | json 'v.environment.id')
wait_job "$(echo "$created" | json 'v.job.id')"
bind_host=$(api GET "/envs/$bind_id" | json 'v.exposures[0].host')
[[ "$(preview "$bind_host")" == *"version one"* ]] || fail "the mounted page is not served"
[ "$(status "$bind_host" -H 'Accept: text/html')" = "200" ] || fail "an exposure with auth: none should be public"
pass "the mounted page is served, publicly (auth: none)"

printf 'version two\n' > "$WORK/bind/www/index.html"
tar -C "$WORK/bind" -czf "$WORK/bind-v2.tar.gz" "${BIND_FILES[@]}"
wait_job "$(api POST "/envs/$bind_id/update" -F "primary=@$WORK/bind-v2.tar.gz" | json 'v.job.id')"
[[ "$(preview "$bind_host")" == *"version two"* ]] || fail "the update did not reach the mounted files"
pass "the service sees the updated files"

wait_job "$(api DELETE "/envs/$bind_id" | json 'v.job.id')"
[ -z "$(docker ps -aq --filter "label=dev.spawner.env=$bind_id")" ] || fail "containers left behind"
[ ! -e "$SPAWNER_DATA_DIR/envs/$bind_id" ] || fail "the files written by the container are left behind"
pass "the files written as root by the container are gone"

step "All engine checks passed"
