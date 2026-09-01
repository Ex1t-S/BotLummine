#!/bin/sh
set -eu

DEPLOY_ROOT=${BLADEIA_DEPLOY_ROOT:-/srv/bladeia}
RESTORE_ROOT="$DEPLOY_ROOT/restore-test"
RUN_NAME="run-$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$RESTORE_ROOT/$RUN_NAME"
CONTAINER_NAME="bladeia-restore-test-$$"
VOLUME_NAME="bladeia_restore_test_$$"
TEST_PASSWORD=$(openssl rand -hex 24)

case "$RUN_DIR" in
  "$DEPLOY_ROOT"/restore-test/run-*) ;;
  *) echo "Ruta de restore inválida" >&2; exit 2 ;;
esac

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
  if [ -d "$RUN_DIR" ]; then
    find "$RUN_DIR" -mindepth 1 -delete
    rmdir "$RUN_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$RUN_DIR"
cd "$DEPLOY_ROOT"
export BLADEIA_IMAGE_TAG=$(cat "$DEPLOY_ROOT/.deployed-image-tag")

docker compose --profile ops run --rm restic restore latest --tag weekly --target "/restore/$RUN_NAME"
DUMP_FILE=$(find "$RUN_DIR" -type f -name 'bladeia-*.dump' | sort | tail -n 1)
[ -n "$DUMP_FILE" ] || { echo "Restic no restauró un dump BladeIA" >&2; exit 1; }

docker volume create "$VOLUME_NAME" >/dev/null
docker run -d --name "$CONTAINER_NAME" \
  -e POSTGRES_USER=bladeia_restore \
  -e POSTGRES_PASSWORD="$TEST_PASSWORD" \
  -e POSTGRES_DB=bladeia_restore \
  -v "$VOLUME_NAME:/var/lib/postgresql/data" \
  postgres:17-alpine >/dev/null

attempt=0
until docker exec "$CONTAINER_NAME" pg_isready -U bladeia_restore -d bladeia_restore >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || { echo "PostgreSQL temporal no inició" >&2; exit 1; }
  sleep 2
done

docker exec -i -e PGPASSWORD="$TEST_PASSWORD" "$CONTAINER_NAME" \
  pg_restore --username bladeia_restore --dbname bladeia_restore --no-owner --no-acl --exit-on-error < "$DUMP_FILE"

TABLE_COUNT=$(docker exec -e PGPASSWORD="$TEST_PASSWORD" "$CONTAINER_NAME" \
  psql --username bladeia_restore --dbname bladeia_restore --tuples-only --no-align \
  --command="select count(*) from pg_tables where schemaname = 'public';")

[ "$TABLE_COUNT" -ge 42 ] || { echo "Restore incompleto: $TABLE_COUNT tablas" >&2; exit 1; }
printf 'Restore mensual verificado: %s tablas\n' "$TABLE_COUNT"

