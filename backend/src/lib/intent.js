export function normalizeDigits(value = '') {
	return String(value || '').replace(/\D/g, '');
}

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

function hasExplicitOrderContext(text = '') {
	const q = normalizeText(text);

	return /(pedido|orden|seguimiento|estado del pedido|estado de mi pedido|mi pedido|mi compra|tracking|codigo de seguimiento|código de seguimiento)/.test(
		q
	);
}

export function extractStandaloneOrderNumber(text = '') {
	const q = normalizeText(text);
	const match = q.match(/^#?\s*(\d{4,10})$/);
	return match?.[1] || null;
}

export function extractOrderNumber(text = '', currentState = {}) {
	const raw = String(text || '');
	const q = normalizeText(raw);

	const standalone = extractStandaloneOrderNumber(q);
	if (standalone) return standalone;

	const followUpMatch = q.match(
		/^(?:y\s+)?(?:el\s+|del\s+|pedido\s+|orden\s+)?#?\s*(\d{4,10})\??$/
	);
	if (followUpMatch?.[1]) return followUpMatch[1];

	const hashMatch = q.match(/#\s*(\d{4,10})\b/);
	if (hashMatch?.[1]) return hashMatch[1];

	const contextualMatch = q.match(
		/(?:pedido|orden|tracking|seguimiento|mi pedido es|mi orden es|mi compra es|el pedido|del pedido)\s*#?\s*(\d{4,10})\b/
	);
	if (contextualMatch?.[1]) return contextualMatch[1];

	const plainNumberMatch = q.match(/\b(\d{4,10})\b/);
	if (
		plainNumberMatch?.[1] &&
		(hasExplicitOrderContext(q) || currentState?.lastIntent === 'order_status')
	) {
		return plainNumberMatch[1];
	}

	return null;
}

function hasProductContext(currentState = {}) {
	const interestedProducts =
		Array.isArray(currentState?.interestedProducts) && currentState.interestedProducts.length > 0;

	return (
		interestedProducts ||
		['product', 'stock_check', 'size_help', 'payment', 'shipping'].includes(
			currentState?.lastIntent
		) ||
		['comprar', 'evaluar_producto', 'elegir_talle', 'resolver_pago', 'resolver_envio'].includes(
			currentState?.lastUserGoal
		) ||
		Boolean(currentState?.paymentPreference) ||
		Boolean(currentState?.deliveryPreference) ||
		Boolean(currentState?.frequentSize)
	);
}

function isShortFollowUp(q = '') {
	if (!q) return false;

	const compact = q.replace(/\s+/g, ' ').trim();
	const words = compact.split(' ').filter(Boolean);

	return compact.length <= 45 || words.length <= 7;
}

function hasTrackingKeywords(q = '') {
	return /(seguimiento|estado de mi pedido|estado del pedido|quiero seguir mi pedido|donde esta mi pedido|donde esta mi compra|no llego mi pedido|no me llego|no me llegó|despachado|tracking|codigo de seguimiento|código de seguimiento)/.test(
		q
	);
}

function hasPurchaseKeywords(q = '') {
	return /(quiero comprar|quiero ese|quiero uno|me interesa|pasame el link|como compro|te lo compro|te compro|armar el pedido|armo el pedido|podemos hacer el pedido|puedo hacer el pedido|puedo armar el pedido|por aca puedo comprar|por whatsapp puedo comprar|cerrar la compra|avanzar con la compra|encargar|reservarmelo|reservamelo)/.test(
		q
	);
}

function hasPaymentKeywords(q = '') {
	return /(transferencia|transferir|alias|cbu|banco|comprobante|pago|cuotas|tarjeta|mercado pago|mercadopago)/.test(
		q
	);
}

function hasShippingKeywords(q = '') {
	return /(envio|enviar|correo|oca|andreani|interior|provincia|retiro|retirar|llega a|hacen envios|domicilio|sucursal)/.test(
		q
	);
}

function hasSizeKeywords(q = '') {
	return /(talle|talles|medida|medidas|tabla de talles|que talle|soy m|soy s|soy l|soy xl|soy xxl|uso m|uso s|uso l|uso xl|uso xxl|110 de corpiño|110 de corpino|xl\/xxl|m\/l)/.test(
		q
	);
}

function hasStockKeywords(q = '') {
	return /(stock|disponible|queda|color|colores|tenes en|hay en negro|hay en blanco|hay en beige|negro|blanco|beige|avellana)/.test(
		q
	);
}

function hasProductKeywords(q = '') {
	return /(body|bodies|faja|short|corpi|bombacha|musculosa|calza|conjunto|morley|legging|leggings|pack|combo|corset|modelador)/.test(
		q
	);
}

function shouldContinueOrderFlow(q = '', currentState = {}) {
	const explicitOrderNumber = extractOrderNumber(q, currentState) || extractStandaloneOrderNumber(q);
	const compact = q.replace(/\s+/g, ' ').trim();

	if (!explicitOrderNumber) return false;

	if (
		compact === `#${explicitOrderNumber}` ||
		compact === explicitOrderNumber ||
		compact === `y el ${explicitOrderNumber}?` ||
		compact === `el ${explicitOrderNumber}` ||
		compact === `y ${explicitOrderNumber}`
	) {
		return true;
	}

	if (hasExplicitOrderContext(q)) return true;

	if (
		currentState?.lastIntent === 'order_status' ||
		Boolean(currentState?.lastOrderNumber) ||
		Boolean(currentState?.lastOrderId)
	) {
		return true;
	}

	return false;
}

function isTrackingIntent(q, currentState = {}) {
	const orderNumber = extractOrderNumber(q, currentState) || extractStandaloneOrderNumber(q);

	if (shouldContinueOrderFlow(q, currentState)) {
		return true;
	}

	if (
		currentState?.lastIntent === 'order_status' &&
		/(seguimiento|estado|donde esta|mi compra|mi pedido|no llego|despachado|correo|tracking)/.test(
			q
		)
	) {
		return true;
	}

	return Boolean(orderNumber && hasExplicitOrderContext(q)) || hasTrackingKeywords(q);
}

function shouldPreservePurchaseContext(q, currentState = {}) {
	const productContext = hasProductContext(currentState);
	if (!productContext) return false;

	const shortFollowUp = isShortFollowUp(q);

	if (
		shortFollowUp &&
		(hasSizeKeywords(q) ||
			hasStockKeywords(q) ||
			hasPaymentKeywords(q) ||
			hasShippingKeywords(q) ||
			/(link|pasamelo|pasame|dale|perfecto|genial|buenisimo|buenísimo|y ese|y eso|lo quiero|me sirve|me gusto|me gustó)/.test(
				q
			))
	) {
		return true;
	}

	if (
		shortFollowUp &&
		/(pedido|armo el pedido|armo pedido|hacemos el pedido|hacer el pedido|cerramos|cierro|avanzo|avanzamos)/.test(
			q
		) &&
		!hasTrackingKeywords(q) &&
		!hasExplicitOrderContext(q)
	) {
		return true;
	}

	return false;
}

export function detectIntent(text = '', currentState = {}) {
	const q = normalizeText(text);
	const orderNumber = extractOrderNumber(text, currentState) || extractStandaloneOrderNumber(text);
	const productContext = hasProductContext(currentState);
	const purchaseFlow = hasPurchaseKeywords(q);
	const trackingIntent = isTrackingIntent(q, currentState);
	const preservePurchaseContext = shouldPreservePurchaseContext(q, currentState);

	if (
		/(quiero hablar con una persona|quiero hablar con alguien|humano|asesor|asesora|persona real|operador|agente|alguien del equipo|no quiero bot|no quiero hablar con bot|no me atiendas con bot)/.test(
			q
		)
	) {
		return 'human_handoff';
	}

	if (
		/(reclamo|queja|me llego mal|vino fallado|vino roto|no me gusto|estoy disconforme|muy mala atencion)/.test(
			q
		)
	) {
		return 'complaint';
	}

	if (
		/(cambio|devolucion|devolver|quiero cambiar|quiero devolver|me quedo chico|me quedo grande)/.test(
			q
		)
	) {
		return 'return_exchange';
	}

	if (preservePurchaseContext) {
		if (hasPaymentKeywords(q)) return 'payment';
		if (hasShippingKeywords(q)) return 'shipping';
		if (hasSizeKeywords(q)) return 'size_help';
		if (hasStockKeywords(q)) return 'stock_check';
		return 'product';
	}

	if (trackingIntent || (orderNumber && hasExplicitOrderContext(q)) || orderNumber) {
		return 'order_status';
	}

	if (hasPaymentKeywords(q)) return 'payment';
	if (hasShippingKeywords(q)) return 'shipping';
	if (hasSizeKeywords(q)) return 'size_help';
	if (hasStockKeywords(q)) return 'stock_check';
	if (hasProductKeywords(q)) return 'product';

	if (purchaseFlow) {
		return productContext ? 'product' : 'general';
	}

	return 'general';
}
