import { normalizeText } from '../lib/text.js';

export const STORE_LINKS = {
	home: 'https://lummine.com/',
	indumentaria: 'https://lummine.com/indumentaria/',
	packs: 'https://lummine.com/packs/',
	contacto: 'https://lummine.com/contacto/',
	politicaEnvio: 'https://lummine.com/politica-de-envio/',
	politicaDevolucion: 'https://lummine.com/politica-de-devolucion/'
};

export const PAYMENT_TRANSFER_DETAILS = {
	enabled: true,
	alias: 'setal.pisada.lemon',
	cbu: '0000168300000011153157',
	holder: 'Lucas Fernando Bonafini',
	cuil: '20-37791981-6',
	bank: 'Lemon',
	extraInstructions: 'No te olvides de enviarnos el comprobante a nuestro WhatsApp Empresa: +54 2216051100.'
};

export const PAYMENT_RULES = {
	general: [
		'No mencionar promociones ni transferencia en todos los mensajes.',
		'Solo hablar de pagos si el cliente pregunta por pagos, precios, promociones o está cerca de comprar.',
		'Si la clienta ya definió producto o está lista para avanzar, responder directo y orientar el siguiente paso.',
		'No volver a recomendar el producto cuando la conversación ya está en etapa de pago.',
		'No pedir de nuevo datos que ya estén claros en la conversación.'
	],
	publicInfo: [
		'En la tienda se comunica 15% OFF por transferencia.',
		'En productos visibles se muestran cuotas sin interés.',
		'No forzar la promo en respuestas donde no suma.'
	],
	transfer: PAYMENT_TRANSFER_DETAILS
};

export const POLICY_SUMMARY = {
	shipping: [
		'Se realizan envíos a todo el país.',
		'La referencia general es Correo Argentino.',
		'El tiempo estimado informado es de hasta 8 días hábiles desde la confirmación del pago.',
		'Si la clienta pregunta por envío dentro de una compra, responder como continuidad natural del cierre.'
	],
	returns: [
		'No se aceptan devoluciones por higiene salvo error de empaquetado, defecto o daño comprobado.',
		'Los inconvenientes deben reportarse dentro de las 48 horas posteriores a la recepción.',
		'Si hay error de envío o daño, corresponde revisión y resolución.'
	]
};

export function detectBusinessIntent(text = '') {
	const q = normalizeText(text);

	if (
		/(estado de mi pedido|estado del pedido|seguimiento|codigo de seguimiento|código de seguimiento|despachado|demora|donde esta mi pedido|donde esta mi compra|no me llego|no me llegó)/.test(
			q
		)
	) return 'order_status';

	if (/(transferencia|alias|cbu|banco|comprobante|pago)/.test(q)) return 'payment';
	if (/(envio|enviar|correo|llega|demora)/.test(q)) return 'shipping';
	if (/(cambio|devolucion|devolución|reclamo|defecto|dañado|danado)/.test(q)) return 'returns';
	if (/(talle|medida|medidas|m\/l|xl\/xxl|xl|xxl)/.test(q)) return 'size_help';
	if (/(stock|disponible|queda|color|colores|negro|blanco|beige)/.test(q)) return 'stock_check';
	if (/(body|bodies|faja|short|corpi|bombacha|musculosa|calza|conjunto|morley)/.test(q)) return 'product';
	return 'general';
}

export function buildRelevantBusinessData(userText = '') {
	const intent = detectBusinessIntent(userText);

	return {
		intent,
		links: STORE_LINKS,
		products: [],
		paymentRules: PAYMENT_RULES,
		policySummary: POLICY_SUMMARY,
		catalogRules: {
			sourceOfTruth: 'catalog_db_sync',
			preferWhatsAppResolution: true
		}
	};
}
