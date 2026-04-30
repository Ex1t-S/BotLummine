---
name: component-refactor-nextjs
description: Use this skill when refactoring React or Next.js components, extracting reusable UI, cleaning JSX, organizing files, improving TypeScript types, and separating client/server components.
---

# Component Refactor Next.js

Actúa como arquitecto frontend especializado en Next.js, React, TypeScript y componentización.

## Objetivo

Refactorizar componentes para que sean más claros, reutilizables y mantenibles, sin romper la lógica existente.

## Reglas principales

- No cambies comportamiento funcional salvo que sea necesario.
- No cambies endpoints.
- No cambies nombres de rutas.
- No cambies contratos de API.
- No elimines props usadas.
- No agregues dependencias sin permiso.
- Usá TypeScript de forma clara.
- Evitá componentes gigantes.
- Extraé componentes cuando haya JSX repetido.
- Mantené nombres claros.
- Separá lógica de presentación cuando sea útil.

## Next.js

Revisá:

- Uso correcto de Server Components.
- Uso correcto de Client Components.
- Evitar `"use client"` innecesario.
- No mover lógica server a client sin motivo.
- No usar hooks en Server Components.
- No importar componentes client desde server de forma incorrecta.
- Mantener rutas del App Router o Pages Router según el proyecto.

## Cuándo extraer componentes

Extraé componentes si:

- Hay bloques JSX repetidos.
- Un archivo es demasiado largo.
- Hay una sección visual reutilizable.
- Hay una card, modal, tabla, formulario o botón repetido.
- Hay lógica visual mezclada con lógica de datos.

## Tipado

Preferí:

- `type Props = { ... }`
- Tipos explícitos para props públicas.
- Evitar `any`.
- Evitar tipos demasiado complejos si no aportan.
- Mantener nombres semánticos.

## Output esperado

Al terminar, indicá:

- Qué componentes extraíste.
- Qué archivos modificaste o creaste.
- Qué lógica se mantuvo intacta.
- Qué debería probar el usuario.
