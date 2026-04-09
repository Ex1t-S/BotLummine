function normalizeText(value = '') {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
}

function responseMentionsHumanHandoff(text = '') {
	return /(te paso con una asesora|te paso con un asesor|te derivo con una asesora|te derivo con un asesor|lo revisa una asesora|lo revisa un asesor|ya lo toma una persona|te contacta el equipo|atencion humana|atención humana)/i.test(
		String(text || '')
	);
}

function looksLikeInventedTracking(text = '', liveOrderContext = null) {
	const normalized = String(text || '').toLowerCase();

	if (
		!liveOrderContext?.trackingUrl &&
		/seguilo aca|seguirlo aca|pod[eé]s seguirlo acá|pod[eé]s seguirlo aca|link de seguimiento/i.test(normalized)
	) {
		return true;
	}

	if (!liveOrderContext?.trackingNumber && /c[oó]digo de seguimiento|seguimiento:/i.test(normalized)) {
		return true;
	}

	return false;
}

function buildOfferOptionsBrief(commercialPlan = null) {
	if (!commercialPlan?.offerOptions?.length) return '';

	return commercialPlan.offerOptions
		.slice(0, 3)
		.map((option) => `${option.label}${option.price ? ` (${option.price})` : ''}`)
		.join(', ');
}

export function buildAiFailureFallback({
	intent,
	enrichedState,
	catalogProducts = [],
	commercialPlan = null
}) {
	const firstProduct = Array.isArray(catalogProducts) && catalogProducts.length ? catalogProducts[0] : null;

	if (commercialPlan?.shouldEscalate || enrichedState?.needsHuman) {
		return 'Te paso con una asesora para seguir mejor con esto.';
	}

	if (intent === 'product') {
		if (commercialPlan?.recommendedAction === 'present_offer_options_brief' && commercialPlan?.offerOptions?.length) {
			const brief = buildOfferOptionsBrief(commercialPlan);
			return `En este producto solemos tener ${brief}. Si querés, te digo cuál te conviene más.`;
		}

		if (commercialPlan?.recommendedAction === 'guide_and_discover') {
			return 'Tenemos opción individual y también promos. Si querés, te cuento rápido las más elegidas o te paso la web para que las veas.';
		}

		if (commercialPlan?.recommendedAction === 'present_single_best_offer' && commercialPlan?.bestOffer) {
			return `${commercialPlan.bestOffer.name}${commercialPlan.bestOffer.price ? ` por ${commercialPlan.bestOffer.price}` : ''}.`;
		}

		if (commercialPlan?.recommendedAction === 'present_price_once' && commercialPlan?.bestOffer) {
			return `${commercialPlan.bestOffer.name} está ${commercialPlan.bestOffer.price}.`;
		}

		if (commercialPlan?.recommendedAction === 'confirm_variant_and_continue' && commercialPlan?.bestOffer) {
			return `Sí, lo trabajamos en esa opción. Si querés seguimos con ${commercialPlan.bestOffer.name}.`;
		}

		if (commercialPlan?.recommendedAction === 'close_with_single_link' && commercialPlan?.bestOffer?.productUrl) {
			return `Te paso el link de esa opción: ${commercialPlan.bestOffer.productUrl}`;
		}

		if (commercialPlan?.recommendedAction === 'invite_to_catalog_and_offer_help') {
			return 'Podés mirar las opciones en la web y si querés te ayudo a elegir la que más te convenga.';
		}

		return firstProduct?.productUrl
			? 'Si querés, te paso la web y te ayudo a elegir la opción más conveniente.'
			: 'Contame qué producto buscás y te oriento.';
	}

	if (intent === 'payment') {
		return 'Aceptamos transferencia y tarjetas. Si querés, te digo cómo seguir con esa opción.';
	}

	if (intent === 'shipping') {
		return 'Hacemos envíos. Decime tu zona o ciudad y te cuento cómo sería en tu caso.';
	}

	if (intent === 'size_help') {
		return 'Decime qué talle usás normalmente y te oriento con eso.';
	}

	if (intent === 'order_status') {
		return 'Pasame tu número de pedido y te reviso el estado por acá.';
	}

	return 'Contame un poco más y te ayudo por acá.';
}

export function buildResponsePolicy({
	intent,
	enrichedState,
	liveOrderContext,
	queueDecision,
	commercialPlan
}) {
	if (
		queueDecision?.queue === 'HUMAN' ||
		enrichedState?.needsHuman ||
		commercialPlan?.shouldEscalate
	) {
		return {
			action: 'handoff_human',
			useAI: false,
			allowHandoffMention: true,
			maxChars: 220,
			tone: 'empatico_concreto'
		};
	}

	if (intent === 'order_status') {
		if (!liveOrderContext) {
			return {
				action: 'ask_order_number_or_not_found',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 220,
				tone: 'postventa_clara'
			};
		}

		if (liveOrderContext.trackingUrl || liveOrderContext.trackingNumber) {
			return {
				action: 'order_status_with_tracking',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 320,
				tone: 'postventa_clara'
			};
		}

		return {
			action: 'order_status_without_tracking',
			useAI: false,
			allowHandoffMention: false,
			maxChars: 320,
			tone: 'postventa_clara'
		};
	}

	if (intent === 'payment') {
		return {
			action: 'payment_guidance',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo'
		};
	}

	if (intent === 'shipping') {
		return {
			action: 'shipping_guidance',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo'
		};
	}

	if (intent === 'size_help') {
		return {
			action: 'size_help',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo'
		};
	}

	if (intent === 'product') {
		return {
			action: commercialPlan?.recommendedAction || 'product_guidance',
			useAI: true,
			allowHandoffMention: false,
			maxChars:
				commercialPlan?.recommendedAction === 'close_with_single_link'
					? 200
					: commercialPlan?.recommendedAction === 'present_single_best_offer'
						? 180
						: 220,
			tone: commercialPlan?.mood === 'angry' ? 'empatico_concreto' : 'guia_comercial_directa'
		};
	}

	return {
		action: 'general_help',
		useAI: true,
		allowHandoffMention: false,
		maxChars: 220,
		tone: enrichedState?.preferredTone || 'amigable_directo'
	};
}

export function auditAssistantReply({
	text,
	responsePolicy,
	liveOrderContext,
	fallbackReply,
	commercialPlan
}) {
	const cleaned = normalizeText(text);

	if (!cleaned) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false
		};
	}

	if (
		responsePolicy?.action?.startsWith('order_status') &&
		looksLikeInventedTracking(cleaned, liveOrderContext)
	) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false
		};
	}

	if (
		commercialPlan?.shareLinkNow === false &&
		commercialPlan?.alreadyShared?.sharedLinks?.some((link) => cleaned.includes(link))
	) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false
		};
	}

	const triggerHumanHandoff = commercialPlan?.shouldEscalate || responseMentionsHumanHandoff(cleaned);

	return {
		finalText: cleaned,
		triggerHumanHandoff
	};
}
