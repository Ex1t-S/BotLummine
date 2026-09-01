#!/bin/sh
set -eu

SHA=$(printf '%s\n' "${SSH_ORIGINAL_COMMAND:-}" | sed -n "s/^sudo \/usr\/local\/sbin\/bladeia-deploy '\([0-9a-f]\{40\}\)'$/\1/p")

if [ -z "$SHA" ]; then
  echo "Comando de despliegue no autorizado." >&2
  exit 126
fi

exec sudo /usr/local/sbin/bladeia-deploy "$SHA"
