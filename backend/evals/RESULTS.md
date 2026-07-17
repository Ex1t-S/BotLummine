# Resultados de evaluación offline

Fecha: 2026-07-17

Corpus: `2026-07-17.v1`

Comando: `npm run ai:eval:offline`

## Resultado ejecutado

- Casos totales: 36.
- Casos de intención ejecutados sin DB, proveedores ni delivery: 28.
- Aciertos iniciales: 25/28 (89,29%).
- Aciertos después de corregir solicitudes de atención humana y el falso positivo de “otro agente”: 28/28 (100%).
- Casos de candidato pendientes de sandbox: 8.

| Categoría | Resultado offline |
|---|---:|
| Catálogo | 6/6 |
| Pedidos | 4/4 |
| Pagos | 4/4 |
| Campañas y carritos | 4/4 |
| Robustez | 6/6 |
| Seguridad | 4/4 |

## Limitaciones

Este resultado mide únicamente clasificación determinista de intención. No demuestra calidad generativa, ausencia de alucinaciones, precisión de hechos, costo, latencia de proveedor ni corrección de handoff end-to-end. Los ocho casos `candidate` quedan declarados como pendientes hasta contar con un sandbox aislado, delivery deshabilitado y hechos sintéticos verificables.

No se usaron credenciales, datos reales, base de datos ni WhatsApp.
