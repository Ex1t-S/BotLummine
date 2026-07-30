function text(value) {
	return String(value ?? '').trim();
}

function firstValue(...values) {
	return values.find((value) => text(value)) || '';
}

const CATALOG = [
	{
		codes: ['2388060'],
		category: 'Plantilla invalida',
		title: 'Hay un dato de la plantilla que Meta no acepta',
		message: 'Revisa el texto de los botones, los emojis especiales, las URLs y el formato de las variables. Guarda la plantilla nuevamente sin caracteres no admitidos en botones de llamada.',
		action: 'Corregir la plantilla y volver a guardar.',
	},
	{
		codes: ['2388043', '2388042'],
		category: 'Variables incompletas',
		title: 'Faltan ejemplos para las variables',
		message: 'Cada variable del encabezado, cuerpo o boton debe tener un ejemplo del mismo tipo.',
		action: 'Completa los ejemplos o elimina las variables que no uses.',
	},
	{
		codes: ['2388047', '2388072', '2388073', '132012'],
		category: 'Formato incompatible',
		title: 'El formato de un componente no coincide',
		message: 'El encabezado, cuerpo, pie o media no tiene el formato que espera la plantilla.',
		action: 'Revisa el tipo de encabezado, el media cargado y las variables.',
	},
	{
		codes: ['2388299', '2388293'],
		category: 'Variables mal ubicadas',
		title: 'La posicion de una variable no es valida',
		message: 'Meta no permite variables al inicio o al final del texto, ni demasiadas variables para la cantidad de palabras.',
		action: 'Agrega texto alrededor de la variable o reduce la cantidad de variables.',
	},
	{
		codes: ['2388040'],
		category: 'Texto demasiado largo',
		title: 'Un texto supera el limite permitido',
		message: 'El encabezado, cuerpo, pie o boton es demasiado largo para una plantilla de WhatsApp.',
		action: 'Acorta el texto y vuelve a intentar.',
	},
	{
		codes: ['131009'],
		category: 'Media invalido',
		title: 'El archivo del encabezado no es valido',
		message: 'Meta no pudo validar la imagen, video o documento cargado.',
		action: 'Vuelve a cargar un archivo compatible y guarda la plantilla.',
	},
	{
		codes: ['132000'],
		category: 'Variables del envio',
		title: 'La cantidad de variables no coincide',
		message: 'El envio tiene una cantidad de valores distinta a la definida en la plantilla aprobada.',
		action: 'Completa todos los valores y respeta el orden de las variables.',
	},
	{
		codes: ['132001'],
		category: 'Plantilla no disponible',
		title: 'La plantilla no esta disponible para este numero',
		message: 'La plantilla no existe, fue eliminada o todavia no esta sincronizada con Meta.',
		action: 'Sincroniza las plantillas y selecciona una plantilla aprobada.',
	},
	{
		codes: ['132015', '132016'],
		category: 'Plantilla detenida',
		title: 'Meta detuvo esta plantilla',
		message: 'La plantilla fue pausada o deshabilitada por su calidad o estado de aprobacion.',
		action: 'Revisa el estado en Meta y usa otra plantilla aprobada.',
	},
	{
		codes: ['131047'],
		category: 'Ventana de conversacion',
		title: 'Paso la ventana de atencion',
		message: 'Este contacto no escribio dentro de las ultimas 24 horas.',
		action: 'Usa una plantilla aprobada y verifica que tenga consentimiento de marketing.',
	},
	{
		codes: ['131049'],
		category: 'Politica de Meta',
		title: 'Meta no permite este envio ahora',
		message: 'El envio fue limitado por calidad, participacion o politicas de Meta.',
		action: 'No reintentes de inmediato. Revisa la calidad de la plantilla y el consentimiento.',
	},
	{
		codes: ['131026', '131021'],
		category: 'Destinatario no disponible',
		title: 'No se pudo entregar al destinatario',
		message: 'El numero no tiene WhatsApp activo, no esta disponible o no puede recibir este mensaje.',
		action: 'Verifica el numero y excluye contactos que sigan fallando.',
	},
	{
		codes: ['131042'],
		category: 'Cuenta de WhatsApp',
		title: 'Hay un problema de facturacion o limite en Meta',
		message: 'Meta rechazo el envio por el estado de la cuenta, el medio de pago o el limite de mensajeria.',
		action: 'Revisa la facturacion, los limites y la calidad de la cuenta en Meta.',
	},
	{
		codes: ['190', '10'],
		category: 'Acceso a Meta',
		title: 'La conexion con Meta no tiene permisos',
		message: 'El token vencio o no tiene permisos suficientes para esta operacion.',
		action: 'Renueva el token y verifica los permisos de WhatsApp Business.',
	},
	{
		codes: ['4', '80007', '130429', '131056'],
		category: 'Limite de envios',
		title: 'Se alcanzo el limite temporal de envios',
		message: 'Meta esta limitando la velocidad de envio para esta cuenta o destinatario.',
		action: 'Espera unos minutos y reduce el ritmo o el tamano de la campana.',
	},
];

function findByCode(code, subcode) {
	return CATALOG.find((item) => item.codes.includes(text(subcode)) || item.codes.includes(text(code)));
}

export function classifyWhatsAppError(error = {}, context = 'general') {
	const responseData = error?.response?.data || {};
	const meta = error?.meta || responseData.meta || {};
	const code = firstValue(error.metaCode, error.errorCode, meta.code, responseData.code, error.code);
	const subcode = firstValue(error.metaSubcode, error.errorSubcode, meta.subcode, responseData.error_subcode);
	const rawMessage = firstValue(error.message, responseData.error, responseData.message);
	const normalized = rawMessage.toLowerCase();

	let found = findByCode(code, subcode);

	if (!found && /plantilla|template/.test(normalized)) {
		found = {
			category: 'Plantilla',
			title: context === 'edit' ? 'No se pudo actualizar la plantilla' : 'No se pudo crear la plantilla',
			message: 'La configuracion de la plantilla no es valida para WhatsApp.',
			action: 'Revisa el nombre, idioma, categoria, variables, botones y media.',
		};
	}

	if (!found && /destinatario|recipient|phone|numero|number/.test(normalized)) {
		found = {
			category: 'Destinatario',
			title: 'Hay un problema con el numero destinatario',
			message: 'El numero esta vacio, no tiene formato internacional o no puede recibir mensajes.',
			action: 'Verifica el numero con codigo de pais.',
		};
	}

	if (!found && /pausad|paused|feature flag|salientes/.test(normalized)) {
		found = {
			category: 'Envios pausados',
			title: 'Los envios estan pausados',
			message: 'La marca tiene desactivados los envios automaticos o salientes.',
			action: 'Activa los envios desde Configuracion cuando sea seguro continuar.',
		};
	}

	if (!found && /no hay destinatarios|no quedaron|no pending|sin destinatarios/.test(normalized)) {
		found = {
			category: 'Audiencia vacia',
			title: 'No hay destinatarios para enviar',
			message: 'La audiencia no tiene contactos validos que cumplan los filtros de la campana.',
			action: 'Revisa los filtros, el consentimiento y el estado de los contactos.',
		};
	}

	if (!found) {
		found = {
			category: context === 'template' || context === 'edit' ? 'Plantilla' : 'Despacho',
			title: context === 'edit' ? 'No se pudo actualizar la plantilla' : context === 'template' ? 'No se pudo crear la plantilla' : 'No se pudo completar el envio',
			message: 'Ocurrio un problema al procesar la solicitud.',
			action: 'Revisa la configuracion y vuelve a intentar. Si persiste, contacta soporte.',
		};
	}

	return {
		...found,
		code: code || null,
		subcode: subcode || null,
		technicalMessage: rawMessage || null,
	};
}

