import { getCommercialProfile, inferCommercialFamily, scoreProductAgainstCommercialProfile } from '../../data/catalog-commercial-map.js';

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

function isGreetingOnlyMessage(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (!text) return true;
	const greetingOnly = /^(hola|holi|buenas|buen dia|buen día|buenas tardes|buenas noches|hello|hi|👋)+[!.,\s]*$/i.test(text);
	const hasProductContext = Boolean(currentState?.currentProductFocus) || asArray(currentState?.interestedProducts).length > 0;
	return greetingOnly && !hasProductContext;
}

function detectMood(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (/(horrible|malisimo|malisima|desastre|pesimo|p[eé]simo|me cans[eé]|no responden|nadie responde|quiero una persona|quiero hablar con alguien|me tienen harta|me tienen podrida)/i.test(text)) return 'angry';
	if (/(urgente|ya|ahora|hoy|cuanto antes)/i.test(text)) return 'urgent';
	if (/(quiero|me interesa|pasame|mandame|lo compro|me sirve|me gust[oó]|si\b)/i.test(text)) return 'interested';
	return currentState?.customerMood || 'neutral';
}

function detectBuyingIntent(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (/(lo quiero|lo compro|pasame el link|mandame el link|como compro|como pago|gu[ií]ame|quiero comprar)/i.test(text)) return 'high';
	if (/(precio|cuanto|cu[aá]nto|sale|valor|ten[eé]s|tienen|talle|color|oferta|promo)/i.test(text)) return 'medium';
	return currentState?.buyingIntentLevel || 'low';
}

function detectSalesStage({ intent, messageBody, currentState = {}, greetingOnly = false }) {
	const text = normalizeText(messageBody);
	if (greetingOnly) return 'DISCOVERY';
	if (currentState?.needsHuman) return 'NEEDS_HUMAN';
	if (/(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text)) return 'PRICE_EVALUATION';
	if (/(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(text)) return 'OFFER_DISCOVERY';
	if (/(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text)) return 'SIZE_COLOR_CHECK';
	if (/(quiero|lo quiero|me lo llevo|como compro|pasame el link|mandame el link|gu[ií]ame)/i.test(text)) return 'READY_TO_BUY';
	if (intent === 'product') return 'PRODUCT_INTEREST';
	return currentState?.salesStage || 'DISCOVERY';
}

function detectRequestedAction(messageBody = '', greetingOnly = false) {
	const text = normalizeText(messageBody);
	if (greetingOnly) return 'GREETING';
	if (/(pasame|mandame|enviame).*(link|url)|\b(link|url|web|tienda|comprar)\b/i.test(text)) return 'ASK_LINK';
	if (/(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text)) return 'ASK_PRICE';
	if (/(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(text)) return 'ASK_OFFER';
	if (/(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text)) return 'ASK_VARIANT';
	if (/^si$/i.test(text) || /^(sí)$/i.test(text)) return 'AFFIRM_CONTINUATION';
	if (/(transferencia|alias|pago|cuotas)/i.test(text)) return 'ASK_PAYMENT';
	return 'GENERAL';
}

function inferFamilyFromHistory({ messageBody = '', currentState = {}, products = [] }) {
	const requested = inferCommercialFamily(messageBody);
	if (requested) return requested;
	const currentFocusFamily = inferCommercialFamily(currentState?.currentProductFocus || '');
	if (currentFocusFamily) return currentFocusFamily;
	if (products[0]?.family) return products[0].family;
	const firstInterest = asArray(currentState?.interestedProducts)[0] || '';
	return inferCommercialFamily(firstInterest);
}

function findProductFocus({ messageBody, currentState = {}, products = [], requestedAction = 'GENERAL', family = null }) {
	const text = normalizeText(messageBody);
	const direct = products.find((product) => text.includes(normalizeText(product.name || '')));
	if (direct?.name) return direct.name;
	if ((requestedAction === 'GENERAL' || requestedAction === 'GREETING') && family) return family;
	if (currentState?.currentProductFocus && inferCommercialFamily(currentState.currentProductFocus) === family) return currentState.currentProductFocus;
	if (products[0]?.name) return products[0].name;
	if (currentState?.currentProductFocus) return currentState.currentProductFocus;
	const interested = asArray(currentState?.interestedProducts);
	return interested[0] || family || null;
}

function mergeHistorySignals({ recentMessages = [], currentState = {}, products = [] }) {
	const fromState = {
		sharedLinks: uniqueStrings(asArray(currentState?.sharedLinks)),
		shownPrices: uniqueStrings(asArray(currentState?.shownPrices)),
		shownOffers: uniqueStrings(asArray(currentState?.shownOffers))
	};
	const assistantTexts = recentMessages.filter((msg) => msg.role === 'assistant').map((msg) => String(msg.text || ''));
	const joined = assistantTexts.join('\n').toLowerCase();
	const fromRecent = { sharedLinks: [], shownPrices: [], shownOffers: [] };
	for (const product of products) {
		if (product.productUrl && joined.includes(String(product.productUrl).toLowerCase())) fromRecent.sharedLinks.push(product.productUrl);
		if (product.price && joined.includes(String(product.price).toLowerCase())) fromRecent.shownPrices.push(`${product.name}::${product.price}`);
		if (product.hasDiscount) fromRecent.shownOffers.push(`${product.name}::discount`);
	}
	if (/(3x1|tres por uno)/i.test(joined)) fromRecent.shownOffers.push('3x1');
	if (/(2x1|dos por uno)/i.test(joined)) fromRecent.shownOffers.push('2x1');
	if (/(promo|promocion|promoción|oferta)/i.test(joined)) fromRecent.shownOffers.push('promo');
	return {
		sharedLinks: uniqueStrings([...fromState.sharedLinks, ...fromRecent.sharedLinks]),
		shownPrices: uniqueStrings([...fromState.shownPrices, ...fromRecent.shownPrices]),
		shownOffers: uniqueStrings([...fromState.shownOffers, ...fromRecent.shownOffers])
	};
}

function rankCommercialProducts(products = [], { messageBody = '', currentState = {}, requestedAction = 'GENERAL', family = null } = {}) {
	const text = normalizeText(messageBody);
	const currentFocus = normalizeText(currentState?.currentProductFocus || '');
	const interests = asArray(currentState?.interestedProducts).map((v) => normalizeText(v));
	const profile = getCommercialProfile(family);
	const introMode = profile?.introMode || 'product_first';
	const isGenericDiscovery = requestedAction === 'GENERAL' || requestedAction === 'GREETING';

	return [...products]
		.map((product) => {
			let score = Number(product.score || 0) + Number(product.commercialScoreBoost || 0);
			const name = normalizeText(product.name || '');
			const productFamily = product.family || inferCommercialFamily(name);
			const offerType = product.offerType || 'single';

			if (productFamily && family && productFamily === family) score += 28;
			if (product.hasDiscount) score += requestedAction === 'ASK_OFFER' ? 22 : 8;
			if (product.priceValue != null) score += 6;
			if (product.productUrl) score += 2;
			if (currentFocus && name.includes(currentFocus)) score += 16;
			if (interests.some((term) => term && name.includes(term))) score += 8;
			if (scoreProductAgainstCommercialProfile(product, family) > 0) score += scoreProductAgainstCommercialProfile(product, family);

			if (requestedAction === 'ASK_LINK' || requestedAction === 'ASK_PRICE' || requestedAction === 'ASK_VARIANT') {
				if (offerType === 'single') score += 12;
			}

			if (requestedAction === 'ASK_OFFER') {
				if (offerType === '3x1') score += 24;
				if (offerType === '2x1') score += 16;
			}

			if (isGenericDiscovery) {
				if (introMode === 'offer_first' && offerType === '3x1') score += 16;
				if (introMode === 'offer_first' && offerType === '2x1') score += 8;
				if (introMode === 'product_first' && offerType === 'single') score += 14;
				if (offerType === 'pack' && !/(promo|oferta|2x1|3x1)/i.test(text)) score -= 6;
			}

			return { ...product, commercialScore: score };
		})
		.sort((a, b) => b.commercialScore - a.commercialScore);
}

function chooseBestOffer(products = [], { requestedAction = 'GENERAL', family = null } = {}) {
	if (!products.length) return null;
	const profile = getCommercialProfile(family);
	const introMode = profile?.introMode || 'product_first';
	const ordered = [...products].sort((a, b) => (b.commercialScore ?? 0) - (a.commercialScore ?? 0));
	let chosen = ordered[0];
	if ((requestedAction === 'GENERAL' || requestedAction === 'GREETING') && introMode === 'product_first') {
		chosen = ordered.find((item) => (item.offerType || 'single') === 'single') || chosen;
	}
	return chosen ? {
		name: chosen.name,
		price: chosen.price || null,
		priceValue: chosen.priceValue ?? null,
		productUrl: chosen.productUrl || null,
		hasDiscount: !!chosen.hasDiscount,
		colors: chosen.colors || [],
		sizes: chosen.sizes || [],
		offerKey: chosen.hasDiscount ? `${chosen.name}::discount` : chosen.name,
		family: chosen.family || family || null,
		offerType: chosen.offerType || 'single'
	} : null;
}

function shouldShareLinkNow({ requestedAction, stage, bestOffer, alreadyShared }) {
	if (!bestOffer?.productUrl) return false;
	if (requestedAction === 'ASK_LINK') return true;
	if (requestedAction === 'AFFIRM_CONTINUATION' && stage === 'READY_TO_BUY') return !alreadyShared.sharedLinks.includes(bestOffer.productUrl);
	return false;
}

function shouldRepeatPriceNow({ requestedAction, bestOffer, alreadyShared }) {
	if (!bestOffer?.price) return false;
	if (requestedAction !== 'ASK_PRICE') return false;
	return !alreadyShared.shownPrices.includes(`${bestOffer.name}::${bestOffer.price}`);
}

function shouldEscalate({ messageBody = '', mood = 'neutral', currentState = {} }) {
	const text = normalizeText(messageBody);
	if (currentState?.needsHuman) return { shouldEscalate: true, reason: currentState.handoffReason || 'existing_handoff' };
	if (/(quiero hablar con una persona|quiero una asesora|pasame con alguien|atencion humana|atención humana|humano)/i.test(text)) return { shouldEscalate: true, reason: 'requested_human' };
	if (mood === 'angry') return { shouldEscalate: true, reason: 'angry_customer' };
	return { shouldEscalate: false, reason: null };
}

function buildRecommendedAction({ stage, requestedAction, shouldEscalate, shareLinkNow, repeatPriceNow }) {
	if (shouldEscalate) return 'handoff_human';
	if (requestedAction === 'GREETING') return 'greet_and_discover';
	if (requestedAction === 'ASK_LINK' && shareLinkNow) return 'close_with_single_link';
	if (requestedAction === 'ASK_PRICE' && repeatPriceNow) return 'present_price_once';
	if (requestedAction === 'ASK_OFFER') return 'present_single_best_offer';
	if (requestedAction === 'ASK_VARIANT') return 'confirm_variant_and_continue';
	if (requestedAction === 'ASK_PAYMENT') return 'payment_guidance_with_current_offer';
	if (requestedAction === 'AFFIRM_CONTINUATION') return 'continue_current_offer';
	if (stage === 'READY_TO_BUY') return 'close_sale';
	return 'answer_and_guide';
}

export function resolveCommercialBrainV2({ intent, messageBody, currentState = {}, recentMessages = [], catalogProducts = [] }) {
	const greetingOnly = isGreetingOnlyMessage(messageBody, currentState);
	const requestedAction = detectRequestedAction(messageBody, greetingOnly);
	const productFamily = inferFamilyFromHistory({ messageBody, currentState, products: catalogProducts });
	const rankedProducts = greetingOnly ? [] : rankCommercialProducts(catalogProducts, { messageBody, currentState, requestedAction, family: productFamily });
	const mood = detectMood(messageBody, currentState);
	const buyingIntentLevel = greetingOnly ? 'low' : detectBuyingIntent(messageBody, currentState);
	const stage = detectSalesStage({ intent, messageBody, currentState, greetingOnly });
	const productFocus = greetingOnly ? null : findProductFocus({ messageBody, currentState, products: rankedProducts, requestedAction, family: productFamily });
	const alreadyShared = mergeHistorySignals({ recentMessages, currentState, products: rankedProducts });
	const bestOffer = greetingOnly ? null : chooseBestOffer(rankedProducts, { requestedAction, family: productFamily });
	const shareLinkNow = shouldShareLinkNow({ requestedAction, stage, bestOffer, alreadyShared });
	const repeatPriceNow = shouldRepeatPriceNow({ requestedAction, bestOffer, alreadyShared });
	const escalation = shouldEscalate({ messageBody, mood, currentState });
	const recommendedAction = buildRecommendedAction({ stage, requestedAction, shouldEscalate: escalation.shouldEscalate, shareLinkNow, repeatPriceNow });
	const responseRules = [
		'Si es solo un saludo, respondé breve y no ofrezcas productos todavía.',
		'Nombra y saluda al cliente una vez sola al comenzar la conversación.',
		'Ofrecer varias promos si solo te pidieron comparar.',
		'Priorizá una sola oferta principal por familia.',
		'Compartir un unico link por respuesta.',
		'Si la conversación cambió de producto, el link y el foco tienen que seguir el producto más reciente.',
		'Si ya se dijo el precio, no lo repitas salvo pedido explícito.',
		'Bajá el entusiasmo; soná más humana y directa.'
	];
	return {
		stage,
		mood,
		buyingIntentLevel,
		requestedAction,
		productFocus,
		productFamily,
		rankedProducts,
		bestOffer,
		alreadyShared,
		shareLinkNow,
		repeatPriceNow,
		shouldEscalate: escalation.shouldEscalate,
		handoffReason: escalation.reason,
		recommendedAction,
		responseRules,
		greetingOnly
	};
}
