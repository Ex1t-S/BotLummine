import { getCommercialProfile, normalizeCommercialFamily } from '../data/catalog-commercial-map.js';

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
	if (/(horrible|malisimo|malisima|desastre|pesimo|me canse|no responden|nadie responde|quiero una persona|quiero hablar con alguien)/i.test(text)) return 'angry';
	if (/(urgente|ya|ahora|hoy|cuanto antes)/i.test(text)) return 'urgent';
	return currentState?.customerMood || 'neutral';
}

function detectBuyingIntent(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (/(lo quiero|lo compro|pasame el link|mandame el link|como compro|como pago|gu[ií]ame|quiero comprar)/i.test(text)) return 'high';
	if (/(precio|cuanto|sale|valor|talle|color|oferta|promo|link)/i.test(text)) return 'medium';
	return currentState?.buyingIntentLevel || 'low';
}

function detectRequestedVariant(messageBody = '', products = []) {
	const text = normalizeText(messageBody);
	const color = (text.match(/\b(negro|blanco|beige|nude|rosa|gris|azul|verde|bordo|marron|avellana)\b/) || [])[1] || null;
	const size = (text.match(/\b(xs|s|m|l|xl|xxl|xxxl|m\/l|l\/xl|xl\/xxl)\b/) || [])[1] || null;
	const resolvedColor = color || products.flatMap((p) => asArray(p.colors)).find((value) => text.includes(normalizeText(value))) || null;
	const resolvedSize = size || products.flatMap((p) => asArray(p.sizes)).find((value) => text.includes(normalizeText(value))) || null;
	return { color: resolvedColor, size: resolvedSize };
}

function detectRequestedAction(messageBody = '') {
	const text = normalizeText(messageBody);
	if (/(pasame|mandame|enviame).*(link|url)|\b(link|url|comprar)\b/i.test(text)) return 'ASK_LINK';
	if (/(catalogo|catálogo|pagina|página|web|ver opciones|mirar opciones|ver la web|ver la pagina)/i.test(text)) return 'ASK_CATALOG';
	if (/(precio|cuanto|sale|valor)/i.test(text)) return 'ASK_PRICE';
	if (/(oferta|promo|promocion|promoción|pack|combo|2x1|3x1|alguna promo mas|alguna promo más|que opciones|qué opciones|otras opciones)/i.test(text)) return 'ASK_OFFER';
	if (/(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text)) return 'ASK_VARIANT';
	if (/^si$/i.test(text) || /^(sí)$/i.test(text)) return 'AFFIRM_CONTINUATION';
	if (/(transferencia|alias|pago|cuotas|comprobante)/i.test(text)) return 'ASK_PAYMENT';
	return 'GENERAL';
}

function detectSalesStage({ intent, messageBody, currentState = {}, requestedAction }) {
	const text = normalizeText(messageBody);
	if (currentState?.needsHuman) return 'NEEDS_HUMAN';
	if (requestedAction === 'ASK_PRICE') return 'PRICE_EVALUATION';
	if (requestedAction === 'ASK_OFFER') return 'OFFER_DISCOVERY';
	if (requestedAction === 'ASK_VARIANT') return 'SIZE_COLOR_CHECK';
	if (/(quiero|lo quiero|me lo llevo|como compro|pasame el link|mandame el link|gu[ií]ame)/i.test(text)) return 'READY_TO_BUY';
	if (intent === 'product') return 'PRODUCT_INTEREST';
	return currentState?.salesStage || 'DISCOVERY';
}

function familyFromRecentMessages(recentMessages = []) {
	const recentUserText = [...recentMessages].slice(-4).map((msg) => (msg.role === 'user' ? msg.text : '')).join(' ');
	return normalizeCommercialFamily(recentUserText);
}

function findProductFocus({ messageBody, currentState = {}, products = [], recentMessages = [] }) {
	const messageFamily = normalizeCommercialFamily(messageBody);
	if (messageFamily !== 'general') return messageFamily;
	const recentFamily = familyFromRecentMessages(recentMessages);
	if (recentFamily !== 'general') return recentFamily;
	if (currentState?.currentProductFocus) return normalizeCommercialFamily(currentState.currentProductFocus);
	if (products[0]?.family && products[0].family !== 'general') return products[0].family;
	return 'general';
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
		if (product.offerLabel && joined.includes(String(product.offerLabel).toLowerCase())) fromRecent.shownOffers.push(product.offerLabel);
	}
	if (/(3x1|tres por uno)/i.test(joined)) fromRecent.shownOffers.push('3x1');
	if (/(2x1|dos por uno)/i.test(joined)) fromRecent.shownOffers.push('2x1');
	return {
		sharedLinks: uniqueStrings([...fromState.sharedLinks, ...fromRecent.sharedLinks]),
		shownPrices: uniqueStrings([...fromState.shownPrices, ...fromRecent.shownPrices]),
		shownOffers: uniqueStrings([...fromState.shownOffers, ...fromRecent.shownOffers])
	};
}

function rankCommercialProducts(products = [], { messageBody = '', currentState = {}, recentMessages = [] } = {}) {
	const text = normalizeText(messageBody);
	const asksPromo = /(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(text);
	const requestedFamily = findProductFocus({ messageBody, currentState, products, recentMessages });
	const currentFocus = normalizeCommercialFamily(currentState?.currentProductFocus || '');
	const specificColor = /(negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text);
	const specificSize = /(xs|s|m|l|xl|xxl|xxxl|m\/l|l\/xl|xl\/xxl)/i.test(text);

	return [...products]
		.map((product) => {
			let score = Number(product.score || 0);
			if (product.family === requestedFamily) score += 34;
			if (currentFocus && product.family === currentFocus) score += 18;
			if (product.productUrl) score += 2;
			if (product.priceValue != null) score += 4;
			if (specificColor && !(product.colors || []).length) score -= 5;
			if (specificSize && !(product.sizes || []).length) score -= 5;
			if (!asksPromo && product.profile?.showMode === 'offer_first' && product.offerType === 'pack_3x1') score += 10;
			if (!asksPromo && product.profile?.showMode === 'offer_first' && product.offerType === 'pack_2x1') score += 4;
			if (!asksPromo && product.profile?.showMode === 'product_first' && product.offerType === 'single') score += 10;
			if (!asksPromo && product.profile?.showMode === 'product_first' && product.offerType.startsWith('pack')) score -= 10;
			if (asksPromo && product.offerType === 'pack_3x1') score += 18;
			if (asksPromo && product.offerType === 'pack_2x1') score += 10;
			return { ...product, commercialScore: score };
		})
		.sort((a, b) => b.commercialScore - a.commercialScore);
}

function chooseBestOffer(products = [], context = {}) {
	if (!products.length) return null;
	const family = context.productFocus !== 'general' ? context.productFocus : products[0]?.family || 'general';
	const profile = getCommercialProfile(family);
	const familyProducts = products.filter((product) => product.family === family);
	const pool = familyProducts.length ? familyProducts : products;

	let chosen = null;
	if (context.requestedAction === 'ASK_LINK' || context.requestedAction === 'ASK_PRICE') {
		chosen = pool.find((product) => product.offerType === 'single' && product.productUrl) || pool[0] || null;
	}
	if (!chosen && (context.requestedAction === 'ASK_OFFER' || context.asksPromo)) {
		chosen = pool.find((product) => product.offerType === 'pack_3x1') || pool.find((product) => product.offerType === 'pack_2x1') || pool[0] || null;
	}
	if (!chosen && profile?.showMode === 'offer_first') {
		chosen = pool.find((product) => product.offerType === 'pack_3x1') || pool.find((product) => product.offerType === 'pack_2x1') || pool.find((product) => product.offerType === 'single') || pool[0] || null;
	}
	if (!chosen) {
		chosen = pool.find((product) => product.offerType === 'single') || pool[0] || null;
	}
	if (!chosen) return null;
	return {
		name: chosen.name,
		price: chosen.price || null,
		priceValue: chosen.priceValue ?? null,
		productUrl: chosen.productUrl || null,
		hasDiscount: !!chosen.hasDiscount,
		colors: chosen.colors || [],
		sizes: chosen.sizes || [],
		offerType: chosen.offerType || null,
		offerLabel: chosen.offerLabel || null,
		offerKey: chosen.hasDiscount ? `${chosen.name}::discount` : chosen.name,
		family: chosen.family || null,
		respectSpecificity: Boolean(context?.requestedVariant?.color || context?.requestedVariant?.size)
	};
}

function buildOfferOptions(products = [], productFocus = 'general') {
	const family = productFocus !== 'general' ? productFocus : products[0]?.family || 'general';
	const familyProducts = products.filter((product) => product.family === family);
	const profile = getCommercialProfile(family);
	const source = familyProducts.length ? familyProducts : products;
	const options = [];
	const pushUnique = (product, label) => {
		if (!product || options.some((item) => item.productUrl && item.productUrl === product.productUrl)) return;
		options.push({ label, productName: product.name, price: product.price || null, productUrl: product.productUrl || null, family: product.family || null });
	};
	if (profile?.showMode === 'offer_first') {
		pushUnique(source.find((p) => p.offerType === 'pack_3x1'), 'promo 3x1');
		pushUnique(source.find((p) => p.offerType === 'pack_2x1'), 'promo 2x1');
		pushUnique(source.find((p) => p.offerType === 'single'), 'opción individual');
	} else {
		pushUnique(source.find((p) => p.offerType === 'single'), 'opción individual');
		pushUnique(source.find((p) => p.offerType === 'pack_3x1'), 'promo 3x1');
		pushUnique(source.find((p) => p.offerType === 'pack_2x1'), 'promo 2x1');
	}
	return options.slice(0, 3);
}

function shouldShareLinkNow({ requestedAction, stage, bestOffer, alreadyShared }) {
	if (!bestOffer?.productUrl) return false;
	if (requestedAction === 'ASK_LINK') return true;
	if (requestedAction === 'AFFIRM_CONTINUATION' && stage === 'READY_TO_BUY') return !alreadyShared.sharedLinks.includes(bestOffer.productUrl);
	return false;
}

function shouldRepeatPriceNow({ requestedAction, bestOffer, alreadyShared }) {
	if (!bestOffer?.price || requestedAction !== 'ASK_PRICE') return false;
	return !alreadyShared.shownPrices.includes(`${bestOffer.name}::${bestOffer.price}`);
}

function shouldEscalate({ messageBody = '', mood = 'neutral', currentState = {} }) {
	const text = normalizeText(messageBody);
	if (currentState?.needsHuman) return { shouldEscalate: true, reason: currentState.handoffReason || 'existing_handoff' };
	if (/(quiero hablar con una persona|quiero una asesora|pasame con alguien|atencion humana|atención humana|humano)/i.test(text)) return { shouldEscalate: true, reason: 'requested_human' };
	if (mood === 'angry') return { shouldEscalate: true, reason: 'angry_customer' };
	return { shouldEscalate: false, reason: null };
}

function buildRecommendedAction({ stage, requestedAction, shouldEscalate, shareLinkNow, repeatPriceNow, buyingIntentLevel, requestedVariant, productFocus }) {
	if (shouldEscalate) return 'handoff_human';
	if (requestedAction === 'ASK_LINK' && shareLinkNow) return 'close_with_single_link';
	if (requestedAction === 'ASK_PRICE' && repeatPriceNow) return 'present_price_once';
	if (requestedAction === 'ASK_PAYMENT') return 'payment_guidance_with_current_offer';
	if (requestedAction === 'ASK_CATALOG') return 'invite_to_catalog_and_offer_help';
	if (requestedAction === 'ASK_OFFER') return 'present_offer_options_brief';
	if (requestedAction === 'ASK_VARIANT') return 'confirm_variant_then_guide';
	if (stage === 'PRODUCT_INTEREST' && buyingIntentLevel === 'low') return 'guide_and_discover';
	if (stage === 'PRODUCT_INTEREST' && requestedVariant && (requestedVariant.color || requestedVariant.size)) return 'guide_specific_product';
	if (stage === 'READY_TO_BUY') return 'close_sale';
	if (productFocus && productFocus !== 'general') return 'answer_and_guide';
	return 'answer_and_guide';
}

export function resolveCommercialBrainV2({ intent, messageBody, currentState = {}, recentMessages = [], catalogProducts = [] }) {
	const requestedAction = detectRequestedAction(messageBody);
	const mood = detectMood(messageBody, currentState);
	const buyingIntentLevel = detectBuyingIntent(messageBody, currentState);
	const stage = detectSalesStage({ intent, messageBody, currentState, requestedAction });
	const rankedProducts = rankCommercialProducts(catalogProducts, { messageBody, currentState, recentMessages });
	const requestedVariant = detectRequestedVariant(messageBody, rankedProducts);
	const productFocus = findProductFocus({ messageBody, currentState, products: rankedProducts, recentMessages });
	const alreadyShared = mergeHistorySignals({ recentMessages, currentState, products: rankedProducts });
	const bestOffer = chooseBestOffer(rankedProducts, {
		requestedVariant,
		requestedAction,
		asksPromo: requestedAction === 'ASK_OFFER',
		productFocus
	});
	const offerOptions = buildOfferOptions(rankedProducts, productFocus);
	const shareLinkNow = shouldShareLinkNow({ requestedAction, stage, bestOffer, alreadyShared });
	const repeatPriceNow = shouldRepeatPriceNow({ requestedAction, bestOffer, alreadyShared });
	const escalation = shouldEscalate({ messageBody, mood, currentState });
	const recommendedAction = buildRecommendedAction({
		stage,
		requestedAction,
		shouldEscalate: escalation.shouldEscalate,
		shareLinkNow,
		repeatPriceNow,
		buyingIntentLevel,
		requestedVariant,
		productFocus
	});
	const profile = getCommercialProfile(productFocus);
	return {
		mood,
		buyingIntentLevel,
		stage,
		requestedAction,
		requestedVariant,
		productFocus,
		productFocusLabel: profile?.familyLabel || productFocus,
		bestOffer,
		offerOptions,
		shareLinkNow,
		repeatPriceNow,
		recommendedAction,
		shouldEscalate: escalation.shouldEscalate,
		handoffReason: escalation.reason,
		alreadyShared,
		rankedProducts,
		introLine: profile?.introLine || null
	};
}
