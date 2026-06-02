# BotLummine

Panel multi marca para operar ventas por WhatsApp con IA, inbox humano, catalogo, campanias, carritos abandonados, clientes e integraciones de ecommerce/logistica.

El backend corre con Express, Prisma y PostgreSQL/Neon. El frontend corre con Vite + React. Produccion esta pensada para Railway en backend y dominio publico del panel en `bladeia.com`.

## Estructura

```txt
backend/
  prisma/        schema y migraciones
  scripts/       utilidades operativas versionadas
  src/           API, jobs, servicios e integraciones
frontend/
  src/           panel web
  tests/         pruebas Playwright/performance
.github/         auditoria de seguridad y dependabot
```

## Desarrollo Local

Instalar dependencias:

```bash
npm --prefix backend ci
npm --prefix frontend ci
```

Generar Prisma:

```bash
npm --prefix backend run prisma:generate
```

Levantar servicios:

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
```

El frontend local usa `http://localhost:5173`. El backend por defecto usa `PORT=3000` si no se define otro puerto.

## Produccion En Railway

Railway ejecuta el comando de inicio definido en `railway.json`:

```bash
npm start
```

Ese comando aplica migraciones Prisma y arranca el backend.

Jobs operativos recomendados:

```bash
npm run jobs:campaign-dispatch
npm run jobs:enbox-sync
npm run jobs:diagnose
```

Schedules sugeridos:

- Campanias, carritos, pagos pendientes y envios: cada 1 hora.
- Enbox sync: cada 30 minutos.
- Diagnostico: cada 6 horas.
- Compactacion de payloads crudos: manual o cron controlado con `npm --prefix backend run raw-payloads:compact:apply`.

Para Neon serverless, no dejar un scheduler residente haciendo polling desde el web server. Mantener
`CAMPAIGN_DISPATCHER_ENABLED=false` en el servicio web cuando exista un cron, y ejecutar
`npm run jobs:campaign-dispatch` como Railway Cron cada 1 hora si se necesitan campanias,
carritos, pagos pendientes o notificaciones automaticas. Esto evita que `/api/health` y el proceso web
mantengan compute de Postgres activo cuando no hay trafico real.

Tambien mantener `AI_REPLY_COOLDOWN_SWEEP_MS=0` o sin definir en el servicio web. Las respuestas con
cooldown siguen funcionando con timers en memoria cuando entra un webhook; el sweep solo sirve para
recuperar respuestas pendientes despues de reinicios, y si queda activo consulta Postgres en bucle.

## Variables De Entorno

No guardar valores reales en git. Configurar secretos solo en Railway o en `.env` local ignorado.

Base:

- `NODE_ENV=production`
- `PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `AUTH_COOKIE_NAME`
- `SECRET_ENCRYPTION_KEY`
- `BACKEND_PUBLIC_URL`
- `FRONTEND_URL`
- `FRONTEND_URL_PROD`
- `ALLOW_VERCEL_PREVIEWS=false`

IA:

- `AI_PROVIDER`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `MAX_CONTEXT_MESSAGES`
- `AI_AUTOREPLY_ENABLED`
- `AI_REPLY_COOLDOWN_SWEEP_MS=0` para evitar polling permanente en Neon; usar un valor positivo solo si se acepta compute continuo.

WhatsApp / Meta:

- `META_APP_ID`
- `META_APP_SECRET`
- `WHATSAPP_DRY_RUN=false`
- `WHATSAPP_GRAPH_VERSION`
- `WHATSAPP_INBOUND_MEDIA_DIR`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

Tiendanube:

- `TIENDANUBE_APP_ID`
- `TIENDANUBE_CLIENT_SECRET`
- `TIENDANUBE_REGISTER_SECRET`
- `TIENDANUBE_STATE_SECRET`
- `TIENDANUBE_WEBHOOK_BASE_URL`
- `TIENDANUBE_REDIRECT_URI`

Shopify, si aplica:

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_REDIRECT_URI`
- `SHOPIFY_WEBHOOK_BASE_URL`
- `SHOPIFY_APP_SCOPES`

Seguridad y observabilidad:

- `RATE_LIMIT_BACKEND=upstash`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `RATE_LIMIT_FAIL_OPEN=false`
- `TURNSTILE_REQUIRED=true` cuando el widget este validado en frontend
- `TURNSTILE_SECRET_KEY`
- `SENTRY_DSN`
- `LOG_LEVEL=info`
- `DEBUG_EXTERNAL_PAYLOADS=false`

Campanias:

- `CAMPAIGN_DISPATCHER_ENABLED=true` o sin definir hasta crear Railway Cron; luego usar `false` en el servicio web.
- `CAMPAIGN_DISPATCHER_INTERVAL_MS`
- `CAMPAIGN_HEADER_MEDIA_MAX_BYTES`
- `OUTBOUND_MEDIA_MAX_BYTES`

## Seguridad Operativa

Estado actual cubierto por el codigo:

- Cookies de sesion `httpOnly`, `secure` y firmadas con JWT.
- CORS por allowlist de origenes.
- Bloqueo por `Origin`/`Referer` para mutaciones autenticadas.
- Webhooks de WhatsApp, Shopify y Tiendanube validados por firma.
- Secretos de proveedores cifrados con `SECRET_ENCRYPTION_KEY`.
- Rate limiting para login, webhooks y acciones sensibles.
- Sentry opcional para errores y eventos de seguridad.

Checklist de produccion:

- Mantener `DEV_AUTH_BYPASS=false`.
- Usar `RATE_LIMIT_BACKEND=upstash` y `RATE_LIMIT_FAIL_OPEN=false`.
- Activar Turnstile cuando el login tenga el token frontend conectado.
- No activar `OUTBOUND_DEBUG` ni `DEBUG_EXTERNAL_PAYLOADS` en produccion.
- Rotar secretos si fueron compartidos en capturas, chats o logs.
- Ejecutar compactacion de payloads crudos segun retencion.
- Revisar backups despues de cifrar secretos y definir desde que fecha contienen `enc:v1`.

Backlog de hardening:

- Agregar token CSRF para mutaciones autenticadas.
- Sanitizar `rawPayload` antes de responder al inbox.
- Validar passwords nuevos con minimo 12 caracteres.
- Sanitizar logs debug de proveedores antes de imprimirlos.

## Scripts Utiles

Backend:

```bash
npm --prefix backend run audit:security
npm --prefix backend run prisma:generate
npm --prefix backend run prisma:migrate
npm --prefix backend run raw-payloads:compact:dry-run
npm --prefix backend run raw-payloads:compact:apply
npm --prefix backend run ai:regression
```

Frontend:

```bash
npm --prefix frontend run build
npm --prefix frontend run test:e2e
npm --prefix frontend run test:perf
```

Repositorio completo:

```bash
npm run audit:security
npm run build
```

## Verificacion Antes De Deploy

```bash
npm --prefix backend audit --audit-level=high
npm --prefix frontend audit --audit-level=high
npm --prefix backend run prisma:generate
npm --prefix frontend run build
```

Confirmar tambien:

- `git status` no muestra secretos ni artefactos locales.
- Railway tiene los dominios exactos en `FRONTEND_URL`, `FRONTEND_URL_PROD` y `BACKEND_PUBLIC_URL`.
- Los webhooks publicos usan HTTPS.
