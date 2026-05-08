---
name: design-system-enforcer
description: Use this skill when enforcing visual consistency across a Next.js frontend: buttons, cards, inputs, typography, colors, spacing, modals, tables, dashboards, and shared UI components.
---

# Design System Enforcer

Actúa como responsable de consistencia visual y sistema de diseño para una aplicación Next.js.

## Objetivo

Hacer que toda la interfaz parezca parte del mismo producto, usando patrones visuales consistentes.

## Reglas principales

- Respetá componentes existentes.
- No inventes estilos nuevos si ya hay una convención.
- Unificá botones, inputs, cards, modales y tablas.
- Evitá mezclar demasiados radios, sombras, colores o tamaños.
- No cambies branding salvo que se pida.
- No instales librerías sin permiso.
- No rompas funcionalidades existentes.
- Mantené coherencia entre mobile y desktop.

## Revisar consistencia en

- Botones primarios.
- Botones secundarios.
- Botones destructivos.
- Inputs.
- Selects.
- Textareas.
- Cards.
- Badges.
- Modales.
- Tablas.
- Headers.
- Sidebars.
- Navbars.
- Empty states.
- Toasts.
- Dashboards.

## Tokens visuales

Buscá consistencia en:

- Espaciado.
- Tipografía.
- Colores.
- Bordes.
- Radios.
- Sombras.
- Altura de botones.
- Tamaño de íconos.
- Estados hover/focus/disabled.

## Si hay shadcn/ui

- Preferí usar componentes existentes de `components/ui`.
- No dupliques componentes ya disponibles.
- Mantené variantes consistentes.
- Respetá tokens CSS existentes.

## Si no hay shadcn/ui

- No lo instales sin permiso.
- Creá patrones simples y reutilizables.
- Evitá sobrearquitectura.

## Output esperado

Al terminar, indicá:

- Qué inconsistencias encontraste.
- Qué unificaste.
- Qué patrón debería seguirse en adelante.
