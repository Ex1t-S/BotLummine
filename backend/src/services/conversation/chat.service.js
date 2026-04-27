import { prisma } from '../../lib/prisma.js';
import { runAssistantReply } from '../ai/index.js';
import { normalizeThreadPhone } from '../../lib/conversation-threads.js';
import { publishInboxEvent } from '../../lib/inbox-events.js';
import {
	detectIntent,
	extractOrderNumber,
	extractStandaloneOrderNumber
} from '../../lib/intent.js';
import {
	analyzeConversationTurn,
	buildHandoffReply
} from './conversation-analysis.service.js';
import {
	searchCatalogProducts,
	buildCatalogContext,
	pickCommercialHints,
	getCatalogLookupStatus
} from '../catalog/catalog-search.service.js';
import { resolveCommercialBrainV2 } from '../ai/commercial-brain.service.js';
import { buildPrompt } from '../common/prompt-builder.js';
import {
	isPaymentProofMessage,
	isAmbiguousPaymentAttachment,
	buildPaymentReviewAck,
	resolveConversationQueue
} from './inbox-routing.service.js';
import { analyzePaymentProofImage } from './payment-proof-vision.service.js';
import {
	normalizeText,
	buildConversationSummary,
	buildAiFailureFallback,
	buildResponsePolicy,
	auditAssistantReply,
	resolveIntentAction,
	buildStatePayload,
	buildFallbackOrderAwareReply,
} from './conversation-helpers.service.js';
import {
	maybeHandleMenuFlow,
	syncHumanHandoff,
} from './menu-flow.service.js';
import { sendAndPersistOutbound } from './outbound-message.service.js';
import { buildMenuAssistantContext } from '../whatsapp/whatsapp-menu.service.js';

function appendMenuHintIfNeeded(text = '', menuAssistantContext = null) {
	const baseText = String(text || '').trim();
	const suffix = String(menuAssistantContext?.suffixText || '').trim();

	if (!baseText || !suffix || !menuAssistantContext?.shouldAppendToReply) {
		return baseText;
	}

	const normalizedBase = baseText.toLowerCase();
	const normalizedSuffix = suffix.toLowerCase();

	if (normalizedBase.includes(normalizedSuffix)) {
		return baseText;
	}

	return `${baseText}\n\n${suffix}`.trim();
}

function findLastOutboundBeforeCurrentInbound(messages = []) {
	for (let index = messages.length - 2; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.direction === 'OUTBOUND') {
			return message;
		}
	}

	return null;
}

function isOutboundCampaignTemplateMessage(message = null) {
	return (
		message?.direction === 'OUTBOUND' &&
		message?.provider === 'whatsapp-cloud-api' &&
		message?.type === 'template' &&
		Boolean(message?.model)
	);
}

function isAbandonedCartCampaignMessage(message = null) {
	const rawPayload = message?.rawPayload || {};
	const model = String(message?.model || rawPayload.campaignTemplateName || '').toLowerCase();
	const audienceSource = String(rawPayload.campaignAudienceSource || '').toLowerCase();

	return (
		isOutboundCampaignTemplateMessage(message) &&
		(audienceSource === 'abandoned_carts' || model === 'carrito_abandonated_v2')
	);
}

function isCampaignFollowupState(currentState = {}) {
	const goal = String(currentState?.lastUserGoal || '').toLowerCase();
	const summary = normalizeText(currentState?.commercialSummary || '');

	return (
		goal.includes('campana') ||
		goal.includes('carrito') ||
		goal.includes('pago_pendiente') ||
		summary.includes('campana')
	);
}

function buildCampaignReplyHints({ currentState = {}, lastOutbound = null } = {}) {
	if (!isOutboundCampaignTemplateMessage(lastOutbound) && !isCampaignFollowupState(currentState)) {
		return [];
	}

	const goal = String(currentState?.lastUserGoal || '').toLowerCase();
	const hints = [
		'La clienta esta respondiendo una campana reciente: no abras el menu principal.',
		'Usa el resumen comercial y el mensaje de plantilla como contexto principal.',
		'Si solo saluda o dice gracias, responde breve retomando el motivo de la campana.',
		'No uses "Cliente" como nombre propio; si no hay nombre real, omitilo.',
		'No suenes celebratoria ni ceremonial: evita felicitaciones largas y frases como "me alegra mucho".',
	];

	if (goal.includes('pago_pendiente')) {
		hints.push('Si viene por pago pendiente, ayuda a completar el pago o confirmar comprobante sin vender otra promo.');
		hints.push('Si envia o confirma comprobante, agradece y deja la conversacion en revision de pago.');
		hints.push('Si solo saluda, contesta que le escribias por el pago pendiente y ofrece ayudar a finalizar o revisar comprobante.');
	} else if (goal.includes('carrito')) {
		hints.push('Si viene por carrito abandonado, resolvi la objecion concreta para que pueda finalizar la compra.');
		hints.push('Si pregunta por talle, envio o cuotas, contesta eso y conserva el link pendiente cuando exista.');
		hints.push('Si tiene miedo por el talle, pedile una referencia concreta de talle/medidas y tranquiliza sin derivar.');
	} else if (goal.includes('promocion')) {
		hints.push('Si viene por promo, explica por que se envio y ofrece ayuda sobre producto, talle, stock o compra.');
		hints.push('No digas que recibiste una consulta si la charla empezo por campana: deci que le escribimos para compartir la promo.');
		hints.push('Si dice que ya compro, agradece breve y ofrece revisar comprobante, pedido o seguimiento si lo necesita.');
	}

	return hints;
}

function looksLikeThirdPartyAutoReply(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;

	return /(gracias\s+por\s+(comunicarte|escribir)\s+(con|a)|te\s+comunicaste\s+con|servicio\s+de\s+guardia|solo\s+llamadas\s+por\s+whatsapp|departamento\s+comercial|por\s+consultas\s+o\s+turnos|estudio\s+juridico|mi\s+nombre\s+es\s+.+\s+en\s+que\s+puedo\s+ayudarte|en\s+un\s+momento\s+te\s+respondo|dejame\s+tu\s+consulta|d[ée]jame\s+tu\s+consulta|te\s+respondo\s+para\s+ayudarte\s+con\s+tu\s+pedido|esper[o]?\s+tenga\s+un\s+buen\s+dia)/i.test(
		normalized
	);
}

function looksLikeCampaignPaymentIssue(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;

	const hasPaymentTopic =
		/(pago|tarjeta|cuotas|banco|mercado pago|mercadopago|transfer|alias|cbu|comprobante)/i.test(
			normalized
		);
	const hasFriction =
		/(error|no me deja|no me dejaba|no podia|problema|recargada|rechaz|no encontre|no figura|me daba|no podia pagar)/i.test(
			normalized
		);

	return hasPaymentTopic && hasFriction;
}

function looksLikeSimplePurchaseCompletion(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;

	const completedPurchase =
		/(ya compre|ya hice la compra|ya hice el pedido|ya realice el pedido|ya realice la compra|ya finalice la compra|ya esta realizado|ya esta hecha|ya lo compre)/i.test(
			normalized
		);
	const asksForFollowUp =
		/(cuando|seguimiento|tracking|pedido|envio|llega|cuanto|donde)/i.test(normalized);

	return completedPurchase && !asksForFollowUp;
}

function looksLikeGenericCampaignReply(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return true;

	if (/^(hola+|holaa+|holis+|buen dia|buenos dias|buenas|gracias|muchas gracias|hola sofi|hola bella|hola hermosa)[!. ]*$/i.test(normalized)) {
		return true;
	}

	if (normalized.length <= 20 && /^(si|sisi|dale|ok|oka|buenas|hola|holaa|holis|gracias)/i.test(normalized)) {
		return true;
	}

	return false;
}

function isPaymentClarifierMessage(message = null) {
	return (
		message?.direction === 'OUTBOUND' &&
		message?.model === 'payment-attachment-clarifier'
	);
}

function looksLikePaymentClarifierConfirmation({ text = '', lastOutbound = null } = {}) {
	if (!isPaymentClarifierMessage(lastOutbound)) {
		return false;
	}

	const normalized = normalizeText(text);
	if (!normalized) return false;

	return /^(si|sí|sisi|sip|correcto|exacto|asi es|así es|es comprobante|si es comprobante|sí es comprobante|es el comprobante|si te mande el comprobante|sí te mandé el comprobante|te mande el comprobante|te mandé el comprobante|comprobante|comprobante de pago)$/i.test(
		normalized
	);
}

async function maybeHandleCampaignReply({
	conversation,
	currentState,
	contactName,
	messageBody,
	messageType,
	rawPayload,
	transportMode,
}) {
	const lastOutbound = findLastOutboundBeforeCurrentInbound(conversation?.messages || []);
	if (!isOutboundCampaignTemplateMessage(lastOutbound) && !isCampaignFollowupState(currentState)) {
		return { handled: false };
	}

	const normalizedBody = normalizeText(messageBody);
	const normalizedMessageType = String(messageType || '').toLowerCase();

	if (normalizedMessageType === 'reaction' || looksLikeThirdPartyAutoReply(normalizedBody)) {
		return {
			handled: true,
			traceModel: 'campaign-autoreply-ignore',
			suppressReply: true,
		};
	}

	return { handled: false };
}

export async function getOrCreateConversation({
	waId,
	contactName,
	queue = 'HUMAN',
	aiEnabled = false,
	forceRouting = false
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
						needsHuman: queue === 'HUMAN' || aiEnabled === false,
						menuActive: false,
						menuPath: null
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
						needsHuman: conversation.queue === 'HUMAN' || conversation.aiEnabled === false,
						menuActive: false,
						menuPath: null
					}
				}
			},
			include: { contact: true, state: true }
		});
	}

	if (forceRouting && (conversation.queue !== queue || conversation.aiEnabled !== aiEnabled)) {
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

	const createdInboundAt = new Date();

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
			rawPayload,
			createdAt: createdInboundAt,
		}
	});

	await prisma.conversation.update({
		where: { id: conversation.id },
		data: {
			lastMessageAt: createdInboundAt,
			lastInboundMessageAt: createdInboundAt,
			unreadCount: {
				increment: 1,
			},
		}
	});

	publishInboxEvent({
		scope: 'message',
		action: 'inbound-created',
		conversationId: conversation.id,
		queue: conversation.queue,
		direction: 'INBOUND',
		metaMessageId,
		createdAt: createdInboundAt.toISOString(),
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
	const lastOutbound = findLastOutboundBeforeCurrentInbound(freshConversation.messages || []);
	let trace = {
		intent: null,
		queueDecision: null,
		responsePolicy: null,
		commercialPlan: null,
		catalogProducts: [],
		commercialHints: [],
		prompt: null,
		assistantMessage: null,
		provider: null,
		model: null,
		aiGuidance: null,
		liveOrderContext: null,
		paymentProofAnalysis: null,
		shouldReply: false,
		menuAssistantContext: null,
	};

	const campaignReplyDecision = await maybeHandleCampaignReply({
		conversation: freshConversation,
		currentState,
		contactName,
		messageBody,
		messageType,
		rawPayload,
		transportMode,
	});

	if (campaignReplyDecision?.handled) {
		trace = {
			...trace,
			intent: 'campaign_reply',
			assistantMessage: null,
			provider: 'system',
			model: campaignReplyDecision.traceModel || 'campaign-reply-router',
			shouldReply: !campaignReplyDecision.suppressReply,
		};
		return { conversation: freshConversation, trace };
	}

	const menuDecision = await maybeHandleMenuFlow({
		conversation: freshConversation,
		currentState,
		contactName,
		messageBody,
		messageType,
		rawPayload,
		transportMode,
		skipMenu: isOutboundCampaignTemplateMessage(lastOutbound) || isCampaignFollowupState(currentState),
	});

	if (menuDecision?.handled) {
		trace = {
			...trace,
			intent: menuDecision?.forceIntent || 'menu',
			assistantMessage: null,
			provider: 'system',
			model: 'menu-flow',
			shouldReply: false,
		};
		return { conversation: freshConversation, trace };
	}

	const effectiveMessageBody = normalizeText(
		menuDecision?.effectiveMessageBody || messageBody
	);
	const summaryUserMessage = normalizeText(
		menuDecision?.summaryUserMessage || effectiveMessageBody || messageBody
	);
	const forceIntent = menuDecision?.forceIntent || null;
	const menuStatePatch = menuDecision?.statePatch || null;

	const intent = forceIntent || detectIntent(effectiveMessageBody, currentState);
	const explicitOrderNumber =
		extractOrderNumber(effectiveMessageBody, currentState) ||
		extractStandaloneOrderNumber(effectiveMessageBody);

	const recentMessages = freshConversation.messages.slice(-8).map((msg) => ({
		role: msg.direction === 'INBOUND' ? 'user' : 'assistant',
		text: msg.body
	}));

	if (recentMessages.length) {
		recentMessages[recentMessages.length - 1] = {
			...recentMessages[recentMessages.length - 1],
			text: summaryUserMessage
		};
	}

	const memoryPatch = analyzeConversationTurn({
		messageBody: effectiveMessageBody,
		intent,
		currentState,
		recentMessages
	});

	if (intent === 'human_handoff') {
		memoryPatch.needsHuman = true;
		memoryPatch.handoffReason = 'requested_human';
	}

	const paymentProofAnalysis = await analyzePaymentProofImage({
		messageType,
		attachmentMeta,
		rawPayload,
	});

	const detectedPaymentProof = isPaymentProofMessage({
		messageType,
		body: effectiveMessageBody,
		rawPayload,
		currentState,
		recentMessages
	}) || looksLikePaymentClarifierConfirmation({
		text: effectiveMessageBody,
		lastOutbound,
	}) || paymentProofAnalysis.isPaymentProof;

	if (detectedPaymentProof) {
		memoryPatch.needsHuman = true;
		memoryPatch.handoffReason = 'payment_proof_review';
		memoryPatch.paymentPreference = memoryPatch.paymentPreference || currentState?.paymentPreference || 'transferencia';
	}

	const ambiguousPaymentAttachment = isAmbiguousPaymentAttachment({
		messageType,
		body: effectiveMessageBody,
		rawPayload,
		currentState,
		recentMessages
	});

	let queueDecision = resolveConversationQueue({
		currentConversation: freshConversation,
		memoryPatch,
		detectedPaymentProof,
		aiDeclaredHandoff: false
	});

	const shouldUnlockCampaignHumanLock =
		!detectedPaymentProof &&
		(isOutboundCampaignTemplateMessage(lastOutbound) || isCampaignFollowupState(currentState)) &&
		freshConversation.queue === 'HUMAN' &&
		currentState?.handoffReason === 'campaign_reply_pending_human';

	if (shouldUnlockCampaignHumanLock) {
		queueDecision = {
			queue: 'AUTO',
			aiEnabled: true,
		};
		memoryPatch.needsHuman = false;
		memoryPatch.handoffReason = null;
	}

	if (menuDecision?.queueDecisionOverride && !detectedPaymentProof) {
		queueDecision = menuDecision.queueDecisionOverride;
	}

	const intentResult = await resolveIntentAction({
		intent,
		messageBody: effectiveMessageBody,
		explicitOrderNumber,
		currentState
	});

	const aiGuidance = intentResult.aiGuidance || null;
	const liveOrderContext = intentResult.liveOrderContext || null;
	const forcedReply = intentResult.forcedReply || null;

	trace = {
		...trace,
		intent,
		queueDecision,
		aiGuidance,
		liveOrderContext,
		paymentProofAnalysis: paymentProofAnalysis.analyzed ? paymentProofAnalysis : null,
	};

	const nextStatePayload = buildStatePayload({
		currentState,
		contactName,
		normalizedWaId,
		intent,
		explicitOrderNumber,
		liveOrderContext,
		memoryPatch,
		menuStatePatch
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

	if (ambiguousPaymentAttachment && !detectedPaymentProof) {
		const clarification =
			'Recibi la imagen o archivo. Es un comprobante de pago o queres que revise otra cosa de la foto?';
		trace = {
			...trace,
			assistantMessage: clarification,
			provider: 'system',
			model: 'payment-attachment-clarifier',
			shouldReply: false,
		};

		await sendAndPersistOutbound({
			conversationId: freshConversation.id,
			body: clarification,
			deliveryMode: transportMode,
			aiMeta: {
				provider: 'system',
				model: 'payment-attachment-clarifier',
				raw: { ambiguousPaymentAttachment: true }
			}
		});

		await prisma.conversation.update({
			where: { id: freshConversation.id },
			data: {
				lastSummary: buildConversationSummary({
					intent,
					enrichedState,
					lastUserMessage: summaryUserMessage,
					lastAssistantMessage: clarification,
					liveOrderContext
				})
			}
		});

		return { conversation: freshConversation, trace };
	}

	if (detectedPaymentProof) {
		const ack = buildPaymentReviewAck();
		trace = {
			...trace,
			assistantMessage: ack,
			provider: 'system',
			model: 'payment-proof-router',
			shouldReply: false,
		};

		await sendAndPersistOutbound({
			conversationId: freshConversation.id,
			body: ack,
			deliveryMode: transportMode,
			aiMeta: {
				provider: 'system',
				model: 'payment-proof-router',
				raw: {
					detectedPaymentProof: true,
					paymentProofAnalysis: paymentProofAnalysis.analyzed ? paymentProofAnalysis : null,
				}
			}
		});

		await prisma.conversation.update({
			where: { id: freshConversation.id },
			data: {
				lastSummary: buildConversationSummary({
					intent,
					enrichedState,
					lastUserMessage: summaryUserMessage,
					lastAssistantMessage: ack,
					liveOrderContext
				})
			}
		});

		return { conversation: freshConversation, trace };
	}

	const handoffJustTriggered = enrichedState.needsHuman && !currentState.needsHuman;

	if (handoffJustTriggered) {
		const handoffReply = buildHandoffReply({
			contactName: freshConversation.contact.name || '',
			reason: enrichedState.handoffReason
		});

		trace = {
			...trace,
			assistantMessage: handoffReply,
			provider: 'system',
			model: 'human-handoff-router',
			shouldReply: false,
		};

		await sendAndPersistOutbound({
			conversationId: freshConversation.id,
			body: handoffReply,
			deliveryMode: transportMode,
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
					lastUserMessage: summaryUserMessage,
					lastAssistantMessage: handoffReply,
					liveOrderContext
				})
			}
		});

		return { conversation: freshConversation, trace };
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
		trace = {
			...trace,
			shouldReply: false,
		};
		return { conversation: freshConversation, trace };
	}

	const maxContext = Number(process.env.MAX_CONTEXT_MESSAGES || 12);

	const fullRecentMessages = freshConversation.messages.slice(-maxContext).map((msg) => ({
		role: msg.direction === 'INBOUND' ? 'user' : 'assistant',
		text: msg.body
	}));

	if (fullRecentMessages.length) {
		fullRecentMessages[fullRecentMessages.length - 1] = {
			...fullRecentMessages[fullRecentMessages.length - 1],
			text: summaryUserMessage
		};
	}

	let catalogProducts = [];
	let catalogContext = '';
	let commercialHints = [];
	let commercialPlan = null;
	let menuAssistantContext = null;

	try {
		catalogProducts = await searchCatalogProducts({
			query: effectiveMessageBody,
			interestedProducts: enrichedState.interestedProducts || [],
			limit: 5
		});

		const catalogStatus = await getCatalogLookupStatus();

		commercialPlan = {
			...resolveCommercialBrainV2({
				intent,
				messageBody: effectiveMessageBody,
				currentState: enrichedState,
				recentMessages: fullRecentMessages,
				catalogProducts
			}),
			catalogAvailable: catalogStatus.available !== false,
			catalogStatusReason: catalogStatus.reason || 'ok',
			catalogStatusMessage: catalogStatus.message || null
		};

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
		} else if (intent === 'product' && commercialPlan?.catalogAvailable === false) {
			catalogProducts = [];
			catalogContext = 'Catálogo local no disponible en esta base. No hay productos confirmados para ofrecer.';
			commercialPlan = {
				...commercialPlan,
				bestOffer: null,
				fallbackOffer: null,
				offerOptions: [],
				requestedOfferAvailable: null,
				shareLinkNow: false,
				repeatPriceNow: false,
				recommendedAction: 'catalog_unavailable_clarify_need'
			};
			commercialHints = [
				'El catálogo local no está disponible en esta base.',
				'No inventes productos, promos, precios ni links.',
				'Pedí una aclaración corta o ofrecé pasar con una asesora.'
			];
		} else {
			catalogContext = buildCatalogContext(catalogProducts);
			commercialHints = pickCommercialHints(catalogProducts, commercialPlan);
		}

		const campaignHints = buildCampaignReplyHints({
			currentState: enrichedState,
			lastOutbound,
		});

		if (campaignHints.length) {
			commercialHints = [
				...campaignHints,
				...commercialHints.filter((hint) => !/solo un saludo inicial|no ofrezcas productos/i.test(hint)),
			];
			commercialPlan = {
				...commercialPlan,
				campaignFollowup: true,
			};
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
		if (commercialPlan?.categoryLocked && commercialPlan?.productFamilyLabel) {
			commercialHints.push(`No cambies de familia: seguí en ${commercialPlan.productFamilyLabel}.`);
		}
		if (commercialPlan?.excludedKeywords?.length) {
			commercialHints.push(`No vuelvas a ofrecer: ${commercialPlan.excludedKeywords.join(', ')}.`);
		}
		if (commercialPlan?.justRejectedOption && commercialPlan?.bestOffer?.name) {
			commercialHints.push(`Acaba de rechazar una opcion. Reconocelo breve y segui con ${commercialPlan.bestOffer.name} sin volver a nombrar lo excluido.`);
		}
		if (commercialPlan?.requestedOfferType && commercialPlan?.requestedOfferAvailable === false && commercialPlan?.fallbackOffer?.name) {
			commercialHints.push(`La ${commercialPlan.requestedOfferType} exacta no apareció. Decilo claro y ofrecé ${commercialPlan.fallbackOffer.name} sin salir de la misma familia.`);
		}
		commercialHints.push('Bajá el tono celebratorio y soná más natural.');

		const patchedStatePayload = {
			...nextStatePayload,
			currentProductFocus: commercialPlan?.productFocusLabel || commercialPlan?.productFocus || nextStatePayload.currentProductFocus || null,
			currentProductFamily: commercialPlan?.productFamily || nextStatePayload.currentProductFamily || null,
			requestedOfferType: commercialPlan?.requestedOfferType || nextStatePayload.requestedOfferType || null,
			excludedProductKeywords: commercialPlan?.excludedKeywords?.length
				? commercialPlan.excludedKeywords
				: nextStatePayload.excludedProductKeywords || [],
			categoryLocked:
				typeof commercialPlan?.categoryLocked === 'boolean'
					? commercialPlan.categoryLocked
					: nextStatePayload.categoryLocked || false,
			salesStage: commercialPlan?.stage || nextStatePayload.salesStage || null,
			shownOffers: commercialPlan?.bestOffer?.offerLabel
				? [...new Set([...(Array.isArray(nextStatePayload.shownOffers) ? nextStatePayload.shownOffers : []), commercialPlan.bestOffer.offerLabel])]
				: nextStatePayload.shownOffers || [],
			shownPrices: commercialPlan?.repeatPriceNow && commercialPlan?.bestOffer?.price
				? [...new Set([...(Array.isArray(nextStatePayload.shownPrices) ? nextStatePayload.shownPrices : []), `${commercialPlan.bestOffer.name}::${commercialPlan.bestOffer.price}`])]
				: nextStatePayload.shownPrices || [],
			sharedLinks: commercialPlan?.shareLinkNow && commercialPlan?.bestOffer?.productUrl
				? [...new Set([...(Array.isArray(nextStatePayload.sharedLinks) ? nextStatePayload.sharedLinks : []), commercialPlan.bestOffer.productUrl])]
				: nextStatePayload.sharedLinks || [],
			lastRecommendedProduct: commercialPlan?.bestOffer?.name || nextStatePayload.lastRecommendedProduct || null,
			lastRecommendedOffer: commercialPlan?.bestOffer?.offerLabel || nextStatePayload.lastRecommendedOffer || null,
			buyingIntentLevel: commercialPlan?.buyingIntentLevel || nextStatePayload.buyingIntentLevel || null,
			commercialSummary: buildConversationSummary({
				intent,
				enrichedState: { ...enrichedState, currentProductFocus: commercialPlan?.productFocusLabel || commercialPlan?.productFocus || nextStatePayload.currentProductFocus || null },
				lastUserMessage: summaryUserMessage,
				lastAssistantMessage: '',
				liveOrderContext,
				commercialPlan
			})
		};

		Object.assign(nextStatePayload, patchedStatePayload);
		Object.assign(enrichedState, patchedStatePayload);

		await prisma.conversationState.upsert({
			where: { conversationId: freshConversation.id },
			update: patchedStatePayload,
			create: {
				conversationId: freshConversation.id,
				...patchedStatePayload
			}
		});
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

	try {
		menuAssistantContext = await buildMenuAssistantContext({
			intent,
			currentState: enrichedState,
			responsePolicy,
			commercialPlan,
			queueDecision,
		});
	} catch (menuContextError) {
		console.error('[MENU ASSISTANT] No se pudo construir el contexto:', menuContextError);
	}

	trace = {
		...trace,
		responsePolicy,
		commercialPlan,
		catalogProducts,
		commercialHints,
		shouldReply: true,
		menuAssistantContext,
	};

	let finalReply = forcedReply || null;
	let aiMeta = null;
	let prompt = null;

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
			prompt = buildPrompt({
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
				responsePolicy,
				menuAssistantContext
			});

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
				responsePolicy,
				menuAssistantContext
			});

			const fallbackReply = buildFallbackOrderAwareReply({
				intent,
				liveOrderContext,
				enrichedState,
				catalogProducts,
				commercialPlan,
			});

			const audited = auditAssistantReply({
				text: aiResult?.text || '',
				responsePolicy,
				liveOrderContext,
				fallbackReply,
				commercialPlan,
				recentMessages: fullRecentMessages,
				contactName: freshConversation.contact.name || freshConversation.contact.waId,
				businessName: process.env.BUSINESS_NAME || 'Lummine',
				agentName: process.env.BUSINESS_AGENT_NAME || 'Sofi'
			});

			finalReply = appendMenuHintIfNeeded(
				audited.finalText,
				menuAssistantContext
			);
			aiMeta = aiResult;

			if (audited.triggerHumanHandoff) {
				await syncHumanHandoff({
					conversationId: freshConversation.id,
					reason: commercialPlan?.handoffReason || 'ai_declared_handoff'
				});
			}
		} catch (aiError) {
			console.error('Error en flujo de respuesta automática:', aiError);

			finalReply = buildFallbackOrderAwareReply({
				intent,
				liveOrderContext,
				enrichedState,
				catalogProducts,
				commercialPlan,
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

	if (forcedReply) {
		finalReply = appendMenuHintIfNeeded(finalReply, menuAssistantContext);
	}

	trace = {
		...trace,
		prompt,
		assistantMessage: finalReply,
		provider: aiMeta?.provider || (forcedReply ? 'system' : null),
		model: aiMeta?.model || (forcedReply ? 'rule-based-forced-reply' : null),
	};

	await sendAndPersistOutbound({
		conversationId: freshConversation.id,
		body: finalReply,
		deliveryMode: transportMode,
		aiMeta
	});

	await prisma.conversation.update({
		where: { id: freshConversation.id },
		data: {
			lastSummary: buildConversationSummary({
				intent,
				enrichedState,
				lastUserMessage: summaryUserMessage,
				lastAssistantMessage: finalReply,
				liveOrderContext,
				commercialPlan
			})
		}
	});

	return { conversation: freshConversation, trace };
}
