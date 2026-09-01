#!/bin/sh
set -eu

DEPLOY_ROOT=${BLADEIA_DEPLOY_ROOT:-/srv/bladeia}
BACKUP_DIR="$DEPLOY_ROOT/backups"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TMP_FILE="$BACKUP_DIR/.bladeia-$STAMP.dump"
FINAL_FILE="$BACKUP_DIR/bladeia-$STAMP.dump"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd "$DEPLOY_ROOT"

export BLADEIA_IMAGE_TAG=$(cat "$DEPLOY_ROOT/.deployed-image-tag")
docker compose exec -T db sh -ec 'pg_dump --format=custom --no-owner --no-acl --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' > "$TMP_FILE"
docker compose exec -T db pg_restore --list < "$TMP_FILE" > /dev/null
chmod 600 "$TMP_FILE"
mv "$TMP_FILE" "$FINAL_FILE"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'bladeia-*.dump' -mtime +7 -delete

printf '%s\n' "$FINAL_FILE"

