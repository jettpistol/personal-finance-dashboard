#!/bin/sh
# A bind-mounted ./data folder is usually created by root on the host; hand it to the
# unprivileged "node" user, then run the app as that user.
set -e
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${DATA_DIR:-/data}"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
