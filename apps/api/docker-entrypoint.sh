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
  # writes in all of them.
  if [ -n "$SPAWNER_DATA_DIR" ]; then
    mkdir -p "$SPAWNER_DATA_DIR"
    chown node:node "$SPAWNER_DATA_DIR" 2>/dev/null || true
    find "$SPAWNER_DATA_DIR" -mindepth 1 -maxdepth 1 -type d -exec chown node:node {} + 2>/dev/null || true
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

echo "Running database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "Starting Spawner..."
exec node dist/main.js
