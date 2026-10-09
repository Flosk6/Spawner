#!/bin/sh
set -e

# Started as root: give the node user access to the host Docker socket (its
# group id differs between hosts) and to the data directory, then drop
# privileges.
if [ "$(id -u)" = "0" ]; then
  if [ -S /var/run/docker.sock ]; then
    DOCKER_GID=$(stat -c %g /var/run/docker.sock)
    if ! getent group "$DOCKER_GID" >/dev/null; then
      groupadd -g "$DOCKER_GID" docker-host
    fi
    usermod -aG "$(getent group "$DOCKER_GID" | cut -d: -f1)" node
  fi
  # The data directory and its first level may come from the host or from
  # Docker, as root, when it creates the mount source of Traefik: Spawner
  # writes in all of them. The data directory is Spawner's alone (the
  # containers that mount parts of it do not go through it); route files
  # stay readable by Traefik, which runs without capabilities.
  if [ -n "$SPAWNER_DATA_DIR" ]; then
    mkdir -p "$SPAWNER_DATA_DIR"
    chown node:node "$SPAWNER_DATA_DIR" 2>/dev/null || true
    chmod 700 "$SPAWNER_DATA_DIR" 2>/dev/null || true
    find "$SPAWNER_DATA_DIR" -mindepth 1 -maxdepth 1 -type d -exec chown node:node {} + 2>/dev/null || true
    find "$SPAWNER_DATA_DIR/traefik" -maxdepth 1 -type f -name '*.yaml' -exec chmod 644 {} + 2>/dev/null || true
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

# The database may still be starting: retry for about a minute.
echo "Running database migrations..."
attempt=1
until ./node_modules/.bin/prisma migrate deploy; do
  if [ "$attempt" -ge 20 ]; then
    echo "The database is unreachable, giving up" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 3
done

echo "Starting Spawner..."
exec node dist/main.js
