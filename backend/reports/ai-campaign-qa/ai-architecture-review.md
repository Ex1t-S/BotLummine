# Revision Profesional de Arquitectura IA

## Flujo actual
- WhatsApp entra por webhook y se persiste como inbound antes de decidir respuesta.
- El flujo principal pasa por menu, contexto de campana, deteccion de intent, reply gate, cooldown live, memoria, routing y generacion.
- El routing separa `AUTO`, `HUMAN` y `PAYMENT_REVIEW`, evitando que la IA siga cuando hay comprobante, reclamo fuerte o pedido humano.
- El prompt final combina estado, politicas, catalogo, commercial brain, menu context y campaign context.
- La generacion usa cadena de providers con Gemini/OpenAI y luego audita la respuesta antes de persistir outbound.

## Estado para su funcion
- Score automatico del QA: 5 / 5 sobre 6 conversaciones.
- Para venta asistida, la base es razonable: tiene memoria comercial, ranking de productos, reglas anti-repeticion y protecciones de catalogo.
- Para campanas, la mejora clave ya es el `campaignAssistantContext`: evita respuestas genericas cuando la respuesta del cliente viene de pago pendiente, carrito o promo.
- Para soporte/postventa, el sistema es mas conservador: corta a humano o revision de pago cuando detecta riesgo operativo.

## Fortalezas
- Buen desacople entre reglas deterministicas y modelo generativo.
- Trazabilidad alta: intent, queue, response policy, commercial plan, prompt y provider quedan disponibles.
- Protecciones utiles contra inventar tracking, acciones operativas, catalogo y multimedia.
- Modo lab permite probar sin enviar WhatsApp real.

## Falencias posibles
- Muchas reglas viven como regex dispersas; eso puede generar inconsistencias entre intent, gate, memoria y audit.
- El contexto de campana depende del ultimo outbound con metadata correcta; si falta `campaignMeta`, la IA pierde objetivo.
- El debounce live es en memoria; si el proceso reinicia, los timers pendientes se pierden.
- La evaluacion de calidad todavia no es parte de CI ni bloquea regresiones automaticamente.
- La IA puede seguir siendo debil ante mensajes largos con varias intenciones mezcladas si el intent principal queda mal clasificado.

## Recomendaciones priorizadas
1. Convertir este QA en suite recurrente con subset rapido obligatorio antes de deploy.
2. Persistir campaign context normalizado en conversation state cuando entra una respuesta de campana.
3. Unificar detectores de humano/frustracion/auto-respuesta en un modulo unico reutilizable.
4. Pasar el cooldown a una cola persistente si se escala a produccion multi-instancia.
5. Agregar evaluador LLM offline para complementar los scores por regex con juicio semantico.
