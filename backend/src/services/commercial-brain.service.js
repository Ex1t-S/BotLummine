function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
	return [...new Set(values.filter(Boolean).map((v) => String(v).trim()))];
}

function detectMood(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);

	if (/(horrible|malisimo|malisima|desastre|pesimo|me canse|no responden|quiero una persona|quiero hablar con alguien)/i.test(text)) {
		return 'angry';
	}

	if (/(urgente|ya|ahora|hoy|cuanto antes)/i.test(text)) {
		return 'urgent';
	}

	if (/(quiero|me interesa|pasame|mandame|lo compro|me sirve|me gusto|si\b|sí\b)/i.test(text)) {
		return 'interested';
	}

	return currentState?.customerMood || 'neutral';
}

function detectBuyingIntent(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);

	if (/(lo quiero|lo compro|pasame el link|mandame el link|como compro|como pago|quiero comprar)/i.test(text)) {
		return 'high';
	}

	if (/(precio|cuanto|cuanto|sale|valor|tenes|tienen|talle|color|oferta|promo|metodos de pago|m[eé]todos de pago)/i.test(text)) {
		return 'medium';
	}

	return currentState?.buyingIntentLevel || 'low';
}

function detectSalesStage({ intent, messageBody, currentState = {} }) {
	const text = normalizeText(messageBody);

	if (currentState?.needsHuman) return 'NEEDS_HUMAN';
	if (/(pasame el link|mandame el link|como compro|quiero comprar|cerramos|lo quiero)/i.test(text)) return 'READY_TO_BUY';
	if (/(metodos de pago|m[eé]todos de pago|transferencia|tarjeta|cuotas|alias)/i.test(text)) return 'PAYMENT_CHECK';
	if (/(envio|envío|demora|llega|bahia blanca|bahía blanca|correo|andreani|oca)/i.test(text)) return 'SHIPPING_CHECK';
	if (/(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text)) return 'PRICE_EVALUATION';
	if (/(alguna promo mas|alguna promo m[aá]s|hay otra promo|hay otras promos|que promos hay|qué promos hay|3x1|2x1|promo|oferta|pack)/i.test(text)) {
		return 'OFFER_DISCOVERY';
	}
	if (/(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text)) {
		return 'SIZE_COLOR_CHECK';
	}
	if (intent === 'product') return 'PRODUCT_INTEREST';

	return currentState?.salesStage || 'DISCOVERY';
}

function detectRequestedAction(messageBody = '') {
	const text = normalizeText(messageBody);

	if (/^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches)$/i.test(text)) return 'GREETING';
	if (/^(gracias|muchas gracias|genial gracias|ok gracias)$/i.test(text)) return 'THANKS';
	if (/(pasame|mandame|enviame).*(link|url)|\b(link|url|web|tienda|comprar)\b/i.test(text)) return 'ASK_LINK';
	if (/(metodos de pago|m[eé]todos de pago|transferencia|alias|pago|cuotas|tarjeta)/i.test(text)) return 'ASK_PAYMENT';
	if (/(envio|envío|demora|llega|bahia blanca|bahía blanca|correo|andreani|oca)/i.test(text)) return 'ASK_SHIPPING';
	if (/(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text)) return 'ASK_PRICE';
	if (/(alguna promo mas|alguna promo m[aá]s|hay otra promo|hay otras promos|que promos hay|qué promos hay)/i.test(text)) return 'ASK_MORE_OPTIONS';
	if (/(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(text)) return 'ASK_OFFER';
	if (/(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text)) return 'ASK_VARIANT';
	if (/^(si|sí|dale|ok)$/i.test(text)) return 'AFFIRM_CONTINUATION';
	return 'GENERAL';
}

function mergeHistorySignals({ recentMessages = [], currentState = {}, products = [] }) {
	const fromState = {
		sharedLinks: uniqueStrings(asArray(currentState?.sharedLinks)),
		shownPrices: uniqueStrings(asArray(currentState?.shownPrices)),
		shownOffers: uniqueStrings(asArray(currentState?.shownOffers))
	};

	const assistantTexts = recentMessages
		.filter((msg) => msg.role === 'assistant')
		.map((msg) => String(msg.text || ''));

	const joined = assistantTexts.join('\n').toLowerCase();
	const fromRecent = { sharedLinks: [], shownPrices: [], shownOffers: [] };

	for (const product of products) {
		if (product.productUrl && joined.includes(String(product.productUrl).toLowerCase())) {
			fromRecent.sharedLinks.push(product.productUrl);
		}

		if (product.price && joined.includes(String(product.price).toLowerCase())) {
			fromRecent.shownPrices.push(`${product.name}::${product.price}`);
		}

		if (product.offerType && product.offerType !== 'single' && joined.includes(product.offerType.toLowerCase())) {
			fromRecent.shownOffers.push(product.offerType);
		}
	}

	return {
		sharedLinks: uniqueStrings([...fromState.sharedLinks, ...fromRecent.sharedLinks]),
		shownPrices: uniqueStrings([...fromState.shownPrices, ...fromRecent.shownPrices]),
		shownOffers: uniqueStrings([...fromState.shownOffers, ...fromRecent.shownOffers])
	};
}

function findProductFocus({ messageBody, currentState = {}, products = [] }) {
	const text = normalizeText(messageBody);

	const exact = products.find((product) => text.includes(normalizeText(product.name || '')));
	if (exact?.name) return exact.name;

	const familyMatch = products.find((product) => product.family && text.includes(normalizeText(product.family)));
	if (familyMatch?.family) return familyMatch.family;

	if (currentState?.currentProductFocus) return currentState.currentProductFocus;
	if (products[0]?.family) return products[0].family;
	if (products[0]?.name) return products[0].name;

	const interested = asArray(currentState?.interestedProducts);
	return interested[0] || null;
}

function computeOfferWeight({ product, requestedAction, text, currentFocus }) {
	let score = Number(product.score || 0);
	const name = normalizeText(product.name || '');
	const family = normalizeText(product.family || '');
	const focus = normalizeText(currentFocus || '');
	const askingOffer = ['ASK_OFFER', 'ASK_MORE_OPTIONS'].includes(requestedAction);
	const askingPrice = requestedAction === 'ASK_PRICE';
	const askingLink = requestedAction === 'ASK_LINK';
	const askingVariant = requestedAction === 'ASK_VARIANT';
	const explicit3x1 = /\b3x1\b|tres por uno/i.test(text);
	const explicit2x1 = /\b2x1\b|dos por uno/i.test(text);

	if (focus && (name.includes(focus) || family.includes(focus))) score += 28;
	if (askingVariant && product.variantMatchScore) score += product.variantMatchScore;
	if (askingVariant && /negro|blanco|beige|nude|rosa|gris|azul|verde|bordo/i.test(text) && !product.hasRequestedColor) score -= 12;
	if (askingVariant && /\bxl\b|\bxxl\b|\bxxxl\b|talle/i.test(text) && !product.hasRequestedSize) score -= 10;

	if (askingOffer || askingPrice || askingLink) {
		if (product.hasDiscount) score += 10;
		if (product.packCount >= 3) score += explicit3x1 ? 18 : 10;
		else if (product.packCount === 2) score += explicit2x1 ? 16 : 7;
	} else {
		if (product.packCount > 1) score += 1;
		if (product.hasDiscount) score += 1;
	}

	if (/total white/i.test(name) && !/total white/i.test(text) && requestedAction !== 'ASK_LINK') {
		score -= 4;
	}

	return score;
}

function rankCommercialProducts(products = [], { messageBody = '', currentState = {}, requestedAction = 'GENERAL' } = {}) {
	const text = normalizeText(messageBody);
	const currentFocus = findProductFocus({ messageBody, currentState, products });

	return [...products]
		.map((product) => ({
			...product,
			commercialScore: computeOfferWeight({
				product,
				requestedAction,
				text,
				currentFocus
			})
		}))
		.sort((a, b) => (b.commercialScore || 0) - (a.commercialScore || 0));
}

function chooseBestOffer(products = [], { requestedAction = 'GENERAL', stage = 'DISCOVERY', productFocus = null } = {}) {
	if (!products.length) return null;

	const shouldCommitOffer = [
		'ASK_PRICE',
		'ASK_LINK',
		'ASK_PAYMENT',
		'AFFIRM_CONTINUATION'
	].includes(requestedAction) || ['PRICE_EVALUATION', 'READY_TO_BUY', 'PAYMENT_CHECK'].includes(stage);

	if (!shouldCommitOffer) {
		return null;
	}

	const chosen = products[0];
	if (!chosen) return null;

	return {
		name: chosen.name,
		price: chosen.price || null,
		priceValue: chosen.priceValue ?? null,
		productUrl: chosen.productUrl || null,
		hasDiscount: !!chosen.hasDiscount,
		colors: chosen.colors || [],
		sizes: chosen.sizes || [],
		offerType: chosen.offerType || 'single',
		packCount: chosen.packCount || 1,
		offerKey: chosen.offerType && chosen.offerType !== 'single'
			? `${chosen.family || productFocus || chosen.name}::${chosen.offerType}`
			: chosen.name
	};
}

function buildOfferCandidates(products = [], productFocus = null) {
	return products.slice(0, 3).map((product) => ({
		name: product.name,
		price: product.price || null,
		offerType: product.offerType || 'single',
		family: product.family || productFocus || null,
		productUrl: product.productUrl || null
	}));
}

function shouldShareLinkNow({ requestedAction, bestOffer, alreadyShared }) {
	if (!bestOffer?.productUrl) return false;
	if (requestedAction !== 'ASK_LINK') return false;
	return !alreadyShared.sharedLinks.includes(bestOffer.productUrl);
}

function shouldRepeatPriceNow({ requestedAction, bestOffer, alreadyShared }) {
	if (!bestOffer?.price) return false;
	if (!['ASK_PRICE', 'ASK_OFFER', 'ASK_MORE_OPTIONS'].includes(requestedAction)) return false;
	return !alreadyShared.shownPrices.includes(`${bestOffer.name}::${bestOffer.price}`);
}

function shouldEscalate({ messageBody = '', mood = 'neutral', currentState = {} }) {
	const text = normalizeText(messageBody);

	if (currentState?.needsHuman) {
		return { shouldEscalate: true, reason: currentState.handoffReason || 'existing_handoff' };
	}

	if (/(quiero hablar con una persona|quiero una asesora|pasame con alguien|atencion humana|atención humana|humano)/i.test(text)) {
		return { shouldEscalate: true, reason: 'requested_human' };
	}

	if (mood === 'angry') {
		return { shouldEscalate: true, reason: 'angry_customer' };
	}

	return { shouldEscalate: false, reason: null };
}

function buildRecommendedAction({ stage, requestedAction, shouldEscalate, shareLinkNow, repeatPriceNow }) {
	if (shouldEscalate) return 'handoff_human';
	if (requestedAction === 'ASK_LINK' && shareLinkNow) return 'close_with_single_link';
	if (requestedAction === 'ASK_PRICE' && repeatPriceNow) return 'present_price_once';
	if (requestedAction === 'ASK_MORE_OPTIONS') return 'offer_overview';
	if (requestedAction === 'ASK_OFFER') return 'offer_overview';
	if (requestedAction === 'ASK_VARIANT') return 'confirm_variant_and_continue';
	if (requestedAction === 'ASK_PAYMENT') return 'payment_guidance_with_current_offer';
	if (requestedAction === 'ASK_SHIPPING') return 'shipping_guidance';
	if (requestedAction === 'THANKS') return 'simple_closing';
	if (requestedAction === 'GREETING') return 'greet_once';
	if (requestedAction === 'GENERAL' && ['DISCOVERY', 'PRODUCT_INTEREST'].includes(stage)) return 'qualify_before_offer';
	if (stage === 'READY_TO_BUY') return 'close_sale';
	return 'answer_and_guide';
}

export function resolveCommercialBrainV2({
	intent,
	messageBody,
	currentState = {},
	recentMessages = [],
	catalogProducts = []
}) {
	const mood = detectMood(messageBody, currentState);
	const buyingIntentLevel = detectBuyingIntent(messageBody, currentState);
	const stage = detectSalesStage({ intent, messageBody, currentState });
	const requestedAction = detectRequestedAction(messageBody);

	const rankedProducts = rankCommercialProducts(catalogProducts, {
		messageBody,
		currentState,
		requestedAction
	});

	const productFocus = findProductFocus({
		messageBody,
		currentState,
		products: rankedProducts
	});

	const alreadyShared = mergeHistorySignals({
		recentMessages,
		currentState,
		products: rankedProducts
	});

	const bestOffer = chooseBestOffer(rankedProducts, {
		requestedAction,
		stage,
		productFocus
	});
	const offerCandidates = buildOfferCandidates(rankedProducts, productFocus);
	const escalation = shouldEscalate({ messageBody, mood, currentState });
	const shareLinkNow = shouldShareLinkNow({ requestedAction, bestOffer, alreadyShared });
	const repeatPriceNow = shouldRepeatPriceNow({ requestedAction, bestOffer, alreadyShared });
	const recommendedAction = buildRecommendedAction({
		stage,
		requestedAction,
		shouldEscalate: escalation.shouldEscalate,
		shareLinkNow,
		repeatPriceNow
	});

	return {
		mood,
		buyingIntentLevel,
		stage,
		requestedAction,
		productFocus,
		bestOffer,
		offerCandidates,
		alreadyShared,
		shareLinkNow,
		repeatPriceNow,
		shouldEscalate: escalation.shouldEscalate,
		handoffReason: escalation.reason,
		recommendedAction
	};
}
