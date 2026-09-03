# Observabilidad de BladeIA

Dozzle muestra los logs de todos los contenedores en tiempo real en
`https://logs.bladeia.com`. El acceso utiliza el usuario `admin` y el secreto
guardado únicamente en `/srv/bladeia/secrets/dozzle-admin-password`.

El socket Docker no se expone directamente a Dozzle: el visor se conecta a un
proxy interno con sólo lectura de contenedores, eventos e información del host.
No se habilitan acciones ni shell desde Dozzle. Nginx termina TLS y el contenedor
escucha únicamente en `127.0.0.1:3010`.

El archivo `/srv/bladeia/dozzle-users.yml` se genera durante la instalación y no
debe versionarse. Para recrearlo:

```sh
pw=$(cat /srv/bladeia/secrets/dozzle-admin-password)
docker run --rm amir20/dozzle:latest generate admin --password "$pw" \
  --name "BladeIA Logs" --user-roles none > /srv/bladeia/dozzle-users.yml
chmod 600 /srv/bladeia/dozzle-users.yml
```

El servicio se administra con:

```sh
systemctl enable --now bladeia-observability.service
docker compose -f /srv/bladeia/observability/docker-compose.yml ps
```

