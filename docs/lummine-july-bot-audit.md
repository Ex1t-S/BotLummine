# Auditoría de conversaciones de Lummine

## Corte analizado

Mensajes del workspace `lummine` desde el 1 de julio hasta el 6 de agosto de 2026. El análisis separa mensajes entrantes de salidas de campañas, porque las plantillas masivas no representan una respuesta del bot.

## Hallazgos confirmados

- 2.947 mensajes: 508 entrantes y 2.439 salientes.
- 124 conversaciones tuvieron al menos un mensaje entrante.
- Bajo la regla “respuesta antes del siguiente mensaje del cliente”, hubo 232 entradas sin salida previa; 156 recibieron otro mensaje antes de una respuesta y 76 quedaron sin salida posterior en el corte.
- Hubo 87 prompts de menú en 28 conversaciones. Catorce conversaciones repitieron el menú tres veces o más y una llegó a 12 prompts.
- Hubo intervención manual en 59 conversaciones. Después de la última salida manual llegaron 71 mensajes entrantes; solo 19 tuvieron una salida antes del siguiente mensaje. Ocho conversaciones volvieron a producir automatizaciones y dos volvieron a producir IA.
- Se detectaron 19 acciones de comprobantes, todas `APPROVE`, con transición `PAYMENT_REVIEW → HUMAN`.
- Se observaron 57 imágenes, 2 stickers, 4 audios y 1 documento. Los registros conservan identificadores/metadatos de Meta, pero el almacenamiento local de inbox no contiene los archivos del histórico.

Los conteos de intención son señales heurísticas y no se deben interpretar como etiquetas perfectas: 164 mensajes contenían términos comerciales y 132 terminaron en HUMAN; 172 contenían términos de pedido y 70 fueron clasificados como `general`.

## Cambios implementados

- Bloqueo humano duro para pagos, reclamos, devoluciones, pedidos problemáticos y pedidos explícitos de asistencia.
- Bloqueo comercial de 24 horas para intervenciones comerciales simples, con reanudación automática auditable solo ante un nuevo mensaje.
- Eventos durables de handoff, liberación, mensaje manual, menú, decisión entrante y revisión de pago.
- Menú con contador de intentos inválidos y derivación después de dos intentos; el texto libre comercial abandona el menú.
- Detección de precio y compra directa como intención comercial/producto.
- Estado de adjunto normalizado: `AVAILABLE`, `PENDING`, `DOWNLOAD_FAILED`, `UNRECOVERABLE` y `UNKNOWN`.
- El histórico no recuperable responde `410` y el bot no intenta interpretar imágenes o stickers ausentes. Solicita reenvío o descripción; los contextos de pago siguen la revisión humana.

## Seguimiento recomendado

Después del despliegue, medir durante siete días para Lummine: menú completado, repeticiones, entradas sin respuesta, mensajes automáticos durante lock humano, reanudaciones, tiempo de primera respuesta, precisión de intención comercial y disponibilidad de multimedia nueva.
