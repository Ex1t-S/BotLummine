# WhatsApp AI Assistant Starter

Starter completo para:

- recibir mensajes de **WhatsApp Cloud API**
- responder con **Gemini** o **OpenAI**
- guardar usuarios, contactos, conversaciones y mensajes con **Prisma + PostgreSQL/Neon**
- entrar a una **pantalla web** con login para ver todos los chats
- probar integraciones sin Meta usando un **simulador de mensajes**
- importar chats viejos exportados de WhatsApp a tu base de datos

## Stack

- Node.js
- Express
- Prisma
- PostgreSQL / Neon
- EJS + CSS simple
- Gemini u OpenAI por configuración

## 1) Crear el proyecto en Visual Studio Code

```bash
npm install
cp .env.example .env
```

Después completá `.env`.

## 2) Base de datos

Este proyecto está pensado para **PostgreSQL**. Si ya usaste Neon, seguí con Neon.

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run db:seed
```

Usuario inicial:

- email: el valor de `SEED_ADMIN_EMAIL`
- password: el valor de `SEED_ADMIN_PASSWORD`

## 3) Levantar en desarrollo

```bash
npm run dev
```

Abrí:

- `http://localhost:3000/login`

## 4) Probar sin WhatsApp real

Mientras `WHATSAPP_DRY_RUN=true`, el sistema no le pega a Meta: guarda el mensaje y simula el envío.

En el dashboard vas a tener:

- un formulario para **simular mensaje entrante**
- un formulario para **probar la IA**
- listado de conversaciones
- detalle de cada chat
- respuesta manual
- switch de IA por conversación

## 5) Conectar WhatsApp Cloud API

### Webhook de verificación
Meta va a verificar:

- `GET /webhook/whatsapp`

### Webhook entrante
Meta enviará mensajes a:

- `POST /webhook/whatsapp`

### Variables necesarias

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

## 6) Elegir proveedor de IA

En `.env`:

```env
AI_PROVIDER=gemini
```

o

```env
AI_PROVIDER=openai
```

### Gemini
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

### OpenAI
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

## 7) Importar chats exportados

Podés exportar un chat de WhatsApp a `.txt` e importarlo.

Ejemplo:

```bash
node scripts/import-whatsapp-export.mjs "./exports/cliente1.txt" "Mi Negocio" "+5492210000000" "Cliente Demo"
```

Parámetros:

1. ruta del `.txt`
2. nombre de tu negocio en el chat exportado
3. teléfono / waId del contacto
4. nombre del contacto

El importador intenta parsear formatos típicos como:

- `12/03/26, 14:22 - Juan: Hola`
- `[12/03/26, 14:22:10] Juan: Hola`

## 8) Producción

Recomendado para producción:

- Railway / Render / Fly.io / VPS para el backend
- Neon para PostgreSQL
- nginx o proxy
- HTTPS real para el webhook
- Railway web: `npm start`
- Railway cron Enbox: `npm run jobs:enbox-sync`, schedule `*/30 * * * *`
- Railway cron campanas: `npm run jobs:campaign-dispatch`, schedule `*/5 * * * *`
- Diagnostico operativo opcional: `npm run jobs:diagnose`, schedule `0 */6 * * *`
- guia de workers/cron: `docs/railway-cron.md`
- hardening env: `LOG_LEVEL=info`, `DEBUG_EXTERNAL_PAYLOADS=false`, `HEALTHCHECK_DB=false`
- timeouts env: `META_GRAPH_TIMEOUT_MS`, `WHATSAPP_SEND_TIMEOUT_MS`, `TIENDANUBE_TIMEOUT_MS`, `ENBOX_TIMEOUT_MS`, `AI_PROVIDER_TIMEOUT_MS`
- `WHATSAPP_DRY_RUN=false`
- rotación de logs
- rate limiting
- cola de tareas si el tráfico sube

## 9) Próximas mejoras recomendadas

- búsqueda full text / pgvector
- asignación de chats a agentes
- etiquetas
- notas internas
- archivos y media
- respuestas rápidas / templates
- analytics
- panel de configuración desde UI

## 10) Estructura

```txt
src/
  controllers/
  middleware/
  routes/
  services/
    ai/
  views/
  lib/
public/
prisma/
scripts/
```
