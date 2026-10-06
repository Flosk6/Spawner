# Fixture: bind-mounted sources

Used by `scripts/e2e-engine.sh`, not an example to copy: a service that
mounts files of its source, and writes into it as root. An update must
recreate the service so it sees the new files, and a delete must remove
the files the container wrote.
