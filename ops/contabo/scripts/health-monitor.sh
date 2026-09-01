#!/bin/sh
set -eu

DEPLOY_ROOT=${BLADEIA_DEPLOY_ROOT:-/srv/bladeia}
ALERTS=""

append_alert() {
  if [ -n "$ALERTS" ]; then
    ALERTS="$ALERTS; $1"
  else
    ALERTS=$1
  fi
}

container_is_running() {
  [ "$(docker inspect --format '{{.State.Running}}' "$1" 2>/dev/null || true)" = "true" ]
}

container_is_running bladeia-db || append_alert "bladeia-db no está ejecutándose"
container_is_running bladeia-api || append_alert "bladeia-api no está ejecutándose"

if ! curl --fail --silent --max-time 8 http://127.0.0.1:3002/api/health >/dev/null 2>&1; then
  append_alert "el healthcheck de la API no responde correctamente"
fi

DISK_PERCENT=$(df -P "$DEPLOY_ROOT" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')
if [ "${DISK_PERCENT:-0}" -ge 85 ]; then
  append_alert "el disco está al ${DISK_PERCENT}%"
fi

MEM_AVAILABLE_MB=$(awk '/MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
if [ "${MEM_AVAILABLE_MB:-0}" -lt 512 ]; then
  append_alert "sólo quedan ${MEM_AVAILABLE_MB} MB de memoria disponible"
fi

NOW=$(date +%s)
LATEST_DUMP=$(find "$DEPLOY_ROOT/backups" -maxdepth 1 -type f -name 'bladeia-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -n 1 | cut -d' ' -f2-)
if [ -z "$LATEST_DUMP" ]; then
  append_alert "no existe ningún dump local validado"
else
  DUMP_AGE=$((NOW - $(stat -c %Y "$LATEST_DUMP")))
  [ "$DUMP_AGE" -le 129600 ] || append_alert "el último dump local tiene más de 36 horas"
fi

WEEKLY_MARKER="$DEPLOY_ROOT/last-weekly-backup-ok"
if [ ! -f "$WEEKLY_MARKER" ]; then
  append_alert "todavía no existe un backup semanal confirmado en R2"
else
  WEEKLY_AGE=$((NOW - $(stat -c %Y "$WEEKLY_MARKER")))
  [ "$WEEKLY_AGE" -le 691200 ] || append_alert "el último backup semanal confirmado tiene más de 8 días"
fi

if [ -z "$ALERTS" ]; then
  printf 'BladeIA monitor OK\n'
  exit 0
fi

MESSAGE="BladeIA Contabo: $ALERTS"
printf '%s\n' "$MESSAGE" >&2

if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  ESCAPED=$(printf '%s' "$MESSAGE" | sed 's/\\/\\\\/g; s/"/\\"/g')
  curl --fail --silent --show-error --max-time 10 \
    -H 'Content-Type: application/json' \
    --data "{\"text\":\"$ESCAPED\"}" \
    "$ALERT_WEBHOOK_URL" >/dev/null
fi

exit 1
