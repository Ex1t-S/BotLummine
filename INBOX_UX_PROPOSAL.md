# Propuesta Inbox BladeIA — revisión del código actual

## Alcance

Revisión de `InboxPage.jsx`, `InboxPage.css`, `InboxPage.v2.css`, `messaging-conversation.tsx`, `ai-chat-input.tsx` y del preview de `WhatsAppMenuPage.jsx`. No se modificó el Inbox ni se enviaron mensajes. Son hallazgos del código, no una validación end-to-end contra WhatsApp o producción. La revisión visual del navegador sigue pendiente por el bloqueo del navegador embebido.

## Qué ya existe y conviene conservar

- Bandejas Automático, Atención humana y Comprobantes; búsqueda y filtros de lectura/espera.
- Conversación y filtros en URL; navegación móvil entre lista y chat.
- Actualización por eventos, con polling de respaldo; paginación de conversaciones e historial.
- Borradores de texto por conversación durante la sesión de la pantalla.
- Archivos, pegado de imágenes, audio grabado, emojis y estados de envío/error.
- Panel de contexto e historial de decisiones de comprobantes.
- Confirmación antes de borrar historial y controles para acciones administrativas.
- Vista previa interactiva del menú de WhatsApp dentro de su editor.

## Hallazgos y prioridades

| Prioridad | Evidencia actual | Consecuencia | Propuesta |
|---|---|---|---|
| Alta | `selectedFile` es un único estado de InboxPage; cambiar de conversación no lo limpia ni lo guarda por ID | Un adjunto preparado para A puede quedar seleccionado al abrir B. Riesgo deducido del código; reproducir con datos locales antes de corregir | Guardar adjuntos y grabación por ID, o pedir descartarlos antes de cambiar; bloquear cruces de destinatario |
| Alta | `COMMANDS` ofrece Resumen interno, Traducir borrador y Explicar contexto; `handleSubmit` sólo envía texto, sin ejecutar los comandos | El usuario selecciona una capacidad que no tiene efecto | Retirar esas opciones hasta conectarlas, o implementar resultado en un panel de borrador con Aplicar/Descartar; nunca envío automático |
| Alta | `InteractiveMenuMessage` dibuja «Abrir menú» como `div` con `aria-hidden`, sin acción | El operador ve un control aparente que no puede abrir y no ve las opciones enviadas | Botón «Ver opciones enviadas» que despliega el payload histórico en modo lectura, con selección del cliente si está registrada |
| Alta | Tomar modo humano, volver a automático y comprobantes están juntos dentro del menú de tres puntos | Acciones frecuentes ocultas; difícil saber qué hacer primero | Acción principal visible «Pasar a atención humana» / «Volver a automático», con estado actual y feedback |
| Media | `handleLoadOlderMessages` y errores de marcar leído/no leído sólo hacen console.error | El operador puede creer que terminó una acción que falló | Error localizado y reintento; conservar historial y scroll |
| Media | `composerDrafts` vive sólo en useState | Se conserva al cambiar de chat, pero se pierde al salir de la pantalla o recargar | Persistencia con alcance usuario/workspace/conversación y política de expiración; informar claramente dónde se guarda |
| Media | Inbox pasa `status="offline"` fijo; el color de la etiqueta IA depende de ese mismo status | Presencia y automatización están mezcladas visualmente | Eliminar presencia si no hay dato real; separar estado de IA, atención humana y conexión del sistema |
| Media | La búsqueda usa `normalizedSearch` directamente en la queryKey | Puede disparar una consulta por cada tecla | Debounce de 250–300 ms, cancelación de peticiones viejas y feedback de búsqueda |
| Media | Se respeta el scroll cuando el operador lee arriba, pero no hay salto visible a mensajes nuevos en los componentes revisados | Puede no notar actividad reciente | Indicador «Nuevos mensajes» con contador y salto voluntario al final |
| Media | `Reiniciar IA` dispara la mutación directamente, mientras borrar historial sí confirma | Efecto poco explicado para una acción sobre contexto | Confirmación breve con alcance exacto; distinguir reinicio de contexto de devolver a automático |
| Media | Estilos repartidos entre CSS base, V2, global y overrides oscuros | Cambiar un color o tamaño puede tener efectos contradictorios | Unificar tokens y reglas del Inbox gradualmente; validar claro/oscuro antes de retirar reglas |

## Versión propuesta: Inbox operativo

Una interfaz de trabajo sobria: blanco para mensajes, azul profundo para navegación y celeste para selección. La animación del home no se traslada al chat. El objetivo es distinguir qué necesita respuesta, quién atiende y cuál es la próxima acción.

```text
┌──────────────────────┬────────────────────────────────┬─────────────────────┐
│ Bandeja              │ Cliente / teléfono             │ Contexto            │
│ Buscar…              │ IA activa  [Atención humana] ⋯ │ Resumen             │
│ Todas · IA · Humano  ├────────────────────────────────┤ Intención detectada │
│ Comprobantes         │ Fecha                          │ Última actividad    │
│ Esperando / Sin leer │ Mensajes y archivos            │ Cola actual         │
├──────────────────────┤ Menú enviado [Ver opciones]    │ Historial           │
│ Cliente · hora       │ Respuesta elegida              │                     │
│ Último mensaje       │                                │ Pedidos / cliente*  │
│ Espera respuesta     │           [Nuevos mensajes ↓]  │                     │
│                      ├────────────────────────────────┤                     │
│                      │ Responder al cliente           │                     │
│                      │ Borrador…                      │                     │
│                      │ Adjuntar · Audio       Enviar  │                     │
└──────────────────────┴────────────────────────────────┴─────────────────────┘
```

*Pedidos y datos ampliados son una segunda etapa: verificar los endpoints y permisos disponibles. No simular datos ni prometer que ya están integrados.*

- Desktop amplio: lista de 300–340 px, chat flexible y contexto opcional de 280–320 px. Contexto cerrado por defecto en anchos intermedios.
- Tablet: lista y chat; contexto como panel superpuesto que se cierra con Escape y devuelve foco al botón.
- Móvil: una pantalla a la vez: lista → chat → contexto. Botón de volver visible, compositor estable al abrir teclado y controles de al menos 44 px.
- Lista: nombre, último mensaje, tiempo y un único estado prioritario. Separar «no leído» de «espera respuesta»: no significan lo mismo.
- Cabecera: estado de automatización explícito y acción principal. «Pasar a atención humana» reutiliza la cola existente; no implica asignación personal. «Tomar conversación» sólo se incorporaría al existir ownership real.
- Compositor: adjunto/audio con preview y descarte; Enter envía, Shift+Enter agrega línea, ayuda visible. Borrador no se borra cuando falla el envío. Validar cambio de chat durante envío y grabación.
- Historial: fecha agrupada, hora compacta, autor IA/equipo distinguible y estado de entrega sólo cuando lo informa el backend. Evitar mostrar como entregado lo que sólo fue aceptado por la API.
- Comprobantes: panel específico con documento y decisión; separar «Registrar validación» de «Finalizar revisión». Mantener auditoría, motivo e idempotencia. No presentar la decisión operativa como acreditación bancaria.

## Parte interactiva

1. Menús recibidos/enviados: expandir las opciones exactas del payload histórico; no usar el menú actual de configuración para reconstruir un mensaje viejo. Si faltan datos: «Detalle de opciones no disponible».
2. Acciones del operador: distinguir controles reales de previews. No hacer que «Ver opciones» envíe una elección al cliente.
3. Editor de menú: conservar su simulador y sumar identificación del negocio activo, no una marca fija; el preview actual contiene el texto «Lummine».
4. Asistencia IA: primero resultado editable; después aplicación al borrador. «Resumen interno» no debe enviarse al cliente.
5. Respuestas rápidas, notas internas y asignación a operadores: mejoras posteriores sujetas a soporte de backend, permisos y auditoría.

## Orden de implementación recomendado

1. Seguridad de contexto del compositor: archivo/audio por conversación, cambio durante envío, borradores, errores de acciones y comandos sin efecto.
2. Nueva distribución visual con la misma API: lista, cabecera, compositor y contexto; menú interactivo expandible.
3. Accesibilidad y adaptación: teclado, foco, contraste, 360/390/768/1024/1440 px, claro/oscuro.
4. Extensiones: pedidos vinculados, notas internas, respuestas rápidas y asignación real, sólo después de validar datos y permisos.

## Pruebas de aceptación

- Adjuntar en A, abrir B: nunca enviar el archivo de A a B.
- Grabar en A y cambiar: detener/descartar de manera explícita, sin mover el audio al otro cliente.
- Enviar y cambiar de chat mientras responde la API: limpiar sólo el borrador del envío original.
- Error de envío: conservar texto/archivo, mostrar causa y reintento; validar duplicados ante respuesta perdida.
- Cargar historial antiguo con fallo: conservar el scroll y ofrecer reintento visible.
- Leer mensajes antiguos cuando llega uno nuevo: no saltar automáticamente; mostrar aviso.
- Pasar a humano / automático: verificar estado y comportamiento real de la IA, además de la etiqueta.
- Navegar listas, menús, diálogo de comprobantes y contexto sólo con teclado.
- Abrir menú histórico con/sin payload: mostrar información fiel sin enviar nada.
- Recargar, salir y cambiar de workspace: borradores aislados según la política elegida.

La propuesta no modifica todavía el Inbox productivo. La siguiente implementación debería comenzar por la primera etapa y acompañarse de una demo local con datos ficticios identificados.
