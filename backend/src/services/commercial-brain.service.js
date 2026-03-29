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

	if (/(precio|cuanto|cu[aá]nto|sale|valor|ten[eé]s|tienen|talle|color|oferta|promo|link)/i.test(text)) {
		return 'medium';
	}

	return currentState?.buyingIntentLevel || 'low';
}

function detectRequestedVariant(messageBody = '', products = []) {
	const text = normalizeText(messageBody);
	const color = (text.match(/\b(negro|blanco|beige|nude|rosa|gris|azul|verde|bordo|marron|avellana)\b/) || [])[1] || null;
	const size = (text.match(/\b(xs|s|m|l|xl|xxl|xxxl|m\/l|l\/xl|xl\/xxl)\b/) || [])[1] || null;

	const resolvedColor = color || products.flatMap((p) => asArray(p.colors)).find((value) => text.includes(normalizeText(value))) || null;
	const resolvedSize = size || products.flatMap((p) => asArray(p.sizes)).find((value) => text.includes(normalizeText(value))) || null;

	return {
		color: resolvedColor,
		size: resolvedSize
	};
}

function detectSalesStage({ intent, messageBody, currentState = {} }) {
	const text = normalizeText(messageBody);

	if (currentState?.needsHuman) return 'NEEDS_HUMAN';
	if (/(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text)) return 'PRICE_EVALUATION';
	if (/(oferta|promo|promocion|promoción|pack|combo|2x1|3x1|que opciones|qué opciones|alguna promo)/i.test(text)) return 'OFFER_DISCOVERY';
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

	if (/(body|bodies|body modelador)/.test(text)) return 'body modelador';
	if (/(short|short faja)/.test(text)) return 'short/faja';
	if (/(bombacha|colaless)/.test(text)) return 'bombacha modeladora';
	if (/(faja|reductora|reductor)/.test(text)) return 'faja reductora';

	const byFamily = products.find((product) => product.family && product.family !== 'general');
	if (byFamily?.family === 'body_modelador') return 'body modelador';
	if (byFamily?.family === 'short_faja') return 'short/faja';
	if (byFamily?.family === 'bombacha_modeladora') return 'bombacha modeladora';
	if (byFamily?.family === 'faja') return 'faja reductora';

	if (currentState?.currentProductFocus) return currentState.currentProductFocus;
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

		if (product.offerType && joined.includes(String(product.offerLabel || '').toLowerCase())) {
			fromRecent.shownOffers.push(product.offerLabel);
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
	const asksPromo = /(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(text);
	const specificColor = /(negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text);
	const specificSize = /(xs|s|m|l|xl|xxl|xxxl|m\/l|l\/xl|xl\/xxl)/i.test(text);

	return [...products]
		.map((product) => {
			let score = Number(product.score || 0);
			const name = normalizeText(product.name || '');

			if (product.priceValue != null) score += 8;
			if (product.productUrl) score += 2;

			if (currentFocus && name.includes(currentFocus)) {
				score += 18;
			}

			if (interests.some((term) => term && name.includes(term))) {
				score += 10;
			}

			if (asksPromo) {
				if (product.hasDiscount) score += 14;
				if (product.offerType === 'pack_3x1') score += 12;
				if (product.offerType === 'pack_2x1') score += 8;
			} else {
				if (product.offerType === 'single') score += 12;
				if (product.offerType?.startsWith('pack')) score -= 10;
			}

			if (specificColor && !(product.colors || []).length) score -= 6;
			if (specificSize && !(product.sizes || []).length) score -= 6;

			return { ...product, commercialScore: score };
		})
		.sort((a, b) => b.commercialScore - a.commercialScore);
}

function chooseBestOffer(products = [], context = {}) {
	if (!products.length) return null;

	const ordered = [...products].sort((a, b) => {
		if ((a.commercialScore ?? 0) !== (b.commercialScore ?? 0)) {
			return (b.commercialScore ?? 0) - (a.commercialScore ?? 0);
		}
		if ((a.priceValue ?? Infinity) !== (b.priceValue ?? Infinity)) {
			return (a.priceValue ?? Infinity) - (b.priceValue ?? Infinity);
		}
		return 0;
	});

	const chosen = ordered[0];
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

function buildOfferOptions(products = [], productFocus = null) {
	const byKey = new Map();

	for (const product of products) {
		const key = `${product.family || 'general'}::${product.offerType || 'single'}`;
		if (byKey.has(key)) continue;

		let label = 'opción individual';
		if (product.offerType === 'pack_3x1') label = 'promo 3x1';
		else if (product.offerType === 'pack_2x1') label = 'promo 2x1';
		else if (product.offerType === 'pack') label = 'pack';

		byKey.set(key, {
			label,
			productName: product.name,
			price: product.price || null,
			productUrl: product.productUrl || null,
			family: product.family || null
		});
		if (byKey.size >= 3) break;
	}

	const options = [...byKey.values()];
	if (productFocus && !options.length) {
		return [{ label: 'opción del producto consultado', productName: productFocus, price: null, productUrl: null }];
	}
	return options;
}

function detectRequestedAction(messageBody = '') {
	const text = normalizeText(messageBody);

	if (/(pasame|mandame|enviame).*(link|url)|\b(link|url|comprar)\b/i.test(text)) {
		return 'ASK_LINK';
	}

	if (/(catalogo|catálogo|pagina|página|web|ver opciones|mirar opciones|ver la web|ver la pagina)/i.test(text)) {
		return 'ASK_CATALOG';
	}

	if (/(precio|cuanto|cu[aá]nto|sale|valor)/i.test(text)) {
		return 'ASK_PRICE';
	}

	if (/(oferta|promo|promocion|promoción|pack|combo|2x1|3x1|alguna promo mas|alguna promo más|que opciones|qué opciones|otras opciones)/i.test(text)) {
		return 'ASK_OFFER';
	}

	if (/(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(text)) {
		return 'ASK_VARIANT';
	}

	if (/^si$/i.test(text) || /^(sí)$/i.test(text)) {
		return 'AFFIRM_CONTINUATION';
	}

	if (/(transferencia|alias|pago|cuotas|comprobante)/i.test(text)) {
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

function buildRecommendedAction({ stage, requestedAction, shouldEscalate, shareLinkNow, repeatPriceNow, buyingIntentLevel, requestedVariant }) {
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
	const requestedVariant = detectRequestedVariant(messageBody, rankedProducts);
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

	const bestOffer = chooseBestOffer(rankedProducts, { requestedVariant });
	const offerOptions = buildOfferOptions(rankedProducts, productFocus);
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
		buyingIntentLevel,
		requestedVariant
	});

	return {
		mood,
		buyingIntentLevel,
		stage,
		requestedAction,
		requestedVariant,
		productFocus,
		bestOffer,
		offerOptions,
		shareLinkNow,
		repeatPriceNow,
		recommendedAction,
		shouldEscalate: escalation.shouldEscalate,
		handoffReason: escalation.reason,
		alreadyShared,
		rankedProducts
	};
}
