#!/bin/sh
set -eu

DEPLOY_ROOT=${BLADEIA_DEPLOY_ROOT:-/srv/bladeia}
LOCAL_BACKUP=$($DEPLOY_ROOT/scripts/backup-local.sh)
cd "$DEPLOY_ROOT"
export BLADEIA_IMAGE_TAG=$(cat "$DEPLOY_ROOT/.deployed-image-tag")

docker compose --profile ops run --rm restic snapshots >/dev/null 2>&1 || \
  docker compose --profile ops run --rm restic init
docker compose --profile ops run --rm restic backup "/backups/$(basename "$LOCAL_BACKUP")" --tag weekly
docker compose --profile ops run --rm restic forget --tag weekly --keep-weekly 12 --prune
touch "$DEPLOY_ROOT/last-weekly-backup-ok"
