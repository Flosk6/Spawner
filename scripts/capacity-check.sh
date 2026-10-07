#!/usr/bin/env bash
#
# Checks on a real server that the capacity Spawner announces holds: as long
# as GET /system/capacity announces room for one more environment of a
# project, it creates one and waits until it is ready, then checks that the
# server kept its memory reserve; once the capacity says 0, one more must be
# refused (exit code 6). Every environment must still be ready at the end,
# without any out-of-memory kill. Everything it created is deleted at the end.
#
# It runs from any machine with Node.js 20 or later and curl, against a
# server you may fill for a while (its environments keep running, but new
# ones are refused until the check ends).
#
# Usage: SPAWNER_URL=https://spawner.preview.example.com SPAWNER_TOKEN=<admin token> \
#          scripts/capacity-check.sh [project directory] [--yes]
#   project directory   holds .spawner/ (default: examples/node-postgres)
#   --yes               no confirmation
#   MAX=<n>             stops after n environments, without the refusal check
#
# The token: an admin's personal token, or SPAWNER_BOOTSTRAP_TOKEN from
# /opt/spawner/.env. It creates the project "capacity-check" and deletes it at
# the end. A personal token belongs to a person, whose quota would stop the
# check early: the quota is lifted while it runs, then put back.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT=capacity-check
SOURCE="$ROOT/examples/node-postgres"
YES=0
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) SOURCE="$arg" ;;
  esac
done
: "${SPAWNER_URL:?set SPAWNER_URL to the dashboard URL}"
: "${SPAWNER_TOKEN:?set SPAWNER_TOKEN to an admin token}"
SPAWNER_URL="${SPAWNER_URL%/}"
export SPAWNER_URL SPAWNER_TOKEN
[ -f "$SOURCE/.spawner/spawner.yaml" ] || { echo "$SOURCE holds no .spawner/spawner.yaml" >&2; exit 2; }

WORK="$(mktemp -d)"
export SPAWNER_CONFIG_DIR="$WORK/cli-config"
CREATED=()
QUOTA_RESTORE=""
PROJECT_CREATED=0

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }
pass() { printf '\033[32mok\033[0m %s\n' "$*"; }
json() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);const r=($1);console.log(typeof r==='string'?r:JSON.stringify(r))})"
}
api() {
  local method=$1 path=$2
  shift 2
  curl -fsS -X "$method" -H "Authorization: Bearer $SPAWNER_TOKEN" "$SPAWNER_URL/api/v1$path" "$@"
}
spawner() { (cd "$WORK/app" && node "$WORK/spawner" "$@"); }
gib() { node -e "console.log((Number(process.argv[1]) / 1024 ** 3).toFixed(2) + ' GiB')" "$1"; }

cleanup() {
  local code=$?
  set +e
  if [ "${#CREATED[@]}" -gt 0 ]; then
    step "Deleting the ${#CREATED[@]} environments of the check"
    for env in "${CREATED[@]}"; do
      spawner down "$env" --no-wait --json >/dev/null 2>&1
    done
    for _ in $(seq 1 120); do
      [ "$(api GET "/envs?project=$PROJECT" | json 'v.length')" = "0" ] && break
      sleep 5
    done
  fi
  if [ -n "$QUOTA_RESTORE" ]; then
    api PUT /settings/limits -H 'Content-Type: application/json' -d "$QUOTA_RESTORE" >/dev/null || echo "Put the quota back from the settings page: $QUOTA_RESTORE" >&2
  fi
  if [ "$PROJECT_CREATED" = 1 ]; then
    api DELETE "/projects/$PROJECT" >/dev/null || echo "The project $PROJECT is left: delete it from the dashboard once its environments are gone" >&2
  fi
  rm -rf "$WORK"
  exit "$code"
}
trap cleanup EXIT

# capacity: the capacity of the project, as the server announces it.
capacity() {
  api GET /system/capacity | json "(() => { const p = v.projects.find((p) => p.project === '$PROJECT'); return [p.places ?? -1, v.host ? v.host.availableMemoryBytes : 0, p.memoryBytes, p.basedOn.memory, p.limitedBy].join(' '); })()"
}

# fresh_sample MS: waits for a sample of the server taken after MS (epoch milliseconds).
fresh_sample() {
  for _ in $(seq 1 40); do
    [ "$(api GET /system | json "v.at ? new Date(v.at).getTime() > $1 : false")" = "true" ] && return 0
    sleep 3
  done
  fail "the server took no new sample in 2 minutes"
}

step "Preparing"
version=$(api GET /info | json 'v.version')
curl -fsS "$SPAWNER_URL/api/v1/cli/spawner" -o "$WORK/spawner"
mkdir -p "$WORK/app"
cp -R "$SOURCE/." "$WORK/app/"
rm -rf "$WORK/app/node_modules" "$WORK/app/vendor" "$WORK/app/.git"
node -e "const fs = require('fs'); const f = process.argv[1]; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^project: .*$/m, 'project: $PROJECT'))" "$WORK/app/.spawner/spawner.yaml"
if api GET "/projects/$PROJECT" >/dev/null 2>&1; then
  [ "$(api GET "/envs?project=$PROJECT" | json 'v.length')" = "0" ] || fail "the project $PROJECT has environments: delete them first"
else
  api POST /projects -H 'Content-Type: application/json' \
    -d "{\"slug\":\"$PROJECT\",\"name\":\"Capacity check\",\"repoUrl\":\"https://github.com/Flosk6/Spawner.git\"}" >/dev/null
  PROJECT_CREATED=1
fi
read -r places available typical basis limited <<<"$(capacity)"
[ "$places" -ge 0 ] || fail "the server has not measured itself yet: try again in a minute"
echo "Spawner $version at $SPAWNER_URL: $(gib "$available") of memory available"
echo "Announced now: $places more environments of $(basename "$SOURCE"), at $(gib "$typical") each ($basis); measured usage will change it"
if [ "$YES" != 1 ]; then
  read -r -p "This fills the server with environments until it announces no room, then deletes them. Continue? [y/N] " answer </dev/tty
  [[ "$answer" =~ ^[Yy] ]] || { echo "Nothing done."; exit 0; }
fi
if [ "$(api GET /system/capacity | json 'v.quota !== null')" = "true" ]; then
  QUOTA_RESTORE=$(api GET /settings/limits | json 'JSON.stringify({ envsPerUser: v.overridden.includes("envsPerUser") ? v.values.envsPerUser : null })')
  api PUT /settings/limits -H 'Content-Type: application/json' -d '{"envsPerUser":0}' >/dev/null
  echo "The quota of a person is lifted until the end of the check"
fi

step "Creating environments while the capacity announces room"
lowest=$available
n=0
while :; do
  read -r places available typical basis limited <<<"$(capacity)"
  [ "$places" -gt 0 ] || break
  if [ -n "${MAX:-}" ] && [ "$n" -ge "$MAX" ]; then
    break
  fi
  n=$((n + 1))
  env="cap-$n"
  CREATED+=("$env")
  started=$(date +%s)
  up=$(spawner up "$env" --wait --json 2>"$WORK/up.err") || fail "$env was announced ($places more) but failed: $up $(tail -5 "$WORK/up.err")"
  [ "$(echo "$up" | json 'v.environment.status')" = "ready" ] || fail "$env should be ready: $up"
  ready_ms=$(node -e 'console.log(Date.now())')
  fresh_sample "$((ready_ms + 20000))"
  read -r _ now_available _ _ _ <<<"$(capacity)"
  [ "$now_available" -lt "$lowest" ] && lowest=$now_available
  [ "$now_available" -ge $((1024 ** 3)) ] || fail "after $env, only $(gib "$now_available") of memory is available: the 1 GiB reserve is gone"
  printf '%s ready in %ss (announced: %s more, %s each, %s); now %s available\n' \
    "$env" "$(($(date +%s) - started))" "$places" "$(gib "$typical")" "$basis" "$(gib "$now_available")"
done
[ "$n" -gt 0 ] || fail "the server announced no room for a single environment of $(basename "$SOURCE")"
pass "$n environments created as announced; at least $(gib "$lowest") of memory stayed available"

if [ -z "${MAX:-}" ]; then
  step "One more, beyond the capacity"
  CREATED+=(cap-beyond)
  set +e
  beyond=$(spawner up cap-beyond --wait --json 2>/dev/null)
  code=$?
  set -e
  [ "$code" = "6" ] || fail "with no room announced ($limited), one more environment should be refused with exit code 6, not $code: $beyond"
  pass "the capacity said 0 (limited by $limited) and one more environment was refused: $(echo "$beyond" | json 'v.error ? v.error.message : v.environment.error')"
fi

step "Checking the environments"
for env in "${CREATED[@]}"; do
  [ "$env" = cap-beyond ] && continue
  status=$(spawner status "$env" --json)
  [ "$(echo "$status" | json 'v.environment.status')" = "ready" ] || fail "$env is no longer ready: $(echo "$status" | json 'v.environment.status + " " + (v.environment.error || "")')"
  id=$(echo "$status" | json 'v.environment.id')
  ooms=$(api GET "/envs/$id/events" | json 'v.events.filter((e) => e.type === "oom").length')
  [ "$ooms" = "0" ] || fail "$env had $ooms out-of-memory kills"
done
swap=$(api GET /system | json 'v.host ? v.host.memory.swapUsedBytes : 0')
pass "the $n environments are ready, without any out-of-memory kill; swap in use: $(gib "$swap")"
