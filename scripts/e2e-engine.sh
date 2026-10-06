#!/usr/bin/env bash
#
# End-to-end test of the environment engine (milestone M1).
#
# Starts the local stack (Postgres, Traefik, Spawner), then with
# examples/node-postgres sent as an archive, as the CLI will:
#   1. creates an environment and waits until it is ready
#   2. calls its URL through Traefik and checks the seeded data
#   3. runs a command in the database service
#   4. updates it with changed code and checks the data was kept
#   5. deletes it and checks nothing is left (containers, volumes,
#      network, images, routing file, sources)
#
# Then, with scripts/e2e-fixtures/bind-mount, a service that mounts files of
# its source and writes into it as root: an update must reach the mounted
# files, and a delete must remove what the container wrote.
#
# Usage: scripts/e2e-engine.sh            (KEEP=1 to leave the stack running)
# Needs: docker with compose, curl, node, tar.

set -euo pipefail
cd "$(dirname "$0")/.."

export SPAWNER_DATA_DIR="${SPAWNER_DATA_DIR:-$PWD/local-data/e2e}"
export SPAWNER_HTTP_PORT="${SPAWNER_HTTP_PORT:-80}"
export SPAWNER_BOOTSTRAP_TOKEN="${SPAWNER_BOOTSTRAP_TOKEN:-$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")}"
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

preview() {
  curl -sS --max-time 10 -H "Host: $1" "http://127.0.0.1:${SPAWNER_HTTP_PORT}${2:-/}"
}

cleanup() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    echo "--- spawner logs (last 60 lines)"
    docker logs spawner --tail 60 2>&1 || true
  fi
  if [ "${KEEP:-0}" != "1" ]; then
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
    docker run --rm -v "$SPAWNER_DATA_DIR:/data" alpine:3.20 sh -c 'rm -rf /data/*' >/dev/null 2>&1 || true
    rm -rf "$SPAWNER_DATA_DIR"
  fi
  rm -rf "$WORK"
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
mkdir -p "$SPAWNER_DATA_DIR/traefik"
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 180
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:8080/api/auth/status" >/dev/null && break
  sleep 2
done
pass "Spawner is up"

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
pass "ready at http://$host"

step "Calling the environment through Traefik"
page=$(preview "$host")
echo "$page"
[[ "$page" == *"Hello from Spawner (demo)"* ]] || fail "unexpected page"
[[ "$page" == *"1 user(s)"* ]] || fail "the seed did not run"
pass "the app answers with the seeded data"

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
leftovers=""
[ -z "$(docker ps -aq --filter "label=dev.spawner.env=$env_id")" ] || leftovers+=" containers"
[ -z "$(docker volume ls -q --filter "label=dev.spawner.env=$env_id")" ] || leftovers+=" volumes"
[ -z "$(docker network ls -q --filter "label=dev.spawner.env=$env_id")" ] || leftovers+=" networks"
[ -z "$(docker images -q --filter "label=com.docker.compose.project=spn-example--demo")" ] || leftovers+=" images"
[ ! -e "$SPAWNER_DATA_DIR/traefik/$env_id.yaml" ] || leftovers+=" routing"
[ ! -e "$SPAWNER_DATA_DIR/envs/$env_id" ] || leftovers+=" sources"
[ -z "$leftovers" ] || fail "left behind:$leftovers"
status=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $host" "http://127.0.0.1:${SPAWNER_HTTP_PORT}/")
[ "$status" = "404" ] || fail "the URL still answers ($status)"
pass "nothing left behind"

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
pass "the mounted page is served"

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
