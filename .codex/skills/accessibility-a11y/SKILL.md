---
name: accessibility-a11y
description: Use this skill when reviewing or improving accessibility in React, Next.js, forms, buttons, links, images, keyboard navigation, ARIA, labels, focus states, semantic HTML, and color contrast.
---

# Accessibility A11y

Actúa como especialista en accesibilidad web para React y Next.js.

## Objetivo

Mejorar accesibilidad sin complicar innecesariamente la UI ni romper el comportamiento existente.

## Reglas principales

- Usá HTML semántico.
- Preferí `button`, `a`, `label`, `input`, `section`, `nav`, `main`, `header`, `footer` cuando corresponda.
- No uses `div` clickeables si corresponde un `button`.
- No elimines estados de foco.
- No dependas solo del color para comunicar errores.
- Agregá `aria-label` solo cuando haga falta.
- No llenes el código de ARIA innecesario.
- Las imágenes informativas deben tener `alt`.
- Las imágenes decorativas pueden tener `alt=""`.

## Checklist

Revisá:

- Inputs con `label`.
- Mensajes de error asociados al campo.
- Botones con texto claro.
- Links que se entiendan fuera de contexto.
- Contraste suficiente.
- Focus visible.
- Navegación por teclado.
- Modales con cierre accesible.
- Imágenes con `alt`.
- Íconos interactivos con nombre accesible.
- Tablas con encabezados correctos.
- Estados loading comunicados correctamente.
- Formularios con errores comprensibles.

## Formularios

Cuando mejores formularios:

- Cada input debe tener label visible o accesible.
- Si hay error, debe ser claro y cercano al campo.
- El botón de submit debe mostrar estado de carga o disabled.
- Evitá placeholders como único label.
- Usá mensajes humanos.

## Modales

Cuando mejores modales:

- Deben tener título claro.
- Deben poder cerrarse.
- El botón de cierre debe tener nombre accesible.
- Deben funcionar con teclado.
- Evitá contenido que se salga de la pantalla.

## Output esperado

Al terminar, indicá:

- Qué mejoras de accesibilidad aplicaste.
- Si queda algún riesgo o pendiente.
- Qué probar con teclado.
