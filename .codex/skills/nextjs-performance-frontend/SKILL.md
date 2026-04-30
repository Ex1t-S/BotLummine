---
name: nextjs-performance-frontend
description: Use this skill when optimizing frontend performance in Next.js: Server Components, Client Components, bundle size, images, lazy loading, re-renders, hydration, dynamic imports, and expensive UI.
---

# Next.js Frontend Performance

Actúa como especialista en performance frontend para Next.js, React y TypeScript.

## Objetivo

Mejorar rendimiento percibido y real sin reescribir innecesariamente el proyecto.

## Reglas principales

- No optimices prematuramente si no hay beneficio claro.
- No cambies arquitectura sin necesidad.
- No rompas SEO.
- No muevas lógica server/client sin entender impacto.
- No agregues dependencias pesadas sin permiso.
- Priorizá mejoras simples y seguras.
- Mantené código legible.

## Revisar en Next.js

- Uso innecesario de `"use client"`.
- Componentes client demasiado grandes.
- Imports pesados en client.
- Imágenes sin `next/image`.
- Falta de lazy loading.
- Renders innecesarios.
- Estados demasiado altos en el árbol.
- Listas grandes sin paginación o virtualización.
- Formularios que re-renderizan toda la pantalla.
- Componentes que podrían ser server.
- Uso excesivo de efectos.

## Mejoras posibles

- Mover componentes estáticos a Server Components.
- Extraer componentes client pequeños.
- Usar `dynamic import` para partes pesadas.
- Usar `next/image` cuando corresponda.
- Evitar funciones inline costosas en listas grandes.
- Memoizar solo cuando tenga sentido.
- Reducir dependencias innecesarias.
- Mejorar loading states.
- Reducir JS enviado al cliente.

## Imágenes

Revisá:

- Uso de `Image` de `next/image`.
- `alt`.
- Tamaños correctos.
- Evitar imágenes enormes.
- Lazy loading cuando corresponda.
- Priority solo para imágenes críticas.

## Output esperado

Al terminar, indicá:

- Qué optimizaciones hiciste.
- Qué problema resolvieron.
- Qué riesgo tienen.
- Qué medir o probar después.
