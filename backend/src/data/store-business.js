import { normalizeText } from '../lib/text.js';

export const STORE_LINKS = {
	home: process.env.STORE_HOME_URL || '',
	catalog: process.env.STORE_CATALOG_URL || '',
	contacto: process.env.STORE_CONTACT_URL || '',
	politicaEnvio: process.env.STORE_SHIPPING_POLICY_URL || '',
	politicaDevolucion: process.env.STORE_RETURNS_POLICY_URL || ''
};

export const PAYMENT_RULES = {
	general: [
		'No mencionar promociones ni transferencia en todos los mensajes.',
		'Solo hablar de pagos si el cliente pregunta por pagos, precios, promociones o está cerca de comprar.',
		'Si la persona ya definió producto o está lista para avanzar, responder directo y orientar el siguiente paso.',
		'No volver a recomendar el producto cuando la conversación ya está en etapa de pago.',
		'No pedir de nuevo datos que ya estén claros en la conversación.'
	],
	publicInfo: [
		'Usa solo promociones, cuotas o descuentos configurados para este workspace.',
		'No inventes beneficios comerciales si no están presentes en el contexto.'
	],
	transfer: {
		enabled: true,
		alias: process.env.TRANSFER_ALIAS || 'TU_ALIAS_REAL',
		cbu: process.env.TRANSFER_CBU || 'TU_CBU_REAL',
		holder: process.env.TRANSFER_HOLDER || 'TITULAR_REAL',
		bank: process.env.TRANSFER_BANK || 'BANCO_REAL',
		extraInstructions:
			process.env.TRANSFER_EXTRA ||
			'Una vez realizada la transferencia, enviar comprobante por este medio para validarlo.'
	}
};

export const POLICY_SUMMARY = {
	shipping: [
		'Usa solo la política de envíos cargada para este workspace.',
		'Si falta ubicación o método de envío, pedir el dato sin cortar el hilo comercial.'
	],
	returns: [
		'Usa solo la política de cambios y devoluciones cargada para este workspace.',
		'Si falta información para resolver el caso, pedir el dato puntual y ofrecer revisión humana.'
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
	if (/(producto|productos|catalogo|catálogo|promo|combo|oferta)/.test(q)) return 'product';
	return 'general';
}

export function buildRelevantBusinessData(userText = '') {
	return {
		intent: detectBusinessIntent(userText),
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
