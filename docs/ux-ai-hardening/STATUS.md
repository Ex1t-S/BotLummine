# Implementación del informe UX/UI + IA

Fecha: 2026-09-09. Rama: `codex/ux-ai-hardening`, desde main `6392ea0`.

## Estado de esta entrega

**Trabajo parcial. No está todo implementado ni desplegado.** Se preservó la aprobación visual por fase solicitada por el usuario. No se cambiaron interfaces productivas, datos ni flags de envío.

| Hallazgo | Avance local | Falta para cerrar |
|---|---|---|
| IA-01 Webhook durable | Pendiente | Persistir antes del ACK, worker, migración y prueba real de recuperación |
| IA-02 Toma humana durante generación | Revalidación tras generación y antes de la salida normal; cancela por nuevo inbound o toma humana | Cubrir todos los caminos anticipados de menú/acuse y validar carreras con PostgreSQL |
| IA-03 Duplicación de salida | Fallback sólo ante rechazo de parámetros; reserva única persistente por respuesta normal/inbound | Cola de salida completa, interfaz de conciliación de resultados ambiguos y prueba de caída real |
| IA-04 Cooldown | Persistencia esperada, recuperación de lease de 15 min y limpieza condicionada al propietario | Prueba de reinicio y ráfagas con base real; revisar las rutas anticipadas |
| IA-05 Trazas | Captura aislada por turno, IDs/resultados de salida en eventos y logs, separada de shouldReply | Exponerlo en Laboratorio/Diagnóstico y sumar casos E2E |
| IA-06 Derivación estructurada | Se conserva la petición del modelo o del auditor | Evaluaciones sandbox de veracidad de stock/precios y casos adversariales |
| IA-07 Toma manual | Nueva toma manual HARD; las existentes no vencen silenciosamente | UI para explicar duración/liberación y prueba de operador |
| IA-08 Historial | Consulta acotada 20–100 mensajes, más último saliente histórico cuando hace falta | Medición en staging con chat largo y comparación funcional |
| UX-01 Estados de IA | La asignación se distingue de permisos pausados o desconocidos en Bandeja | QA con operadores en staging |
| UX-02/03 Automatizaciones | Consultas independientes, error por regla, configuración separada de permisos y horario real del servidor | Heartbeat fiable: el lastRunAt actual no se actualiza en todos los ciclos vacíos |
| UX-04/05 Operación | Acceso a reglas correcto, tres métricas con unidades, sin KPI que suma categorías, tareas separadas de estado técnico | QA con roles reales |
| UX-06/07 Resultados | URL conserva campaña, filtros y página; fetch de selección fuera de página; cero no reemplazado por subtotal; período correcto | Período compartido con Diagnóstico y respuestas globales (ahora rotuladas por página) |
| UX-08/13/20 Correcciones funcionales | Denominador de lectura alineado, moneda explícita, aria-pressed del período y error API no invalida credenciales | Resto de etiquetas de filtros y metadatos de actualización |
| UX-09 a UX-19 restantes | Rediseño general pendiente | Propuestas visuales y QA por fase, preservando marca y animación |

## Verificación local

- Tests Node del backend sin conexiones a producción: 137 pasan, 0 fallan.
- Tests unitarios del estado de automatización frontend: 4 pasan.
- Build frontend correcto. Persiste advertencia de chunk Three.js mayor a 500 kB.
- E2E demo: 1024/1280/1440, claro/oscuro, fallos independientes, ruta Configurar correcta, URL/filtros persistentes, ceros y login 503; sin errores JavaScript.
- Capturas finales en `frontend/audit-artifacts/hardening/`; todos los datos son sintéticos.
- Evaluación offline: 28 casos correctos; 8 casos de candidato requieren sandbox y no se ejecutaron.
- Check de sintaxis desde el directorio backend.
- Sin migraciones ejecutadas, mensajes externos, push ni despliegue.

Una ejecución del check de sintaxis desde la raíz falló por su directorio de trabajo; se repitió desde backend y pasó sobre 161 archivos. Las simulaciones de laboratorio quedan rotuladas SIMULATED, no ACCEPTED del proveedor.

La reserva de salida es conservadora: queda retenida incluso ante caída antes del envío o resultado ambiguo. Evita un segundo intento ciego; no garantiza entrega ni reemplaza una cola con conciliación. No borrar reservas para reintentar sin revisar la aceptación del proveedor.

Los cambios se probaron con dobles de base/transporte. No se debe confundir una prueba concurrente con mocks con una certificación E2E en PostgreSQL/Meta.

## Aprobación visual recibida — fase 1

[Propuesta generada](./phase-1-proposal.png): Operación y Automatizaciones. Es un mockup demo, no un snapshot implementado ni una lectura de producción.

Antes: capturas de la auditoría de 2026-09-08 en el workspace original, sin diferencias de código de frontend contra el main de partida.

Cambios propuestos:

1. Cabeceras compactas y una acción principal por contexto.
2. Estado de envíos persistente, independiente de asignación a IA o regla habilitada.
3. Pendientes con unidades explícitas; no sumar categorías heterogéneas.
4. Información técnica separada de tareas de atención.
5. Reglas con configuración, estado de envío y última ejecución diferenciados.
6. Error o información desconocida como tal, nunca como cero o desactivado.
7. Conservar navegación y funciones existentes: el mockup no autoriza eliminar Audiencias, aunque su pestaña no aparezca en la imagen generada.
8. En la implementación, “Habilitada” irá bajo Configuración; “Pausada por el equipo” bajo Estado de envío. El render conceptual no reemplaza esta definición.

El usuario aprobó esta fase con “Si aplica todo”. Se implementaron Operación y Automatizaciones, preservando Audiencias y el resto de rutas. Se corrigieron además errores funcionales de Resultados, Estadísticas, Bandeja y Login sin rediseñar esas pantallas. Landing, Resultados/Diagnóstico, Bandeja, Carritos/Clientes/Catálogo y Configuración/Laboratorio siguen pendientes de sus referencias para rediseños completos.

Las guías de UX, copy, accesibilidad y estados de carga/error del repositorio guiaron la separación de configuración y capacidad de envío; un fallo de consulta nunca se interpreta como regla deshabilitada. Se reutilizaron componentes y tokens. Compatibilidad puntual con el CSS heredado requirió overrides acotados; todavía no es una consolidación global de estilos.

La API de permisos es autenticada y de sólo lectura, no prueba conectividad con Meta. No se alteraron flags ni horarios en producción. No se ejecutaron migraciones ni despliegues. Se debe publicar backend antes de frontend; si el endpoint todavía no existe, la UI mostrará “sin verificar”.

## Siguientes pasos

1. Revisar capturas finales de la fase 1 implementada; preparar las referencias de las fases restantes.
2. Persistencia durable del webhook y conciliación de salida, con base de pruebas aislada.
3. Implementación UI por fase y pruebas desktop 1024/1280/1440.
4. QA en staging con envíos reales bloqueados; casos con Meta sólo mediante destinatarios de prueba autorizados.
5. Revisión del diff, integración y despliegue controlado, sin reactivar automáticamente el bot.
