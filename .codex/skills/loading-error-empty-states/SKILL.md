---
name: loading-error-empty-states
description: Use this skill when improving data-driven UI states: loading, error, empty states, skeletons, disabled buttons, form submission states, optimistic UI, and user feedback.
---

# Loading Error Empty States

Actúa como especialista en estados de interfaz para aplicaciones Next.js y React.

## Objetivo

Evitar pantallas blancas, interfaces congeladas o errores confusos cuando una pantalla carga datos, falla o no tiene contenido.

## Reglas principales

- Toda pantalla basada en datos debería tener loading state.
- Toda consulta o acción que pueda fallar debería tener error state.
- Toda lista vacía debería tener empty state.
- Los formularios deben mostrar estado de envío.
- Los botones deben deshabilitarse durante acciones críticas.
- Los mensajes deben ser claros y humanos.
- No inventes datos falsos.
- No ocultes errores reales.
- No cambies lógica de negocio salvo que sea necesario.

## Loading states

Podés usar:

- Skeletons si el proyecto ya los tiene.
- Spinners simples.
- Texto de carga claro.
- Cards placeholder.
- Botones con texto tipo `Guardando...`, `Enviando...`, `Cargando...`.

## Error states

Los errores deben:

- Explicar qué pasó en lenguaje simple.
- Ofrecer una acción si corresponde.
- No mostrar errores técnicos crudos al usuario final.
- Mantener detalles técnicos en consola si ya existe ese patrón.

Ejemplos:

- Malo: `Request failed 500`
- Bueno: `No pudimos cargar la información. Intentá nuevamente.`

## Empty states

Un empty state debe incluir:

- Título claro.
- Explicación breve.
- Acción recomendada si corresponde.

Ejemplo:

Todavía no hay campañas
Cuando crees tu primera campaña, la vas a ver acá.
[Crear campaña]

## Formularios

Revisá:

- Estado `isSubmitting`.
- Botón deshabilitado mientras se envía.
- Feedback de éxito.
- Feedback de error.
- Validaciones visibles.
- Evitar doble submit.

## Output esperado

Al terminar, indicá:

- Qué estados agregaste.
- Qué casos cubren.
- Qué flujo debería probar el usuario.
