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

	if (
		/(horrible|malisimo|malisima|desastre|pesimo|p[eé]simo|me cans[eé]|no responden|nadie responde|quiero una persona|quiero hablar con alguien|me tienen harta|me tienen podrida)/i.test(
			text
		)
	) {
		return 'angry';
	}

	if (/(urgente|ya|ahora|hoy|cuanto antes)/i.test(text)) {
		return 'urgent';
	}

	if (/(quiero|me interesa|pasame|mandame|lo compro|me sirve|me gust[oó]|si\b)/i.test(text)) {
		return 'interested';
	}

	return currentState?.customerMood || 'neutral';
}

function detectBuyingIntent(messageBody = '', currentState = {}) {
	const text = normalizeText(messageBody);

	if (
		/(lo quiero|lo compro|pasame el link|mandame el link|como compro|como pago|gu[ií]ame|quiero comprar)/i.test(
			text
		)
	) {
		return 'high';
	}

	if (/(precio|cuanto|cu[aá]nto|sale|valor|ten[eé]s|tienen|talle|color|oferta|promo)/i.test(text)) {
		return 'medium';
	}

	return currentState?.buyingIntentLevel || 'low';
}

function detectSalesStage({ intent, messageBody, currentState = {} }) {
	const text = normalizeText(messageBody);

	if (currentState?.needsHuman) return 'NEEDS_HUMAN';
	if (/(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text)) return 'PRICE_EVALUATION';
	if (/(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(text)) return 'OFFER_DISCOVERY';
	if (/(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text)) {
		return 'SIZE_COLOR_CHECK';
	}
	if (/(quiero|lo quiero|me lo llevo|como compro|pasame el link|mandame el link|gu[ií]ame)/i.test(text)) {
		return 'READY_TO_BUY';
	}
	if (intent === 'product') return 'PRODUCT_INTEREST';

	return currentState?.salesStage || 'DISCOVERY';
}

function findProductFocus({ messageBody, currentState = {}, products = [] }) {
	const text = normalizeText(messageBody);

	const direct = products.find((product) =>
		text.includes(normalizeText(product.name || ''))
	);

	if (direct?.name) return direct.name;

	const directFamily = products.find((product) =>
		product.family && text.includes(normalizeText(product.family))
	);

	if (directFamily?.family) return directFamily.family;
	if (currentState?.currentProductFocus) return currentState.currentProductFocus;
	if (products[0]?.family) return products[0].family;
	if (products[0]?.name) return products[0].name;

	const interested = asArray(currentState?.interestedProducts);
	return interested[0] || null;
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

	const fromRecent = {
		sharedLinks: [],
		shownPrices: [],
		shownOffers: []
	};

	for (const product of products) {
		if (product.productUrl && joined.includes(String(product.productUrl).toLowerCase())) {
			fromRecent.sharedLinks.push(product.productUrl);
		}

		if (product.price && joined.includes(String(product.price).toLowerCase())) {
			fromRecent.shownPrices.push(`${product.name}::${product.price}`);
		}

		if (product.hasDiscount) {
			fromRecent.shownOffers.push(`${product.name}::discount`);
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

function rankCommercialProducts(products = [], { messageBody = '', currentState = {} } = {}) {
	const text = normalizeText(messageBody);
	const currentFocus = normalizeText(currentState?.currentProductFocus || '');
	const interests = asArray(currentState?.interestedProducts).map((v) => normalizeText(v));
	const askingOffer = /(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(text);
	const askingPrice = /(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text);
	const askingLink = /(pasame|mandame|enviame).*(link|url)|(link|url|web|tienda|comprar)/i.test(text);
	const askingVariant = /(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text);
	const genericBodySearch = /(body|modelador|faja|reductor|reductora)/i.test(text);

	return [...products]
		.map((product) => {
			let score = Number(product.score || 0);
			const name = normalizeText(product.name || '');
			const family = normalizeText(product.family || '');

			if (product.priceValue != null) score += 6;
			if (product.productUrl) score += 1;

			if (genericBodySearch && /(body|modelador|faja|reductor|reductora)/i.test(name + ' ' + family)) {
				score += 24;
			}

			if (currentFocus && (name.includes(currentFocus) || family.includes(currentFocus))) {
				score += 28;
			}

			if (interests.some((term) => term && (name.includes(term) || family.includes(term)))) {
				score += 16;
			}

			if (askingVariant && product.variantMatchScore) {
				score += product.variantMatchScore;
			}

			if (askingOffer || askingPrice || askingLink) {
				if (product.hasDiscount) score += 16;
				if (product.packCount >= 3) score += 14;
				else if (product.packCount === 2) score += 8;
			} else {
				if (product.hasDiscount) score += 4;
				if (product.packCount >= 3) score += 2;
				if (product.packCount === 2) score += 1;
			}

			return { ...product, commercialScore: score };
		})
		.sort((a, b) => b.commercialScore - a.commercialScore);
}

function chooseBestOffer(products = [], { requestedAction = 'GENERAL', stage = 'DISCOVERY' } = {}) {
	if (!products.length) return null;

	const shouldCommitOffer = [
		'ASK_OFFER',
		'ASK_PRICE',
		'ASK_LINK',
		'ASK_PAYMENT',
		'AFFIRM_CONTINUATION'
	].includes(requestedAction) || ['PRICE_EVALUATION', 'OFFER_DISCOVERY', 'READY_TO_BUY'].includes(stage);

	if (!shouldCommitOffer) {
		return null;
	}

	const ordered = [...products].sort((a, b) => {
		if ((a.commercialScore ?? 0) !== (b.commercialScore ?? 0)) {
			return (b.commercialScore ?? 0) - (a.commercialScore ?? 0);
		}

		if ((a.packCount ?? 0) !== (b.packCount ?? 0)) {
			return (b.packCount ?? 0) - (a.packCount ?? 0);
		}

		const aDiscount = a.hasDiscount ? 1 : 0;
		const bDiscount = b.hasDiscount ? 1 : 0;
		if (aDiscount !== bDiscount) return bDiscount - aDiscount;

		return (a.priceValue ?? Infinity) - (b.priceValue ?? Infinity);
	});

	const chosen = ordered[0];

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
		offerKey: chosen.hasDiscount ? `${chosen.name}::discount` : chosen.name
	};
}

function detectRequestedAction(messageBody = '') {
	const text = normalizeText(messageBody);

	if (/(pasame|mandame|enviame).*(link|url)|\b(link|url|web|tienda|comprar)\b/i.test(text)) {
		return 'ASK_LINK';
	}

	if (/(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text)) {
		return 'ASK_PRICE';
	}

	if (/(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(text)) {
		return 'ASK_OFFER';
	}

	if (/(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text)) {
		return 'ASK_VARIANT';
	}

	if (/^si$/i.test(text) || /^(sí)$/i.test(text)) {
		return 'AFFIRM_CONTINUATION';
	}

	if (/(transferencia|alias|pago|cuotas)/i.test(text)) {
		return 'ASK_PAYMENT';
	}

	return 'GENERAL';
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
	if (requestedAction !== 'ASK_PRICE') return false;

	return !alreadyShared.shownPrices.includes(`${bestOffer.name}::${bestOffer.price}`);
}

function shouldEscalate({ messageBody = '', mood = 'neutral', currentState = {} }) {
	const text = normalizeText(messageBody);

	if (currentState?.needsHuman) {
		return {
			shouldEscalate: true,
			reason: currentState.handoffReason || 'existing_handoff'
		};
	}

	if (/(quiero hablar con una persona|quiero una asesora|pasame con alguien|atencion humana|atención humana|humano)/i.test(text)) {
		return {
			shouldEscalate: true,
			reason: 'requested_human'
		};
	}

	if (mood === 'angry') {
		return {
			shouldEscalate: true,
			reason: 'angry_customer'
		};
	}

	return {
		shouldEscalate: false,
		reason: null
	};
}

function buildRecommendedAction({ stage, requestedAction, shouldEscalate, shareLinkNow, repeatPriceNow }) {
	if (shouldEscalate) return 'handoff_human';
	if (requestedAction === 'ASK_LINK' && shareLinkNow) return 'close_with_single_link';
	if (requestedAction === 'ASK_PRICE' && repeatPriceNow) return 'present_price_once';
	if (requestedAction === 'ASK_OFFER') return 'present_single_best_offer';
	if (requestedAction === 'GENERAL' && stage === 'PRODUCT_INTEREST') return 'qualify_before_offer';
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
	const rankedProducts = rankCommercialProducts(catalogProducts, {
		messageBody,
		currentState
	});

	const mood = detectMood(messageBody, currentState);
	const buyingIntentLevel = detectBuyingIntent(messageBody, currentState);
	const stage = detectSalesStage({ intent, messageBody, currentState });
	const requestedAction = detectRequestedAction(messageBody);
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

	const bestOffer = chooseBestOffer(rankedProducts, { requestedAction, stage });

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

	const escalation = shouldEscalate({
		messageBody,
		mood,
		currentState
	});

	const recommendedAction = buildRecommendedAction({
		stage,
		requestedAction,
		shouldEscalate: escalation.shouldEscalate,
		shareLinkNow,
		repeatPriceNow
	});

	const responseRules = [
		'No felicites cada acción del cliente.',
		'No abras varias promos si no te pidieron comparar.',
		'Priorizá una sola oferta principal.',
		'No compartas más de un link por respuesta.',
		'Si el cliente ya eligió una promo, seguí solo con esa.',
		'Si preguntan talle o color, respondé como continuidad natural del producto foco.',
		'Si ya se dijo el precio, no lo repitas salvo pedido explícito.',
		'Bajá el entusiasmo; soná más humana y directa.'
	];

	return {
		stage,
		mood,
		buyingIntentLevel,
		requestedAction,
		productFocus,
		rankedProducts,
		bestOffer,
		alreadyShared,
		shareLinkNow,
		repeatPriceNow,
		shouldEscalate: escalation.shouldEscalate,
		handoffReason: escalation.reason,
		recommendedAction,
		responseRules
	};
}