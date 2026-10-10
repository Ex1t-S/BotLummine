# Conexión manual de WhatsApp Cloud API por marca

Este procedimiento es para una marca que administra **su propia App de Meta, negocio y WABA**. No usa Embedded Signup. Los identificadores de la App, la WABA y el teléfono son distintos; tener el número verificado en WhatsApp Manager no demuestra por sí solo que Cloud API pueda enviar ni que el webhook reciba eventos.

## Antes de empezar

- Confirmar que la App de Meta seleccionada pertenece al negocio que tiene acceso a la WABA real de la marca. No copiar IDs del número de prueba de Meta.
- Si el mismo número sigue en la aplicación WhatsApp Business, confirmar primero si está habilitado para coexistencia. No eliminar ni migrar el número a ciegas: puede cortar la atención actual.
- El administrador de BladeIA debe disponer del App ID y App Secret de esa App. El App Secret y los tokens nunca se mandan por chat ni se guardan en Git.

## 1. App y webhook

En BladeIA → Administración → Integraciones → **Paso 1**, guardar la App ID, App Secret y un Verify Token generado para esa App. El campo **Embedded Signup Config ID queda vacío** en este procedimiento. BladeIA mostrará una Callback URL específica de la App.

En Meta for Developers → App → WhatsApp → Configuración, pegar esa Callback URL y **el mismo Verify Token**. Verificar el webhook y suscribir el campo `messages`. No usar `https://api.bladeia.com/api/` sin la ruta completa que muestra BladeIA.

## 2. Acceso del usuario del sistema

En Meta Business Settings, seleccionar el negocio correcto. En **Cuentas → Cuentas de WhatsApp**, identificar la WABA real y su ID. En **Usuarios → Usuarios del sistema**, asignar esa WABA al usuario del sistema con permisos suficientes. Generar un token para **la misma App ID registrada en BladeIA** con `whatsapp_business_management` y `whatsapp_business_messaging`. Usar un token de usuario del sistema de vigencia apropiada, no el token temporal de “Probar API”. Guardarlo solo en el formulario seguro de BladeIA.

Si la WABA no aparece entre los activos que pueden asignarse, detenerse y verificar la propiedad/acceso del negocio, la App elegida y el rol del usuario; no crear una WABA duplicada para sortear el problema.

## 3. Número y conexión

Desde WhatsApp Manager o la configuración de la API obtener el **Phone Number ID del número real**. En BladeIA → **Paso 2**, elegir la App, pegar WABA ID, Phone Number ID y token. Pulsar **Comprobar con Meta**. Esta consulta es de solo lectura: valida que el token pertenezca a la App, tenga permisos y que el número figure dentro de la WABA. No prueba el registro Cloud API ni envía mensajes.

Corregir cualquier error antes de continuar. Al pulsar **Vincular canal y suscribir webhooks**, BladeIA solicita a Meta suscribir esa App a la WABA y solo guarda el canal activo si Meta confirma la operación. Esto es adicional a la configuración del campo `messages` en la App.

Si Meta aún pide registrar el número en Cloud API, completar ese paso en la configuración oficial. El registro usa un PIN de seis dígitos y puede afectar un número que todavía se use en WhatsApp Business; no ejecutarlo sin verificar la ruta de migración/coexistencia.

## 4. Prueba final

1. Desde un teléfono autorizado, enviar un mensaje al número de la marca.
2. Confirmar que aparece en la bandeja del workspace correcto de BladeIA.
3. Responder desde BladeIA dentro de la ventana de conversación abierta y confirmar recepción.
4. Comprobar en logs que no hay errores de firma, enrutamiento por Phone Number ID ni respuestas duplicadas.
5. Solo después habilitar automatizaciones y campañas de esa marca.

## Diagnóstico rápido

| Síntoma | Revisar |
| --- | --- |
| Token de otra App | Generar uno para la misma Meta App ID guardada en BladeIA. |
| Falta `whatsapp_business_management` | Permisos del token y asignación de la WABA al usuario del sistema. |
| Phone Number ID no figura en la WABA | ID real, negocio elegido y cuenta de WhatsApp propietaria. |
| Envía pero no recibe | Callback URL, Verify Token, campo `messages`, suscripción de la App a la WABA y firma del webhook. |
| Número verificado pero no envía | Estado de registro Cloud API, token, límites/calidad y permisos del negocio. |

Referencias oficiales: [colección Cloud API de Meta](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api), [suscripción de App a WABA](https://www.postman.com/meta/whatsapp-business-platform/request/bw8g53p/subscribe-to-your-waba), [registro de número](https://www.postman.com/meta/whatsapp-business-platform/request/zb2u18b/register-phone), [programa Tech Provider y Embedded Signup](https://whatsappbusiness.com/partners/become-a-partner/).
