import {
	getCommercialProfile,
	getFamilyLabel,
	getPreferredOfferOrder,
	inferCommercialFamily,
	scoreProductAgainstCommercialProfile
} from '../data/catalog-commercial-map.js';

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
	const greetingOnly =
		/^(hola|holi|buenas|buen dia|buen día|buenas tardes|buenas noches|hello|hi|👋)+[!.,\s]*$/i.test(
			text
		);
	const hasProductContext =
		Boolean(currentState?.currentProductFocus) || asArray(currentState?.interestedProducts).length > 0;
	return greetingOnly && !hasProductContext;
}

function detectMood(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (
		/(horrible|malisimo|malisima|desastre|pesimo|p[eé]simo|me cans[eé]|no responden|nadie responde|quiero una persona|quiero hablar con alguien|me tienen harta|me tienen podrida)/i.test(
			text
		)
	) {
		return 'angry';
	}
	if (/(urgente|ya|ahora|hoy|cuanto antes)/i.test(text)) return 'urgent';
	if (/(quiero|me interesa|pasame|mandame|lo compro|me sirve|me gust[oó]|si\b)/i.test(text))
		return 'interested';
	return currentState?.customerMood || 'neutral';
}

function detectBuyingIntent(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);
	if (/(lo quiero|lo compro|pasame el link|mandame el link|como compro|como pago|gu[ií]ame|quiero comprar)/i.test(text))
		return 'high';
	if (/(precio|cuanto|cu[aá]nto|sale|valor|ten[eé]s|tienen|talle|color|oferta|promo)/i.test(text))
		return 'medium';
	return currentState?.buyingIntentLevel || 'low';
}

function detectSalesStage({ intent, messageBody, currentState = {}, greetingOnly = false }) {
	const text = normalizeText(messageBody);
	if (greetingOnly) return 'DISCOVERY';
	if (currentState?.needsHuman) return 'NEEDS_HUMAN';
	if (/(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text) && /(oferta|promo|pack|combo|2x1|3x1)/i.test(text))
		return 'PRICE_OFFER_EVALUATION';
	if (/(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text)) return 'PRICE_EVALUATION';
	if (/(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(text)) return 'OFFER_DISCOVERY';
	if (/(talle|medida|size|xl|xxl|xxxl|m\/l|l\/xl|xl\/xxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text))
		return 'SIZE_COLOR_CHECK';
	if (/(quiero|lo quiero|me lo llevo|como compro|pasame el link|mandame el link|gu[ií]ame)/i.test(text))
		return 'READY_TO_BUY';
	if (intent === 'product') return 'PRODUCT_INTEREST';
	return currentState?.salesStage || 'DISCOVERY';
}

function detectRequestedAction(messageBody = '', greetingOnly = false) {
	const text = normalizeText(messageBody);
	if (greetingOnly) return 'GREETING';

	const asksLink = /(pasame|mandame|enviame).*(link|url)|\b(link|url|web|tienda|comprar)\b/i.test(text);
	const asksPrice = /(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text);
	const asksOffer = /(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(text);
	const asksVariant =
		/(talle|medida|size|xl|xxl|xxxl|m\/l|l\/xl|xl\/xxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(
			text
		);

	if (asksLink) return 'ASK_LINK';
	if (asksPrice && asksOffer) return 'ASK_PRICE_AND_OFFER';
	if (asksPrice) return 'ASK_PRICE';
	if (asksOffer) return 'ASK_OFFER';
	if (asksVariant) return 'ASK_VARIANT';
	if (/^si$/i.test(text) || /^(sí)$/i.test(text)) return 'AFFIRM_CONTINUATION';
	if (/(transferencia|alias|pago|cuotas)/i.test(text)) return 'ASK_PAYMENT';
	return 'GENERAL';
}

function extractRequestedColors(text = '') {
	const matches = normalizeText(text).match(
		/\b(negro|blanco|beige|nude|rosa|gris|azul|verde|bordo|marron|marrón|avellana)\b/g
	);
	return [...new Set(matches || [])];
}

function extractRequestedSizes(text = '', currentState = {}) {
	const normalized = normalizeText(text);
	const results = [];

	const patterns = [
		/\b(xxxl|3xl)\b/g,
		/\b(xxl|2xl)\b/g,
		/\b(xl)\b/g,
		/\b(l\/xl)\b/g,
		/\b(xl\/xxl)\b/g,
		/\b(m\/l)\b/g,
		/\b(s\/m)\b/g,
		/\b110\b/g
	];

	for (const pattern of patterns) {
		const matches = normalized.match(pattern);
		if (matches?.length) results.push(...matches);
	}

	if (!results.length && currentState?.frequentSize) {
		results.push(String(currentState.frequentSize));
	}

	return [...new Set(results.map((item) => item.toUpperCase()))];
}

function inferRequestedFamilyFromHistory({ messageBody = '', currentState = {}, recentMessages = [], products = [] }) {
	const explicitFamily = inferCommercialFamily(messageBody);
	if (explicitFamily) return { family: explicitFamily, explicitSwitch: true };

	const userRecentText = recentMessages
		.filter((msg) => msg.role === 'user')
		.slice(-6)
		.map((msg) => String(msg.text || ''))
		.reverse()
		.find(Boolean);

	const currentFocusFamily = inferCommercialFamily(currentState?.currentProductFocus || '');
	if (currentFocusFamily) return { family: currentFocusFamily, explicitSwitch: false };

	const lastRecommendedFamily = inferCommercialFamily(currentState?.lastRecommendedProduct || '');
	if (lastRecommendedFamily) return { family: lastRecommendedFamily, explicitSwitch: false };

	if (products[0]?.family) return { family: products[0].family, explicitSwitch: false };

	const firstInterest = asArray(currentState?.interestedProducts)[0] || '';
	const interestFamily = inferCommercialFamily(firstInterest);
	if (interestFamily) return { family: interestFamily, explicitSwitch: false };

	if (userRecentText) {
		const recentFamily = inferCommercialFamily(userRecentText);
		if (recentFamily) return { family: recentFamily, explicitSwitch: false };
	}

	return { family: null, explicitSwitch: false };
}

function collectVariantPreferences({ messageBody = '', recentMessages = [], currentState = {} }) {
	const recentUserMessages = recentMessages
		.filter((msg) => msg.role === 'user')
		.slice(-6)
		.map((msg) => String(msg.text || ''));

	const allUserText = [...recentUserMessages, messageBody].join(' ');
	const requestedColors = extractRequestedColors(allUserText);
	const requestedSizes = extractRequestedSizes(allUserText, currentState);

	return {
		requestedColors,
		requestedSizes
	};
}

function inferOfferKey(product = {}) {
	if (!product) return null;
	if (product.offerType === '3x1') return '3x1';
	if (product.offerType === '2x1') return '2x1';
	if (product.offerType === 'pack') return 'pack';
	return 'single';
}

function productVariantCompatibility(product = {}, { requestedColors = [], requestedSizes = [] } = {}) {
	const haystack = normalizeText(
		[
			product.name,
			...(Array.isArray(product.variantHints) ? product.variantHints : []),
			...(Array.isArray(product.colors) ? product.colors : []),
			...(Array.isArray(product.sizes) ? product.sizes : [])
		]
			.filter(Boolean)
			.join(' ')
	);

	const explicitColorData = asArray(product.colors).length > 0;
	const explicitSizeData = asArray(product.sizes).length > 0;

	let score = 0;
	let missingHardMatch = false;

	for (const color of requestedColors) {
		const normalizedColor = normalizeText(color);
		if (haystack.includes(normalizedColor)) score += 22;
		else if (explicitColorData) {
			score -= 28;
			missingHardMatch = true;
		}
		if (normalizedColor !== 'blanco' && /total white|white\b/.test(normalizeText(product.name || ''))) {
			score -= 18;
		}
	}

	for (const size of requestedSizes) {
		const normalizedSize = normalizeText(size);
		if (haystack.includes(normalizedSize)) score += 22;
		else if (explicitSizeData) {
			score -= 32;
			missingHardMatch = true;
		}
	}

	return {
		score,
		missingHardMatch
	};
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
		if (joined.includes(String(product.name || '').toLowerCase())) {
			fromRecent.shownOffers.push(product.offerKey || inferOfferKey(product));
		}
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
		familyLocked = false,
		requestedColors = [],
		requestedSizes = []
	} = {}
) {
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
			const variantCompatibility = productVariantCompatibility(product, {
				requestedColors,
				requestedSizes
			});

			if (productFamily && family && productFamily === family) score += 42;
			if (familyLocked && productFamily && family && productFamily !== family) score -= 180;
			if (product.hasDiscount) score += requestedAction === 'ASK_OFFER' ? 22 : 8;
			if (product.priceValue != null) score += 6;
			if (product.productUrl) score += 2;
			if (currentFocus && name.includes(currentFocus)) score += 16;
			if (interests.some((term) => term && name.includes(term))) score += 8;
			score += scoreProductAgainstCommercialProfile(product, family);
			score += variantCompatibility.score;

			if (
				(requestedAction === 'ASK_LINK' ||
					requestedAction === 'ASK_PRICE' ||
					requestedAction === 'ASK_VARIANT') &&
				offerType === 'single'
			) {
				score += 12;
			}

			if (requestedAction === 'ASK_PRICE_AND_OFFER') {
				if (offerType === 'single') score += 18;
				if (offerType === '3x1') score += 24;
				if (offerType === '2x1') score += 12;
			}

			if (requestedAction === 'ASK_OFFER') {
				if (offerType === '3x1') score += 34;
				if (offerType === '2x1') score += 18;
			}

			if (requestedAction === 'ASK_VARIANT' && variantCompatibility.missingHardMatch) {
				score -= 24;
			}

			if (isGenericDiscovery) {
				if (introMode === 'guided_discovery' && offerType === '3x1') score += 18;
				if (introMode === 'guided_discovery' && offerType === '2x1') score += 4;
				if (introMode === 'product_first' && offerType === 'single') score += 14;
				if (offerType === 'pack' && !/(promo|oferta|2x1|3x1)/i.test(text)) score -= 6;
			}

			return {
				...product,
				offerKey: product.offerKey || inferOfferKey(product),
				commercialScore: score,
				variantMatchScore: variantCompatibility.score
			};
		})
		.sort((a, b) => b.commercialScore - a.commercialScore);
}

function pickPreferredProduct(products = [], offerTypes = []) {
	for (const offerType of offerTypes) {
		const hit = products.find((item) => (item.offerType || 'single') === offerType);
		if (hit) return hit;
	}
	return products[0] || null;
}

function chooseBestOffer(
	products = [],
	{
		requestedAction = 'GENERAL',
		family = null,
		requestedColors = [],
		requestedSizes = []
	} = {}
) {
	if (!products.length) return null;

	const hasVariantFilters = requestedColors.length > 0 || requestedSizes.length > 0;
	let contextKey = 'general';

	if (requestedAction === 'ASK_OFFER') contextKey = 'askOffer';
	else if (requestedAction === 'ASK_PRICE') contextKey = 'askPrice';
	else if (requestedAction === 'ASK_PRICE_AND_OFFER') contextKey = 'askPriceAndOffer';
	else if (requestedAction === 'ASK_VARIANT' || hasVariantFilters) contextKey = 'askVariant';
	else if (requestedAction === 'AFFIRM_CONTINUATION') contextKey = 'readyToBuy';

	const ordered = [...products].sort((a, b) => (b.commercialScore ?? 0) - (a.commercialScore ?? 0));
	const preferredOrder = getPreferredOfferOrder(family, contextKey);
	const chosen = pickPreferredProduct(ordered, preferredOrder);

	return chosen
		? {
				name: chosen.name,
				price: chosen.price || null,
				priceValue: chosen.priceValue ?? null,
				productUrl: chosen.productUrl || null,
				hasDiscount: !!chosen.hasDiscount,
				colors: chosen.colors || [],
				sizes: chosen.sizes || [],
				offerKey: chosen.offerKey || inferOfferKey(chosen),
				family: chosen.family || family || null,
				offerType: chosen.offerType || 'single'
			}
		: null;
}

function chooseComparisonSet(products = [], family = null) {
	if (!products.length) return null;
	const ordered = [...products].sort((a, b) => (b.commercialScore ?? 0) - (a.commercialScore ?? 0));
	const single = ordered.find((item) => (item.offerType || 'single') === 'single') || null;

	const profileOrder = getPreferredOfferOrder(family, 'askOffer');
	const offer = pickPreferredProduct(
		ordered.filter((item) => (item.offerType || 'single') !== 'single'),
		profileOrder.filter((item) => item !== 'single')
	);

	if (!single && !offer) return null;

	return {
		single: single
			? {
					name: single.name,
					price: single.price,
					productUrl: single.productUrl || null,
					offerType: single.offerType || 'single'
				}
			: null,
		offer: offer
			? {
					name: offer.name,
					price: offer.price,
					productUrl: offer.productUrl || null,
					offerType: offer.offerType || 'single'
				}
			: null
	};
}

function shouldShareLinkNow({ requestedAction, stage, bestOffer, alreadyShared }) {
	if (!bestOffer?.productUrl) return false;
	if (requestedAction === 'ASK_LINK') return true;
	if (requestedAction === 'AFFIRM_CONTINUATION' && stage === 'READY_TO_BUY') {
		return !alreadyShared.sharedLinks.includes(bestOffer.productUrl);
	}
	return false;
}

function shouldRepeatPriceNow({ requestedAction, bestOffer, alreadyShared }) {
	if (!bestOffer?.price) return false;
	if (!['ASK_PRICE', 'ASK_PRICE_AND_OFFER'].includes(requestedAction)) return false;
	return !alreadyShared.shownPrices.includes(`${bestOffer.name}::${bestOffer.price}`);
}

function shouldEscalate({ messageBody = '', mood = 'neutral', currentState = {} }) {
	const text = normalizeText(messageBody);
	if (currentState?.needsHuman) {
		return { shouldEscalate: true, reason: currentState.handoffReason || 'existing_handoff' };
	}
	if (
		/(quiero hablar con una persona|quiero una asesora|pasame con alguien|atencion humana|atención humana|humano)/i.test(
			text
		)
	) {
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
	greetingOnly,
	family = null
}) {
	if (shouldEscalate) return 'handoff_human';
	if (greetingOnly) return 'greet_and_discover';
	if (requestedAction === 'ASK_LINK' && shareLinkNow) return 'close_with_single_link';
	if (requestedAction === 'ASK_PRICE_AND_OFFER') return 'compare_single_vs_best_offer';
	if (requestedAction === 'ASK_PRICE' && repeatPriceNow) return 'present_price_once';
	if (requestedAction === 'ASK_OFFER') return 'present_single_best_offer';
	if (requestedAction === 'ASK_VARIANT') return 'confirm_variant_and_continue';
	if (requestedAction === 'ASK_PAYMENT') return 'payment_guidance_with_current_offer';
	if (requestedAction === 'AFFIRM_CONTINUATION') return 'continue_current_offer';
	if (stage === 'READY_TO_BUY') return 'close_sale';
	if (stage === 'PRODUCT_INTEREST' && family === 'body_modelador') return 'discover_family_before_offer';
	return 'answer_and_guide';
}

function findProductFocus({
	currentState = {},
	products = [],
	requestedAction = 'GENERAL',
	family = null,
	bestOffer = null
}) {
	if (bestOffer?.name) return bestOffer.name;
	if (
		currentState?.currentProductFocus &&
		inferCommercialFamily(currentState.currentProductFocus) === family
	) {
		return currentState.currentProductFocus;
	}
	if (requestedAction === 'GENERAL' && family) return getFamilyLabel(family);
	if (products[0]?.name) return products[0].name;
	return currentState?.currentProductFocus || getFamilyLabel(family);
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
	const familyFromHistory = inferRequestedFamilyFromHistory({
		messageBody,
		currentState,
		recentMessages,
		products: catalogProducts
	});
	const productFamily = familyFromHistory.family;
	const familyLocked = Boolean(productFamily && !familyFromHistory.explicitSwitch);
	const { requestedColors, requestedSizes } = collectVariantPreferences({
		messageBody,
		recentMessages,
		currentState
	});

	const rankedProducts = greetingOnly
		? []
		: rankCommercialProducts(catalogProducts, {
				messageBody,
				currentState,
				requestedAction,
				family: productFamily,
				familyLocked,
				requestedColors,
				requestedSizes
			});

	const mood = detectMood(messageBody, currentState);
	const buyingIntentLevel = greetingOnly ? 'low' : detectBuyingIntent(messageBody, currentState);
	const stage = detectSalesStage({ intent, messageBody, currentState, greetingOnly });
	const alreadyShared = mergeHistorySignals({
		recentMessages,
		currentState,
		products: rankedProducts
	});
	const bestOffer = greetingOnly
		? null
		: chooseBestOffer(rankedProducts, {
				requestedAction,
				family: productFamily,
				requestedColors,
				requestedSizes
			});
	const comparisonSet =
		requestedAction === 'ASK_PRICE_AND_OFFER'
			? chooseComparisonSet(rankedProducts, productFamily)
			: null;
	const shareLinkNow = shouldShareLinkNow({
		requestedAction,
		stage,
		bestOffer,
		alreadyShared
	});
	const repeatPriceNow = shouldRepeatPriceNow({
		requestedAction,
		bestOffer,
		alreadyShared
	});
	const escalation = shouldEscalate({ messageBody, mood, currentState });
	const recommendedAction = buildRecommendedAction({
		stage,
		requestedAction,
		shouldEscalate: escalation.shouldEscalate,
		shareLinkNow,
		repeatPriceNow,
		greetingOnly,
		family: productFamily
	});
	const productFocus = greetingOnly
		? null
		: findProductFocus({
				currentState,
				products: rankedProducts,
				requestedAction,
				family: productFamily,
				bestOffer
			});

	const responseRules = [
		'Si es solo un saludo, respondé breve y no ofrezcas productos todavía.',
		'No repitas saludo ni nombre del cliente si la conversación ya empezó.',
		'No salgas de la familia actual salvo que la clienta cambie de producto de forma explícita.',
		'No abras varias promos si no te pidieron comparar.',
		'Priorizá una sola oferta principal por familia.',
		'No compartas más de un link por respuesta.',
		'Si la conversación cambió de producto, el link y el foco tienen que seguir el producto más reciente.',
		'Si ya se dijo el precio, no lo repitas salvo pedido explícito.',
		'No confirmes talle o color si el producto foco no lo soporta o no está confirmado.',
		'Bajá el entusiasmo; soná más humana y directa.'
	];

	return {
		stage,
		mood,
		buyingIntentLevel,
		requestedAction,
		productFocus,
		productFamily,
		familyLocked,
		rankedProducts,
		bestOffer,
		comparisonSet,
		alreadyShared,
		shareLinkNow,
		repeatPriceNow,
		requestedColors,
		requestedSizes,
		shouldEscalate: escalation.shouldEscalate,
		handoffReason: escalation.reason,
		recommendedAction,
		responseRules,
		greetingOnly
	};
}
