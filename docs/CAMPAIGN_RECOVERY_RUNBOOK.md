# Recuperación segura de campañas y carritos fallidos

## Alcance

Este procedimiento sirve para diagnosticar y reintentar destinatarios fallidos o pendientes sin volver a contactar a quienes ya fueron enviados. No autoriza envíos por sí mismo: la ejecución final debe hacerse con una ventana operativa aprobada y una persona responsable observando el resultado.

## Diagnóstico del 18 de julio de 2026

- La consulta fue de solo lectura. No se lanzó ninguna campaña ni se modificó Railway.
- En la ventana de registros observada se seleccionaron 23 oportunidades de carritos abandonados y cada una llegó al inicio del envío.
- No aparecieron eventos `campaign.recipient_send_failed` ni `abandoned_cart_automation.failed` en los filtros consultados. Esto no demuestra entrega final: la entrega y la lectura dependen de los webhooks posteriores de Meta.
- La pantalla `Resultados` descartaba campañas sin `sentCount` y el enlace del resumen abría otra vista. Además, `Seguimiento` ignoraba inicialmente el parámetro `campaign` y elegía el primer registro. Esa combinación explicaba buena parte de la ausencia aparente de resultados.
- El worker horario de producción conserva una versión anterior porque su deployment más reciente falló durante `npm run build` con código 127. El backend principal sí estaba desplegado. Antes de depender del worker debe corregirse su build en una intervención separada y autorizada.
- Los registros muestran cierres de conexión Prisma cuando termina cada ejecución horaria. Como el contenedor cron finaliza después del job, deben correlacionarse con el código de salida antes de clasificarlos como pérdida de datos.

### Verificación de “13200” y de las 13:20

- La búsqueda literal de `13200` no devolvió coincidencias en los registros disponibles del backend, worker ni tráfico HTTP de producción.
- También se revisó la ventana del 17 de julio de 2026 entre las 13:15 y las 13:30 (hora de Argentina). No aparecieron eventos de campañas o carritos en los registros observables del backend y del worker para esa ventana.
- La ausencia en logs no demuestra que no exista un registro en la base: los importes, nombres y contadores de destinatarios no se registran de forma completa por seguridad.
- Por lo tanto, no es seguro inferir una campaña ni un conjunto de destinatarios reintentables a partir de “13200”. El conteo exacto debe obtenerse desde el detalle de lectura de la campaña seleccionada o mediante una consulta de auditoría autorizada y de solo lectura.

## Garantías actuales del reintento

El endpoint existente de reintento:

1. Está limitado por `workspaceId`.
2. Sólo cambia destinatarios `FAILED` o `PENDING` a `PENDING`.
3. No recrea destinatarios ni modifica `SENT`, `DELIVERED` o `READ`.
4. Antes de cada envío vuelve a aplicar bajas de marketing, conversaciones humanas abiertas y ventanas de enfriamiento.
5. Usa el bloqueo del dispatcher para impedir que dos procesos despachen la misma campaña simultáneamente.

El identificador único del registro de automatización por `workspaceId + checkoutId` evita volver a incorporar el mismo checkout en otra corrida automática. Los omitidos (`SKIPPED`) no deben reintentarse automáticamente.

## Conteo previo anonimizado

Antes de ejecutar, obtener desde `Seguimiento` o desde los endpoints de lectura:

- campaña y workspace esperados;
- total de `FAILED`;
- total de `PENDING`;
- total ya enviado (`SENT`, `DELIVERED`, `READ`);
- total `SKIPPED`;
- agrupación de fallos por código, sin teléfonos ni nombres;
- plantilla, idioma y estado de aprobación;
- estado de los flags `CAMPAIGN_DISPATCH` y `WHATSAPP_OUTBOUND`;
- antigüedad de la campaña y ventana comercial aplicable.

No exportar teléfonos, nombres, emails, checkout URLs ni payloads de Meta para obtener este conteo.

## Lista de control antes del reintento

1. Confirmar que la campaña pertenece al workspace correcto.
2. Confirmar que la plantilla sigue aprobada, conserva el idioma y acepta las mismas variables.
3. Separar errores permanentes (número inválido, plantilla rechazada, baja) de errores transitorios (timeout, rate limit, servidor).
4. No reintentar `SKIPPED`, contactos con baja, conversaciones humanas abiertas ni destinatarios dentro del enfriamiento.
5. Verificar que no exista otra campaña activa con la misma audiencia y plantilla.
6. Registrar el conteo esperado de `FAILED + PENDING` y la hora de corte.
7. Ejecutar una única acción de “Reintentar fallidos” desde el seguimiento de la campaña seleccionada.
8. Observar que la campaña pase a cola y que el conteo de fallidos no aumente por un error fatal compartido.
9. Detener la ejecución si falla autorización, plantilla, credencial o configuración del proveedor; esos errores no se resuelven repitiendo destinatarios.
10. Comparar enviados antes/después y documentar cuántos quedaron enviados, fallidos, pendientes u omitidos.

## Rollback operativo

El reintento no puede retirar mensajes ya aceptados por WhatsApp. Si aparece un error compartido, cancelar la campaña para impedir nuevos despachos, conservar la evidencia anonimizada y corregir la causa antes de otro intento. No borrar destinatarios ni registros de automatización: son la protección contra duplicados y la traza de auditoría.
