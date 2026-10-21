# Inbox: versión local para revisión

Preview: http://127.0.0.1:5181/inbox/automatico

Servidor demo aislado, datos sintéticos en memoria; mensajes sin entrega externa. El inicio público continúa en el puerto 5180.

## Implementado

- Bandejas visibles en una cuadrícula, incluyendo Todos; filtros de lectura separados.
- Paleta azul/celeste, fondo suave y compositor de ancho completo con ayuda para teclado.
- Acción principal visible para pasar a humano o automático; contexto lateral opcional.
- Bienvenida que explica cada bandeja; panel de tareas para comprobantes.
- Menús históricos expandibles en modo consulta, sin enviar respuestas.
- Adjuntos por conversación; al terminar un envío se limpia sólo el borrador/archivo enviado, conservando cambios más recientes.
- Grabación detenida y descartada al desmontar/cambiar conversación; preview de audio e imágenes antes del envío.
- Comandos IA sin implementación retirados; escribir / ya no abre herramientas sin efecto.
- Búsqueda con demora de 280 ms y cancelación de peticiones anteriores.
- Aviso para ir al final cuando llegan mensajes mientras se lee arriba.
- Error visible al cargar historial anterior y confirmación antes de reiniciar contexto.

## Validación realizada

Build de producción correcto. Cuatro pruebas unitarias sobre separación de borradores/archivos y menús históricos pasan. API demo probada: autentica un workspace sintético, lista conversaciones y devuelve deliveredExternally=false al enviar texto. Datos restaurados tras la prueba.

## Pendiente de validar en navegador

El navegador embebido bloqueó el acceso en esta sesión. No se verificó visualmente escritorio/móvil ni micrófono. Probar selección de chats, archivo A → chat B, grabación/cambio de chat, contexto, menú de acciones, comprobantes y pantalla de 390 px. Los borradores se mantienen durante la estancia en la bandeja, no después de recargar. No se modificó backend, main ni producción.

Para reiniciar esta demo:

```powershell
cd frontend
node node_modules/vite/bin/vite.js --config demo/inbox-preview.config.mjs --mode demo --host 127.0.0.1 --port 5181 --strictPort
```
