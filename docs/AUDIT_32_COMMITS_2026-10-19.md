# Auditoría de 32 commits locales — 19 de octubre de 2026

## Alcance y resultado

Base: `origin/codex/contabo-migration` hasta `5d68823`. Se revisaron los 32 commits, su pertenencia a `origin/main`, el diff neto de los cambios pendientes, los conflictos con el `main` actualizado y la validación del árbol integrado. De los 32, **24 ya están en `main`** y **8 aún no están en `main` por identidad de commit**. La rama también contiene tres commits de observabilidad anteriores a esos 32; por eso la comparación completa con `main` muestra 11 commits propios. Una corrección de Shopify tiene un parche equivalente en `main`; el resto se conserva al integrar. `origin/main` aportó además nueve commits recientes, incluidos ajustes de permisos y de la interfaz de alta manual de WhatsApp.

| Commit | Cambio | Estado al iniciar |
| --- | --- | --- |
| `97abfca` | Migrate BladeIA backend to Contabo and R2 (#31) | Ya en `main` |
| `8f736a4` | Harden Contabo deploy dependency handling (#32) | Ya en `main` |
| `e3d69e9` | Protect secrets in Contabo access logs (#33) | Ya en `main` |
| `7ac5093` | Fix production login after Railway migration (#34) | Ya en `main` |
| `100f944` | Merge pull request #35 from Ex1t-S/codex/contabo-migration | Ya en `main` |
| `21b7cc9` | Merge pull request #36 from Ex1t-S/codex/contabo-migration | Ya en `main` |
| `86c16f6` | fix: suppress automatic replies to stale Meta webhook retries | Ya en `main` |
| `23036e6` | docs: record webhook backlog incident and safe recovery | Ya en `main` |
| `49d90bb` | Merge pull request #37 from Ex1t-S/codex/hotfix-stale-webhook-replies | Ya en `main` |
| `206b755` | fix: bound menu retries and audit delayed inbound history repair | Ya en `main` |
| `b28bbf2` | Merge pull request #38 from Ex1t-S/codex/harden-inbound-menus | Ya en `main` |
| `10b09ec` | fix: include audited repair script required by regression tests | Ya en `main` |
| `6392ea0` | Merge pull request #39 from Ex1t-S/codex/harden-inbound-menus | Ya en `main` |
| `4181c81` | fix(ai): harden automatic reply ownership and retry safety | Ya en `main` |
| `0a88945` | docs: track audit implementation and phase-one visual proposal | Ya en `main` |
| `2335146` | feat(operations): expose scoped read-only delivery permissions | Ya en `main` |
| `d3c66b1` | feat(ux): implement approved operations and automation views | Ya en `main` |
| `36e0a16` | fix(deps): update multer and qs security patches | Ya en `main` |
| `1fb2722` | fix(ux): handle incomplete runtime status and align operation tests | Ya en `main` |
| `36d30de` | Merge pull request #40 from Ex1t-S/codex/ux-ai-hardening | Ya en `main` |
| `a94989e` | feat: support Lummine CVU payment details | Ya en `main` |
| `eab249d` | Merge pull request #41 from Ex1t-S/codex/lummine-payment-template | Ya en `main` |
| `9c66bac` | feat(ai): improve conversation continuity and handoff safety | Ya en `main` |
| `d195548` | Merge pull request #42 from Ex1t-S/codex/conversation-intelligence | Ya en `main` |
| `34dd532` | fix(ai): ground catalog replies and improve handoffs | Pendiente de integrar |
| `fc46fbe` | fix(admin): scope payment details and validate WhatsApp permissions | Pendiente de integrar |
| `7cb08eb` | fix(messaging): limit interactive text fallback to eligible errors | Pendiente de integrar |
| `ca03791` | chore(ai): track safe Gemini diagnostic commands | Pendiente de integrar |
| `564f4b4` | chore(deps): refresh Railway CLI lockfile | Pendiente de integrar |
| `0df7e98` | Merge remote-tracking branch 'origin/main' into codex/contabo-migration | Pendiente de integrar |
| `ca67b16` | fix(shopify): align OAuth install and initial sync | Pendiente de integrar |
| `5d68823` | feat(whatsapp): guide and validate manual Meta channel setup | Pendiente de integrar |

## Hallazgos y acciones

1. La integración generó tres conflictos en el alta manual de WhatsApp. Se conservaron las validaciones posteriores de `main` (comprobación de Meta antes de activar, canal heredado y aviso de vencimiento de token) junto con las validaciones de permisos y pertenencia de WABA de esta rama.
2. El README principal seguía describiendo Railway como producción. Se actualizó para apuntar a Contabo y al flujo manual de WhatsApp.
3. El workflow de despliegue publica la imagen del backend, pero no sincroniza archivos `ops/contabo/` con el VPS. Se documentó la aplicación operativa separada. El visor Dozzle requiere crear su archivo de usuarios y contraseña en el VPS antes de activarlo.
4. El alta real de un número y la suscripción de la App a la WABA exigen verificar en Meta los IDs, el token de usuario del sistema, la propiedad del negocio, la recepción y el envío. Las pruebas automatizadas solo simulan Meta.

## Verificación

- `git show --check` en los 32 commits: sin errores.
- `npm ci --ignore-scripts` en backend y frontend: 0 vulnerabilidades reportadas en ambos.
- Prisma Client generado; `npm run check:syntax`: 168 archivos correctos.
- `npm run test:unit`: 180 pruebas aprobadas.
- `npm run build` del frontend: correcto.
- Playwright `tests/admin/whatsapp-manual-setup.spec.js`: 1 prueba aprobada.
- La API pública respondió HTTP 200 y `database: ok` con el commit `321453e` antes de esta integración. El acceso SSH local al VPS fue rechazado, por lo que no se verificó ni aplicó allí la configuración de `ops/contabo/`.

## Siguiente paso operativo

Integrar esta rama en `main` mediante PR y observar el workflow de Contabo. Antes de activar Dozzle o cambios de Compose, aplicar sus archivos en el VPS y validar los servicios. Para Kaisy, verificar primero el Business Manager, la App, WABA, Phone Number ID y token, y hacer una prueba de mensaje entrante y saliente. Repetir la comprobación por cada workspace sin reutilizar credenciales de otra marca.
