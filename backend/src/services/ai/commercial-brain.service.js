import {
	getCommercialFamilyLabel,
	getCommercialProfile,
	inferCommercialFamily,
	scoreProductAgainstCommercialProfile
} from '../../data/catalog-commercial-map.js';

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
	return [...new Set(values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))];
}

function isGreetingOnlyMessage(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (!text) return true;
	const greetingOnly = /^(hola|holi|buenas|buen dia|buen día|buenas tardes|buenas noches|hello|hi|👋)+[!.,\s]*$/i.test(text);
	const hasProductContext =
		Boolean(currentState?.currentProductFocus) ||
		Boolean(currentState?.currentProductFamily) ||
		asArray(currentState?.interestedProducts).length > 0;
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

function detectRequestedOfferType(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (/(3x1|tres por uno)/i.test(text)) return '3x1';
	if (/(2x1|dos por uno)/i.test(text)) return '2x1';
	if (/(pack|combo|promo|promocion|promoción|oferta)/i.test(text)) return 'pack';
	return currentState?.requestedOfferType || null;
}

function resolveProductFamily({ messageBody = '', currentState = {}, products = [] }) {
	const requested = inferCommercialFamily(messageBody);
	if (requested) return requested;
	if (currentState?.currentProductFamily) return currentState.currentProductFamily;
	const currentFocusFamily = inferCommercialFamily(currentState?.currentProductFocus || '');
	if (currentFocusFamily) return currentFocusFamily;
	if (products[0]?.family) return products[0].family;
	const joinedInterest = asArray(currentState?.interestedProducts).join(' ');
	return inferCommercialFamily(joinedInterest);
}

function shouldLockFamily({ messageBody = '', currentState = {}, productFamily = null }) {
	const text = normalizeText(messageBody);
	if (inferCommercialFamily(messageBody)) return true;
	if (/(estabamos hablando de|estábamos hablando de|veniamos hablando de|veníamos hablando de|de ese|de esa|de eso|de esos|de esas)/i.test(text) && (productFamily || currentState?.currentProductFamily)) return true;
	return Boolean(currentState?.categoryLocked && (currentState?.currentProductFamily || productFamily));
}

function normalizeExcludedKeywords(currentState = {}) {
	return uniqueStrings(asArray(currentState?.excludedProductKeywords)).map((item) => normalizeText(item));
}

function productContainsExcludedKeyword(product = {}, excludedKeywords = []) {
	if (!excludedKeywords.length) return false;
	const haystack = normalizeText([
		product.name,
		product.handle,
		product.tags,
		product.shortDescription,
		...(Array.isArray(product.variantHints) ? product.variantHints : []),
		...(Array.isArray(product.colors) ? product.colors : []),
		...(Array.isArray(product.sizes) ? product.sizes : [])
	].filter(Boolean).join(' '));
	return excludedKeywords.some((keyword) => keyword && haystack.includes(keyword));
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
		if (product.hasDiscount) fromRecent.shownOffers.push(`${product.offerType || 'single'}::${product.name}`);
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

function rankCommercialProducts(
	products = [],
	{
		messageBody = '',
		currentState = {},
		requestedAction = 'GENERAL',
		family = null,
		requestedOfferType = null,
		categoryLocked = false,
		excludedKeywords = []
	} = {}
) {
	const text = normalizeText(messageBody);
	const currentFocus = normalizeText(currentState?.currentProductFocus || '');
	const interests = asArray(currentState?.interestedProducts).map((v) => normalizeText(v));
	const lastRecommendedProduct = normalizeText(currentState?.lastRecommendedProduct || '');
	const profile = getCommercialProfile(family);
	const introMode = profile?.introMode || 'product_first';
	const isGenericDiscovery = requestedAction === 'GENERAL' || requestedAction === 'GREETING';

	const ranked = [...products]
		.map((product) => {
			let score = Number(product.score || 0) + Number(product.commercialScoreBoost || 0);
			const name = normalizeText(product.name || '');
			const productFamily = product.family || inferCommercialFamily(name);
			const offerType = product.offerType || 'single';
			const isExcluded = productContainsExcludedKeyword(product, excludedKeywords);

			if (productFamily && family && productFamily === family) score += 34;
			if (categoryLocked && family && productFamily && productFamily !== family) score -= 140;
			else if (family && productFamily && productFamily !== family) score -= 18;

			if (product.hasDiscount) score += requestedAction === 'ASK_OFFER' ? 18 : 6;
			if (product.priceValue != null) score += 5;
			if (product.productUrl) score += 2;
			if (currentFocus && name.includes(currentFocus)) score += 18;
			if (lastRecommendedProduct && name.includes(lastRecommendedProduct)) score += 16;
			if (interests.some((term) => term && name.includes(term))) score += 8;

			const profileScore = scoreProductAgainstCommercialProfile(product, family);
			if (profileScore > 0) score += profileScore;

			if (requestedOfferType) {
				if (offerType === requestedOfferType) score += 36;
				else if (requestedAction === 'ASK_OFFER') score -= 32;
				else score -= 10;
			} else if (requestedAction === 'ASK_OFFER') {
				if (offerType === '3x1') score += 20;
				if (offerType === '2x1') score += 12;
			}

			if (requestedAction === 'ASK_LINK' || requestedAction === 'ASK_PRICE' || requestedAction === 'ASK_VARIANT' || requestedAction === 'AFFIRM_CONTINUATION') {
				if (currentState?.lastRecommendedOffer && String(currentState.lastRecommendedOffer).includes(product.name)) score += 12;
				if (offerType === 'single') score += 8;
			}

			if (isGenericDiscovery) {
				if (introMode === 'offer_first' && offerType === '3x1') score += 14;
				if (introMode === 'product_first' && offerType === 'single') score += 12;
				if (offerType === 'pack' && !/(promo|oferta|2x1|3x1)/i.test(text)) score -= 6;
			}

			if (isExcluded) score -= 220;

			return { ...product, family: productFamily, commercialScore: score, isExcluded };
		})
		.sort((a, b) => b.commercialScore - a.commercialScore);

	if (categoryLocked && family) {
		const sameFamily = ranked.filter((item) => item.family === family);
		if (sameFamily.length) {
			const rest = ranked.filter((item) => item.family !== family);
			return [...sameFamily, ...rest];
		}
	}

	return ranked;
}

function mapBestOffer(chosen, family) {
	if (!chosen) return null;
	return {
		name: chosen.name,
		productId: chosen.productId || chosen.id || null,
		price: chosen.price || null,
		priceValue: chosen.priceValue ?? null,
		productUrl: chosen.productUrl || null,
		hasDiscount: !!chosen.hasDiscount,
		colors: chosen.colors || [],
		sizes: chosen.sizes || [],
		offerKey: chosen.hasDiscount ? `${chosen.name}::discount` : chosen.name,
		family: chosen.family || family || null,
		offerType: chosen.offerType || 'single',
		offerLabel: `${chosen.offerType || 'single'}::${chosen.name}`
	};
}

function chooseBestOffer(
	products = [],
	{
		requestedAction = 'GENERAL',
		family = null,
		requestedOfferType = null,
		categoryLocked = false,
		currentState = {}
	} = {}
) {
	if (!products.length) return { bestOffer: null, requestedOfferAvailable: null, fallbackOffer: null, offerOptions: [] };

	const profile = getCommercialProfile(family);
	const introMode = profile?.introMode || 'product_first';
	const allowed = products.filter((item) => !item.isExcluded);
	const familyScoped = family ? allowed.filter((item) => item.family === family) : allowed;
	const eligible = (categoryLocked && familyScoped.length) || familyScoped.length ? familyScoped : allowed;
	const requestedMatches = requestedOfferType ? eligible.filter((item) => item.offerType === requestedOfferType) : [];
	const lastRecommendedName = normalizeText(currentState?.lastRecommendedProduct || '');

	let chosen = null;
	if (requestedMatches.length) {
		chosen = requestedMatches[0];
	} else if (requestedAction === 'ASK_OFFER') {
		chosen = eligible.find((item) => item.offerType === '3x1') || eligible.find((item) => item.offerType === '2x1') || eligible[0] || null;
	} else if ((requestedAction === 'ASK_LINK' || requestedAction === 'ASK_PRICE' || requestedAction === 'ASK_VARIANT' || requestedAction === 'AFFIRM_CONTINUATION') && lastRecommendedName) {
		chosen = eligible.find((item) => normalizeText(item.name || '').includes(lastRecommendedName)) || eligible[0] || null;
	} else if ((requestedAction === 'GENERAL' || requestedAction === 'GREETING') && introMode === 'product_first') {
		chosen = eligible.find((item) => (item.offerType || 'single') === 'single') || eligible[0] || null;
	} else {
		chosen = eligible[0] || null;
	}

	const fallbackOffer = !requestedMatches.length && requestedOfferType ? eligible[0] || null : null;
	const offerOptions = eligible.slice(0, 3).map((item) => ({
		name: item.name,
		price: item.price || null,
		offerType: item.offerType || 'single',
		productUrl: item.productUrl || null
	}));

	return {
		bestOffer: mapBestOffer(chosen, family),
		requestedOfferAvailable: requestedOfferType ? requestedMatches.length > 0 : null,
		fallbackOffer: mapBestOffer(fallbackOffer, family),
		offerOptions
	};
}

function shouldShareLinkNow({ requestedAction, stage, bestOffer, alreadyShared, requestedOfferAvailable }) {
	if (!bestOffer?.productUrl) return false;
	if (requestedOfferAvailable === false) return false;
	if (requestedAction === 'ASK_LINK') return true;
	if (requestedAction === 'AFFIRM_CONTINUATION' && stage === 'READY_TO_BUY') return !alreadyShared.sharedLinks.includes(bestOffer.productUrl);
	return false;
}

function shouldRepeatPriceNow({ requestedAction, bestOffer, alreadyShared, requestedOfferAvailable }) {
	if (!bestOffer?.price) return false;
	if (requestedOfferAvailable === false) return false;
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

function buildRecommendedAction({
	stage,
	requestedAction,
	shouldEscalate,
	shareLinkNow,
	repeatPriceNow,
	requestedOfferType,
	requestedOfferAvailable,
	hasFallbackWithinFamily
}) {
	if (shouldEscalate) return 'handoff_human';
	if (requestedAction === 'GREETING') return 'greet_and_discover';
	if (requestedOfferType && requestedOfferAvailable === false && hasFallbackWithinFamily) {
		return 'explain_requested_offer_unavailable_keep_family';
	}
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
	const productFamily = resolveProductFamily({ messageBody, currentState, products: catalogProducts });
	const productFamilyLabel = getCommercialFamilyLabel(productFamily);
	const categoryLocked = shouldLockFamily({ messageBody, currentState, productFamily });
	const requestedOfferType = greetingOnly ? null : detectRequestedOfferType(messageBody, currentState);
	const excludedKeywords = greetingOnly ? [] : normalizeExcludedKeywords(currentState);
	const rankedProducts = greetingOnly
		? []
		: rankCommercialProducts(catalogProducts, {
			messageBody,
			currentState,
			requestedAction,
			family: productFamily,
			requestedOfferType,
			categoryLocked,
			excludedKeywords
		});
	const mood = detectMood(messageBody, currentState);
	const buyingIntentLevel = greetingOnly ? 'low' : detectBuyingIntent(messageBody, currentState);
	const stage = detectSalesStage({ intent, messageBody, currentState, greetingOnly });
	const alreadyShared = mergeHistorySignals({ recentMessages, currentState, products: rankedProducts });
	const selection = greetingOnly
		? { bestOffer: null, requestedOfferAvailable: null, fallbackOffer: null, offerOptions: [] }
		: chooseBestOffer(rankedProducts, {
			requestedAction,
			family: productFamily,
			requestedOfferType,
			categoryLocked,
			currentState
		});
	const bestOffer = selection.bestOffer;
	const fallbackOffer = selection.fallbackOffer;
	const requestedOfferAvailable = selection.requestedOfferAvailable;
	const shareLinkNow = shouldShareLinkNow({ requestedAction, stage, bestOffer, alreadyShared, requestedOfferAvailable });
	const repeatPriceNow = shouldRepeatPriceNow({ requestedAction, bestOffer, alreadyShared, requestedOfferAvailable });
	const escalation = shouldEscalate({ messageBody, mood, currentState });
	const recommendedAction = buildRecommendedAction({
		stage,
		requestedAction,
		shouldEscalate: escalation.shouldEscalate,
		shareLinkNow,
		repeatPriceNow,
		requestedOfferType,
		requestedOfferAvailable,
		hasFallbackWithinFamily: Boolean(fallbackOffer)
	});

	const productFocus = bestOffer?.name || currentState?.currentProductFocus || productFamilyLabel || null;
	const responseRules = [
		'Si es solo un saludo, respondé breve y no ofrezcas productos todavía.',
		'Si el cliente ya fijó una familia de producto, no cambies de familia sin permiso explícito.',
		'Si pidió una promo puntual, primero buscala dentro de la misma familia antes de abrir alternativas.',
		'Si una opción está excluida por el cliente, no la vuelvas a ofrecer.',
		'Priorizá una sola opción principal por respuesta.',
		'Compartí un único link por respuesta.',
		'Si la oferta exacta no existe, decilo claro y seguí dentro de la misma familia.',
		'Bajá el entusiasmo; soná más humana y directa.'
	];

	return {
		stage,
		mood,
		buyingIntentLevel,
		requestedAction,
		requestedOfferType,
		requestedOfferAvailable,
		productFocus,
		productFocusLabel: productFocus,
		productFamily,
		productFamilyLabel,
		categoryLocked,
		excludedKeywords,
		rankedProducts,
		bestOffer,
		fallbackOffer,
		offerOptions: selection.offerOptions,
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
