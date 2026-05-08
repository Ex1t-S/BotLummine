# Alta de una nueva tienda en Lummine

## Objetivo

Dejar una nueva marca operativa dentro de Lummine con:

- inbox de WhatsApp funcionando
- ecommerce conectado
- catálogo sincronizado
- branding y tono cargados
- usuarios de la marca creados
- envíos y campañas listos si aplican

## Cómo funciona hoy el sistema

Lummine es multi-tenant. Cada tienda vive dentro de un `workspace`.

Ese workspace concentra:

- identidad de marca
- configuración de IA
- canal de WhatsApp
- conexión de ecommerce
- conexión logística
- usuarios
- catálogo, clientes, pedidos, campañas y carritos abandonados

La asignación de mensajes entrantes de WhatsApp a una marca se hace por `phoneNumberId`. Cada número de Meta queda asociado a un solo workspace.

## Qué pedirle al cliente

### 1. Datos comerciales y operativos

- nombre de la marca
- slug corto para uso interno
- URL pública de la tienda
- logo
- tono de atención deseado
- nombre que va a usar la agente IA
- contexto de negocio: qué vende, diferenciales, reglas comerciales, restricciones

### 2. Datos de pago

- banco
- titular
- alias
- CBU/CVU
- texto adicional de pago por transferencia

### 3. Acceso a WhatsApp Cloud API

- `WABA ID`
- `Phone Number ID`
- `Access Token` vigente del número
- número visible del canal

Importante:

- hoy la verificación del webhook de WhatsApp usa `WHATSAPP_VERIFY_TOKEN` global de entorno
- el campo `verifyToken` existe por canal, pero el webhook de verificación no lo usa todavía

### 4. Acceso al ecommerce

Si usa Tiendanube:

- idealmente hacer instalación vía OAuth desde Lummine
- si no, pedir `storeId`, `accessToken`, `scope`, `storeName` y `storeUrl`

Si usa Shopify:

- `shopDomain`
- `accessToken`
- opcional `storeName`, `storeUrl`, `scope`

### 5. Logística

Si usa Enbox:

- usuario
- password
- `panelBaseUrl`
- `publicBaseUrl`
- `publicTrackingSalt`
- `targetClientId`
- `discoverySeedDid`

### 6. Acceso de equipo

- nombre, mail y password inicial del admin de la marca
- si van a operar varias personas, mails de agentes adicionales

### 7. Para campañas de WhatsApp

- confirmación de que la cuenta de Meta puede usar templates
- templates aprobados en Meta o definición de cuáles hay que crear

## Prerrequisitos de plataforma

Antes de dar de alta una nueva marca, la plataforma tiene que tener:

- backend público por HTTPS
- frontend con dominio autorizado por CORS
- base de datos con migraciones al día
- cron jobs activos si se van a usar campañas y Enbox

Variables especialmente importantes:

- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_URL` o `FRONTEND_URL_PROD`
- `CORS_ALLOWED_ORIGINS` si hay más de un dominio
- `BACKEND_PUBLIC_URL` o `TIENDANUBE_WEBHOOK_BASE_URL`
- `WHATSAPP_VERIFY_TOKEN`
- `TIENDANUBE_CLIENT_SECRET` o `TIENDANUBE_APP_SECRET`

## Orden recomendado de alta

### Paso 1. Crear el workspace

Desde `Admin plataforma > Marcas`:

- crear la marca
- cargar `name`
- cargar `slug`
- cargar `businessName`
- definir `agentName`
- definir `tone`

Esto crea la base del tenant.

### Paso 2. Cargar branding y contexto

Desde `Admin plataforma > Datos de plataforma y branding` o como admin de marca:

- nombre comercial
- logo
- contexto de negocio
- prompt extra si hace falta

Después, si la tienda es Tiendanube, conviene importar branding para traer:

- logo
- nombre de tienda
- URL de tienda
- algunos colores

### Paso 3. Conectar WhatsApp

Desde `Admin plataforma > Integraciones > WhatsApp Cloud API`:

- `wabaId`
- `phoneNumberId`
- `displayPhoneNumber`
- `accessToken`
- `graphVersion`
- estado `ACTIVE`

Validación esperada:

- ese `phoneNumberId` no puede estar asignado a otro workspace
- los mensajes entrantes de ese número van a caer en esa marca

### Paso 4. Configurar webhook de WhatsApp en Meta

En Meta hay que apuntar al backend:

- verificación: `GET /api/webhook/whatsapp`
- recepción: `POST /api/webhook/whatsapp`

Checklist:

- usar el `WHATSAPP_VERIFY_TOKEN` del entorno
- suscribir el número/cuenta a eventos de mensajes y estados

### Paso 5. Conectar ecommerce

#### Opción A. Tiendanube por OAuth

Es la mejor opción actual.

Flujo:

1. iniciar instalación en `/api/tiendanube/install` autenticado como admin
2. Tiendanube devuelve `code`
3. callback guarda `storeInstallation`
4. se intenta sincronizar branding
5. se intentan registrar webhooks de pedidos automáticamente

#### Opción B. Tiendanube manual

Cargar desde `Integraciones > Ecommerce`:

- provider `TIENDANUBE`
- `externalStoreId`
- `accessToken`
- `scope`
- `storeName`
- `storeUrl`

#### Opción C. Shopify manual

Cargar:

- provider `SHOPIFY`
- `externalStoreId` o `shopDomain`
- `shopDomain`
- `accessToken`
- `storeUrl`

### Paso 6. Confirmar webhooks de Tiendanube

Lummine usa:

- `POST /api/webhook/tiendanube/orders`

Si la instalación fue por OAuth y el backend está bien publicado por HTTPS, intenta registrar estos eventos:

- `order/created`
- `order/updated`
- `order/paid`
- `order/pending`
- `order/voided`
- `order/cancelled`
- `order/edited`

Si eso falla, hay que registrar los webhooks manualmente.

### Paso 7. Sincronizar catálogo

Desde `Admin plataforma > Operaciones`:

- importar branding Tiendanube si aplica
- sincronizar catálogo del proveedor correcto

Resultado esperado:

- productos cargados en `CatalogProduct`
- precios, imágenes, variantes y links listos para inbox y campañas

### Paso 8. Configurar contenido operativo

Como admin de marca:

- definir `agentName`
- ajustar `tone`
- cargar `businessContext`
- cargar datos de pago

Esto impacta directo en cómo responde la IA.

### Paso 9. Configurar menú de WhatsApp

Desde el editor de menú:

- revisar menú principal
- adaptar opciones, textos y submenús
- definir intenciones como producto, pagos, envíos, talles o derivación humana

No es obligatorio para que funcione el inbox, pero sí para replicar una experiencia como la actual de Lummine.

### Paso 10. Crear usuarios

Desde `Usuarios`:

- crear admin de marca
- crear agentes si hace falta

Roles:

- `PLATFORM_ADMIN`: toda la plataforma
- `ADMIN`: administra una marca
- `AGENT`: opera inbox

### Paso 11. Configurar logística

Si usa Enbox:

- guardar conexión `ENBOX`
- dejarla en `ACTIVE`

Esto permite enriquecer consultas de estado de pedido y sincronizar tracking.

### Paso 12. Templates y campañas

Si van a usar campañas:

- sincronizar templates desde Meta
- validar que el `wabaId` y el token del canal sean correctos
- revisar templates aprobados
- configurar schedules si van a automatizar envíos

### Paso 13. Jobs de fondo

En producción conviene tener:

- `npm run jobs:campaign-dispatch` cada 5 minutos
- `npm run jobs:enbox-sync` cada 30 minutos
- `npm run jobs:diagnose` cada 6 horas

Sin eso, campañas programadas y tracking no van a quedar al día.

## Validación final de salida

Una tienda nueva debería cerrar con este checklist:

- workspace creado
- branding cargado
- canal de WhatsApp `ACTIVE`
- webhook de WhatsApp validado
- ecommerce conectado
- webhooks de pedidos funcionando
- catálogo sincronizado
- datos de pago cargados
- menú de WhatsApp revisado
- usuario admin creado
- Enbox configurado si aplica
- templates sincronizados si van a usar campañas
- cron jobs activos en producción

## Prueba mínima recomendada

Hacer estas pruebas reales antes de darla por cerrada:

1. enviar un WhatsApp al número de la marca y confirmar que entra al inbox correcto
2. responder desde Lummine y confirmar entrega en WhatsApp
3. abrir catálogo en el panel y verificar productos
4. crear o modificar un pedido en Tiendanube y confirmar que entra por webhook
5. consultar estado de pedido desde WhatsApp si usa Enbox
6. sincronizar templates si va a usar campañas
7. lanzar una campaña de prueba o preview de carrito abandonado

## Riesgos y particularidades del estado actual

- el verify token de WhatsApp hoy es global, no por workspace
- Tiendanube puede operar por credenciales guardadas en base o por variables de entorno para el workspace default
- la instalación ideal de Tiendanube es por OAuth, porque además intenta dejar branding y webhooks resueltos
- campañas y templates dependen de que el canal de WhatsApp tenga `wabaId` y token válidos
- el ruteo entrante de WhatsApp depende de `phoneNumberId`, no del nombre de la marca

## Resumen práctico

Si querés repetir el alta de Lummine con el menor riesgo, pedile al cliente:

- datos de marca
- datos de pago
- acceso de WhatsApp Cloud API
- acceso de Tiendanube o Shopify
- acceso de Enbox si usa envíos
- usuarios del equipo
- definición de templates si va a usar campañas

Y hacé este orden:

1. crear workspace
2. conectar WhatsApp
3. conectar ecommerce
4. validar webhooks
5. sincronizar branding y catálogo
6. cargar contexto, pagos y menú
7. crear usuarios
8. configurar Enbox, templates y jobs
9. hacer pruebas reales de punta a punta
