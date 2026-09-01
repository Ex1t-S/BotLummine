#!/bin/sh
set -eu

SOURCE_ROOT=${1:-}
DEPLOY_ROOT=/srv/bladeia
APP_USER=deploy
ACTION_USER=bladeia-deploy

[ "$(id -u)" -eq 0 ] || { echo "Ejecutar como root" >&2; exit 1; }
[ -n "$SOURCE_ROOT" ] && [ -f "$SOURCE_ROOT/docker-compose.yml" ] || {
  echo "Uso: bootstrap-root.sh /ruta/a/ops/contabo" >&2
  exit 2
}

install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$DEPLOY_ROOT"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" \
  "$DEPLOY_ROOT/backups" "$DEPLOY_ROOT/restore-test" "$DEPLOY_ROOT/secrets"
install -m 640 -o "$APP_USER" -g "$APP_USER" "$SOURCE_ROOT/docker-compose.yml" "$DEPLOY_ROOT/docker-compose.yml"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$DEPLOY_ROOT/scripts"
for script in "$SOURCE_ROOT"/scripts/*.sh; do
  [ "$(basename "$script")" = "bootstrap-root.sh" ] && continue
  install -m 750 -o "$APP_USER" -g "$APP_USER" "$script" "$DEPLOY_ROOT/scripts/$(basename "$script")"
done

if [ ! -f "$DEPLOY_ROOT/.env" ]; then
  install -m 600 -o "$APP_USER" -g "$APP_USER" "$SOURCE_ROOT/.env.example" "$DEPLOY_ROOT/.env"
  echo "Completar $DEPLOY_ROOT/.env antes del primer despliegue" >&2
fi

if [ ! -f "$DEPLOY_ROOT/secrets/restic-password" ]; then
  umask 077
  openssl rand -base64 48 > "$DEPLOY_ROOT/secrets/restic-password"
  chown "$APP_USER:$APP_USER" "$DEPLOY_ROOT/secrets/restic-password"
fi

if ! id "$ACTION_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$ACTION_USER"
fi
install -d -m 700 -o "$ACTION_USER" -g "$ACTION_USER" "/home/$ACTION_USER/.ssh"

cat > /usr/local/sbin/bladeia-deploy <<'EOF'
#!/bin/sh
set -eu
SHA=${1:-}
case "$SHA" in *[!0-9a-f]*|'') exit 2;; esac
[ "${#SHA}" -eq 40 ] || exit 2
exec runuser -u deploy -- /srv/bladeia/scripts/deploy.sh "$SHA"
EOF
chmod 750 /usr/local/sbin/bladeia-deploy
chown root:root /usr/local/sbin/bladeia-deploy

cat > /etc/sudoers.d/bladeia-deploy <<EOF
$ACTION_USER ALL=(root) NOPASSWD: /usr/local/sbin/bladeia-deploy *
EOF
chmod 440 /etc/sudoers.d/bladeia-deploy
visudo -cf /etc/sudoers.d/bladeia-deploy >/dev/null

for unit in "$SOURCE_ROOT"/systemd/*; do
  install -m 644 -o root -g root "$unit" "/etc/systemd/system/$(basename "$unit")"
done
systemctl daemon-reload

if [ ! -f /swapfile-bladeia ]; then
  fallocate -l 2G /swapfile-bladeia
  chmod 600 /swapfile-bladeia
  mkswap /swapfile-bladeia >/dev/null
  swapon /swapfile-bladeia
  printf '/swapfile-bladeia none swap sw 0 0\n' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-bladeia-swap.conf

echo "Bootstrap listo. Falta instalar la clave pública de GitHub Actions, completar .env y configurar Nginx/certificado."

