#!/usr/bin/env bash
#
# End-to-end test of the environment engine, access and the CLI.
#
# Starts the local stack (Postgres, Traefik, Spawner), checks that the
# dashboard refuses to be framed and that its Socket.IO server refuses the
# polling transport, then with examples/node-postgres sent as an archive
# through the API:
#   1. creates an environment and waits until it is ready
#   2. calls its URL through Traefik (with an agent's preview token) and
#      checks the seeded data; then an impostor calling itself "spawner" and
#      taking the names of the environment's service, on a network Docker's
#      DNS asks before Spawner's, must receive none of their traffic
#   3. checks the URL is protected: anonymous visitors go to the dashboard,
#      API clients get a 401, only real CORS preflights pass without
#      credentials, a share link opens it until it is revoked, and an invited
#      teammate (scripts/e2e/teammate.mjs: passkey, device login, dashboard)
#      opens it
#   4. runs a command in the database service
#   5. updates it with changed code and checks the data was kept
#   6. deletes it and checks nothing is left (containers, volumes,
#      network, images, routing file, sources)
#
# Then an agent's turn, with the spawner CLI downloaded from the server and
# logged in by the device flow (the teammate approves it): a source from a
# repository the project does not list is refused by the server before
# anything is cloned, and by the CLI before anything is sent; from a git
# worktree with an uncommitted change, up --wait --json, the protected URL
# with a preview token, exec (with stdin and exit codes), logs, status,
# stats, shell (in a pseudo-terminal), a share link, a compose file refused
# before upload (exit 7); then
# scripts/e2e/mcp.mjs drives `spawner mcp` (status, url, exec, logs with
# errors_only, up with progress, down), and nothing may be left; logout
# revokes the CLI's token and the tokens created with it. Along the
# way, the supervision: project variables (a secret masked in the job log),
# the timeline, the recorded terminal session, three out-of-memory kills
# named by the timeline, spawner status and the system alerts, metrics,
# disk and capacity; and the deleted environment keeps its page, timeline
# and last logs. Then the lifecycle: a service stopped outside Spawner makes
# the environment degraded until it runs again; spawner sleep stops it and a
# visit gets the waiting page and wakes it up, data kept; a minute without
# activity puts it to sleep by itself and spawner exec wakes it up first; the
# quota of a person refuses a second environment (exit 6); revoking a token
# closes the stream of logs it had open.
#
# Then, with scripts/e2e-fixtures/bind-mount, a service that mounts files of
# its source and writes into it as root: the capacity announced must match
# what is refused, an update must reach the mounted files, and once expired
# the environment must disappear with what the container wrote. The automatic
# cleanup removes what a deleted environment left and nothing else.
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

# A container on a network whose name sorts before spawner-core, which
# Traefik joins: Docker's DNS asks it first for a bare name.
IMPOSTOR=e2e-impostor
IMPOSTOR_NETWORK=aaa-e2e-impostor

remove_impostor() {
  docker rm -f "$IMPOSTOR" >/dev/null 2>&1 || true
  docker network disconnect -f "$IMPOSTOR_NETWORK" spawner-traefik >/dev/null 2>&1 || true
  docker network rm "$IMPOSTOR_NETWORK" >/dev/null 2>&1 || true
}

# Compose projects of the environments the test creates, with names of their
# own: the cleanup removes them, and the README's quick start creates
# example/demo on a developer's stack.
TEST_PROJECTS=(spn-example--e2e-demo spn-bindmount--bind spn-agent--feat-cli-demo spn-foreign--e2e-foreign)

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

# wait_status ENV_ID STATUS SECONDS: waits until the environment has the status.
wait_status() {
  for _ in $(seq 1 $(($3 / 2))); do
    [ "$(api GET "/envs/$1" | json 'v.status')" = "$2" ] && return 0
    sleep 2
  done
  return 1
}

# limits JSON: changes the limits of the server as an admin.
limits() {
  api PUT /settings/limits -H 'Content-Type: application/json' -d "$1" >/dev/null
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
  remove_impostor
  if [ "${KEEP:-0}" != "1" ]; then
    # A failed run can leave its environments behind; the next run must not reuse their data.
    for project in "${TEST_PROJECTS[@]}"; do
      remove_project "$project" >/dev/null 2>&1 || true
    done
    # Each run builds Spawner's image again: removing it keeps old builds from piling up (the build cache stays).
    "${COMPOSE[@]}" down -v --remove-orphans --rmi local >/dev/null 2>&1 || true
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
remove_impostor
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

step "Protecting the dashboard"
for path in / /api/v1/healthz; do
  headers=$(curl -sS -D - -o /dev/null --max-time 10 -H "Host: spawner.localtest.me" "http://127.0.0.1:${SPAWNER_HTTP_PORT}$path" | tr -d '\r')
  grep -qi '^x-frame-options: deny$' <<<"$headers" || fail "the dashboard ($path) should answer X-Frame-Options: DENY: $headers"
  grep -qi "^content-security-policy:.*frame-ancestors 'none'" <<<"$headers" || fail "the dashboard ($path) should answer frame-ancestors 'none': $headers"
done
pass "the dashboard and its API cannot be framed (X-Frame-Options, frame-ancestors)"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: spawner.localtest.me" "http://127.0.0.1:${SPAWNER_HTTP_PORT}/socket.io/?EIO=4&transport=polling")
[ "$code" = "400" ] || fail "the Socket.IO server of the terminal should refuse the polling transport with a 400, not $code"
pass "Socket.IO refuses the polling transport (the terminal runs over WebSocket: spawner shell, below)"

step "Creating the project"
api POST /projects -H 'Content-Type: application/json' \
  -d "{\"slug\":\"example\",\"name\":\"Example\",\"repoUrl\":\"https://github.com/Flosk6/Spawner.git\",\"rootDir\":\"$EXAMPLE\"}" | json 'v.slug'

step "Creating the environment from an uploaded worktree"
archive "$PWD" "$WORK/v1.tar.gz"
created=$(api POST /envs -F project=example -F env=e2e-demo -F createdVia=cli -F "primary=@$WORK/v1.tar.gz")
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
[[ "$page" == *"Hello from Spawner (e2e-demo)"* ]] || fail "unexpected page"
[[ "$page" == *"1 user(s)"* ]] || fail "the seed did not run"
pass "the app answers with the seeded data"

step "Routing past an impostor"
# Traefik sits on spawner-core and on every published environment network,
# and Docker's DNS answers a bare name from the first network that knows it.
app_container=$(docker ps --filter "label=dev.spawner.env=$env_id" --filter "label=dev.spawner.service=app" --format '{{.Names}}')
# Read as Traefik reads them: Spawner writes them for itself and Traefik only.
routes=$(docker exec spawner-traefik cat "/etc/traefik/dynamic/$env_id.yaml" 2>&1 || true)
grep -qF "url: http://app.spn-example--e2e-demo_default:3000" <<<"$routes" \
  || fail "the route should reach the app service by its name on the environment network: $routes"
routes=$(docker exec spawner-traefik cat /etc/traefik/dynamic/_spawner.yaml 2>&1 || true)
grep -qF "http://spawner.spawner-core:3000" <<<"$routes" \
  || fail "the dashboard and forwardAuth should reach Spawner by its name on spawner-core: $routes"
if [ "$(printf '%s\n' 1.48 "$(docker version -f '{{.Server.APIVersion}}')" | sort -V | head -1)" = 1.48 ]; then
  priority=$(docker inspect -f '{{(index .NetworkSettings.Networks "spn-example--e2e-demo_default").GwPriority}}' spawner-traefik 2>&1 || true)
  [ "$priority" = "-1" ] || fail "Traefik should join the environment network below spawner-core (GwPriority -1), not $priority"
fi
docker network create "$IMPOSTOR_NETWORK" >/dev/null
docker run -d --name "$IMPOSTOR" --network "$IMPOSTOR_NETWORK" --network-alias spawner --network-alias app --network-alias "$app_container" \
  node:22-alpine node -e "require('http').createServer((request, response) => response.end('impostor')).listen(3000)" >/dev/null
docker network connect "$IMPOSTOR_NETWORK" spawner-traefik
for _ in $(seq 1 30); do
  [ "$(docker exec spawner-traefik wget -qO- -T 2 http://spawner:3000/ 2>/dev/null)" = "impostor" ] && break
  sleep 1
done
[ "$(docker exec spawner-traefik wget -qO- -T 2 http://spawner:3000/ 2>/dev/null)" = "impostor" ] \
  || fail "seen from Traefik, the bare name spawner should lead to the impostor, or this check proves nothing"
# Traefik reuses the idle connections of the previous steps, which Node
# closes after 5 seconds: past that, every request below resolves afresh.
sleep 6
dashboard=$(curl -sS --max-time 10 -H "Host: spawner.localtest.me" "http://127.0.0.1:${SPAWNER_HTTP_PORT}/api/v1/healthz")
[ "$dashboard" = '{"status":"ok"}' ] || fail "the dashboard should answer from Spawner, not: $dashboard"
[[ "$(preview "$host")" == *"Hello from Spawner (e2e-demo)"* ]] || fail "the preview should answer from the environment, not: $(preview "$host")"
[ "$(status "$host" -H 'Accept: application/json')" = "401" ] || fail "Spawner, not the impostor, should check each request to the preview"
remove_impostor
pass "an impostor named spawner, app and $app_container, on a network asked first: Traefik still reaches Spawner and the environment"

step "Protecting the previews"
[ "$(status "$host" -H 'Accept: text/html')" = "302" ] || fail "an anonymous visitor reached the preview"
redirect=$(curl -s -o /dev/null -w '%{redirect_url}' -H "Host: $host" -H 'Accept: text/html' "http://127.0.0.1:${SPAWNER_HTTP_PORT}/")
[[ "$redirect" == "http://spawner.localtest.me/api/v1/auth/preview?next="* ]] || fail "anonymous visitors should go to the dashboard, not $redirect"
[ "$(status "$host" -H 'Accept: application/json')" = "401" ] || fail "an API client without credentials should get a 401"
pass "anonymous visitors are sent to the dashboard, API clients get a 401"
[ "$(status "$host" -X OPTIONS -H 'Accept: application/json')" = "401" ] || fail "an OPTIONS request that is not a CORS preflight should need credentials"
[ "$(status "$host" -X OPTIONS -H 'Origin: http://elsewhere.localtest.me' -H 'Access-Control-Request-Method: POST')" != "401" ] || fail "a CORS preflight should reach the application"
pass "only real CORS preflights pass without credentials"

created_share=$(api POST "/envs/$env_id/share" -H 'Content-Type: application/json' -d '{"ttlHours":1}')
share=$(json 'v.url' <<<"$created_share")
share_path=${share#http://$host}
answer=$(curl -s -D - -o /dev/null -H "Host: $host" "http://127.0.0.1:${SPAWNER_HTTP_PORT}${share_path}")
share_cookie=$(echo "$answer" | grep -i '^set-cookie: spawner_share_' | sed -E 's/^[^:]+: ([^;]+).*/\1/' | tr -d '\r')
[[ "$answer" == *" 302"* && -n "$share_cookie" ]] || fail "the share link should set its cookie: $answer"
[ "$(status "$host" -H "Cookie: $share_cookie" -H 'Accept: text/html')" = "200" ] || fail "the share link cookie should open the preview"
api DELETE "/envs/$env_id/shares/$(json 'v.id' <<<"$created_share")" >/dev/null
[ "$(status "$host" -H "Cookie: $share_cookie" -H 'Accept: text/html')" = "302" ] || fail "revoking a share link should close the preview to whoever opened it"
pass "a share link opens the preview without an account, until it is revoked"

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
[ -z "$(docker images -q --filter "label=com.docker.compose.project=spn-example--e2e-demo")" ] || left+=" images"
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
# Uncommitted changes: the greeting and a secret come from project variables.
sed -i.bak "s/const GREETING = 'Hello from Spawner';/const GREETING = process.env.GREETING;/" "$WORKTREE/server.js" && rm "$WORKTREE/server.js.bak"
node -e "const fs = require('fs'); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('      ENV_NAME: \${SPAWNER_ENV}\n', '      ENV_NAME: \${SPAWNER_ENV}\n      GREETING: \${GREETING}\n      SECRET_TOKEN: \${SECRET_TOKEN}\n'))" "$WORKTREE/.spawner/compose.yaml"
sed -i.bak "s/  console.log('seeded 1 user');/  console.log('seeded 1 user, token', process.env.SECRET_TOKEN);/" "$WORKTREE/seed.js" && rm "$WORKTREE/seed.js.bak"
# A route that shows the cookies the application receives.
node -e "const fs = require('fs'); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(\"    if (request.url === '/users') {\", \"    if (request.url === '/cookies') {\\n      response.writeHead(200, { 'content-type': 'text/plain' }).end(request.headers.cookie ?? '');\\n      return;\\n    }\\n    if (request.url === '/users') {\"))" "$WORKTREE/server.js"
api PUT /projects/agent/variables/GREETING -H 'Content-Type: application/json' -d '{"value":"Hello from a project variable"}' >/dev/null
api PUT /projects/agent/variables/SECRET_TOKEN -H 'Content-Type: application/json' -d '{"value":"s3cr3t-token-value","secret":true}' >/dev/null

# A project of its own, so that the refused environment leaves the agent's untouched.
api POST /projects -H 'Content-Type: application/json' \
  -d '{"slug":"foreign","name":"Foreign","repoUrl":"https://github.com/Flosk6/Spawner.git"}' | json 'v.slug'
FOREIGN="$WORK/agent-foreign"
git -C "$AGENT_REPO" worktree add -q -b feat/foreign "$FOREIGN"
sed -i.bak 's/^project: agent$/project: foreign/' "$FOREIGN/.spawner/spawner.yaml" && rm "$FOREIGN/.spawner/spawner.yaml.bak"
printf 'sources:\n  other:\n    repo: https://github.com/acme/other.git\n' >>"$FOREIGN/.spawner/spawner.yaml"
tar -C "$FOREIGN" --exclude .git -czf "$WORK/foreign.tar.gz" .
created=$(api POST /envs -F project=foreign -F env=e2e-foreign -F "primary=@$WORK/foreign.tar.gz")
foreign_id=$(echo "$created" | json 'v.environment.id')
foreign_job=$(echo "$created" | json 'v.job.id')
for _ in $(seq 1 60); do
  [ "$(api GET "/jobs/$foreign_job" | json 'v.status')" = "failed" ] && break
  sleep 1
done
[ "$(api GET "/jobs/$foreign_job" | json 'v.status + " " + v.errorCode')" = "failed invalid" ] || fail "a source from an unlisted repository should be refused: $(api GET "/jobs/$foreign_job")"
api GET "/jobs/$foreign_job/logs" | grep -q 'sources.other.repo: source "other" comes from https://github.com/acme/other.git, which is not among the source repositories' \
  || fail "the job log should name the refused repository: $(api GET "/jobs/$foreign_job/logs")"
[ ! -e "$SPAWNER_DATA_DIR/envs/$foreign_id/src/other" ] || fail "nothing should be cloned for a refused source"
wait_job "$(api DELETE "/envs/$foreign_id" | json 'v.job.id')"
set +e
foreign=$(cd "$FOREIGN" && spawner up --json 2>/dev/null)
code=$?
set -e
[ "$code" = "7" ] && [ "$(echo "$foreign" | json 'v.error.issues[0].code')" = "manifest.source_repo" ] || fail "spawner up should refuse an unlisted source repository with exit 7, not $code: $foreign"
pass "a source from a repository the project does not list: refused before any clone, and by the CLI before any upload"
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
[[ "$page" == *"Hello from a project variable"* ]] || fail "the uncommitted change, with its project variable, is not deployed: $page"
[[ "$page" == *"1 user(s)"* ]] || fail "the seed did not run: $page"
[ "$(status "$agent_host" -H 'Accept: application/json')" = "401" ] || fail "the URL should need a token"
# A page loads its scripts, styles and API calls at once: Traefik asks Spawner before each of them.
burst=$(seq 1 40 | xargs -P 40 -I{} curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 \
  -H "Host: $agent_host" -H "X-Spawner-Preview: $PREVIEW_TOKEN" "http://127.0.0.1:${SPAWNER_HTTP_PORT}/health" | sort | uniq -c | tr -s ' ' | tr '\n' ',')
[ "$burst" = " 40 200," ] || fail "40 requests at once to a preview should all pass, not: $burst"
pass "40 requests at once to the preview all pass: Spawner's checks are not rate limited"
job_log=$(spawner logs "$agent_env" --job)
[[ "$job_log" == *"token ********"* && "$job_log" != *"s3cr3t-token-value"* ]] || fail "the secret variable should be masked in the job log: $job_log"
pass "the protected URL serves the uncommitted change and its project variable; the secret is masked in the job log"

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
cookies=$(curl -s --max-time 10 -H "Host: $agent_host" -H "Cookie: theme=dark; $share_cookie; spawner_preview=anything" "http://127.0.0.1:${SPAWNER_HTTP_PORT}/cookies")
[ "$cookies" = "theme=dark" ] || fail "the application should receive its own cookies only, not Spawner's: $cookies"
pass "the application receives its own cookies, never Spawner's"

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

step "Supervising the environment"
usage_check='v.usage ? v.usage.memoryBytes > 0 : false'
for _ in $(seq 1 30); do
  [ "$(api GET "/envs/$agent_id" | json "$usage_check")" = "true" ] && break
  sleep 2
done
[ "$(api GET "/envs/$agent_id" | json "$usage_check")" = "true" ] || fail "the environment should report its memory"
sessions=$(api GET /terminals)
[ "$(echo "$sessions" | json 'v[0].actor + " " + v[0].service + " " + v[0].endReason + " " + v[0].exitCode')" = "Grace via e2e-agent app exit 5" ] \
  || fail "the terminal session should be recorded: $sessions"
[[ "$(api GET "/terminals/$(echo "$sessions" | json 'v[0].id')/recording")" == *"shell-42"* ]] || fail "the recording should hold what the terminal showed"
[[ "$(api GET "/envs/$agent_id/events" | json 'v.events.map((e) => e.message).join("|")')" == *"Creation succeeded in"* ]] || fail "the timeline should show the creation"
pass "the memory in use, the recorded terminal session, the jobs in the timeline"

for _ in 1 2 3; do
  set +e
  spawner exec "$agent_env" app -- node -e "const a = []; for (;;) a.push(Buffer.alloc(32 * 1024 * 1024, 1))" >/dev/null 2>&1
  code=$?
  set -e
  [ "$code" = "137" ] || fail "the memory hog should be killed (exit code 137), not $code"
done
loops=""
for _ in $(seq 1 30); do
  loops=$(spawner status --json | json 'v.crashLoops.map((l) => l.service + ": " + l.lastCause).join(",")')
  [[ "$loops" == "app: out of memory"* ]] && break
  sleep 1
done
[[ "$loops" == "app: out of memory"* ]] || fail "spawner status should say app fails for lack of memory, not: $loops"
[[ "$(api GET "/envs/$agent_id/events" | json 'v.events.filter((e) => e.type === "oom").length')" == "3" ]] || fail "the timeline should hold the three out-of-memory kills"
[[ "$(api GET /system | json 'v.alerts.map((a) => a.kind).join(",")')" == *"crash_loop"* ]] || fail "the system view should raise an alert"
pass "three out-of-memory kills: the timeline, spawner status and the system alerts name the cause ($loops)"

for _ in $(seq 1 30); do
  [ "$(spawner status --json | json 'v.services.every((s) => s.state === "running" && s.health === "healthy")')" = "true" ] && break
  sleep 2
done
# The collector also samples during the deploy, while only db runs: wait for a minute of both services.
both='v.points.some((point) => Object.keys(point.services).length === 2)'
for _ in $(seq 1 90); do
  [ "$(api GET "/envs/$agent_id/metrics?range=1h" | json "$both")" = "true" ] && break
  sleep 2
done
[ "$(api GET "/envs/$agent_id/metrics?range=1h" | json "$both")" = "true" ] || fail "the metrics should hold a minute of both services"
# A measure taken while the environment was being created shows its images
# but an empty database: wait for the one Spawner takes after the job.
volumes='v.disk ? v.disk.volumesBytes > 0 : false'
for _ in $(seq 1 90); do
  [ "$(api GET "/envs/$agent_id/disk" | json "$volumes")" = "true" ] && break
  sleep 2
done
[ "$(api GET "/envs/$agent_id/disk" | json "$volumes")" = "true" ] || fail "the disk of the environment should be measured"
[ "$(spawner capacity --json | json 'typeof v.projects.find((p) => p.project === "agent").places')" = "number" ] || fail "spawner capacity should count the room left"
[ "$(api GET /projects/agent/usage | json 'v.environments.total')" = "1" ] || fail "the project usage should count its environment"
pass "minute metrics of each service, the disk of the environment, the capacity and the project usage"

step "Sleeping and waking up"
app_container=$(docker ps -q --filter "label=dev.spawner.env=$agent_id" --filter "label=dev.spawner.service=app")
docker stop -t 1 "$app_container" >/dev/null
wait_status "$agent_id" degraded 130 || fail "a service stopped outside Spawner should make the environment degraded"
[[ "$(api GET "/envs/$agent_id" | json 'v.error')" == "app exited with code"* ]] || fail "the environment should say which service is down"
docker start "$app_container" >/dev/null
wait_status "$agent_id" ready 130 || fail "the environment should be ready again once its service runs"
pass "a service stopped outside Spawner: the environment turns degraded, then ready again"

asleep=$(spawner sleep "$agent_env" --json)
[ "$(echo "$asleep" | json 'v.environment.status')" = "sleeping" ] || fail "spawner sleep should put the environment to sleep: $asleep"
[ -z "$(docker ps -q --filter "label=dev.spawner.env=$agent_id")" ] || fail "a sleeping environment should run no container"
code=$(curl -s -o "$WORK/wake.html" -D "$WORK/wake.headers" -w '%{http_code}' --max-time 10 \
  -H "Host: $agent_host" -H "X-Spawner-Preview: $PREVIEW_TOKEN" -H 'Accept: text/html' "http://127.0.0.1:${SPAWNER_HTTP_PORT}/")
[ "$code" = "503" ] && grep -qi '^x-spawner-wake:' "$WORK/wake.headers" && grep -q "Waking up: $agent_env (agent)" "$WORK/wake.html" \
  || fail "a visit to a sleeping environment should get the waiting page, not $code: $(head -c 300 "$WORK/wake.html")"
for _ in $(seq 1 60); do
  [[ "$(preview "$agent_host")" == *"Hello from a project variable"* ]] && break
  sleep 2
done
[[ "$(preview "$agent_host")" == *"Hello from a project variable"* ]] || fail "the visit should have woken the environment up"
[ "$(preview "$agent_host" /users | json 'v.length')" = "3" ] || fail "the data should survive sleeping"
[[ "$(api GET "/envs/$agent_id/events" | json 'v.events.map((e) => e.message).join("|")')" == *"Wake-up started by a visit to $agent_host"* ]] \
  || fail "the timeline should show what woke it up"
pass "spawner sleep stops it; a visit gets the waiting page and wakes it up, data kept"

limits '{"idleSeconds":"1m"}'
wait_status "$agent_id" sleeping 200 || fail "after a minute without activity, the environment should sleep"
limits '{"idleSeconds":null}'
[[ "$(api GET "/envs/$agent_id/events" | json 'v.events.map((e) => e.message).join("|")')" == *"Sleep started by Spawner (no activity for 1m)"* ]] \
  || fail "the timeline should say why it went to sleep"
users=$(spawner exec "$agent_env" db -- psql -U app -d app -tAc "SELECT count(*) FROM users" 2>"$WORK/wake.err") || fail "spawner exec should wake the environment up: $(cat "$WORK/wake.err")"
[ "$(echo "$users" | tr -d '[:space:]')" = "3" ] || fail "spawner exec should run once the environment is awake, not answer: $users"
grep -q "is asleep: waking it up" "$WORK/wake.err" || fail "spawner exec should say it wakes the environment up first"
pass "a minute without activity put it to sleep by itself; spawner exec woke it up first"

limits '{"envsPerUser":1}'
set +e
quota=$(spawner up second-env --json 2>/dev/null)
code=$?
set -e
limits '{"envsPerUser":null}'
[ "$code" = "6" ] && [ "$(echo "$quota" | json 'v.error.code')" = "quota" ] || fail "an environment beyond the quota of a person should be refused with exit 6, not $code: $quota"
pass "beyond the quota of a person, spawner up is refused with exit code 6"

stream_token=$(spawner token create --name e2e-stream --json | json 'v.token')
curl -sN --max-time 120 -H "Authorization: Bearer $stream_token" "$API/envs/$agent_id/logs?follow=true" >"$WORK/stream.out" &
stream_pid=$!
sleep 3
kill -0 "$stream_pid" 2>/dev/null || fail "a stream of logs should stay open while the environment runs: $(head -c 300 "$WORK/stream.out")"
spawner token revoke "${stream_token:0:12}" >/dev/null
for _ in $(seq 1 20); do
  kill -0 "$stream_pid" 2>/dev/null || break
  sleep 0.5
done
if kill -0 "$stream_pid" 2>/dev/null; then
  kill "$stream_pid"
  fail "revoking a token should close the stream of logs it had open"
fi
wait "$stream_pid" || true
pass "revoking a token closes the stream of logs it had open"

step "An agent drives the environment through MCP"
node "$ROOT/scripts/e2e/mcp.mjs" "$WORK/spawner" "$WORKTREE" "$agent_env"
left=$(leftovers "$agent_id")
[ -z "$left" ] || fail "spawner_down left behind:$left"
[ "$(api GET "/envs/$agent_id" | json 'v.status')" = "deleted" ] || fail "a deleted environment should stay readable"
[ "$(api GET "/envs?deleted=true&project=agent" | json 'v.map((e) => `${e.slug}:${e.status}`).join(",")')" = "$agent_env:deleted" ] || fail "the deleted environments should be listed"
[[ "$(api GET "/envs/$agent_id/logs?errors=true&tail=50" | json 'v.lines.map((l) => l.text).join("|")')" == *'relation "users" does not exist'* ]] \
  || fail "the archived logs should keep the error found through MCP"
[[ "$(api GET "/envs/$agent_id/events" | json 'v.events[0].message')" == "Deletion succeeded in"* ]] || fail "the timeline should end with the deletion"
child_token=$(spawner token create --name e2e-child --json | json 'v.token')
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $child_token" "$API/auth/whoami")" = "200" ] || fail "a token created with the CLI should work"
[ "$(spawner logout --json | json 'v.revoked')" = "true" ] || fail "spawner logout should revoke the token"
set +e
spawner whoami >/dev/null 2>&1
code=$?
set -e
[ "$code" = "3" ] || fail "after logout, the CLI should exit with 3, not $code"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $child_token" "$API/auth/whoami")" = "401" ] \
  || fail "logout should also revoke the tokens created with the CLI's token"
cd "$ROOT"
pass "nothing left behind; logout revoked the token, and the tokens created with it"

step "Serving files mounted from a source"
BIND_FIXTURE=scripts/e2e-fixtures/bind-mount
BIND_FILES=(.spawner www data README.md)
api POST /projects -H 'Content-Type: application/json' \
  -d '{"slug":"bindmount","name":"Bind mount","repoUrl":"https://github.com/Flosk6/Spawner.git","allowPublic":true}' | json 'v.slug'
mkdir -p "$WORK/bind"
cp -R "$BIND_FIXTURE/." "$WORK/bind/"
tar -C "$WORK/bind" -czf "$WORK/bind-v1.tar.gz" "${BIND_FILES[@]}"
limits '{"envMemoryMaxBytes":"1024g","envMemoryBytes":"512g"}'
[ "$(api GET /system/capacity | json 'v.projects.find((p) => p.project === "bindmount").places')" = "0" ] || fail "with 512 GiB per environment, the capacity should be 0"
code=$(curl -s -o "$WORK/room.json" -w '%{http_code}' -H "Authorization: Bearer $SPAWNER_BOOTSTRAP_TOKEN" \
  -F project=bindmount -F env=bind -F createdVia=cli -F "primary=@$WORK/bind-v1.tar.gz" "$API/envs")
limits '{"envMemoryMaxBytes":null,"envMemoryBytes":null}'
[ "$code" = "503" ] && [ "$(json 'v.code' < "$WORK/room.json")" = "capacity" ] || fail "a creation beyond the capacity should be refused, not $code: $(cat "$WORK/room.json")"
[ "$(api GET /system/capacity | json 'v.projects.find((p) => p.project === "bindmount").places > 0')" = "true" ] || fail "the capacity should announce room again"
pass "the capacity announced no room and the creation was refused (503, capacity); back to normal, it announces room"
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

docker exec spawner-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -qc \"UPDATE environments SET expires_at = now() - interval '1 minute' WHERE id = '$bind_id'\"" >/dev/null
wait_status "$bind_id" deleted 150 || fail "an expired environment should be deleted"
[[ "$(api GET "/envs/$bind_id/events" | json 'v.events.map((e) => e.message).join("|")')" == *"Deletion started by Spawner (expired)"* ]] || fail "the timeline should say it expired"
left=$(leftovers "$bind_id")
[ -z "$left" ] || fail "the expired environment left behind:$left"
[ ! -e "$SPAWNER_DATA_DIR/envs/$bind_id" ] || fail "the files written by the container are left behind"
pass "once expired, the environment disappeared with everything it held, files written as root included"

foreign="e2e-foreign-$$"
orphan="e2e-orphan-$$"
docker volume create "$foreign" >/dev/null
docker volume create --label "dev.spawner.env=$bind_id" "$orphan" >/dev/null
for _ in $(seq 1 45); do
  [ -z "$(docker volume ls -q --filter "name=^$orphan\$")" ] && break
  sleep 2
done
[ -z "$(docker volume ls -q --filter "name=^$orphan\$")" ] || fail "the automatic cleanup should remove what a deleted environment left"
[ -n "$(docker volume ls -q --filter "name=^$foreign\$")" ] || fail "the cleanup must never touch what is not Spawner's"
docker volume rm "$foreign" >/dev/null
pass "the automatic cleanup removed what the deleted environment left, and nothing that is not Spawner's"

step "All engine checks passed"
