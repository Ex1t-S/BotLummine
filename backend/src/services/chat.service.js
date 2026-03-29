import { prisma } from '../lib/prisma.js';
import { runAssistantReply } from './ai/index.js';
import { sendWhatsAppText } from './whatsapp.service.js';
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

function normalizeText(value = '') {
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

function buildConversationSummary({
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

function buildAiFailureFallback({
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
			? `Si querés, te paso la web y te ayudo a elegir la opción más conveniente.`
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

function buildResponsePolicy({
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


function stripRepeatedGreeting(text = '', recentMessages = [], contactName = '') {
	const assistantCount = recentMessages.filter((msg) => msg.role === 'assistant').length;
	if (assistantCount === 0) return text;

	let next = String(text || '').trim();
	const name = String(contactName || '').trim();
	const escapedName = name ? name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
	const patterns = [
		/^¡?hola!?[,\s]*/i,
		escapedName ? new RegExp(`^${escapedName}[,:!?\\s-]*`, 'i') : null,
		escapedName ? new RegExp(`^hola[,\\s]+${escapedName}[,:!?\\s-]*`, 'i') : null,
		escapedName ? new RegExp(`^${escapedName}[,:!?\\s-]*hola[,\\s]*`, 'i') : null
	].filter(Boolean);

	let changed = true;
	while (changed) {
		changed = false;
		for (const pattern of patterns) {
			if (pattern.test(next)) {
				next = next.replace(pattern, '').trim();
				changed = true;
			}
		}
	}

	return next || text;
}

function stripBotOpenings(text = '') {
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

function auditAssistantReply({
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

async function syncHumanHandoff({ conversationId, reason = 'ai_declared_handoff' }) {
	await prisma.conversation.update({
		where: { id: conversationId },
		data: {
			queue: 'HUMAN',
			aiEnabled: false,
			lastMessageAt: new Date()
		}
	});

	await prisma.conversationState.upsert({
		where: { conversationId },
		update: {
			needsHuman: true,
			handoffReason: reason
		},
		create: {
			conversationId,
			needsHuman: true,
			handoffReason: reason,
			interactionCount: 0,
			interestedProducts: [],
			objections: []
		}
	});
}

export async function getOrCreateConversation({
	waId,
	contactName,
	queue = 'AUTO',
	aiEnabled = true
}) {
	const normalizedWaId = normalizeThreadPhone(waId);

	const contact = await prisma.contact.upsert({
		where: { waId: normalizedWaId },
		update: {
			name: contactName || undefined,
			phone: normalizedWaId
		},
		create: {
			waId: normalizedWaId,
			phone: normalizedWaId,
			name: contactName || normalizedWaId
		}
	});

	let conversation = await prisma.conversation.findFirst({
		where: { contactId: contact.id },
		include: { contact: true, state: true }
	});

	if (!conversation) {
		conversation = await prisma.conversation.create({
			data: {
				contactId: contact.id,
				queue,
				aiEnabled,
				lastMessageAt: new Date(),
				state: {
					create: {
						customerName: contactName || normalizedWaId,
						interactionCount: 0,
						interestedProducts: [],
						objections: [],
						needsHuman: queue === 'HUMAN'
					}
				}
			},
			include: { contact: true, state: true }
		});
	}

	if (!conversation.state) {
		conversation = await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				state: {
					create: {
						customerName: contactName || normalizedWaId,
						interactionCount: 0,
						interestedProducts: [],
						objections: [],
						needsHuman: queue === 'HUMAN'
					}
				}
			},
			include: { contact: true, state: true }
		});
	}

	if (conversation.queue !== queue || conversation.aiEnabled !== aiEnabled) {
		conversation = await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				queue,
				aiEnabled
			},
			include: { contact: true, state: true }
		});
	}

	return conversation;
}

export async function sendAndPersistOutbound({ conversationId, waId, body, aiMeta = null }) {
	const waResult = await sendWhatsAppText({ to: waId, body });

	await prisma.message.create({
		data: {
			conversationId,
			direction: 'OUTBOUND',
			senderName: process.env.BUSINESS_NAME || 'Lummine',
			body,
			type: 'text',
			provider: aiMeta?.provider || waResult?.provider || 'whatsapp-cloud-api',
			model: aiMeta?.model || waResult?.model || null,
			tokenPrompt: aiMeta?.usage?.inputTokens ?? null,
			tokenCompletion: aiMeta?.usage?.outputTokens ?? null,
			tokenTotal: aiMeta?.usage?.totalTokens ?? null,
			metaMessageId: waResult?.rawPayload?.messages?.[0]?.id || null,
			rawPayload: {
				ai: aiMeta?.raw || null,
				whatsapp: waResult?.rawPayload || waResult?.error || waResult || {}
			}
		}
	});

	await prisma.conversation.update({
		where: { id: conversationId },
		data: { lastMessageAt: new Date() }
	});

	if (waResult?.ok === false) {
		console.error('Error enviando WhatsApp:', waResult.error || waResult);
	}

	return waResult;
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
	freshConversation,
	currentState,
	contactName,
	normalizedWaId,
	intent,
	explicitOrderNumber,
	liveOrderContext,
	memoryPatch
}) {
	const shouldKeepOrderContext =
		intent === 'order_status' ||
		(currentState?.lastIntent === 'order_status' && explicitOrderNumber);

	return {
		customerName: contactName || freshConversation.contact.name || normalizedWaId,
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
		interactionCount: memoryPatch.interactionCount
	};
}

export async function processInboundMessage({
	waId,
	contactName,
	messageBody,
	messageType = 'text',
	attachmentMeta = null,
	rawPayload,
	metaMessageId = null
}) {
	const normalizedWaId = normalizeThreadPhone(waId);

	const conversation = await getOrCreateConversation({
		waId: normalizedWaId,
		contactName
	});

	if (metaMessageId) {
		const existingMessage = await prisma.message.findUnique({
			where: { metaMessageId }
		});

		if (existingMessage) {
			return { conversation };
		}
	}

	await prisma.message.create({
		data: {
			conversationId: conversation.id,
			metaMessageId,
			senderName: contactName || normalizedWaId,
			direction: 'INBOUND',
			type: messageType || 'text',
			body: messageBody,
			attachmentUrl: attachmentMeta?.attachmentUrl || null,
			attachmentMimeType: attachmentMeta?.attachmentMimeType || null,
			attachmentName: attachmentMeta?.attachmentName || null,
			rawPayload
		}
	});

	await prisma.conversation.update({
		where: { id: conversation.id },
		data: { lastMessageAt: new Date() }
	});

	const freshConversation = await prisma.conversation.findUnique({
		where: { id: conversation.id },
		include: {
			contact: true,
			state: true,
			messages: {
				orderBy: { createdAt: 'asc' }
			}
		}
	});

	if (!freshConversation) {
		return { conversation };
	}

	const currentState = freshConversation.state || {};
	const intent = detectIntent(messageBody, currentState);
	const explicitOrderNumber =
		extractOrderNumber(messageBody, currentState) || extractStandaloneOrderNumber(messageBody);

	const recentMessages = freshConversation.messages.slice(-8).map((msg) => ({
		role: msg.direction === 'INBOUND' ? 'user' : 'assistant',
		text: msg.body
	}));

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
		currentConversation: freshConversation,
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
		freshConversation,
		currentState,
		contactName,
		normalizedWaId,
		intent,
		explicitOrderNumber,
		liveOrderContext,
		memoryPatch
	});

	await prisma.conversationState.upsert({
		where: { conversationId: freshConversation.id },
		update: nextStatePayload,
		create: {
			conversationId: freshConversation.id,
			...nextStatePayload
		}
	});

	await prisma.conversation.update({
		where: { id: freshConversation.id },
		data: {
			queue: queueDecision.queue,
			aiEnabled: queueDecision.aiEnabled,
			lastMessageAt: new Date()
		}
	});

	const enrichedState = {
		...currentState,
		...nextStatePayload
	};

	if (detectedPaymentProof) {
		const ack = buildPaymentReviewAck();

		await sendAndPersistOutbound({
			conversationId: freshConversation.id,
			waId: freshConversation.contact.waId,
			body: ack,
			aiMeta: {
				provider: 'system',
				model: 'payment-proof-router',
				raw: { detectedPaymentProof: true }
			}
		});

		await prisma.conversation.update({
			where: { id: freshConversation.id },
			data: {
				lastSummary: buildConversationSummary({
					intent,
					enrichedState,
					lastUserMessage: messageBody,
					lastAssistantMessage: ack,
					liveOrderContext
				})
			}
		});

		return { conversation: freshConversation };
	}

	const handoffJustTriggered = enrichedState.needsHuman && !currentState.needsHuman;

	if (handoffJustTriggered) {
		const handoffReply = buildHandoffReply({
			contactName: freshConversation.contact.name || '',
			reason: enrichedState.handoffReason
		});

		await sendAndPersistOutbound({
			conversationId: freshConversation.id,
			waId: freshConversation.contact.waId,
			body: handoffReply,
			aiMeta: {
				provider: 'system',
				model: 'human-handoff-router',
				raw: { handoffReason: enrichedState.handoffReason }
			}
		});

		await prisma.conversation.update({
			where: { id: freshConversation.id },
			data: {
				lastSummary: buildConversationSummary({
					intent,
					enrichedState,
					lastUserMessage: messageBody,
					lastAssistantMessage: handoffReply,
					liveOrderContext
				})
			}
		});

		return { conversation: freshConversation };
	}

	const isAiEnabledGlobal =
		String(process.env.AI_AUTOREPLY_ENABLED || 'true').toLowerCase() === 'true';

	const shouldReply =
		isAiEnabledGlobal &&
		queueDecision.aiEnabled &&
		queueDecision.queue === 'AUTO';
	console.log('[AI DEBUG] isAiEnabledGlobal:', isAiEnabledGlobal);
	console.log('[AI DEBUG] queueDecision:', queueDecision);
	console.log('[AI DEBUG] shouldReply:', shouldReply);
	console.log('[AI DEBUG] intent:', intent);
	console.log('[AI DEBUG] waId:', freshConversation.contact.waId);
	if (!shouldReply) {
		return { conversation: freshConversation };
	}

	const maxContext = Number(process.env.MAX_CONTEXT_MESSAGES || 12);

	const fullRecentMessages = freshConversation.messages.slice(-maxContext).map((msg) => ({
		role: msg.direction === 'INBOUND' ? 'user' : 'assistant',
		text: msg.body
	}));

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
		try {
			const aiResult = await runAssistantReply({
				businessName: process.env.BUSINESS_NAME || 'Lummine',
				contactName: freshConversation.contact.name || freshConversation.contact.waId,
				recentMessages: fullRecentMessages,
				conversationSummary: freshConversation.lastSummary || '',
				customerContext: {
					name: freshConversation.contact.name || freshConversation.contact.waId,
					waId: freshConversation.contact.waId
				},
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
				contactName: freshConversation.contact.name || freshConversation.contact.waId
			});

			finalReply = audited.finalText;
			aiMeta = aiResult;

			if (audited.triggerHumanHandoff) {
				await syncHumanHandoff({
					conversationId: freshConversation.id,
					reason: commercialPlan?.handoffReason || 'ai_declared_handoff'
				});
			}
		} catch (aiError) {
			console.error('Error en flujo de respuesta automática:', aiError);

			finalReply =
				intent === 'order_status' && liveOrderContext
					? buildFixedOrderReply(liveOrderContext)
					: buildAiFailureFallback({
							intent,
							enrichedState,
							catalogProducts,
							commercialPlan
						});

			aiMeta = {
				provider: 'fallback',
				model: 'rule-based-fallback',
				raw: {
					error: aiError?.message || String(aiError)
				}
			};
		}
	}

	await sendAndPersistOutbound({
		conversationId: freshConversation.id,
		waId: freshConversation.contact.waId,
		body: finalReply,
		aiMeta
	});

	await prisma.conversation.update({
		where: { id: freshConversation.id },
		data: {
			lastSummary: buildConversationSummary({
				intent,
				enrichedState,
				lastUserMessage: messageBody,
				lastAssistantMessage: finalReply,
				liveOrderContext,
				commercialPlan
			})
		}
	});

	return { conversation: freshConversation };
}