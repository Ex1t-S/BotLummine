import { runAssistantReply } from './ai/index.js';
import { buildPrompt } from './ai/prompt-builder.js';
import { normalizeThreadPhone } from '../lib/conversation-threads.js';
import {
	detectIntent,
	extractOrderNumber,
	extractStandaloneOrderNumber
} from '../lib/intent.js';
import {
	analyzeConversationTurn,
	buildHandoffReply
} from './conversation-analysis.service.js';
import {
	handleOrderStatusIntent,
	buildFixedOrderReply
} from './intents/order-status.service.js';
import { handlePaymentIntent } from './intents/payment.service.js';
import { handleShippingIntent } from './intents/shipping.service.js';
import { handleSizeHelpIntent } from './intents/size-help.service.js';
import { handleProductRecommendationIntent } from './intents/product-recommendation.service.js';
import {
	searchCatalogProducts,
	buildCatalogContext,
	pickCommercialHints
} from './catalog-search.service.js';
import { resolveCommercialBrainV2 } from './commercial-brain.service.js';
import {
	isPaymentProofMessage,
	buildPaymentReviewAck,
	resolveConversationQueue
} from './inbox-routing.service.js';

export function normalizeText(value = '') {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
}

function summarizeText(value = '', max = 160) {
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
		salesStage: null,
		shownOffers: [],
		shownPrices: [],
		sharedLinks: [],
		lastRecommendedProduct: null,
		lastRecommendedOffer: null,
		buyingIntentLevel: null,
		frictionLevel: null,
		commercialSummary: null
	};
}

export function buildConversationSummary({
	intent,
	enrichedState,
	lastUserMessage,
	lastAssistantMessage,
	liveOrderContext,
	commercialPlan = null
}) {
	const parts = [];

	if (enrichedState?.lastUserGoal) {
		parts.push(`Objetivo: ${enrichedState.lastUserGoal}`);
	}

	if (enrichedState?.interestedProducts?.length) {
		parts.push(`Interés: ${enrichedState.interestedProducts.join(', ')}`);
	}

	if (commercialPlan?.productFocus) {
		parts.push(`Foco: ${commercialPlan.productFocus}`);
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
		parts.push(`Derivar: ${enrichedState.handoffReason || commercialPlan?.handoffReason || 'sí'}`);
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
	commercialPlan = null
}) {
	const firstProduct =
		Array.isArray(catalogProducts) && catalogProducts.length ? catalogProducts[0] : null;

	if (commercialPlan?.shouldEscalate || enrichedState?.needsHuman) {
		return 'Te paso con una asesora para seguir mejor con esto.';
	}

	if (intent === 'product') {
		if (commercialPlan?.recommendedAction === 'present_offer_options_brief' && commercialPlan?.offerOptions?.length) {
			const brief = commercialPlan.offerOptions
				.slice(0, 3)
				.map((option) => `${option.label}${option.price ? ` (${option.price})` : ''}`)
				.join(', ');
			return `En este producto solemos tener ${brief}. Si querés, te digo cuál te conviene más.`;
		}

		if (commercialPlan?.recommendedAction === 'guide_and_discover') {
			return 'Tenemos opción individual y también promos. Si querés, te cuento rápido las más elegidas o te paso la web para que las veas.';
		}

		if (commercialPlan?.recommendedAction === 'present_price_once' && commercialPlan?.bestOffer) {
			return `${commercialPlan.bestOffer.name} está ${commercialPlan.bestOffer.price}.`;
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
	aiGuidance,
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
					: commercialPlan?.recommendedAction === 'present_offer_options_brief'
						? 240
						: commercialPlan?.recommendedAction === 'guide_and_discover' || commercialPlan?.recommendedAction === 'invite_to_catalog_and_offer_help'
							? 230
							: 220,
			tone:
				commercialPlan?.mood === 'angry'
					? 'empatico_concreto'
					: 'guia_comercial_directa'
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

export function stripRepeatedGreeting(text = '', recentMessages = [], contactName = '') {
	const assistantCount = recentMessages.filter((msg) => msg.role === 'assistant').length;
	if (assistantCount === 0) return text;

	let next = String(text || '').trim();
	const name = String(contactName || '').trim();
	const escapedName = name ? name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
	const patterns = [
		/^(?:¡)?(?:hola|buenas|buen dia|buen día|buenas tardes|buenas noches)(?:[,!\s-]+(?:soy\s+sofi\s+de\s+lummine|sofi\s+de\s+lummine))?[,:!\s-]*/i,
		escapedName ? new RegExp(`^(?:¡)?(?:hola|buenas|buen dia|buen día|buenas tardes|buenas noches)[,\\s-]+${escapedName}[,:!?\\s-]*`, 'i') : null,
		escapedName ? new RegExp(`^${escapedName}[,:!?\\s-]*`, 'i') : null,
		/^soy\s+sofi\s+de\s+lummine[,:!\s-]*/i
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

export function stripBotOpenings(text = '') {
	let next = String(text || '').trim();
	const openingPattern = /^(?:¡)?(?:claro|perfecto|genial|buen[ií]simo|buenisimo|dale|obvio|excelente)(?:[,!\s-]+)(.*)$/i;
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
	contactName = ''
}) {
	const rawText = typeof text === 'string' ? text : text?.text || String(text || '');
	let cleaned = normalizeText(rawText);
	cleaned = stripRepeatedGreeting(cleaned, recentMessages, contactName);
	cleaned = stripBotOpenings(cleaned);
	cleaned = normalizeText(cleaned);

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

	const triggerHumanHandoff =
		commercialPlan?.shouldEscalate || responseMentionsHumanHandoff(cleaned);

	return {
		finalText: cleaned,
		triggerHumanHandoff
	};
}

async function resolveIntentAction({ intent, messageBody, explicitOrderNumber, currentState }) {
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
		aiGuidance: null
	};
}

function buildStatePayload({
	contactName,
	normalizedWaId,
	intent,
	explicitOrderNumber,
	liveOrderContext,
	currentState,
	memoryPatch
}) {
	const shouldKeepOrderContext =
		intent === 'order_status' ||
		(currentState?.lastIntent === 'order_status' && explicitOrderNumber);

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
		interestedProducts: memoryPatch.interestedProducts,
		objections: memoryPatch.objections,
		needsHuman: memoryPatch.needsHuman,
		handoffReason: memoryPatch.handoffReason,
		interactionCount: memoryPatch.interactionCount,
		notes: currentState?.notes || null,
		currentProductFocus: currentState?.currentProductFocus || null,
		salesStage: currentState?.salesStage || null,
		shownOffers: currentState?.shownOffers || [],
		shownPrices: currentState?.shownPrices || [],
		sharedLinks: currentState?.sharedLinks || [],
		lastRecommendedProduct: currentState?.lastRecommendedProduct || null,
		lastRecommendedOffer: currentState?.lastRecommendedOffer || null,
		buyingIntentLevel: currentState?.buyingIntentLevel || null,
		frictionLevel: currentState?.frictionLevel || null,
		commercialSummary: currentState?.commercialSummary || null
	};
}

function normalizeRecentMessage(msg = {}) {
	const direction = msg.direction || (msg.role === 'assistant' ? 'OUTBOUND' : 'INBOUND');
	return {
		role: direction === 'INBOUND' ? 'user' : 'assistant',
		text: String(msg.body || msg.text || '')
	};
}

export async function runConversationTurn({
	contactName,
	customerContext = {},
	messageBody,
	messageType = 'text',
	attachmentMeta = null,
	rawPayload = null,
	currentConversation = {},
	currentState = {},
	messages = [],
	businessName = process.env.BUSINESS_NAME || 'Lummine'
}) {
	const normalizedWaId = normalizeThreadPhone(
		customerContext?.waId || currentConversation?.waId || currentConversation?.phone || ''
	);
	const normalizedMessages = Array.isArray(messages) ? messages.map(normalizeRecentMessage) : [];

	const intent = detectIntent(messageBody, currentState);
	const explicitOrderNumber =
		extractOrderNumber(messageBody, currentState) || extractStandaloneOrderNumber(messageBody);

	const recentMessages = normalizedMessages.slice(-8);
	const memoryPatch = analyzeConversationTurn({
		messageBody,
		intent,
		currentState,
		recentMessages
	});

	if (intent === 'human_handoff') {
		memoryPatch.needsHuman = true;
		memoryPatch.handoffReason = 'requested_human';
	}

	const detectedPaymentProof = isPaymentProofMessage({
		messageType,
		body: messageBody,
		rawPayload,
		currentState,
		recentMessages
	});

	const queueDecision = resolveConversationQueue({
		currentConversation,
		memoryPatch,
		detectedPaymentProof,
		aiDeclaredHandoff: false
	});

	const intentResult = await resolveIntentAction({
		intent,
		messageBody,
		explicitOrderNumber,
		currentState
	});

	const aiGuidance = intentResult.aiGuidance || null;
	const liveOrderContext = intentResult.liveOrderContext || null;
	const forcedReply = intentResult.forcedReply || null;

	const nextStatePayload = buildStatePayload({
		contactName,
		normalizedWaId,
		intent,
		explicitOrderNumber,
		liveOrderContext,
		currentState,
		memoryPatch
	});

	let enrichedState = {
		...currentState,
		...nextStatePayload
	};

	if (detectedPaymentProof) {
		const ack = buildPaymentReviewAck();
		return {
			intent,
			queueDecision,
			nextStatePayload,
			enrichedState,
			outbound: {
				kind: 'payment_review_ack',
				body: ack,
				aiMeta: {
					provider: 'system',
					model: 'payment-proof-router',
					raw: { detectedPaymentProof: true }
				}
			},
			lastSummary: buildConversationSummary({
				intent,
				enrichedState,
				lastUserMessage: messageBody,
				lastAssistantMessage: ack,
				liveOrderContext
			}),
			trace: {
				intent,
				queueDecision,
				responsePolicy: null,
				commercialPlan: null,
				catalogProducts: [],
				commercialHints: [],
				prompt: null,
				assistantMessage: ack,
				provider: 'system',
				model: 'payment-proof-router',
				aiGuidance,
				liveOrderContext
			}
		};
	}

	const handoffJustTriggered = enrichedState.needsHuman && !currentState.needsHuman;

	if (handoffJustTriggered) {
		const handoffReply = buildHandoffReply({
			contactName: customerContext?.name || contactName || normalizedWaId,
			reason: enrichedState.handoffReason
		});

		return {
			intent,
			queueDecision,
			nextStatePayload,
			enrichedState,
			outbound: {
				kind: 'handoff',
				body: handoffReply,
				aiMeta: {
					provider: 'system',
					model: 'human-handoff-router',
					raw: { handoffReason: enrichedState.handoffReason }
				}
			},
			lastSummary: buildConversationSummary({
				intent,
				enrichedState,
				lastUserMessage: messageBody,
				lastAssistantMessage: handoffReply,
				liveOrderContext
			}),
			trace: {
				intent,
				queueDecision,
				responsePolicy: null,
				commercialPlan: null,
				catalogProducts: [],
				commercialHints: [],
				prompt: null,
				assistantMessage: handoffReply,
				provider: 'system',
				model: 'human-handoff-router',
				aiGuidance,
				liveOrderContext
			}
		};
	}

	const isAiEnabledGlobal =
		String(process.env.AI_AUTOREPLY_ENABLED || 'true').toLowerCase() === 'true';

	const shouldReply =
		isAiEnabledGlobal &&
		queueDecision.aiEnabled &&
		queueDecision.queue === 'AUTO';

	const maxContext = Number(process.env.MAX_CONTEXT_MESSAGES || 12);
	const fullRecentMessages = normalizedMessages.slice(-maxContext);

	let catalogProducts = [];
	let catalogContext = '';
	let commercialHints = [];
	let commercialPlan = null;

	try {
		catalogProducts = await searchCatalogProducts({
			query: messageBody,
			interestedProducts: enrichedState.interestedProducts || [],
			limit: 5
		});

		commercialPlan = resolveCommercialBrainV2({
			intent,
			messageBody,
			currentState: enrichedState,
			recentMessages: fullRecentMessages,
			catalogProducts
		});

		catalogProducts = commercialPlan?.rankedProducts?.length
			? commercialPlan.rankedProducts.slice(0, 5)
			: catalogProducts;

		catalogContext = buildCatalogContext(catalogProducts, commercialPlan);
		commercialHints = pickCommercialHints(catalogProducts, commercialPlan);

		if (aiGuidance?.type === 'payment') {
			if (Array.isArray(aiGuidance.missing) && aiGuidance.missing.length) {
				commercialHints.push(
					`Si pregunta por pago, pedí natural solo lo que falte (${aiGuidance.missing.join(', ')}).`
				);
			}

			if (aiGuidance.paymentDataAvailable) {
				commercialHints.push('Si realmente quiere avanzar, orientala sin abrir otra promo.');
			}
		}

		if (aiGuidance?.type === 'shipping') {
			commercialHints.push(
				'Si falta ubicación, pedí zona, localidad o provincia sin cortar el hilo.'
			);
		}

		if (aiGuidance?.type === 'size_help') {
			commercialHints.push(
				'Si ya venían hablando de un producto, tratá la pregunta de talle como continuidad.'
			);

			if (aiGuidance.knownSize) {
				commercialHints.push(
					`Ya hay un talle detectado en la conversación (${aiGuidance.knownSize}).`
				);
			}
		}

		commercialHints.push('No repitas saludo si la conversación ya empezó.');
		commercialHints.push('No derivas por una duda simple si ya la podés resolver.');
		commercialHints.push('Si la clienta ya dejó claro el producto, respondé directo.');
		commercialHints.push('No pases más de un link en una misma respuesta.');
		commercialHints.push('No abras varias promos si la clienta ya eligió una.');
		commercialHints.push('Bajá el tono celebratorio y soná más natural.');
	} catch (catalogError) {
		console.error('Error buscando productos en catálogo local:', catalogError);
	}

	const responsePolicy = buildResponsePolicy({
		intent,
		enrichedState,
		aiGuidance,
		liveOrderContext,
		queueDecision,
		commercialPlan
	});

	let finalReply = forcedReply || null;
	let aiMeta = null;
	let prompt = null;
	let postReplyHandoff = false;

	if (!shouldReply) {
		return {
			intent,
			queueDecision,
			nextStatePayload,
			enrichedState,
			outbound: null,
			lastSummary: currentConversation?.lastSummary || null,
			trace: {
				intent,
				queueDecision,
				responsePolicy,
				commercialPlan,
				catalogProducts,
				commercialHints,
				prompt: null,
				assistantMessage: null,
				provider: null,
				model: null,
				aiGuidance,
				liveOrderContext,
				shouldReply: false
			}
		};
	}

	if (!finalReply && !responsePolicy.useAI) {
		if (intent === 'order_status' && liveOrderContext) {
			finalReply = buildFixedOrderReply(liveOrderContext);
		} else {
			finalReply = buildAiFailureFallback({
				intent,
				enrichedState,
				catalogProducts,
				commercialPlan
			});
		}
	}

	if (!finalReply) {
		prompt = buildPrompt({
			businessName,
			contactName: customerContext?.name || contactName || normalizedWaId,
			recentMessages: fullRecentMessages,
			conversationSummary: currentConversation?.lastSummary || '',
			customerContext,
			conversationState: enrichedState,
			liveOrderContext,
			catalogProducts,
			catalogContext,
			commercialHints,
			commercialPlan,
			responsePolicy
		});

		try {
			const aiResult = await runAssistantReply({
				businessName,
				contactName: customerContext?.name || contactName || normalizedWaId,
				recentMessages: fullRecentMessages,
				conversationSummary: currentConversation?.lastSummary || '',
				customerContext,
				conversationState: enrichedState,
				liveOrderContext,
				catalogProducts,
				catalogContext,
				commercialHints,
				commercialPlan,
				responsePolicy
			});

			const fallbackReply =
				intent === 'order_status' && liveOrderContext
					? buildFixedOrderReply(liveOrderContext)
					: buildAiFailureFallback({
							intent,
							enrichedState,
							catalogProducts,
							commercialPlan
						});

			const audited = auditAssistantReply({
				text: aiResult?.text || '',
				responsePolicy,
				liveOrderContext,
				fallbackReply,
				commercialPlan,
				recentMessages: fullRecentMessages,
				contactName: customerContext?.name || contactName || normalizedWaId
			});

			finalReply = audited.finalText;
			aiMeta = aiResult;
			postReplyHandoff = audited.triggerHumanHandoff;
		} catch (error) {
			console.error('Error en flujo de respuesta automática:', error);
			finalReply = buildAiFailureFallback({
				intent,
				enrichedState,
				catalogProducts,
				commercialPlan
			});
			aiMeta = {
				provider: 'fallback',
				model: 'local-fallback',
				usage: null,
				raw: {
					error: error.message
				}
			};
		}
	}

	const finalSummary = buildConversationSummary({
		intent,
		enrichedState,
		lastUserMessage: messageBody,
		lastAssistantMessage: finalReply,
		liveOrderContext,
		commercialPlan
	});

	return {
		intent,
		queueDecision,
		nextStatePayload,
		enrichedState,
		outbound: finalReply
			? {
				kind: aiMeta?.provider === 'manual' ? 'manual' : 'assistant',
				body: finalReply,
				aiMeta
			}
			: null,
		lastSummary: finalSummary,
		postReplyHandoff,
		trace: {
			intent,
			queueDecision,
			responsePolicy,
			commercialPlan,
			catalogProducts,
			commercialHints,
			prompt,
			assistantMessage: finalReply,
			provider: aiMeta?.provider || null,
			model: aiMeta?.model || null,
			aiGuidance,
			liveOrderContext,
			shouldReply: true
		}
	};
}
