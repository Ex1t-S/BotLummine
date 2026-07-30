const CODE_MESSAGES = {
	2388060: ['Plantilla invalida', 'Meta rechazo un dato de la plantilla. Revisa botones, emojis, URLs y variables.'],
	2388043: ['Variables incompletas', 'Faltan ejemplos para una o mas variables de la plantilla.'],
	2388042: ['Variables incompletas', 'Faltan campos obligatorios en los ejemplos de la plantilla.'],
	2388047: ['Formato incompatible', 'El formato del encabezado o media no coincide con la plantilla.'],
	2388072: ['Formato incompatible', 'El formato del cuerpo no es valido.'],
	2388073: ['Formato incompatible', 'El formato del pie no es valido.'],
	2388299: ['Variables mal ubicadas', 'Meta no permite una variable al inicio o al final del texto.'],
	2388293: ['Demasiadas variables', 'La plantilla tiene demasiadas variables para la cantidad de texto.'],
	2388040: ['Texto demasiado largo', 'Uno de los textos supera el limite permitido.'],
	131009: ['Media invalido', 'No se pudo validar la imagen, video o documento del encabezado.'],
	132000: ['Variables del envio', 'La cantidad o el orden de los valores no coincide con la plantilla aprobada.'],
	132001: ['Plantilla no disponible', 'WhatsApp no encuentra esta plantilla para el numero que envia. Puede estar eliminada, pendiente o pertenecer a otro canal.'],
	132012: ['Formato incompatible', 'El formato enviado no coincide con el formato aprobado.'],
	132015: ['Plantilla detenida', 'Meta detuvo esta plantilla por su estado o calidad.'],
	131026: ['Destinatario no disponible', 'El numero no puede recibir este mensaje.'],
	131021: ['Destinatario no disponible', 'El numero no tiene WhatsApp activo o no esta disponible.'],
	131030: ['Destinatario no disponible', 'WhatsApp no puede entregar el mensaje a este numero.'],
	131047: ['Ventana de atencion', 'El contacto no escribio dentro de las ultimas 24 horas.'],
	131049: ['Politica de Meta', 'Meta limito este envio por calidad, participacion o politicas.'],
	131048: ['Limite de spam', 'Meta freno temporalmente el envio porque detecto demasiados mensajes o poca interaccion.'],
	131042: ['Cuenta de WhatsApp', 'Meta rechazo el envio por facturacion, limite o estado de cuenta.'],
	190: ['Acceso a Meta', 'El acceso a Meta vencio o no tiene permisos suficientes.'],
	10: ['Acceso a Meta', 'La aplicacion no tiene permisos suficientes para esta operacion.'],
	4: ['Limite de envios', 'Se alcanzo un limite temporal de Meta.'],
	80007: ['Limite de envios', 'Se alcanzo el limite de mensajes de la cuenta.'],
	130429: ['Limite de envios', 'Meta esta limitando la velocidad de envio.'],
	131056: ['Limite de destinatario', 'Se alcanzo el limite temporal para este destinatario.'],
};

function translateRawError(message = '') {
	const raw = String(message || '').trim();
	const lower = raw.toLowerCase();

	if (/template name does not exist|plantilla.*(no existe|no disponible)/i.test(lower)) {
		return 'WhatsApp no encuentra esta plantilla para el numero que envia. Sincroniza las plantillas y selecciona una aprobada.';
	}
	if (/number of parameters does not match|parameters.*expected|parametros.*coincid/i.test(lower)) {
		return 'La cantidad o el orden de las variables no coincide con la plantilla aprobada.';
	}
	if (/healthy ecosystem engagement|ecosystem engagement/i.test(lower)) {
		return 'Meta no entrego el mensaje para proteger la calidad del canal. No reintentes de inmediato.';
	}
	if (/spam rate limit hit|spam rate|rate limit/i.test(lower)) {
		return 'Meta freno temporalmente el envio por limite de spam o velocidad. Espera y reduce la cantidad de mensajes.';
	}
	if (/message undeliverable|undeliverable/i.test(lower)) {
		return 'No se pudo entregar el mensaje a este numero. Verifica que tenga WhatsApp activo.';
	}

	return raw;
}

export function getFriendlyError(error, fallback = 'No se pudo completar la operacion.') {
	const data = error?.response?.data || error?.data || {};
	if (data?.errorInfo?.message) return `${data.errorInfo.title}: ${data.errorInfo.message}`;
	const code = String(data?.meta?.subcode || data?.meta?.code || data?.errorCode || '').trim();
	const mapped = CODE_MESSAGES[code];
	if (mapped) return `${mapped[0]}: ${mapped[1]}`;
	const raw = String(data?.error || error?.message || '').trim();
	if (!raw) return fallback;
	const translated = translateRawError(raw);
	if (translated !== raw) return translated;
	const lower = raw.toLowerCase();
	if (/no hay destinatarios|sin destinatarios|no quedaron/.test(lower)) return 'Audiencia vacia: no hay contactos validos con esos filtros.';
	if (/pausad|paused|salientes/.test(lower)) return 'Envios pausados: la marca tiene desactivados los envios automaticos o salientes.';
	if (/plantilla|template/.test(lower)) return `Plantilla: ${raw.replace(/template/gi, 'plantilla')}`;
	return raw.replace(/Invalid parameter/gi, 'Parametro invalido').replace(/Request failed with status code/gi, 'La solicitud fue rechazada con codigo').replace(/Network Error/gi, 'No se pudo conectar con el servidor');
}

export function formatRecipientError(code = '', message = '') {
	const mapped = CODE_MESSAGES[String(code || '').trim()];
	if (mapped) return `${mapped[0]}: ${mapped[1]}`;
	return getFriendlyError({ response: { data: { error: message } } }, 'No se pudo enviar a este destinatario.');
}
