# BladeIA / BotLummine — prueba local segura

## Inicio rápido

Desde PowerShell, en la raíz del repositorio:

```powershell
.\start-demo.ps1
```

Se abre `http://127.0.0.1:5173/operations` con una sesión autenticada de prueba.

## Garantías del modo demo

- Usa exclusivamente datos sintéticos en memoria.
- No requiere backend, Prisma ni base de datos.
- No consulta ni modifica Railway.
- No usa credenciales productivas.
- Enviar mensajes sólo agrega el texto al historial local.
- Lanzar campañas sólo cambia el estado del fixture local a `RUNNING`.
- No realiza delivery de WhatsApp, campañas o archivos.
- La cabecera muestra `DEMO LOCAL · sin envíos externos` durante toda la sesión.

Los cambios duran mientras el servidor está encendido. El botón **Restaurar datos** recupera el estado inicial; reiniciar el servidor hace lo mismo.

## Datos disponibles

- Operación con prioridades y automatizaciones configuradas.
- Inbox AUTO, HUMAN y PAYMENT_REVIEW con cuatro conversaciones.
- Historial de mensajes y una revisión de comprobante explícitamente sintética.
- Cinco carritos en estados nuevo, contactado, recuperado y descartado.
- Tres plantillas: dos aprobadas y una pendiente.
- Tres campañas: una activa, una finalizada y un borrador.
- Clientes, catálogo y estadísticas con fixtures coherentes.
- AI Lab con una respuesta determinista local que no llama a Gemini ni a otro proveedor.

Todos los nombres, teléfonos, emails, URLs y documentos usan rangos de prueba (`example.test` y numeración `0000`).

## Recorrido sugerido para la revisión

1. **Operación:** verificar jerarquía, prioridades y accesos rápidos.
2. **Inbox / Automático:** abrir Martina Demo, escribir y enviar una respuesta local.
3. **Inbox / Humano:** revisar la conversación derivada y cambiar la cola.
4. **Inbox / Comprobantes:** revisar el documento sintético y registrar una acción.
5. **Carritos:** probar filtros, tabla desktop y cards mobile.
6. **Campañas / Plantillas:** buscar y seleccionar una plantilla aprobada.
7. **Campañas / Audiencia:** recorrer la selección de clientes y carritos.
8. **Campañas / Tracking:** revisar campaña activa y campaña finalizada.
9. **Clientes, Catálogo y Estadísticas:** validar legibilidad y navegación.
10. **AI Lab:** enviar una consulta y confirmar que la respuesta identifica el modo sintético.
11. Pulsar **Restaurar datos** y confirmar que el estado vuelve al inicial.

## Smoke automático del modo demo

```powershell
cd frontend
npx playwright test --config demo/playwright.demo.config.js
```

Esta prueba levanta su propio servidor demo en el puerto `5174`, recorre las vistas principales y verifica que mensajes y campañas informen `deliveredExternally: false`.

Para regenerar las capturas desktop y móvil con el demo encendido:

```powershell
cd frontend
node demo/capture-local-demo.mjs
```

## Detener el entorno

En la terminal donde está ejecutándose, presionar `Ctrl+C`.

## Alcance y limitación

Este modo valida UI, navegación y mutaciones locales. No demuestra conectividad real con Meta, proveedores de IA, base de datos ni Railway. Es deliberado: esas integraciones quedan fuera de la sesión demo para eliminar el riesgo de acciones externas.
