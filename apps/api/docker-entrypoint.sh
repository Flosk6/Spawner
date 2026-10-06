#!/bin/sh
set -e

# Started as root: give the node user access to the host Docker socket
# (its group id differs between hosts), then drop privileges.
if [ "$(id -u)" = "0" ]; then
  if [ -S /var/run/docker.sock ]; then
    DOCKER_GID=$(stat -c %g /var/run/docker.sock)
    if ! getent group "$DOCKER_GID" >/dev/null; then
      groupadd -g "$DOCKER_GID" docker-host
    fi
    usermod -aG "$(getent group "$DOCKER_GID" | cut -d: -f1)" node
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

echo "Running database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "Starting Spawner..."
exec node dist/main.js
