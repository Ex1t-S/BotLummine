function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export const SALES_STAGES = {
	DISCOVERY: 'discovery',
	INTEREST: 'interest',
	COMPARISON: 'comparison',
	PURCHASE_INTENT: 'purchase_intent',
	POST_SALE: 'post_sale'
};

export function detectSalesStage(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);

	if (currentState?.lastIntent === 'order_status') return SALES_STAGES.POST_SALE;
	if (/(precio|sale|cuanto|cu[aá]nto)/i.test(text)) return SALES_STAGES.INTEREST;
	if (/(talle|medida|modelo|diferencia|comparar)/i.test(text)) return SALES_STAGES.COMPARISON;
	if (/(comprar|quiero|me lo llevo|pasame link|link|carrito|pago)/i.test(text)) return SALES_STAGES.PURCHASE_INTENT;
	return SALES_STAGES.DISCOVERY;
}

export function isClosingSignal(messageBody = '') {
	return /(pasame link|quiero comprar|como pago|como compro|lo quiero|me interesa)/i.test(
		normalizeText(messageBody)
	);
}

export function isDiscoverySignal(messageBody = '') {
	return /(que tienen|mostrame|ver productos|catalogo|cat[aá]logo|opciones)/i.test(
		normalizeText(messageBody)
	);
}

export function resolveNextSalesStage({ messageBody = '', currentState = {} } = {}) {
	const detected = detectSalesStage(messageBody, currentState);
	if (detected === SALES_STAGES.PURCHASE_INTENT || isClosingSignal(messageBody)) return SALES_STAGES.PURCHASE_INTENT;
	if (isDiscoverySignal(messageBody)) return SALES_STAGES.DISCOVERY;
	return detected;
}