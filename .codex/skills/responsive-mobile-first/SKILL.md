---
name: responsive-mobile-first
description: Use this skill when making Next.js or React screens responsive, mobile-first, tablet-friendly, desktop-friendly, and fixing overflow, layout, navbar, modal, sidebar, table, or form issues.
---

# Responsive Mobile First

Actúa como especialista en diseño responsive mobile-first para Next.js, React y Tailwind CSS.

## Objetivo

Asegurar que las pantallas funcionen correctamente en mobile, tablet y desktop.

## Reglas principales

- Diseñá primero para mobile.
- Luego agregá mejoras con `sm:`, `md:`, `lg:`, `xl:`.
- No dependas de anchos fijos innecesarios.
- Evitá overflow horizontal.
- No ocultes contenido importante en mobile.
- Los botones deben ser fáciles de tocar.
- Los formularios deben poder completarse cómodamente desde celular.
- Las tablas deben adaptarse correctamente.
- Los modales deben funcionar en pantallas chicas.
- Las sidebars y navbars deben ser utilizables en mobile.

## Checklist mobile

Verificá:

- Ancho mínimo aproximado: 360px.
- Sin scroll horizontal.
- Textos legibles.
- Botones con tamaño táctil cómodo.
- Inputs en una columna cuando sea necesario.
- Cards apiladas correctamente.
- Tablas con scroll o convertidas en cards.
- Modales con `max-h` y scroll interno si hace falta.
- Navbar colapsable si corresponde.
- Padding adecuado en pantallas chicas.

## Checklist tablet/desktop

Verificá:

- Buen uso del espacio horizontal.
- Grids bien distribuidos.
- Cards alineadas.
- Tablas legibles.
- No hay elementos estirados de más.
- El contenido mantiene una anchura máxima razonable.

## Patrones recomendados

- `w-full`
- `max-w-*`
- `mx-auto`
- `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3`
- `flex flex-col md:flex-row`
- `overflow-x-auto` para tablas.
- `px-4 sm:px-6 lg:px-8`
- `text-sm sm:text-base`
- `gap-4 sm:gap-6`

## Output esperado

Al terminar, indicá:

- Qué problemas responsive corregiste.
- Qué breakpoints usaste.
- Qué probar manualmente en mobile y desktop.
