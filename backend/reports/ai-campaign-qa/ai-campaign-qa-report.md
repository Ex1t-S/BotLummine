# Reporte QA de IA en Campanas

Run: 2026-05-19T23-31-25-510Z
Total conversaciones: 6
Score promedio: 5 / 5

## Score por tipo
- pending_payment: 5 / 5 (2 casos)
- cart_recovery: 5 / 5 (2 casos)
- marketing: 5 / 5 (2 casos)

## Score por marca
- lummine: 5 / 5 (3 casos)
- ruchi: 5 / 5 (3 casos)

## Fallas mas repetidas
- Sin fallas detectadas por reglas automaticas.

## Ejemplos a revisar
- Sin ejemplos fallidos.

## Lectura profesional
- La IA ya tiene buena estructura para distinguir venta, soporte, comprobantes, menu y contexto de campana.
- La calidad real depende de que el contexto de campana llegue bien en `rawPayload.campaignMeta` y de que el catalogo tenga productos confiables.
- Los riesgos principales siguen siendo cambios de tema, objeciones con detalles de talle/tela y promesas operativas si el modelo intenta completar datos faltantes.
- Las derivaciones a humano deben mirarse como exito cuando hay frustracion, pedido explicito de persona o reclamo postventa.
