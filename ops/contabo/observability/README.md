# Observabilidad de BladeIA

Dozzle muestra los logs de todos los contenedores en tiempo real en
`https://logs.bladeia.com`. El acceso utiliza el usuario `admin` y el secreto
guardado únicamente en `/srv/bladeia/secrets/dozzle-admin-password`.

El socket Docker no se expone directamente a Dozzle: el visor se conecta a un
proxy interno con sólo lectura de contenedores, eventos e información del host.
No se habilitan acciones ni shell desde Dozzle. Nginx termina TLS y el contenedor
escucha únicamente en `127.0.0.1:3010`.

El archivo `/srv/bladeia/dozzle-users.yml` se genera en el VPS y no debe
versionarse. Crear primero el secreto si todavía no existe y luego el usuario:

```sh
test -f /srv/bladeia/secrets/dozzle-admin-password || openssl rand -base64 48 > /srv/bladeia/secrets/dozzle-admin-password
chmod 600 /srv/bladeia/secrets/dozzle-admin-password
pw=$(cat /srv/bladeia/secrets/dozzle-admin-password)
docker run --rm amir20/dozzle@sha256:7f01a2504f89788b60ad0efddd94472fd66f9a225c708356cdb815d9d8abd184 generate admin --password "$pw" \
  --name "BladeIA Logs" --user-roles none > /srv/bladeia/dozzle-users.yml
chmod 600 /srv/bladeia/dozzle-users.yml
```

El servicio se administra con:

```sh
systemctl enable --now bladeia-observability.service
docker compose -f /srv/bladeia/observability/docker-compose.yml ps
```

