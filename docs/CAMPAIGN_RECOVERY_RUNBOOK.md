# Recuperación segura de campañas y carritos fallidos

## Alcance

Este procedimiento sirve para diagnosticar y reintentar destinatarios fallidos o pendientes sin volver a contactar a quienes ya fueron enviados. No autoriza envíos por sí mismo: la ejecución final debe hacerse con una ventana operativa aprobada y una persona responsable observando el resultado.

## Diagnóstico del 18 de julio de 2026

- La consulta fue de solo lectura. No se lanzó ninguna campaña ni se modificó Railway.
- En la ventana de registros observada se seleccionaron 23 oportunidades de carritos abandonados y cada una llegó al inicio del envío.
- Los logs del deployment actual no mostraban la ejecución consultada. Al revisar el deployment removido que seguía activo a esa hora apareció la evidencia completa de los dos fallos.
- La pantalla `Resultados` descartaba campañas sin `sentCount` y el enlace del resumen abría otra vista. Además, `Seguimiento` ignoraba inicialmente el parámetro `campaign` y elegía el primer registro. Esa combinación explicaba buena parte de la ausencia aparente de resultados.
- El worker horario de producción conserva una versión anterior porque su deployment más reciente falló durante `npm run build` con código 127. El backend principal sí estaba desplegado. Antes de depender del worker debe corregirse su build en una intervención separada y autorizada.
- Los registros muestran cierres de conexión Prisma cuando termina cada ejecución horaria. Como el contenedor cron finaliza después del job, deben correlacionarse con el código de salida antes de clasificarlos como pérdida de datos.

### Verificación de “13200” y de las 13:20

- “13200” correspondía en realidad al código de proveedor Meta `132000`.
- El 17 de julio de 2026 a las 13:19:37 (hora de Argentina), la automatización de carritos seleccionó exactamente 2 oportunidades.
- Los dos destinatarios iniciaron el intento de envío y ambos terminaron con `whatsapp.send_failed` y `campaign.recipient_send_failed`, HTTP 400 y código `132000`.
- En la ventana global revisada del 17 de julio entre las 12:00 y las 16:30 hubo 1 ejecución de automatización de carritos, 19 inicios de envío en todo el sistema y exactamente 2 fallos, ambos pertenecientes a esa misma campaña de carritos.
- La campaña usó la plantilla `carrito_abandonado_sin_eva_v2` y el payload registrado informó `componentsCount=0`, una señal concreta de que no se enviaron los componentes/variables que Meta esperaba.
- El mensaje del proveedor indica que la cantidad de parámetros no coincide con la esperada por la plantilla. No se incluyen IDs, teléfonos ni otros datos personales en este informe.
- La ejecución horaria cerró correctamente; el fallo estuvo en el payload individual enviado a Meta, no en el scheduler.

### Causa probable y condición de recuperación

La evidencia `componentsCount=0` indica que el payload llegó sin los componentes esperados por la plantilla; adicionalmente debe verificarse la cantidad y el orden de sus variables renderizadas. Reintentar los dos destinatarios sin corregir el template o el mapeo de variables repetirá el error `132000`.

Antes de habilitar el reintento se debe:

1. Leer la definición vigente de la plantilla y enumerar sus parámetros por componente y posición.
2. Compararla con las variables renderizadas para la automatización de carritos usando exclusivamente datos sintéticos o anonimizados.
3. Validar cantidad, orden, tipo y ausencia de valores vacíos.
4. Ejecutar una prueba local o sandbox sin delivery externo.
5. Recién después, habilitar una única recuperación de los 2 destinatarios fallidos y observar su resultado.

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
3. Si aparece `132000`, mantener el reintento bloqueado hasta validar cantidad y orden de parámetros contra la definición vigente en Meta.
4. Separar errores permanentes (número inválido, plantilla rechazada, baja) de errores transitorios (timeout, rate limit, servidor).
5. No reintentar `SKIPPED`, contactos con baja, conversaciones humanas abiertas ni destinatarios dentro del enfriamiento.
6. Verificar que no exista otra campaña activa con la misma audiencia y plantilla.
7. Registrar el conteo esperado de `FAILED + PENDING` y la hora de corte.
8. Ejecutar una única acción de “Reintentar fallidos” desde el seguimiento de la campaña seleccionada.
9. Observar que la campaña pase a cola y que el conteo de fallidos no aumente por un error fatal compartido.
10. Detener la ejecución si falla autorización, plantilla, credencial o configuración del proveedor; esos errores no se resuelven repitiendo destinatarios.
11. Comparar enviados antes/después y documentar cuántos quedaron enviados, fallidos, pendientes u omitidos.

## Rollback operativo

El reintento no puede retirar mensajes ya aceptados por WhatsApp. Si aparece un error compartido, cancelar la campaña para impedir nuevos despachos, conservar la evidencia anonimizada y corregir la causa antes de otro intento. No borrar destinatarios ni registros de automatización: son la protección contra duplicados y la traza de auditoría.
