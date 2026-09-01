#!/bin/sh
set -eu

DEPLOY_ROOT=${BLADEIA_DEPLOY_ROOT:-/srv/bladeia}
NEW_TAG=${1:-}

case "$NEW_TAG" in
  *[!0-9a-f]*|'') echo "SHA de imagen inválido" >&2; exit 2 ;;
esac
[ "${#NEW_TAG}" -eq 40 ] || { echo "El SHA debe tener 40 caracteres" >&2; exit 2; }

cd "$DEPLOY_ROOT"
exec 9>"$DEPLOY_ROOT/.deploy.lock"
flock -n 9 || { echo "Ya hay otro despliegue activo" >&2; exit 3; }

OLD_TAG=$(cat "$DEPLOY_ROOT/.deployed-image-tag" 2>/dev/null || true)
export BLADEIA_IMAGE_TAG="$NEW_TAG"

docker compose pull api job
if [ -n "$OLD_TAG" ] && docker compose ps --status running db | grep -q bladeia-db; then
  "$DEPLOY_ROOT/scripts/backup-local.sh" >/dev/null
fi

docker compose --profile jobs run --rm --no-deps job npm run prisma:migrate
docker compose up -d --no-deps api

healthy=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  if body=$(curl --fail --silent --max-time 5 http://127.0.0.1:3002/api/health 2>/dev/null) \
    && printf '%s' "$body" | grep -q "\"commit\":\"$NEW_TAG\"" \
    && printf '%s' "$body" | grep -q '"database":"ok"'; then
    healthy=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if [ "$healthy" -ne 1 ]; then
  echo "Healthcheck falló para $NEW_TAG" >&2
  if [ -n "$OLD_TAG" ]; then
    export BLADEIA_IMAGE_TAG="$OLD_TAG"
    docker compose up -d --no-deps api
  fi
  exit 1
fi

printf '%s\n' "$NEW_TAG" > "$DEPLOY_ROOT/.deployed-image-tag"
chmod 600 "$DEPLOY_ROOT/.deployed-image-tag"
docker compose ps
