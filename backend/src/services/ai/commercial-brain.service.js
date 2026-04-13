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

function asksForTotalWhite(text = '') {
	return /\btotal white\b|\bwhite\b|\bblanco\b/.test(normalizeText(text));
}

function isGreetingOnlyMessage(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (!text) return true;

	const greetingOnly = /^(hola|holi|buenas|buen dia|buenas tardes|buenas noches|hello|hi|👋)+[!.,\s]*$/i.test(text);
	const hasProductContext =
		Boolean(currentState?.currentProductFocus) ||
		Boolean(currentState?.currentProductFamily) ||
		asArray(currentState?.interestedProducts).length > 0;

	return greetingOnly && !hasProductContext;
}

function detectMood(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (/(horrible|malisimo|malisima|desastre|pesimo|me canse|no responden|nadie responde|quiero una persona|quiero hablar con alguien|me tienen harta|me tienen podrida)/i.test(text)) {
		return 'angry';
	}
	if (/(urgente|ya|ahora|hoy|cuanto antes)/i.test(text)) return 'urgent';
	if (/(quiero|me interesa|pasame|mandame|lo compro|me sirve|me gusto|\bsi\b)/i.test(text)) {
		return 'interested';
	}
	return currentState?.customerMood || 'neutral';
}

function detectBuyingIntent(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (/(lo quiero|lo compro|pasame el link|mandame el link|como compro|como pago|guiame|quiero comprar)/i.test(text)) {
		return 'high';
	}
	if (/(precio|cuanto|sale|valor|tenes|tienen|talle|color|oferta|promo)/i.test(text)) {
		return 'medium';
	}
	return currentState?.buyingIntentLevel || 'low';
}

function detectSalesStage({ intent, messageBody, currentState = {}, greetingOnly = false }) {
	const text = normalizeText(messageBody);
	if (greetingOnly) return 'DISCOVERY';
	if (currentState?.needsHuman) return 'NEEDS_HUMAN';
	if (/(precio|cuanto|sale|valor)/i.test(text)) return 'PRICE_EVALUATION';
	if (/(oferta|promo|promocion|pack|combo|2x1|3x1|5x2|cual conviene|que diferencia)/i.test(text)) return 'OFFER_DISCOVERY';
	if (/(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text)) return 'SIZE_COLOR_CHECK';
	if (/(quiero|lo quiero|me lo llevo|como compro|pasame el link|mandame el link|guiame)/i.test(text)) return 'READY_TO_BUY';
	if (intent === 'product') return 'PRODUCT_INTEREST';
	return currentState?.salesStage || 'DISCOVERY';
}

function detectRequestedAction(messageBody = '', greetingOnly = false) {
	const text = normalizeText(messageBody);
	if (greetingOnly) return 'GREETING';
	if (/(pasame|mandame|enviame).*(link|url)|\b(link|url|web|tienda|comprar)\b/i.test(text)) return 'ASK_LINK';
	if (/(cual|conviene|mejor|diferencia|compar)/i.test(text)) return 'ASK_COMPARISON';
	if (/(precio|cuanto|sale|valor)/i.test(text)) return 'ASK_PRICE';
	if (/(oferta|promo|promocion|pack|combo|2x1|3x1|5x2)/i.test(text)) return 'ASK_OFFER';
	if (/(catalogo|ver opciones|que tienen|mostrame|muestrame)/i.test(text)) return 'ASK_CATALOG';
	if (/(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text)) return 'ASK_VARIANT';
	if (/^si$/i.test(text) || /^(sí)$/i.test(text)) return 'AFFIRM_CONTINUATION';
	if (/(transferencia|alias|pago|cuotas)/i.test(text)) return 'ASK_PAYMENT';
	return 'GENERAL';
}

function detectRequestedOfferType(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (/(5x2|cinco por dos)/i.test(text)) return '5x2';
	if (/(3x1|tres por uno)/i.test(text)) return '3x1';
	if (/(2x1|dos por uno)/i.test(text)) return '2x1';
	if (/(pack|combo|promo|promocion|oferta)/i.test(text)) return 'pack';
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
	if (/(estabamos hablando de|veniamos hablando de|de ese|de esa|de eso|de esos|de esas)/i.test(text) && (productFamily || currentState?.currentProductFamily)) {
		return true;
	}
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
		if (product.hasDiscount) {
			fromRecent.shownOffers.push(`${product.offerType || 'single'}::${product.name}`);
		}
	}

	if (/(5x2|cinco por dos)/i.test(joined)) fromRecent.shownOffers.push('5x2');
	if (/(3x1|tres por uno)/i.test(joined)) fromRecent.shownOffers.push('3x1');
	if (/(2x1|dos por uno)/i.test(joined)) fromRecent.shownOffers.push('2x1');
	if (/(promo|promocion|oferta)/i.test(joined)) fromRecent.shownOffers.push('promo');

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
	const isGenericDiscovery = ['GENERAL', 'GREETING', 'ASK_CATALOG'].includes(requestedAction);
	const explicitTotalWhite = asksForTotalWhite(text);
	const asksBoobTape = /\bboob\s*tape\b|\bboop\s*tape\b/.test(text);

	const ranked = [...products]
		.map((product) => {
			let score = Number(product.score || 0) + Number(product.commercialScoreBoost || 0);
			const name = normalizeText(product.name || '');
			const productFamily = product.family || inferCommercialFamily(name);
			const offerType = product.offerType || 'single';
			const mentionsBoobTape = /\bboob\s*tape\b/.test(
				normalizeText([
					product.name,
					product.handle,
					product.tags,
					product.shortDescription,
					...(Array.isArray(product.variantHints) ? product.variantHints : [])
				].filter(Boolean).join(' '))
			);
			const isExcluded =
				product.isExcluded ||
				product.containsExcludedKeyword ||
				productContainsExcludedKeyword(product, excludedKeywords);

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
				if (product.isExactOfferMatch || offerType === requestedOfferType) score += 44;
				else if (requestedAction === 'ASK_OFFER') score -= 32;
				else score -= 10;
			} else if (requestedAction === 'ASK_OFFER') {
				if (offerType === '3x1') score += 20;
				if (offerType === '5x2') score += 16;
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

			if (
				requestedOfferType === '3x1' &&
				productFamily === 'body_modelador' &&
				/\btotal white\b/.test(name) &&
				!explicitTotalWhite
			) {
				score -= 90;
			}

			if (asksBoobTape) {
				score += mentionsBoobTape ? 42 : -28;
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

function buildOfferLabel(product = {}) {
	const fallbackPrice = product.price ? ` (${product.price})` : '';
	if (product.offerType === '5x2') return `5x2${fallbackPrice}`;
	if (product.offerType === '3x1') return `3x1${fallbackPrice}`;
	if (product.offerType === '2x1') return `2x1${fallbackPrice}`;
	if (product.offerType === 'pack') return `${product.name}${fallbackPrice}`;
	return `${product.name}${fallbackPrice}`;
}

function mapOfferOption(item = {}) {
	return {
		name: item.name,
		price: item.price || null,
		label: buildOfferLabel(item),
		offerType: item.offerType || 'single',
		productUrl: item.productUrl || null
	};
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
		offerLabel: buildOfferLabel(chosen),
		family: chosen.family || family || null,
		offerType: chosen.offerType || 'single'
	};
}

function buildOfferCandidates(products = [], family = null, requestedOfferType = null) {
	const pool = family ? products.filter((product) => product.family === family) : products;
	const hasRequestedMatches =
		requestedOfferType && pool.some((item) => item.offerType === requestedOfferType);
	const prioritized = hasRequestedMatches
		? pool.filter((item) => item.offerType === requestedOfferType)
		: pool;
	const candidates = [];
	const seen = new Set();

	for (const item of prioritized) {
		const option = mapOfferOption(item);
		if (!option.label || seen.has(option.label)) continue;
		seen.add(option.label);
		candidates.push(option);
		if (candidates.length >= 4) break;
	}

	return candidates;
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
	if (!products.length) {
		return { bestOffer: null, requestedOfferAvailable: null, fallbackOffer: null, offerOptions: [] };
	}

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
		chosen =
			eligible.find((item) => item.offerType === '3x1') ||
			eligible.find((item) => item.offerType === '5x2') ||
			eligible.find((item) => item.offerType === '2x1') ||
			eligible[0] ||
			null;
	} else if (
		(requestedAction === 'ASK_LINK' ||
			requestedAction === 'ASK_PRICE' ||
			requestedAction === 'ASK_VARIANT' ||
			requestedAction === 'AFFIRM_CONTINUATION') &&
		lastRecommendedName
	) {
		chosen =
			eligible.find((item) => normalizeText(item.name || '').includes(lastRecommendedName)) ||
			eligible[0] ||
			null;
	} else if ((requestedAction === 'GENERAL' || requestedAction === 'GREETING') && introMode === 'product_first') {
		chosen = eligible.find((item) => (item.offerType || 'single') === 'single') || eligible[0] || null;
	} else {
		chosen = eligible[0] || null;
	}

	const fallbackOffer = !requestedMatches.length && requestedOfferType ? eligible[0] || null : null;
	const offerOptions = buildOfferCandidates(eligible, null, requestedOfferType).slice(0, 3);

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
	if (requestedAction === 'AFFIRM_CONTINUATION' && stage === 'READY_TO_BUY') {
		return !alreadyShared.sharedLinks.includes(bestOffer.productUrl);
	}
	return false;
}

function shouldRepeatPriceNow({ requestedAction, bestOffer, alreadyShared, requestedOfferAvailable }) {
	if (!bestOffer?.price) return false;
	if (requestedOfferAvailable === false) return false;
	if (!['ASK_PRICE', 'ASK_COMPARISON'].includes(requestedAction)) return false;
	return !alreadyShared.shownPrices.includes(`${bestOffer.name}::${bestOffer.price}`);
}

function shouldEscalate({ messageBody = '', mood = 'neutral', currentState = {} }) {
	const text = normalizeText(messageBody);
	if (currentState?.needsHuman) {
		return { shouldEscalate: true, reason: currentState.handoffReason || 'existing_handoff' };
	}
	if (/(quiero hablar con una persona|quiero una asesora|pasame con alguien|atencion humana|humano)/i.test(text)) {
		return { shouldEscalate: true, reason: 'requested_human' };
	}
	if (mood === 'angry') return { shouldEscalate: true, reason: 'angry_customer' };
	return { shouldEscalate: false, reason: null };
}

function buildRecommendedAction({
	stage,
	requestedAction,
	shouldEscalate,
	shareLinkNow,
	repeatPriceNow,
	bestOffer,
	hasKnownProductContext,
	requestedOfferType,
	requestedOfferAvailable,
	hasFallbackWithinFamily,
	offerCandidates = []
}) {
	if (shouldEscalate) return 'handoff_human';
	if (requestedAction === 'GREETING') return 'greet_and_discover';
	if (!hasKnownProductContext) return 'send_general_catalog_first';
	if (requestedAction === 'ASK_CATALOG') {
		return 'send_general_catalog_first';
	}
	if (requestedAction === 'GENERAL' && !bestOffer) {
		return 'send_general_catalog_first';
	}
	if (!bestOffer && requestedAction !== 'ASK_CATALOG') return 'clarify_specific_product';
	if (requestedOfferType && requestedOfferAvailable === false && hasFallbackWithinFamily) {
		return 'explain_requested_offer_unavailable_keep_family';
	}
	if (requestedAction === 'ASK_LINK' && shareLinkNow) return 'close_with_single_link';
	if (requestedAction === 'ASK_PRICE' && repeatPriceNow) return 'present_price_once';
	if (requestedAction === 'ASK_COMPARISON' && offerCandidates.length > 1) return 'present_offer_options_brief';
	if (requestedAction === 'ASK_OFFER' && offerCandidates.length > 1) return 'present_offer_options_brief';
	if (requestedAction === 'ASK_OFFER') return 'present_single_best_offer';
	if (requestedAction === 'ASK_CATALOG' && offerCandidates.length > 1) return 'guide_and_discover';
	if (requestedAction === 'ASK_VARIANT') return 'confirm_variant_and_continue';
	if (requestedAction === 'ASK_PAYMENT') return 'payment_guidance_with_current_offer';
	if (requestedAction === 'AFFIRM_CONTINUATION') return 'continue_current_offer';
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
	const offerCandidates = buildOfferCandidates(rankedProducts, productFamily, requestedOfferType);
	const shareLinkNow = shouldShareLinkNow({ requestedAction, stage, bestOffer, alreadyShared, requestedOfferAvailable });
	const repeatPriceNow = shouldRepeatPriceNow({ requestedAction, bestOffer, alreadyShared, requestedOfferAvailable });
	const escalation = shouldEscalate({ messageBody, mood, currentState });
	const hasKnownProductContext = Boolean(
		productFamily ||
		asArray(currentState?.interestedProducts).length ||
		currentState?.currentProductFocus ||
		currentState?.currentProductFamily ||
		currentState?.lastRecommendedProduct
	);

	const recommendedAction = buildRecommendedAction({
		stage,
		requestedAction,
		shouldEscalate: escalation.shouldEscalate,
		shareLinkNow,
		repeatPriceNow,
		bestOffer,
		hasKnownProductContext,
		requestedOfferType,
		requestedOfferAvailable,
		hasFallbackWithinFamily: Boolean(fallbackOffer),
		offerCandidates
	});

	const productFocus = bestOffer?.name || currentState?.currentProductFocus || productFamilyLabel || null;
	const responseRules = [
		'Si es solo un saludo, responde breve y no ofrezcas productos todavia.',
		'Si el cliente ya fijo una familia de producto, no cambies de familia sin permiso explicito.',
		'Si pidio una promo puntual, primero buscala dentro de la misma familia antes de abrir alternativas.',
		'Si una opcion esta excluida por el cliente, no la vuelvas a ofrecer.',
		'Prioriza una sola opcion principal por respuesta, salvo que te pidan comparar.',
		'Comparti un unico link por respuesta.',
		'Si la oferta exacta no existe, decilo claro y segui dentro de la misma familia.',
		'Baja el entusiasmo; sona mas humana y directa.'
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
		offerCandidates,
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
