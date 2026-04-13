import {
	handleOrderStatusIntent,
	buildFixedOrderReply,
} from '../intents/order-status.service.js';
import { handlePaymentIntent } from '../intents/payment.service.js';
import { handleShippingIntent } from '../intents/shipping.service.js';
import { handleSizeHelpIntent } from '../intents/size-help.service.js';
import { handleProductRecommendationIntent } from '../intents/product-recommendation.service.js';

export function normalizeText(value = '') {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function summarizeText(value = '', max = 160) {
	const text = normalizeText(value);
	if (!text) return '';
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1).trim()}…`;
}

export function createResetConversationState() {
	return {
		customerName: null,
		lastIntent: null,
		lastDetectedIntent: null,
		lastUserGoal: null,
		lastOrderNumber: null,
		lastOrderId: null,
		preferredTone: null,
		customerMood: null,
		urgencyLevel: null,
		frequentSize: null,
		paymentPreference: null,
		deliveryPreference: null,
		interestedProducts: [],
		objections: [],
		needsHuman: false,
		handoffReason: null,
		interactionCount: 0,
		notes: null,
		currentProductFocus: null,
		currentProductFamily: null,
		requestedOfferType: null,
		excludedProductKeywords: [],
		categoryLocked: false,
		salesStage: null,
		shownOffers: [],
		shownPrices: [],
		sharedLinks: [],
		lastRecommendedProduct: null,
		lastRecommendedOffer: null,
		buyingIntentLevel: null,
		frictionLevel: null,
		commercialSummary: null,
		menuActive: false,
		menuPath: null,
		menuLastSelection: null,
		menuLastPromptAt: null,
	};
}

export function buildConversationSummary({
	intent,
	enrichedState,
	lastUserMessage,
	lastAssistantMessage,
	liveOrderContext,
	commercialPlan = null,
}) {
	const parts = [];

	if (enrichedState?.lastUserGoal) {
		parts.push(`Objetivo: ${enrichedState.lastUserGoal}`);
	}

	if (enrichedState?.menuPath) {
		parts.push(`Menú: ${enrichedState.menuPath}`);
	}

	if (enrichedState?.menuLastSelection) {
		parts.push(`Selección: ${enrichedState.menuLastSelection}`);
	}

	if (enrichedState?.interestedProducts?.length) {
		parts.push(`Interés: ${enrichedState.interestedProducts.join(', ')}`);
	}

	if (enrichedState?.currentProductFamily) {
		parts.push(`Familia: ${enrichedState.currentProductFamily}`);
	}

	if (commercialPlan?.productFocus) {
		parts.push(`Foco: ${commercialPlan.productFocus}`);
	}

	if (enrichedState?.requestedOfferType) {
		parts.push(`Promo pedida: ${enrichedState.requestedOfferType}`);
	}

	if (enrichedState?.excludedProductKeywords?.length) {
		parts.push(`Excluir: ${enrichedState.excludedProductKeywords.join(', ')}`);
	}

	if (commercialPlan?.bestOffer?.name) {
		parts.push(`Oferta: ${commercialPlan.bestOffer.name}`);
	}

	if (enrichedState?.frequentSize) {
		parts.push(`Talle: ${enrichedState.frequentSize}`);
	}

	if (enrichedState?.paymentPreference) {
		parts.push(`Pago: ${enrichedState.paymentPreference}`);
	}

	if (enrichedState?.deliveryPreference) {
		parts.push(`Entrega: ${enrichedState.deliveryPreference}`);
	}

	if (intent === 'order_status' && liveOrderContext) {
		parts.push(`Pedido #${liveOrderContext.orderNumber}`);
		parts.push(`Pago ${liveOrderContext.paymentStatus}`);
		parts.push(`Envío ${liveOrderContext.shippingStatus}`);
		if (liveOrderContext.shippingCarrier) {
			parts.push(`Carrier ${liveOrderContext.shippingCarrier}`);
		}
	}

	if (enrichedState?.needsHuman || commercialPlan?.shouldEscalate) {
		parts.push(
			`Derivar: ${
				enrichedState.handoffReason || commercialPlan?.handoffReason || 'sí'
			}`
		);
	}

	if (lastUserMessage) {
		parts.push(`Último cliente: ${summarizeText(lastUserMessage, 120)}`);
	}

	if (lastAssistantMessage) {
		parts.push(`Última respuesta: ${summarizeText(lastAssistantMessage, 120)}`);
	}

	return parts.filter(Boolean).join(' | ');
}

export function buildAiFailureFallback({
	intent,
	enrichedState,
	catalogProducts = [],
	commercialPlan = null,
}) {
	const firstProduct =
		Array.isArray(catalogProducts) && catalogProducts.length ? catalogProducts[0] : null;

	if (commercialPlan?.shouldEscalate || enrichedState?.needsHuman) {
		return 'Te paso con una asesora para seguir mejor con esto.';
	}

	if (intent === 'product' && commercialPlan?.catalogAvailable === false) {
		const familyLabel =
			commercialPlan?.productFamilyLabel ||
			commercialPlan?.productFamily ||
			enrichedState?.currentProductFocus ||
			enrichedState?.currentProductFamily ||
			'ese producto';
		return `Ahora no estoy viendo el catálogo actualizado de ${familyLabel}, así que no te quiero inventar una promo o un link equivocado. Si querés, decime color o talle, o te paso con una asesora.`;
	}

	if (intent === 'product') {
		if (
			commercialPlan?.recommendedAction === 'explain_requested_offer_unavailable_keep_family' &&
			commercialPlan?.requestedOfferType
		) {
			const familyLabel =
				commercialPlan?.productFamilyLabel ||
				commercialPlan?.productFamily ||
				enrichedState?.currentProductFamily ||
				'esa familia';
			const fallbackLabel =
				commercialPlan?.fallbackOffer?.offerLabel ||
				commercialPlan?.fallbackOffer?.name ||
				null;

			return fallbackLabel
				? `No estoy viendo una ${commercialPlan.requestedOfferType} exacta dentro de ${familyLabel}. Lo más parecido que sí tengo confirmado es ${fallbackLabel}.`
				: `No estoy viendo una ${commercialPlan.requestedOfferType} exacta confirmada dentro de ${familyLabel}. Si querés, te muestro la alternativa más cercana sin salir de esa familia.`;
		}

		if (
			commercialPlan?.recommendedAction === 'present_offer_options_brief' &&
			commercialPlan?.offerOptions?.length
		) {
			const brief = commercialPlan.offerOptions
				.slice(0, 3)
				.map((option) => option.label || `${option.name}${option.price ? ` (${option.price})` : ''}`)
				.join(', ');
			return `En este producto solemos tener ${brief}. Si querés, te digo cuál te conviene más.`;
		}

		if (commercialPlan?.recommendedAction === 'guide_and_discover') {
			return 'Tenemos opción individual y también promos. Si querés, te cuento rápido las más elegidas o te paso la web para que las veas.';
		}

		if (commercialPlan?.recommendedAction === 'clarify_specific_product') {
			const familyLabel =
				commercialPlan?.productFamilyLabel ||
				commercialPlan?.productFamily ||
				enrichedState?.currentProductFamily ||
				'ese producto';
			return `No quiero confundirte con una opcion que no sea. Decime el nombre exacto o pasame el link del producto de ${familyLabel} y lo reviso puntual.`;
		}

		if (
			commercialPlan?.recommendedAction === 'present_single_best_offer' &&
			commercialPlan?.bestOffer
		) {
			return `${commercialPlan.bestOffer.name}${
				commercialPlan.bestOffer.price ? ` por ${commercialPlan.bestOffer.price}` : ''
			}.`;
		}

		if (
			commercialPlan?.recommendedAction === 'present_price_once' &&
			commercialPlan?.bestOffer
		) {
			return `${commercialPlan.bestOffer.name} está ${commercialPlan.bestOffer.price}.`;
		}

		if (
			commercialPlan?.recommendedAction === 'confirm_variant_and_continue' &&
			commercialPlan?.bestOffer
		) {
			return `Sí, lo trabajamos en esa opción. Si querés seguimos con ${commercialPlan.bestOffer.name}.`;
		}

		if (
			commercialPlan?.recommendedAction === 'close_with_single_link' &&
			commercialPlan?.bestOffer?.productUrl
		) {
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
	aiGuidance,
	liveOrderContext,
	queueDecision,
	commercialPlan,
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
			tone: 'empatico_concreto',
		};
	}

	if (intent === 'order_status') {
		if (!liveOrderContext) {
			return {
				action: 'ask_order_number_or_not_found',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 220,
				tone: 'postventa_clara',
			};
		}

		if (liveOrderContext.trackingUrl || liveOrderContext.trackingNumber) {
			return {
				action: 'order_status_with_tracking',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 320,
				tone: 'postventa_clara',
			};
		}

		return {
			action: 'order_status_without_tracking',
			useAI: false,
			allowHandoffMention: false,
			maxChars: 320,
			tone: 'postventa_clara',
		};
	}

	if (intent === 'payment') {
		return {
			action: 'payment_guidance',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo',
		};
	}

	if (intent === 'shipping') {
		return {
			action: 'shipping_guidance',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo',
		};
	}

	if (intent === 'size_help') {
		return {
			action: 'size_help',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo',
		};
	}

	if (intent === 'product') {
		if (commercialPlan?.catalogAvailable === false) {
			return {
				action: 'product_catalog_unavailable',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 260,
				tone: 'amigable_directo',
			};
		}

		return {
			action: commercialPlan?.recommendedAction || 'product_guidance',
			useAI: commercialPlan?.recommendedAction !== 'clarify_specific_product',
			allowHandoffMention: false,
			maxChars:
				commercialPlan?.recommendedAction === 'close_with_single_link'
					? 200
					: commercialPlan?.recommendedAction === 'present_offer_options_brief'
						? 240
						: commercialPlan?.recommendedAction === 'guide_and_discover' ||
						  commercialPlan?.recommendedAction === 'invite_to_catalog_and_offer_help'
							? 230
							: commercialPlan?.recommendedAction === 'present_single_best_offer'
								? 180
								: 220,
			tone:
				commercialPlan?.mood === 'angry'
					? 'empatico_concreto'
					: 'guia_comercial_directa',
		};
	}

	return {
		action: 'general_help',
		useAI: true,
		allowHandoffMention: false,
		maxChars: 220,
		tone: enrichedState?.preferredTone || 'amigable_directo',
	};
}

export function stripRepeatedGreeting(text = '', recentMessages = [], contactName = '', preserveGreeting = false) {
	if (preserveGreeting) return text;
	const assistantCount = recentMessages.filter((msg) => msg.role === 'assistant').length;
	if (assistantCount === 0) return text;

	let next = String(text || '').trim();
	const name = String(contactName || '').trim();
	const escapedName = name ? name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
	const patterns = [
		/^(?:¡)?(?:hola|buenas|buen dia|buen día|buenas tardes|buenas noches)(?:[,!\s-]+(?:soy\s+sofi\s+de\s+lummine|sofi\s+de\s+lummine))?[,:!\s-]*/i,
		escapedName
			? new RegExp(
					`^(?:¡)?(?:hola|buenas|buen dia|buen día|buenas tardes|buenas noches)[,\\s-]+${escapedName}[,:!?\\s-]*`,
					'i'
			  )
			: null,
		escapedName ? new RegExp(`^${escapedName}[,:!?\\s-]*`, 'i') : null,
		/^soy\s+sofi\s+de\s+lummine[,:!\s-]*/i,
	].filter(Boolean);

	let changed = true;
	let safety = 0;
	while (changed && safety < 6) {
		changed = false;
		safety += 1;
		for (const pattern of patterns) {
			if (pattern.test(next)) {
				next = next.replace(pattern, '').trim();
				changed = true;
			}
		}
	}

	return next || text;
}

function ensureGeneralPresentation(text = '', { preserveGreeting = false, businessName = 'Lummine', agentName = 'Sofi' } = {}) {
	if (!preserveGreeting) return text;

	const normalized = normalizeText(text);
	if (!normalized) {
		return `Hola, soy ${agentName} de ${businessName}.`;
	}

	if (/soy\s+sofi\s+de\s+lummine/i.test(normalized)) return normalized;

	const withoutLeadingGreeting = normalized.replace(
		/^(?:¡)?(?:hola|buenas|buen dia|buen día|buenas tardes|buenas noches)[,!.\s-]*/i,
		''
	).trim();

	if (!withoutLeadingGreeting) {
		return `Hola, soy ${agentName} de ${businessName}. ¿En que te puedo ayudar?`;
	}

	return `Hola, soy ${agentName} de ${businessName}. ${withoutLeadingGreeting}`.trim();
}

export function stripBotOpenings(text = '') {
	let next = String(text || '').trim();
	const openingPattern =
		/^(?:¡)?(?:claro|perfecto|genial|buen[ií]simo|buenisimo|dale|obvio|excelente)(?:[,!\s-]+)(.*)$/i;
	let safety = 0;

	while (openingPattern.test(next) && safety < 3) {
		next = next.replace(openingPattern, '$1').trim();
		safety += 1;
	}

	return next || text;
}

function responseMentionsHumanHandoff(text = '') {
	return /(te paso con una asesora|te paso con un asesor|te derivo con una asesora|te derivo con un asesor|lo revisa una asesora|lo revisa un asesor|ya lo toma una persona|te contacta el equipo|atencion humana|atención humana)/i.test(
		String(text || '')
	);
}

function looksLikeInventedCommercialReply(text = '', commercialPlan = null) {
	if (commercialPlan?.catalogAvailable !== false) return false;
	const normalized = String(text || '').toLowerCase();
	return (
		/(2x1|3x1|pack|combo|promo|promocion|promoción|oferta)/i.test(normalized) ||
		/\$\s?\d/.test(normalized) ||
		/https?:\/\//i.test(normalized) ||
		/\blink\b|\burl\b/i.test(normalized)
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

export function auditAssistantReply({
	text,
	responsePolicy,
	liveOrderContext,
	fallbackReply,
	commercialPlan,
	recentMessages = [],
	contactName = '',
	businessName = 'Lummine',
	agentName = 'Sofi',
}) {
	const rawText = typeof text === 'string' ? text : text?.text || String(text || '');
	const preserveGreeting = Boolean(commercialPlan?.greetingOnly);
	let cleaned = normalizeText(rawText);
	cleaned = stripRepeatedGreeting(cleaned, recentMessages, contactName, preserveGreeting);
	cleaned = stripBotOpenings(cleaned);
	cleaned = normalizeText(cleaned);

	if (!cleaned) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false,
		};
	}

	if (
		responsePolicy?.action?.startsWith('order_status') &&
		looksLikeInventedTracking(cleaned, liveOrderContext)
	) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false,
		};
	}

	if (
		commercialPlan?.shareLinkNow === false &&
		commercialPlan?.alreadyShared?.sharedLinks?.some((link) => cleaned.includes(link))
	) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false,
		};
	}

	if (looksLikeInventedCommercialReply(cleaned, commercialPlan)) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false,
		};
	}

	const triggerHumanHandoff =
		commercialPlan?.shouldEscalate || responseMentionsHumanHandoff(cleaned);

	const finalText = ensureGeneralPresentation(cleaned, {
		preserveGreeting,
		businessName,
		agentName,
	});

	return {
		finalText,
		triggerHumanHandoff,
	};
}

export async function resolveIntentAction({
	intent,
	messageBody,
	explicitOrderNumber,
	currentState,
}) {
	if (intent === 'order_status') {
		return handleOrderStatusIntent({ explicitOrderNumber, currentState });
	}

	if (intent === 'payment') {
		return handlePaymentIntent({ currentState });
	}

	if (intent === 'shipping') {
		return handleShippingIntent();
	}

	if (intent === 'size_help') {
		return handleSizeHelpIntent({ currentState });
	}

	if (intent === 'product') {
		return handleProductRecommendationIntent({ messageBody, currentState });
	}

	return {
		handled: false,
		forcedReply: null,
		liveOrderContext: null,
		aiGuidance: null,
	};
}

export function buildStatePayload({
	contactName,
	normalizedWaId,
	intent,
	explicitOrderNumber,
	liveOrderContext,
	currentState,
	memoryPatch,
	menuStatePatch = null,
}) {
	const shouldKeepOrderContext =
		intent === 'order_status' ||
		(currentState?.lastIntent === 'order_status' && explicitOrderNumber);

	const interestedProducts = Array.isArray(menuStatePatch?.interestedProducts)
		? menuStatePatch.interestedProducts
		: memoryPatch.interestedProducts;

	const nextProductFamily =
		memoryPatch?.currentProductFamily ||
		menuStatePatch?.currentProductFamily ||
		currentState?.currentProductFamily ||
		null;
	const familyChanged =
		Boolean(nextProductFamily) &&
		Boolean(currentState?.currentProductFamily) &&
		nextProductFamily !== currentState.currentProductFamily;

	const excludedProductKeywords = familyChanged
		? Array.isArray(memoryPatch?.excludedProductKeywords)
			? memoryPatch.excludedProductKeywords
			: []
		: Array.isArray(memoryPatch?.excludedProductKeywords) && memoryPatch.excludedProductKeywords.length
			? [...new Set([...(Array.isArray(currentState?.excludedProductKeywords) ? currentState.excludedProductKeywords : []), ...memoryPatch.excludedProductKeywords])]
			: Array.isArray(currentState?.excludedProductKeywords)
				? currentState.excludedProductKeywords
				: [];

	return {
		customerName: contactName || normalizedWaId,
		lastIntent: shouldKeepOrderContext ? 'order_status' : intent,
		lastDetectedIntent: memoryPatch.lastDetectedIntent,
		lastUserGoal: memoryPatch.lastUserGoal,
		lastOrderNumber: shouldKeepOrderContext
			? explicitOrderNumber || currentState.lastOrderNumber || null
			: null,
		lastOrderId: shouldKeepOrderContext
			? liveOrderContext?.orderId
				? String(liveOrderContext.orderId)
				: currentState.lastOrderId || null
			: null,
		preferredTone: memoryPatch.preferredTone,
		customerMood: memoryPatch.customerMood,
		urgencyLevel: memoryPatch.urgencyLevel,
		frequentSize: memoryPatch.frequentSize,
		paymentPreference: memoryPatch.paymentPreference,
		deliveryPreference: memoryPatch.deliveryPreference,
		interestedProducts,
		objections: memoryPatch.objections,
		needsHuman: memoryPatch.needsHuman,
		handoffReason: memoryPatch.handoffReason,
		interactionCount: memoryPatch.interactionCount,
		notes: currentState?.notes || null,
		currentProductFocus:
			menuStatePatch?.currentProductFocus ||
			memoryPatch?.currentProductFocus ||
			currentState?.currentProductFocus ||
			null,
		currentProductFamily: nextProductFamily,
		requestedOfferType:
			memoryPatch?.requestedOfferType ||
			(familyChanged ? null : currentState?.requestedOfferType) ||
			null,
		excludedProductKeywords,
		categoryLocked:
			typeof memoryPatch?.categoryLocked === 'boolean'
				? memoryPatch.categoryLocked
				: Boolean(currentState?.categoryLocked),
		salesStage: currentState?.salesStage || null,
		shownOffers: currentState?.shownOffers || [],
		shownPrices: currentState?.shownPrices || [],
		sharedLinks: currentState?.sharedLinks || [],
		lastRecommendedProduct: currentState?.lastRecommendedProduct || null,
		lastRecommendedOffer: currentState?.lastRecommendedOffer || null,
		buyingIntentLevel: currentState?.buyingIntentLevel || null,
		frictionLevel: currentState?.frictionLevel || null,
		commercialSummary: currentState?.commercialSummary || null,
		menuActive: false,
		menuPath: null,
		menuLastSelection:
			menuStatePatch?.menuLastSelection || currentState?.menuLastSelection || null,
		menuLastPromptAt: currentState?.menuLastPromptAt || null,
	};
}

export function normalizeRecentMessage(msg = {}) {
	const direction = msg.direction || (msg.role === 'assistant' ? 'OUTBOUND' : 'INBOUND');
	return {
		role: direction === 'INBOUND' ? 'user' : 'assistant',
		text: String(msg.body || msg.text || ''),
	};
}

export function buildFallbackOrderAwareReply({
	intent,
	liveOrderContext,
	enrichedState,
	catalogProducts,
	commercialPlan,
}) {
	if (intent === 'order_status' && liveOrderContext) {
		return buildFixedOrderReply(liveOrderContext);
	}

	return buildAiFailureFallback({
		intent,
		enrichedState,
		catalogProducts,
		commercialPlan,
	});
}
