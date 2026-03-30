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

function familyToHumanLabel(family = null) {
	const map = {
		body_modelador: 'body modelador',
		calzas_linfaticas: 'calzas linfáticas',
		short_faja: 'short faja',
		faja: 'faja',
		bombacha_modeladora: 'bombacha modeladora'
	};
	return map[family] || family || 'producto';
}

function normalizeCommercialText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripRepeatedGreeting(text = '', hasAssistantHistory = false) {
	if (!hasAssistantHistory) return String(text || '').trim();
	let cleaned = String(text || '').trim();
	cleaned = cleaned.replace(
		/^(hola [^,!.]+[,!.\s]+|hola[,!.\s]+|buenas[,!.\s]+|buen dia[,!.\s]+|buen día[,!.\s]+|buenas tardes[,!.\s]+|buenas noches[,!.\s]+)/i,
		''
	);
	return cleaned.trim();
}

function detectFamilyMentionFromReply(text = '') {
	const normalized = normalizeCommercialText(text);
	if (/(body|bodys?).*(modelador|reductor)|\bbody modelador\b|\bbody\b/.test(normalized)) {
		return 'body_modelador';
	}
	if (/(calza|calzas).*(linfat|modeladora)|\bcalzas? linfaticas\b/.test(normalized)) {
		return 'calzas_linfaticas';
	}
	if (/(short).*(faja|modelador|reductor)|\bshort faja\b/.test(normalized)) {
		return 'short_faja';
	}
	if (/(bombacha).*(modeladora|reductora)|\bbombacha modeladora\b/.test(normalized)) {
		return 'bombacha_modeladora';
	}
	if (/\bfaja\b/.test(normalized)) {
		return 'faja';
	}
	return null;
}

function mentionsDifferentLockedFamily(text = '', commercialPlan = null) {
	if (!commercialPlan?.familyLocked || !commercialPlan?.productFamily) return false;
	const replyFamily = detectFamilyMentionFromReply(text);
	return Boolean(replyFamily && replyFamily !== commercialPlan.productFamily);
}

function mergeUniqueStringArrays(existing = [], incoming = []) {
	return [
		...new Set(
			[
				...(Array.isArray(existing) ? existing : []),
				...(Array.isArray(incoming) ? incoming : [])
			]
				.filter(Boolean)
				.map((item) => String(item).trim())
		)
	];
}

function buildCommercialStatePatch({ currentState = {}, commercialPlan = null, finalReply = '' }) {
	if (!commercialPlan) return {};

	const replyText = String(finalReply || '');
	const nextOffers = mergeUniqueStringArrays(currentState?.shownOffers, []);
	const nextPrices = mergeUniqueStringArrays(currentState?.shownPrices, []);
	const nextLinks = mergeUniqueStringArrays(currentState?.sharedLinks, []);

	if (commercialPlan?.bestOffer?.offerKey && replyText) {
		if (
			replyText.includes(commercialPlan.bestOffer.name || '') ||
			/(3x1|2x1|promo|oferta|pack)/i.test(replyText)
		) {
			nextOffers.push(commercialPlan.bestOffer.offerKey);
		}
	}

	if (
		commercialPlan?.comparisonSet?.offer?.name &&
		replyText.includes(commercialPlan.comparisonSet.offer.name)
	) {
		nextOffers.push(commercialPlan.comparisonSet.offer.offerType || 'pack');
	}
	if (
		commercialPlan?.comparisonSet?.single?.name &&
		replyText.includes(commercialPlan.comparisonSet.single.name)
	) {
		nextOffers.push('single');
	}

	if (commercialPlan?.bestOffer?.price && replyText.includes(commercialPlan.bestOffer.price)) {
		nextPrices.push(`${commercialPlan.bestOffer.name}::${commercialPlan.bestOffer.price}`);
	}
	if (
		commercialPlan?.comparisonSet?.single?.price &&
		replyText.includes(commercialPlan.comparisonSet.single.price)
	) {
		nextPrices.push(
			`${commercialPlan.comparisonSet.single.name}::${commercialPlan.comparisonSet.single.price}`
		);
	}
	if (
		commercialPlan?.comparisonSet?.offer?.price &&
		replyText.includes(commercialPlan.comparisonSet.offer.price)
	) {
		nextPrices.push(
			`${commercialPlan.comparisonSet.offer.name}::${commercialPlan.comparisonSet.offer.price}`
		);
	}

	if (
		commercialPlan?.bestOffer?.productUrl &&
		replyText.includes(commercialPlan.bestOffer.productUrl)
	) {
		nextLinks.push(commercialPlan.bestOffer.productUrl);
	}
	if (
		commercialPlan?.comparisonSet?.single?.productUrl &&
		replyText.includes(commercialPlan.comparisonSet.single.productUrl)
	) {
		nextLinks.push(commercialPlan.comparisonSet.single.productUrl);
	}
	if (
		commercialPlan?.comparisonSet?.offer?.productUrl &&
		replyText.includes(commercialPlan.comparisonSet.offer.productUrl)
	) {
		nextLinks.push(commercialPlan.comparisonSet.offer.productUrl);
	}

	return {
		currentProductFocus:
			commercialPlan.productFocus ||
			commercialPlan.bestOffer?.name ||
			currentState.currentProductFocus ||
			null,
		salesStage: commercialPlan.stage || currentState.salesStage || null,
		shownOffers: mergeUniqueStringArrays([], nextOffers),
		shownPrices: mergeUniqueStringArrays([], nextPrices),
		sharedLinks: mergeUniqueStringArrays([], nextLinks),
		lastRecommendedProduct:
			commercialPlan.bestOffer?.name ||
			commercialPlan.comparisonSet?.offer?.name ||
			currentState.lastRecommendedProduct ||
			null,
		lastRecommendedOffer:
			commercialPlan.bestOffer?.offerKey ||
			commercialPlan.comparisonSet?.offer?.offerType ||
			currentState.lastRecommendedOffer ||
			null,
		buyingIntentLevel:
			commercialPlan.buyingIntentLevel || currentState.buyingIntentLevel || null,
		frictionLevel:
			commercialPlan.mood === 'angry'
				? 'high'
				: commercialPlan.mood === 'urgent'
					? 'medium'
					: currentState.frictionLevel || 'low',
		commercialSummary: [
			commercialPlan.productFamily
				? `Familia: ${familyToHumanLabel(commercialPlan.productFamily)}`
				: '',
			commercialPlan.productFocus ? `Foco: ${commercialPlan.productFocus}` : '',
			commercialPlan.bestOffer?.name
				? `Oferta principal: ${commercialPlan.bestOffer.name}`
				: '',
			commercialPlan.requestedColors?.length
				? `Colores: ${commercialPlan.requestedColors.join(', ')}`
				: '',
			commercialPlan.requestedSizes?.length
				? `Talles: ${commercialPlan.requestedSizes.join(', ')}`
				: ''
		]
			.filter(Boolean)
			.join(' | ')
	};
}


function buildAiFailureFallback({
	intent,
	enrichedState,
	catalogProducts = [],
	commercialPlan = null
}) {
	const firstProduct =
		Array.isArray(catalogProducts) && catalogProducts.length ? catalogProducts[0] : null;
	const ranked = Array.isArray(commercialPlan?.rankedProducts)
		? commercialPlan.rankedProducts
		: Array.isArray(catalogProducts)
			? catalogProducts
			: [];
	const singleOption =
		commercialPlan?.comparisonSet?.single ||
		ranked.find((item) => (item.offerType || 'single') === 'single') ||
		null;
	const offerOption =
		commercialPlan?.comparisonSet?.offer ||
		ranked.find((item) => ['3x1', '2x1', 'pack'].includes(item.offerType || 'single')) ||
		commercialPlan?.bestOffer ||
		null;
	const familyLabel = familyToHumanLabel(commercialPlan?.productFamily);
	const requestedVariantText = [
		...(commercialPlan?.requestedColors || []),
		...(commercialPlan?.requestedSizes || [])
	]
		.filter(Boolean)
		.join(' / ');

	if (commercialPlan?.shouldEscalate || enrichedState?.needsHuman) {
		return 'Te paso con una asesora para seguir mejor con esto.';
	}

	if (commercialPlan?.greetingOnly) {
		return 'Hola, ¿qué producto estás buscando?';
	}

	if (intent === 'product') {
		if (commercialPlan?.recommendedAction === 'discover_family_before_offer') {
			return `Sí, trabajamos ${familyLabel}. Tenés opción individual y promos; la principal suele ser el 3x1. Si querés, primero veo color y talle o te paso precios.`;
		}

		if (
			commercialPlan?.recommendedAction === 'compare_single_vs_best_offer' &&
			(singleOption || offerOption)
		) {
			const left = singleOption?.price
				? `La opción individual está ${singleOption.price}.`
				: '';
			const right = offerOption?.name
				? `En promo, la principal es ${offerOption.name}${
						offerOption.price ? ` por ${offerOption.price}` : ''
					}.`
				: '';
			return [left, right].filter(Boolean).join(' ');
		}

		if (
			commercialPlan?.recommendedAction === 'confirm_variant_and_continue' &&
			requestedVariantText
		) {
			if (singleOption?.price) {
				return `Sí, en ${familyLabel} seguimos con ${requestedVariantText}. Si querés, la opción individual está ${singleOption.price} y después vemos promo.`;
			}
			return `Sí, en ${familyLabel} seguimos con ${requestedVariantText}. Si querés, te paso precio individual y promo dentro de esta misma familia.`;
		}

		if (commercialPlan?.recommendedAction === 'show_family_options') {
			const parts = [];
			if (singleOption?.price) {
				parts.push(`En ${familyLabel} tengo opción individual desde ${singleOption.price}.`);
			} else {
				parts.push(`En ${familyLabel} tengo opción individual.`);
			}
			if (offerOption?.name) {
				parts.push(
					`Y en promo, la principal es ${offerOption.name}${
						offerOption.price ? ` por ${offerOption.price}` : ''
					}.`
				);
			}
			parts.push('Si querés, te digo cuál te conviene más o seguimos por color y talle.');
			return parts.join(' ');
		}

		if (
			commercialPlan?.recommendedAction === 'present_single_best_offer' &&
			commercialPlan?.bestOffer
		) {
			return `En ${familyLabel}, la promo principal es ${commercialPlan.bestOffer.name}${
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
			commercialPlan?.recommendedAction === 'continue_current_offer' &&
			(commercialPlan?.comparisonSet?.single || commercialPlan?.comparisonSet?.offer)
		) {
			const preferred = commercialPlan?.comparisonSet?.offer || commercialPlan?.comparisonSet?.single;
			return `Seguimos dentro de ${familyLabel}. ${
				preferred?.name
					? `La opción más alineada es ${preferred.name}${
							preferred.price ? ` por ${preferred.price}` : ''
						}.`
					: 'Si querés, te paso la opción que más te conviene.'
			}`;
		}

		if (
			commercialPlan?.recommendedAction === 'close_with_single_link' &&
			commercialPlan?.bestOffer?.productUrl
		) {
			return `Sí, te paso el link directo: ${commercialPlan.bestOffer.productUrl}`;
		}

		if (commercialPlan?.recommendedAction === 'answer_and_guide' && familyLabel !== 'producto') {
			return `Sí, trabajamos ${familyLabel}. Si querés, seguimos por color y talle o te paso opciones y promos dentro de esta misma familia.`;
		}

		if (commercialPlan?.bestOffer?.productUrl && commercialPlan?.shareLinkNow) {
			return `Te paso la opción más alineada con lo que venían viendo: ${commercialPlan.bestOffer.productUrl}`;
		}

		return firstProduct?.productUrl
			? `Te paso el link del producto: ${firstProduct.productUrl}`
			: 'Contame cuál producto te interesa y te oriento.';
	}

	if (intent === 'payment') {
		return 'Sí, aceptamos ese medio de pago. Si querés te indico cómo seguir.';
	}

	if (intent === 'shipping') {
		return 'Sí, hacemos envíos. Decime tu zona o ciudad y te digo cómo sería.';
	}

	if (intent === 'size_help') {
		return 'Decime qué talle usás normalmente y te oriento.';
	}

	if (intent === 'order_status') {
		return 'Pasame tu número de pedido y te reviso el estado por acá.';
	}

	return 'Te sigo ayudando por acá. Contame un poquito más así te respondo mejor.';
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
		const deterministicActions = new Set([
			'greet_and_discover',
			'discover_family_before_offer',
			'show_family_options',
			'compare_single_vs_best_offer',
			'present_single_best_offer',
			'present_price_once',
			'confirm_variant_and_continue',
			'continue_current_offer',
			'close_with_single_link'
		]);

		return {
			action: commercialPlan?.recommendedAction || 'product_guidance',
			useAI: !deterministicActions.has(commercialPlan?.recommendedAction),
			allowHandoffMention: false,
			maxChars:
				commercialPlan?.recommendedAction === 'close_with_single_link'
					? 200
					: commercialPlan?.recommendedAction === 'present_single_best_offer'
						? 180
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
	hasAssistantHistory = false
}) {
	let cleaned = normalizeText(text);
	cleaned = stripRepeatedGreeting(cleaned, hasAssistantHistory);

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

	if (mentionsDifferentLockedFamily(cleaned, commercialPlan)) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false
		};
	}

	if (commercialPlan?.shareLinkNow === false && /(https?:\/\/|www\.)/i.test(cleaned)) {
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
	const isLabMode = transportMode === 'lab';

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
		interactionCount: memoryPatch.interactionCount,
		currentProductFocus: currentState.currentProductFocus || null,
		salesStage: currentState.salesStage || null,
		shownOffers: currentState.shownOffers || [],
		shownPrices: currentState.shownPrices || [],
		sharedLinks: currentState.sharedLinks || [],
		lastRecommendedProduct: currentState.lastRecommendedProduct || null,
		lastRecommendedOffer: currentState.lastRecommendedOffer || null,
		buyingIntentLevel: currentState.buyingIntentLevel || null,
		frictionLevel: currentState.frictionLevel || null,
		commercialSummary: currentState.commercialSummary || null
	};
}

function buildLabTrace({
	intent = null,
	queueDecision = null,
	responsePolicy = null,
	commercialPlan = null,
	catalogProducts = [],
	commercialHints = [],
	assistantMessage = null,
	provider = null,
	model = null,
	aiGuidance = null,
	liveOrderContext = null,
	shouldReply = true
}) {
	return {
		intent,
		queueDecision,
		responsePolicy,
		commercialPlan,
		catalogProducts,
		commercialHints,
		prompt: null,
		assistantMessage,
		provider,
		model,
		aiGuidance,
		liveOrderContext,
		shouldReply
	};
}

export async function processInboundMessage({
	waId,
	contactName,
	messageBody,
	messageType = 'text',
	attachmentMeta = null,
	rawPayload,
	metaMessageId = null,
	transportMode = 'live'
}) {
	const normalizedWaId = normalizeThreadPhone(waId);
	const isLabMode = transportMode === 'lab';

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

		return {
			conversation: freshConversation,
			trace: isLabMode
				? buildLabTrace({
						intent,
						queueDecision,
						responsePolicy: {
							action: 'payment_review_ack',
							useAI: false,
							allowHandoffMention: false,
							maxChars: 180,
							tone: 'amigable_directo'
						},
						commercialPlan: null,
						catalogProducts: [],
						commercialHints: [],
						assistantMessage: ack,
						provider: 'system',
						model: 'payment-proof-router',
						aiGuidance,
						liveOrderContext,
						shouldReply: true
					})
				: null
		};
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

		return {
			conversation: freshConversation,
			trace: isLabMode
				? buildLabTrace({
						intent,
						queueDecision,
						responsePolicy: {
							action: 'handoff_human',
							useAI: false,
							allowHandoffMention: true,
							maxChars: 220,
							tone: 'empatico_concreto'
						},
						commercialPlan: null,
						catalogProducts: [],
						commercialHints: [],
						assistantMessage: handoffReply,
						provider: 'system',
						model: 'human-handoff-router',
						aiGuidance,
						liveOrderContext,
						shouldReply: true
					})
				: null
		};
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
		return {
			conversation: freshConversation,
			trace: isLabMode
				? buildLabTrace({
						intent,
						queueDecision,
						responsePolicy: null,
						commercialPlan: null,
						catalogProducts: [],
						commercialHints: [],
						assistantMessage: null,
						provider: null,
						model: null,
						aiGuidance,
						liveOrderContext,
						shouldReply: false
					})
				: null
		};
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

		if (commercialPlan?.greetingOnly) {
			catalogProducts = [];
			catalogContext = '';
			commercialHints = [
				'Es solo un saludo inicial.',
				'No ofrezcas productos ni promos todavía.',
				'Respondé breve y natural, invitando a contar qué está buscando.'
			];
		} else {
			catalogContext = buildCatalogContext(catalogProducts);
			commercialHints = pickCommercialHints(catalogProducts, commercialPlan);
		}

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
				hasAssistantHistory: fullRecentMessages.some((msg) => msg.role === 'assistant')
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

	const commercialStatePatch = buildCommercialStatePatch({
		currentState: enrichedState,
		commercialPlan,
		finalReply
	});

	if (Object.keys(commercialStatePatch).length) {
		await prisma.conversationState.upsert({
			where: { conversationId: freshConversation.id },
			update: commercialStatePatch,
			create: {
				conversationId: freshConversation.id,
				...commercialStatePatch
			}
		});
	}

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

	return {
		conversation: freshConversation,
		trace: buildLabTrace({
			intent,
			queueDecision,
			responsePolicy,
			commercialPlan,
			catalogProducts,
			commercialHints,
			assistantMessage: finalReply,
			provider: aiMeta?.provider || null,
			model: aiMeta?.model || null,
			aiGuidance,
			liveOrderContext,
			shouldReply: true
		})
	};
}