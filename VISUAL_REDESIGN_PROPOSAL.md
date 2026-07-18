# Propuesta de rediseño visual y UX de BladeIA / BotLummine

Fecha: 2026-07-18

Rama: `design/visual-redesign-proposal-local-20260718`

Alcance: auditoría visual, tres direcciones y prototipos. No incluye la migración completa de pantallas.

Datos: exclusivamente fixtures sintéticos. Railway, base de datos, WhatsApp y proveedores externos no fueron utilizados.

## Estado de decisión y revisión V2

La primera tanda A/B/C fue rechazada por baja densidad útil, exceso de espacio libre, acentos laterales poco refinados e iconografía inconsistente. No se considera una dirección aprobable ni se trasladará al producto.

La revisión V2 adopta una dirección SaaS operativa más densa y fue aprobada como camino de diseño el 18 de julio de 2026. Sus reglas son:

- base neutra y color principal reservado a selección, foco y acciones;
- tipografía un punto mayor que la primera V2, con metadata legible;
- iconografía SVG consistente;
- paneles sólo para agrupaciones semánticas, sin cards de entidad anidadas;
- listas continuas y tablas antes que colecciones de cajas;
- bordes completos sutiles, sin barras decorativas en botones;
- uso deliberado del ancho disponible y responsive progresivo.

Prototipos V2 validados hasta ahora:

| Pantalla | Paneles/cards | KPIs | Desborde horizontal | Estados responsive |
|---|---:|---:|---|---|
| Operaciones | 5 | 4 | 0 px | 1440, 1280, 768 y 390 px |
| Inbox | 0 cards de conversación | 0 | 0 px | Desktop de tres paneles; tablet sin contexto fijo; móvil Lista → Chat |

Prioridades acordadas para la siguiente etapa:

1. Inbox como módulo operativo principal.
2. Campañas con flujo guiado: objetivo, audiencia, mensaje, programación y revisión.
3. Audiencias con presets simples y filtros avanzados bajo demanda.
4. Analíticas orientadas a decisiones, con menos métricas simultáneas y comparación temporal clara.

## 1. Diagnóstico visual

La interfaz actual es funcional, pero su gramática visual está basada en `card + borde + fondo suave + badge`. Ese patrón se repite incluso cuando el contenido es una lista, una tabla, una sección de configuración o una métrica secundaria. Como resultado, la jerarquía depende más del contenedor que de la importancia operativa.

Hallazgos cuantitativos globales sobre `frontend/src/**/*.css`:

- 102 expresiones distintas de `font-size`.
- 35 expresiones distintas de `border-radius`.
- 335 expresiones distintas de `background`/`background-color`.
- 313 expresiones distintas de `border`/`border-color`.
- Metadatos visibles de 9, 10 y 11 px en distintas pantallas.
- Radios operativos desde 6 hasta 34 px, además de múltiples variantes `999px`.
- La misma pantalla puede acumular superficie de página, shell, hero, KPI, panel, card interna, badge y botón: hasta seis niveles perceptibles.

El problema no es sólo el celeste. El problema raíz es que color, borde, radio y elevación se usan simultáneamente para explicar cada agrupación. Esto produce demasiadas señales visuales de igual intensidad.

### Método de conteo

La baseline se obtuvo con tres fuentes:

1. Capturas reales del frontend actual a 1440×960, 1280×800, 768×1024 y 390×844.
2. Inventario estructural de JSX/CSS de las doce vistas solicitadas.
3. Fixture normalizado de tres filas o elementos por lista para que una pantalla con más datos no parezca artificialmente peor.

`Cards` incluye KPIs en caja, paneles con borde/fondo, cards de entidad y formularios contenidos. `Bordes` cuenta familias de contenedores visibles, no cada línea de una tabla. Los conteos de pantallas con contenido dinámico son una baseline estructural reproducible, no telemetría de producción.

## 2. Métricas de densidad por pantalla

| Pantalla | Cards/cajas | Cards anidadas | KPIs | Bordes visibles | Badges/pills | Superficies | Tamaños tipográficos | Acciones simultáneas | Profundidad | Espacio antes del contenido | Problema principal | Reducción propuesta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Operaciones | 13 | 5 | 7 | 28 | 8 | 7 | 9 | 12 | 5 | 470 px | Dos filas de KPIs antes de las tareas; salud y problemas pesan igual | 6 cajas, 4 KPIs, lista priorizada |
| Inbox automático | 10 | 3 | 0 | 24 | 10 | 6 | 8 | 15 | 4 | 168 px | Cada conversación parece card; estado, unread, realtime e IA compiten | 3 paneles, máximo 3 estados visibles |
| Inbox humano | 10 | 3 | 0 | 23 | 9 | 6 | 8 | 14 | 4 | 168 px | Mismo peso visual que AUTO aunque cambie la tarea | Estructura común con acento de cola mínimo |
| Revisión de comprobantes | 12 | 5 | 0 | 27 | 9 | 7 | 9 | 14 | 6 | 188 px | Documento, decisión e historial están encapsulados varias veces | 4 agrupaciones; evidencia y decisión primero |
| Campañas | 14 | 6 | 8 | 31 | 11 | 8 | 10 | 16 | 6 | 510 px | Hero, tabs, panel y cards de reglas generan caja dentro de caja | 5 cajas, 3 KPIs, filas operativas |
| Templates | 12 | 5 | 3 | 29 | 9 | 8 | 10 | 14 | 6 | 460 px | Edición, ayuda, preview y aprobación compiten | 4 secciones: lista, editor, preview, Meta |
| Carritos abandonados | 8 | 2 | 4 | 19 | 6 | 5 | 8 | 10 | 4 | 405 px | “Mostrando” se presenta como KPI y la barra de filtros ocupa demasiado | 3 agrupaciones, 3 KPIs, una filter bar |
| Clientes | 14 | 7 | 8 | 33 | 12 | 8 | 11 | 15 | 7 | 620 px | Sync, cinco KPIs, filtros y cards preceden la lectura comercial | 5 agrupaciones, 3 KPIs, tabla/lista |
| Catálogo | 10 | 3 | 2 | 23 | 11 | 7 | 9 | 13 | 5 | 390 px | Productos como cards densas y metadata en pills | 4 agrupaciones y tabla/lista con preview |
| Analytics | 15 | 6 | 12 | 32 | 10 | 9 | 11 | 10 | 6 | 520 px | Demasiadas métricas sin pregunta operativa asociada | 6 agrupaciones, máximo 5 KPIs |
| Administración | 18 | 8 | 9 | 39 | 20 | 9 | 12 | 22 | 7 | 480 px | Una card por configuración y estados expresados como pills | 6 dominios con subnav lateral |
| AI Lab | 6 | 2 | 0 | 17 | 6 | 6 | 9 | 9 | 4 | 360 px | Menú/chat/ayuda duplican contenedores y explicaciones | 3 paneles y metadata contextual |

### Resumen comparativo solicitado

| Pantalla | Cards | KPIs | Badges | Acciones | Problema principal | Reducción propuesta |
|---|---:|---:|---:|---:|---|---|
| Operaciones | 13 | 7 | 8 | 12 | KPIs y automatizaciones saludables dominan la pantalla | 6 / 4 / 4 / 9 |
| Inbox automático | 10 | 0 | 10 | 15 | Ruido por conversación y demasiados estados simultáneos | 3 / 0 / 3 / 8 |
| Inbox humano | 10 | 0 | 9 | 14 | Cola visible de forma demasiado decorativa | 3 / 0 / 3 / 8 |
| Revisión de comprobantes | 12 | 0 | 9 | 14 | Evidencia y decisión pierden prioridad | 4 / 0 / 3 / 7 |
| Campañas | 14 | 8 | 11 | 16 | Tabs, métricas y cards anidadas | 5 / 3 / 4 / 8 |
| Templates | 12 | 3 | 9 | 14 | Formulario y ayuda permanente compiten con preview | 4 / 1 / 3 / 8 |
| Carritos | 8 | 4 | 6 | 10 | KPIs decorativos y filtros dispersos | 3 / 3 / 3 / 6 |
| Clientes | 14 | 8 | 12 | 15 | Demasiado contenido antes del listado | 5 / 3 / 4 / 8 |
| Catálogo | 10 | 2 | 11 | 13 | Cards de producto y pills de metadata | 4 / 2 / 4 / 7 |
| Analytics | 15 | 12 | 10 | 10 | Métricas sin jerarquía ni decisión | 6 / 5 / 4 / 6 |
| Administración | 18 | 9 | 20 | 22 | Configuración fragmentada en cards | 6 / 3 / 5 / 10 |
| AI Lab | 6 | 0 | 6 | 9 | Explicación y contenedores repetidos | 3 / 0 / 2 / 5 |

### Información repetida y títulos redundantes

- El workspace aparece en sidebar, topbar, hero y, en ocasiones, dentro de cards.
- “Estado”, “configuración” y “sin configurar” se reiteran en título, badge y acción.
- Inbox repite cola/IA en encabezado, conversación y contexto.
- Campañas repite el nombre de la sección en navegación principal, hero, tab y panel.
- Clientes muestra conteos de pedidos tanto en sincronización como en KPIs y listado.
- Administración traduce cada valor técnico en un pill, incluso cuando un texto en línea sería suficiente.

### Contenido que debería dejar de ser card

- Automatizaciones de Operaciones: lista con divisores y estado alineado.
- Conversaciones de Inbox: filas seleccionables, no mini-cards.
- Campañas y schedules: filas operativas con acción siguiente.
- Clientes: tabla/lista en desktop; resumen lateral sólo al seleccionar.
- Catálogo: tabla/lista con thumbnail y stock; card sólo en móvil.
- Configuraciones de Administración: páginas planas por dominio.
- Historial de comprobantes: timeline colapsable.

## 3. Inventario y clasificación de KPIs

| Área | KPI actual | Clasificación | Decisión propuesta |
|---|---|---|---|
| Operaciones | Alertas | Esencial | Mantener como “Requieren acción” |
| Operaciones | Conversaciones 30d | Reubicar en Analytics | No ocupa el primer viewport |
| Operaciones | Entrada 30d / Salida 30d | Redundante | Unificar en actividad secundaria |
| Operaciones | Comprobantes pendientes | Esencial | Mantener con tiempo máximo de espera |
| Operaciones | Chats sin leer | Secundario | Reemplazar por conversaciones fuera de SLA |
| Operaciones | Carritos nuevos | Secundario | Integrar en prioridades cuando exceda umbral |
| Operaciones | Automatizaciones configuradas | Decorativo | Mostrar sólo errores; salud como resumen |
| Campañas | Enviados / destinatarios | Secundario | Contexto de la campaña seleccionada |
| Campañas | Entrega | Esencial | Mantener con denominador real |
| Campañas | Lectura | Secundario | Detalle, no KPI global permanente |
| Campañas | Respuestas | Esencial | Mantener si existe atribución confiable |
| Campañas | Conversiones | Esencial | Mantener con ventana de atribución |
| Campañas | Costo estimado | Reubicar en Analytics | No compite con acción operativa |
| Carritos | Total | Secundario | Convertir a conteo en heading |
| Carritos | Nuevos | Esencial | Renombrar “Sin contacto” |
| Carritos | Contactados | Secundario | Filtro o detalle |
| Carritos | Mostrando 1–20 | Eliminar | Es paginación, no KPI |
| Carritos | Valor abierto | Esencial | Añadir porque informa prioridad comercial |
| Carritos | Recuperados 7d | Esencial | Mantener si la atribución es real |
| Clientes | Pedidos | Secundario | Heading del listado o Analytics |
| Clientes | Clientes únicos | Esencial | Mantener |
| Clientes | Con teléfono | Decorativo | Convertir en filtro y eliminar KPI |
| Clientes | Ticket promedio | Esencial | Mantener |
| Clientes | Facturación | Esencial | Mantener con período explícito |
| Clientes | Páginas/items de sync | Secundario | Panel colapsable de proceso |
| Analytics | 12 métricas simultáneas | Reubicar/jerarquizar | Máximo cinco por objetivo analítico |
| Administración | Conteos técnicos de integración | Secundario | Estado compacto por dominio |

Regla propuesta: cada KPI debe contestar “¿qué decisión cambia si este número sube o baja?”. Si no hay una respuesta concreta, se convierte en metadata, filtro, tabla o Analytics.

## 4. Problemas de tipografía

- La familia declarada es principalmente Inter, pero no existe una garantía local consistente; el fallback cae a Arial en parte de la aplicación.
- 102 expresiones de tamaño crean una escala imposible de memorizar y mantener.
- La metadata de 9–11 px reduce legibilidad en sesiones prolongadas.
- Mayúsculas, tracking amplio y pesos altos se usan en demasiados niveles.
- Cards y KPIs dependen de tamaño/peso local en vez de una escala semántica.

Alternativa 1 — recomendada: `Inter, ui-sans-serif, system-ui` sin descarga remota. Si se decide empaquetar Inter, usar sólo variable latin woff2 y medir el impacto. Es neutral, legible y adecuada para tablas.

Alternativa 2: `Geist, ui-sans-serif, system-ui`, empaquetada localmente sólo si el bundle/CLS se mantiene. Aporta una voz más contemporánea y técnica, pero implica introducir el asset.

Alternativas descartadas para la primera migración:

- Manrope: más expresiva, pero sus formas redondeadas acercan el producto al tono promocional que se quiere reducir.
- `system-ui` puro: mejor rendimiento, pero cambia entre Windows/macOS y dificulta la consistencia de capturas.

Escala recomendada:

| Rol | Desktop | Mobile | Peso | Line-height |
|---|---:|---:|---:|---:|
| Título de página | 34 px | 28 px | 700 | 1.1 |
| Título de sección | 20 px | 18 px | 650 | 1.25 |
| Título de componente | 16 px | 16 px | 650 | 1.35 |
| Texto principal | 14 px | 14 px | 400/500 | 1.5 |
| Texto secundario | 13 px | 13 px | 400 | 1.45 |
| Metadata | 12 px | 12 px | 500 | 1.4 |

## 5. Problemas de color

- El celeste cumple simultáneamente roles de marca, superficie, selección, información y decoración.
- Variantes de azul/cian en fondos grandes diluyen el significado de selección.
- Los estados semánticos a veces compiten con el color de marca.
- Dark mode acumula overrides porque no existe una capa semántica única.
- 335 expresiones de background demuestran que la paleta real supera ampliamente la declarada.

Regla propuesta: 80–85% de la interfaz debe ser neutral; marca sólo en acción primaria, selección y foco. Los estados usan colores semánticos independientes.

## 6. Problemas de superficies y bordes

- 313 expresiones de borde y 35 radios producen variación incluso entre componentes equivalentes.
- Panel, card, KPI, form y row suelen tener borde completo simultáneamente.
- La sombra se usa junto con borde y color de fondo, multiplicando la separación visual.
- El radio alto hace que herramientas operativas parezcan módulos promocionales.

Sistema propuesto:

- Página: sin borde.
- Sección plana: espaciado + heading + divisor.
- Panel: una superficie y un borde sutil sólo cuando hay agrupación funcional.
- Popover/dialog: elevación 2.
- Row/table: divisores horizontales, no cards.
- Radios: 8 px controles, 10 px paneles, 999 px sólo avatar/toggle semántico.
- Sombras: ninguna en secciones planas; una sombra baja para panel; una alta para overlay.

## 7. Dirección A — Evolución conservadora

### Sistema

- Paleta: página `#F6F8FB`, panel `#FFFFFF`, suave `#EDF4FB`, texto `#16202B`, secundario `#687583`, primario `#1597D1`.
- Tipografía: Inter/system, escala reducida 30/20/16/14/12.
- Superficies: conserva cards principales, elimina cards internas innecesarias.
- Bordes: `#DCE4EC`, completos sólo en panel y control.
- Radios: 12 px panel; 8 px control.
- Sombras: una sombra baja `0 8px 24px rgb(24 52 74 / 8%)`.
- Espaciado: escala 4/8/12/16/24/32.
- Botones: altura 40 px, primario celeste, secundario neutro.
- Inputs: 40 px, borde único, label visible.
- Tablas: encabezado suave, filas con divisores.
- Cards: máximo un nivel de anidación.
- KPIs: hasta cinco; aún contenidos en card.
- Badges: mantienen fondo suave, máximo uno por entidad.
- Navegación: sidebar actual simplificado.

Ventajas: menor riesgo, rápida de migrar, conserva reconocimiento.

Riesgos: puede sentirse todavía demasiado cercana a la versión actual.

Esfuerzo: 2/5.

## 8. Dirección B — Renovación moderada (recomendada)

### Sistema

- Paleta: página `#F5F6F8`, panel `#FFFFFF`, suave `#EEF1F4`, texto `#18212B`, secundario `#697582`, primario `#315DCB`, success `#16835B`, warning `#A96C07`, danger `#BD3D45`.
- Tipografía: Inter/system con escala 34/20/16/14/13/12.
- Superficies: secciones planas por defecto; panel sólo para una unidad de trabajo completa.
- Bordes: divisores `#DFE4E8`; sin borde completo en KPI, actividad o metadata.
- Radios: 10 px panel, 8 px controles.
- Sombras: `0 5px 18px rgb(23 35 49 / 6%)` sólo en paneles elevados.
- Espaciado: 4/8/12/16/24/32/42.
- Botones: primario sólido; secundario outline; terciario texto. Una acción primaria por sección.
- Inputs: barra de filtros compacta con controles progresivos.
- Tablas: primera opción para datos operativos; sticky header y acción al final.
- Cards: reservadas para conversación, evidencia, configuración compleja o agrupación semántica real.
- KPIs: 3–5, planos con línea de acento y contexto real.
- Badges: texto semántico sin fondo cuando el color basta; máximo uno por fila.
- Navegación: sidebar sobrio; subnavegación compacta en lugar de pills.

Ventajas: cambio perceptible, menor ruido, mantiene familiaridad funcional, viable pantalla por pantalla.

Riesgos: requiere revisar CSS global y dark mode de manera coordinada.

Esfuerzo: 3/5.

## 9. Dirección C — Renovación profunda

### Sistema

- Paleta dark-first: página `#111722`, panel `#18212E`, suave `#202B3A`, texto `#F2F5F8`, secundario `#A3AFBC`, primario `#A8D86B`.
- Light counterpart: neutros fríos y acento oliva; no es una simple inversión.
- Tipografía: Geist/system, escala densa 32/19/15/14/12.
- Superficies: command center continuo; columnas y divisores sustituyen cards.
- Bordes: `#344151`, sólo estructura.
- Radios: 8 px; controles 6–8 px.
- Sombras: sólo overlays.
- Espaciado: 4/8/12/18/24/36.
- Botones: acento alto para acción primaria; controles compactos.
- Inputs: toolbar integrada y comandos rápidos.
- Tablas: densidad alta, filas seleccionables y panel de detalles.
- Cards: casi eliminadas.
- KPIs: barras compactas o summary rail.
- Badges: estado textual/ícono; color sin cápsula.
- Navegación: rail denso, atajos y panel contextual persistente.

Ventajas: identidad SaaS operativa clara, máxima reducción de cajas, gran velocidad de escaneo.

Riesgos: mayor curva de aprendizaje, dark-first puede no corresponder a todos los usuarios y exige revisar cada flujo.

Esfuerzo: 5/5.

## 10. Dirección recomendada

Se recomienda B.

La dirección A no resuelve por completo la percepción de “misma app con CSS más prolijo”. La C es potente, pero cambia demasiadas variables simultáneamente. B cambia la gramática visual —cards a secciones/listas, celeste a neutros, KPIs planos y tipografía controlada— sin alterar la arquitectura funcional.

Patrones puntuales de C que pueden incorporarse a B:

- Divisores y filas seleccionables del Inbox.
- Subnavegación lateral en Administración.
- Panel contextual persistente sólo en desktop.
- Densidad compacta opt-in para usuarios operativos.

## 11. Prototipos renderizados

Prototipo funcional: [`frontend/redesign-prototypes/visual-redesign-prototypes.html`](frontend/redesign-prototypes/visual-redesign-prototypes.html)

El archivo permite cambiar entre A/B/C y Operaciones/Inbox/Campañas/Carritos sin backend. Se generaron 48 capturas: tres direcciones × cuatro pantallas × cuatro viewports.

### Baseline actual

- [`Operaciones 1440×960`](frontend/audit-artifacts/redesign-current/operations-1440x960.png)
- [`Inbox 1440×960`](frontend/audit-artifacts/redesign-current/inbox-1440x960.png)
- [`Campañas 1440×960`](frontend/audit-artifacts/redesign-current/campaigns-1440x960.png)
- [`Carritos 1440×960`](frontend/audit-artifacts/redesign-current/carts-1440x960.png)

La carpeta `frontend/audit-artifacts/redesign-current/` contiene también 1280×800, 768×1024 y 390×844.

### Dirección A

- [`Operaciones`](frontend/audit-artifacts/redesign-prototypes/a/operations-1440x960.png)
- [`Inbox`](frontend/audit-artifacts/redesign-prototypes/a/inbox-1440x960.png)
- [`Campañas`](frontend/audit-artifacts/redesign-prototypes/a/campaigns-1440x960.png)
- [`Carritos`](frontend/audit-artifacts/redesign-prototypes/a/carts-1440x960.png)

### Dirección B — recomendada

- [`Operaciones`](frontend/audit-artifacts/redesign-prototypes/b/operations-1440x960.png)
- [`Inbox`](frontend/audit-artifacts/redesign-prototypes/b/inbox-1440x960.png)
- [`Campañas`](frontend/audit-artifacts/redesign-prototypes/b/campaigns-1440x960.png)
- [`Carritos`](frontend/audit-artifacts/redesign-prototypes/b/carts-1440x960.png)
- [`Operaciones mobile`](frontend/audit-artifacts/redesign-prototypes/b/operations-390x844.png)
- [`Inbox mobile`](frontend/audit-artifacts/redesign-prototypes/b/inbox-390x844.png)
- [`Campañas mobile`](frontend/audit-artifacts/redesign-prototypes/b/campaigns-390x844.png)
- [`Carritos mobile`](frontend/audit-artifacts/redesign-prototypes/b/carts-390x844.png)

### Dirección C

- [`Operaciones`](frontend/audit-artifacts/redesign-prototypes/c/operations-1440x960.png)
- [`Inbox`](frontend/audit-artifacts/redesign-prototypes/c/inbox-1440x960.png)
- [`Campañas`](frontend/audit-artifacts/redesign-prototypes/c/campaigns-1440x960.png)
- [`Carritos`](frontend/audit-artifacts/redesign-prototypes/c/carts-1440x960.png)

## 12. Comparación cuantitativa de los cuatro prototipos

Medición de Dirección B a 1440×960:

| Pantalla | Cards antes | Cards después | KPIs antes | KPIs después | Badges antes | Badges después | Acciones antes | Acciones después | Reducción principal |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Operaciones | 13 | 6 | 7 | 4 | 8 | 4 | 12 | 9 | Una lista priorizada reemplaza dos grillas de cards |
| Inbox | 10 | 3 paneles | 0 | 0 | 10 | 3 | 15 | 8 | Filas sin card; estado agrupado y contexto limpio |
| Campañas | 14 | 5 | 8 | 3 | 11 | 3 | 16 | 8 | Campañas como filas; próxima acción explícita |
| Carritos | 8 | 3 | 4 | 3 | 6 | 3 | 10 | 5 | Tabla desktop y cards operativas sólo en móvil |

### Cambios de jerarquía

Operaciones:

- Primero aparecen problemas accionables, no volumen de mensajes.
- Actividad y salud quedan en segundo nivel.
- Automatizaciones saludables se resumen; sólo los fallos ganan prioridad.

Inbox:

- Lista, chat y contexto forman una unidad continua.
- Se limita el estado por fila a una línea consistente.
- El composer se separa con un divisor, no con otra card.

Campañas:

- Nombre, audiencia, estado, métrica esencial y próxima acción conviven en una fila.
- Estadísticas secundarias salen del primer viewport.
- La navegación secundaria deja de usar tabs-pills grandes.

Carritos:

- “Mostrando” desaparece como KPI.
- Cliente/importe/antigüedad forman la lectura primaria.
- En móvil se mantiene card porque la tabla deja de ser escaneable; en desktop no se duplica el patrón.

### Elementos eliminados o reubicados

- Heroes altos: reemplazados por heading compacto.
- Cards de paginación/conteo: eliminadas.
- Pills explicativos: convertidos en texto semántico.
- Métricas 30d: Analytics.
- Ayuda permanente en formularios: tooltip/help contextual.
- Historial de comprobantes: timeline colapsable.
- Estados de integración: una fila por integración dentro del dominio.

### Riesgos funcionales de los prototipos

- Reducir badges exige definir qué estado tiene prioridad cuando hay varios.
- Agrupar filtros debe preservar filtros avanzados y URL state.
- Inbox móvil necesita mantener el flujo progresivo ya implementado.
- Tablas requieren sticky header, foco y acciones accesibles.
- La reducción de KPIs no debe ocultar alertas regulatorias u operativas reales.
- C es dark-first y necesita una validación adicional de fatiga visual y contraste.

## 13. Plan de implementación posterior a aprobación

1. Congelar la dirección elegida y registrar decisiones en un ADR visual.
2. Crear tokens semánticos nuevos en una capa aislada; no reemplazar globalmente en un solo commit.
3. Implementar tipografía, botones, inputs, divisores, tablas, estados y panel base.
4. Migrar Operaciones; TypeScript, build, E2E y capturas.
5. Migrar Inbox y revisión de comprobantes; conservar URL, drafts, colas y responsive.
6. Migrar Campañas/Templates; coordinar los cambios concurrentes existentes.
7. Migrar Carritos; tabla desktop y cards móvil.
8. Migrar Clientes/Catálogo/AI Lab.
9. Migrar Administración/Analytics con subnavegación por dominios.
10. Auditar light/dark, WCAG 2.2 AA, rendimiento y regresión visual.

Cada pantalla tendrá un commit separado. No se modificarán backend, Railway, variables ni migraciones salvo que un contrato sea imprescindible y se apruebe explícitamente.

## 14. Riesgos

- Existen cambios locales concurrentes en Campañas y manifests; deben integrarse de forma aislada.
- La dirección B cambia la densidad y puede requerir entrenamiento mínimo de usuarios frecuentes.
- El recorte de KPIs necesita validación con usuarios operativos para no ocultar una métrica decisiva.
- Dark mode actual depende de overrides; migrarlo sin tokens semánticos puede producir inconsistencias.
- Inter/Geist no deben cargarse remotamente sin medir peso, FOUT y CLS.
- Los prototipos son funcionales para navegación visual, no sustituyen pruebas contra contratos reales.

## 15. Criterios de aceptación

- La diferencia visual con la baseline es perceptible sin cambiar marca ni funciones.
- Reducción mínima de 45% en cards/cajas en las cuatro pantallas piloto.
- Máximo cinco KPIs visibles; Operaciones y Campañas apuntan a cuatro y tres.
- Reducción mínima de 50% en badges por fila o entidad.
- Ningún metadata operativo por debajo de 12 px.
- Celeste/azul reservado a acción, selección y foco; menos de 15% de superficie cromática en light mode.
- Una sola elevación de panel y una de overlay.
- Máximo dos radios operativos, excluyendo avatar/toggle.
- Desktop sin cards de entidad cuando una tabla/lista sea superior.
- Mobile sin scroll horizontal accidental y con targets táctiles de al menos 44 px.
- Light/dark WCAG 2.2 AA en pantallas críticas.
- TypeScript, build y E2E verdes después de cada migración.
- Capturas comparativas en 1440×960, 1280×800, 768×1024 y 390×844.
- La fase de implementación completa no comienza hasta aprobar una dirección.

## 16. Decisión pendiente

Esta propuesta se detiene aquí, como fue solicitado. La recomendación es aprobar B y, opcionalmente, incorporar la densidad de tablas y el panel contextual de C. No se modificó ninguna pantalla productiva.
