# BladeIA en Contabo

Este paquete despliega únicamente BladeIA. No comparte red, volumen, puerto ni
base de datos con la aplicación de inmobiliaria.

## Servicios

- `api`: Express/Prisma en `127.0.0.1:3002`.
- `db`: PostgreSQL 17 sin puertos publicados.
- `job`: proceso efímero usado por el timer horario.
- `restic`: proceso efímero para backups cifrados en R2.

## Preparación única

1. Crear `api.bladeia.com` apuntando al VPS y los buckets R2
   `bladeia` (público, servido por `assets.bladeia.com`) y
   `bladeia-private-prod` (privado, sin dominio público).
2. Copiar esta carpeta a una ruta temporal del VPS.
3. Ejecutar como root:

   ```sh
   ./scripts/bootstrap-root.sh /ruta/temporal/ops/contabo
   ```

4. Completar `/srv/bladeia/.env`, instalar la clave pública del workflow en
   `/home/bladeia-deploy/.ssh/authorized_keys` con las opciones
   `restrict,command="/usr/local/sbin/bladeia-deploy-ssh"` y guardar una copia
   externa de `/srv/bladeia/secrets/restic-password`.
5. Autenticar al usuario `deploy` contra GHCR con un token `read:packages`.
6. Emitir el certificado de `api.bladeia.com`, instalar
   `nginx/bladeia-log-format.conf` en `/etc/nginx/conf.d/` y
   `nginx/api.bladeia.com.conf` en `/etc/nginx/sites-available/`. Validar con
   `nginx -t` antes de recargar. El formato dedicado omite query strings para
   no guardar tokens de webhooks u OAuth en los access logs.

Los timers sólo se habilitan después del cutover:

```sh
systemctl enable --now bladeia-campaign-job.timer
systemctl enable --now bladeia-backup-local.timer
systemctl enable --now bladeia-backup-weekly.timer
systemctl enable --now bladeia-restore-test-monthly.timer
systemctl enable --now bladeia-health-monitor.timer
```

El monitor escribe en `journald` y, si se configura `ALERT_WEBHOOK_URL`, también
envía la alerta a ese webhook.

## Secretos GitHub Actions

- `CONTABO_HOST`
- `CONTABO_DEPLOY_USER` (`bladeia-deploy`)
- `CONTABO_SSH_PORT`
- `CONTABO_SSH_PRIVATE_KEY`
- `CONTABO_KNOWN_HOSTS`

El workflow publica una imagen por SHA, toma un backup antes de migraciones,
aplica Prisma, valida base y commit, y vuelve a la imagen anterior si falla.
