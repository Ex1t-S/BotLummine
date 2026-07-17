import { prisma } from '../../lib/prisma.js';
import { logger, maskPhone } from '../../lib/logger.js';
import { createAiTurnTrace, logAiTurnTrace } from '../ai/turn-trace.js';
import { validateAssistantOutput } from '../ai/assistant-output.js';
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
import { compilePrompt } from '../common/prompt-builder.js';
import {
	isPaymentProofMessage,
	isAmbiguousPaymentAttachment,
	PAYMENT_REVIEW_ACK,
	resolveConversationQueue
} from './inbox-routing.service.js';
import {
	classifyInboundAttachment,
	attachmentClassificationLooksLikeReturnEvidence
} from './attachment-classifier.service.js';
import {
	normalizeText,
	buildConversationSummary,
	buildAiFailureFallback,
	buildCatalogSafetyFallback,
	buildResponsePolicy,
	auditAssistantReply,
	resolveIntentAction,
	shouldForceCatalogSafetyFallback,
	buildStatePayload,
	buildFallbackOrderAwareReply,
	resolveReplyGate,
	sanitizeStateForSupportPrompt,
	isSupportIntent,
	isDkvWorkspace,
	isUnableToContinueHandoffReply,
	buildUnableToContinueHandoffReply,
} from './conversation-helpers.service.js';
import {
	maybeHandleMenuFlow,
	syncHumanHandoff,
} from './menu-flow.service.js';
import { sendAndPersistOutbound } from './outbound-message.service.js';
import { maybeForwardPaymentProof } from './payment-proof-forwarding.service.js';
import { buildMenuAssistantContext } from '../whatsapp/whatsapp-menu.service.js';
import {
	DEFAULT_WORKSPACE_ID,
	getWorkspaceRuntimeConfig,
	normalizeWorkspaceId,
} from '../workspaces/workspace-context.service.js';
import {
	WORKSPACE_FEATURE_FLAGS,
	isWorkspaceFeatureEnabled,
} from '../workspaces/workspace-feature-flags.service.js';
import {
	buildVerticalNonCommercePlan,
	getAiVerticalProfile,
	resolveAiProfile,
	resolveAiVertical,
	usesCommerceEngine,
} from '../ai/vertical-profile.service.js';
import { persistChatConfirmationConversions } from '../campaigns/campaign-attribution.service.js';
import {
	looksLikeThirdPartyAutoReply as looksLikeThirdPartyAutoReplySignal,
	shouldTreatAsPreSaleObjection,
} from './conversation-signals.service.js';

const AUTO_REPLY_COOLDOWN_MS = Number(process.env.AI_REPLY_COOLDOWN_MS || 10_000);
const AUTO_REPLY_COOLDOWN_SWEEP_MS = Number(process.env.AI_REPLY_COOLDOWN_SWEEP_MS || 0);
const pendingAutoReplyTimers = new Map();
let pendingAutoReplySweepStarted = false;

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

function isCatalogFollowUpRequest(text = '') {
	const normalized = normalizeText(text);
	if (!normalized || normalized.length > 90) return false;
	if (/^\[(imagen|documento|audio|video|sticker|archivo)\s+recibid[oa]/i.test(normalized)) return false;
	return /(link|url|web|comprar|foto|fotos|imagen|imagenes|video|mandame|enviame|pasame|ver|mostrame|muestrame)/i.test(normalized);
}

function buildCatalogQueryContext({
	messageBody = '',
	currentState = {},
	recentMessages = [],
} = {}) {
	const genericStateValues = new Set([
		'soporte de venta',
		'consulta_general',
		'consulta general',
		'general',
	]);
	const cleanHint = (value) => {
		const raw = String(value || '').trim();
		const normalized = normalizeText(raw);
		if (!normalized || normalized.length < 3 || genericStateValues.has(normalized)) return null;
		if (/^[.,;:!?]+$/.test(raw)) return null;
		return raw;
	};
	const recentUserHints = recentMessages
		.filter((message) => message.role === 'user')
		.map((message) => cleanHint(message.text))
		.filter(Boolean)
		.slice(-4);
	const stateHints = [
		...(Array.isArray(currentState.interestedProducts) ? currentState.interestedProducts : []),
		currentState.currentProductFocus,
		currentState.lastRecommendedProduct,
		currentState.currentProductFamily,
	]
		.map(cleanHint)
		.filter(Boolean);

	return [messageBody, ...recentUserHints, ...stateHints].filter(Boolean).join(' ');
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

function isAbandonedCartCampaignMessage(message = null) {
	return (
		message?.direction === 'OUTBOUND' &&
		message?.provider === 'whatsapp-cloud-api' &&
		(
			message?.model === 'carrito_abandonated_v2' ||
			message?.rawPayload?.campaignMeta?.campaignId ||
			message?.rawPayload?.campaignMeta?.audienceSource
		)
	);
}

function isCampaignOutboundMessage(message = null) {
	return Boolean(
		message?.direction === 'OUTBOUND' &&
		message?.type === 'template' &&
		message?.rawPayload?.campaignMeta?.campaignId
	);
}

function normalizeCampaignSource(value = '') {
	return String(value || '').trim().toLowerCase();
}

function getCampaignMeta(message = null) {
	return message?.rawPayload?.campaignMeta || null;
}

function buildCampaignPromptBlock(context = {}) {
	return [
		`Tipo: ${context.category}`,
		`Objetivo: ${context.objective}`,
		context.templateName ? `Template: ${context.templateName}` : '',
		context.previewText ? `Mensaje enviado: ${String(context.previewText).slice(0, 500)}` : '',
		`Como responder: ${context.responseFrame}`,
		'Si la respuesta del cliente es vaga o confirma interes, continua con este objetivo de campania.',
		'Si el cliente cambia claramente de tema, atende el nuevo tema y no fuerces la campania.',
		'Si el cliente trae una objecion preventa, resolvela comercialmente antes de derivar.',
		'Si hay reclamo postventa real, frustracion o pedido humano, deriva sin insistir con venta.'
	].filter(Boolean).join('\n');
}

function classifyCampaignContext(message = null) {
	if (!isCampaignOutboundMessage(message)) return null;

	const meta = getCampaignMeta(message) || {};
	const source = normalizeCampaignSource(meta.audienceSource || '');
	const templateName = normalizeText(message?.model || meta.templateName || '');
	const templateKey = normalizeCampaignSource(templateName);
	const previewText = normalizeText(message?.body || '');
	let category = 'sales';
	let objective = 'venta';
	let responseFrame =
		'Responder como venta consultiva sobre el producto o promocion enviados en la campania.';

	if (source === 'abandoned_carts' || /carrito|abandon/.test(templateKey)) {
		category = 'cart_recovery';
		objective = 'recuperacion_de_carrito';
		responseFrame =
			'Recuperar el carrito: resolver dudas que frenan la compra, recordar beneficio o link ya enviado si aplica, y facilitar que termine la compra.';
	} else if (source === 'pending_payment' || /pago|payment|pendiente/.test(templateKey)) {
		category = 'pending_payment';
		objective = 'pago_pendiente';
		responseFrame =
			'Ayudar a completar el pago pendiente: aclarar medios de pago, comprobante o proximo paso sin vender otro producto.';
	} else if (source === 'customers' || source === 'manual' || source === 'marketing') {
		category = 'sales';
		objective = 'venta_promocionada';
		responseFrame =
			'Vender o explicar el producto/promocion de la campania, manteniendo foco en lo enviado.';
	}

	return {
		category,
		objective,
		source: source || 'manual',
		audienceSource: source || 'manual',
		campaignId: meta.campaignId || null,
		templateName,
		previewText,
		responseFrame,
		detectedAt: new Date().toISOString(),
		lastUsedAt: new Date().toISOString(),
		promptBlock: buildCampaignPromptBlock({
			category,
			objective,
			templateName,
			previewText,
			responseFrame,
		})
	};
}

function looksLikeThirdPartyAutoReply(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	if (/(gracias\s+por\s+tu\s+mensaje|no\s+atendemos\s+llamadas|no\s+hacemos\s+ventas\s+online|dejanos\s+tu\s+mensaje|d[ée]janos\s+tu\s+mensaje|horarios?:|lunes\s+a\s+viernes)/i.test(normalized)) return true;

	return /(gracias\s+por\s+(comunicarte|escribir)\s+(con|a)|te\s+comunicaste\s+con|servicio\s+de\s+guardia|solo\s+llamadas\s+por\s+whatsapp|departamento\s+comercial|por\s+consultas\s+o\s+turnos|estudio\s+juridico|mi\s+nombre\s+es\s+.+\s+en\s+que\s+puedo\s+ayudarte|en\s+un\s+momento\s+te\s+respondo|dejame\s+tu\s+consulta|d[ée]jame\s+tu\s+consulta|te\s+respondo\s+para\s+ayudarte\s+con\s+tu\s+pedido|esper[o]?\s+tenga\s+un\s+buen\s+dia)/i.test(
		normalized
	);
}

function normalizeStoredCampaignContext(value = null) {
	if (!value || typeof value !== 'object') return null;
	if (!value.category || !value.objective) return null;
	return {
		...value,
		responseFrame: value.responseFrame || 'Responder segun el objetivo de la campania y el mensaje actual.',
		promptBlock: buildCampaignPromptBlock(value),
		lastUsedAt: new Date().toISOString(),
	};
}

function getActiveCampaignContext(lastOutbound = null, currentState = {}) {
	return classifyCampaignContext(lastOutbound) || normalizeStoredCampaignContext(currentState?.campaignContext);
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

async function maybeHandleAbandonedCartReply({
	conversation,
	messageBody,
	messageType,
}) {
	const lastOutbound = findLastOutboundBeforeCurrentInbound(conversation?.messages || []);
	if (!isAbandonedCartCampaignMessage(lastOutbound)) {
		return { handled: false };
	}

	const normalizedBody = normalizeText(messageBody);
	const normalizedMessageType = String(messageType || '').toLowerCase();

	if (['image', 'document'].includes(normalizedMessageType)) {
		return { handled: false };
	}

	if (looksLikeThirdPartyAutoReplySignal(normalizedBody)) {
		return {
			handled: true,
			traceModel: 'campaign-autoreply-ignore',
			suppressReply: true,
		};
	}

	return { handled: false };
}

function clearPendingAutoReply(conversationId) {
	const timer = pendingAutoReplyTimers.get(conversationId);
	if (timer) {
		clearTimeout(timer);
		pendingAutoReplyTimers.delete(conversationId);
	}
}

async function processPendingAutoReply(conversationId, { workspaceId = null, transportMode = 'live' } = {}) {
	const state = await prisma.conversationState.findUnique({
		where: { conversationId },
		include: {
			conversation: {
				include: {
					contact: true,
				},
			},
		},
	});
	if (!state?.pendingAutoReplyMessageId || !state?.pendingAutoReplyDueAt) return false;
	if (new Date(state.pendingAutoReplyDueAt).getTime() > Date.now()) return false;

	const claimed = await prisma.conversationState.updateMany({
		where: {
			conversationId,
			pendingAutoReplyMessageId: state.pendingAutoReplyMessageId,
			pendingAutoReplyLockedAt: null,
		},
		data: {
			pendingAutoReplyLockedAt: new Date(),
		},
	});
	if (!claimed.count) return false;

	try {
		const inbound = await prisma.message.findFirst({
			where: {
				id: state.pendingAutoReplyMessageId,
				conversationId,
				direction: 'INBOUND',
			},
			include: {
				conversation: {
					include: {
						contact: true,
					},
				},
			},
		});
		if (!inbound) return false;

		await processInboundMessage({
			workspaceId: workspaceId || inbound.workspaceId,
			waId: inbound.conversation?.contact?.waId,
			contactName:
				inbound.conversation?.contact?.name ||
				inbound.senderName ||
				inbound.conversation?.contact?.waId,
			messageBody: inbound.body,
			messageType: inbound.type || 'text',
			attachmentMeta: {
				attachmentUrl: inbound.attachmentUrl,
				attachmentMimeType: inbound.attachmentMimeType,
				attachmentName: inbound.attachmentName,
			},
			rawPayload: inbound.rawPayload,
			metaMessageId: inbound.metaMessageId,
			transportMode,
			existingInboundMessageId: inbound.id,
			bypassResponseCooldown: true,
		});

		await prisma.conversationState.updateMany({
			where: {
				conversationId,
				pendingAutoReplyMessageId: inbound.id,
			},
			data: {
				pendingAutoReplyMessageId: null,
				pendingAutoReplyDueAt: null,
				pendingAutoReplyLockedAt: null,
			},
		});
		return true;
	} catch (error) {
		await prisma.conversationState.updateMany({
			where: { conversationId },
			data: { pendingAutoReplyLockedAt: null },
		}).catch(() => {});
		throw error;
	}
}

function scheduleAutoReplyCooldown({
	conversationId,
	workspaceId,
	messageId,
	transportMode = 'live',
	delayMs = AUTO_REPLY_COOLDOWN_MS,
}) {
	if (!conversationId || delayMs <= 0) return false;

	clearPendingAutoReply(conversationId);
	const dueAt = new Date(Date.now() + delayMs);
	if (messageId) {
		prisma.conversationState.updateMany({
			where: { conversationId },
			data: {
				pendingAutoReplyMessageId: messageId,
				pendingAutoReplyDueAt: dueAt,
				pendingAutoReplyLockedAt: null,
			},
		}).catch((error) => {
			logger.warn('ai.cooldown_persist_failed', { workspaceId, conversationId, error });
		});
	}

	const timer = setTimeout(async () => {
		pendingAutoReplyTimers.delete(conversationId);

		try {
			await processPendingAutoReply(conversationId, { workspaceId, transportMode });
		} catch (error) {
			logger.error('ai.cooldown_autoreply_failed', {
				workspaceId,
				conversationId,
				error,
			});
		}
	}, Math.max(0, dueAt.getTime() - Date.now()));
	if (typeof timer.unref === 'function') timer.unref();

	pendingAutoReplyTimers.set(conversationId, timer);
	return true;
}

async function sweepPendingAutoReplies() {
	const dueStates = await prisma.conversationState.findMany({
		where: {
			pendingAutoReplyMessageId: { not: null },
			pendingAutoReplyDueAt: { lte: new Date() },
			pendingAutoReplyLockedAt: null,
		},
		take: 25,
		include: {
			conversation: true,
		},
	});

	for (const state of dueStates) {
		processPendingAutoReply(state.conversationId, {
			workspaceId: state.conversation?.workspaceId || null,
			transportMode: 'live',
		}).catch((error) => {
			logger.error('ai.cooldown_sweep_failed', {
				workspaceId: state.conversation?.workspaceId || null,
				conversationId: state.conversationId,
				error,
			});
		});
	}
}

function startPendingAutoReplySweep() {
	if (pendingAutoReplySweepStarted || AUTO_REPLY_COOLDOWN_SWEEP_MS <= 0) return;
	pendingAutoReplySweepStarted = true;
	const timer = setInterval(() => {
		sweepPendingAutoReplies().catch((error) => {
			logger.error('ai.cooldown_sweep_tick_failed', { error });
		});
	}, AUTO_REPLY_COOLDOWN_SWEEP_MS);
	if (typeof timer.unref === 'function') timer.unref();
}

startPendingAutoReplySweep();

export async function getOrCreateConversation({
	workspaceId = DEFAULT_WORKSPACE_ID,
	waId,
	contactName,
	profileImageUrl,
	profileImageSource = 'unknown',
	queue = 'HUMAN',
	aiEnabled = false,
	forceRouting = false
}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedWaId = normalizeThreadPhone(waId);
	const normalizedProfileImageUrl = String(profileImageUrl || '').trim();
	const hasProfileImageUrl = Boolean(normalizedProfileImageUrl);
	const profileImageData = hasProfileImageUrl
		? {
				profileImageUrl: normalizedProfileImageUrl,
				profileImageSource: String(profileImageSource || 'unknown').trim() || 'unknown',
				profileImageUpdatedAt: new Date(),
		  }
		: {};

	const contact = await prisma.contact.upsert({
		where: {
			workspaceId_waId: {
				workspaceId: resolvedWorkspaceId,
				waId: normalizedWaId,
			},
		},
		update: {
			name: contactName || undefined,
			phone: normalizedWaId,
			...profileImageData
		},
		create: {
			workspaceId: resolvedWorkspaceId,
			waId: normalizedWaId,
			phone: normalizedWaId,
			name: contactName || normalizedWaId,
			...profileImageData
		}
	});

	let conversation = await prisma.conversation.findFirst({
		where: { workspaceId: resolvedWorkspaceId, contactId: contact.id },
		include: { contact: true, state: true }
	});

	if (!conversation) {
		conversation = await prisma.conversation.create({
			data: {
				contactId: contact.id,
				workspaceId: resolvedWorkspaceId,
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
	workspaceId = DEFAULT_WORKSPACE_ID,
	waId,
	contactName,
	profileImageUrl,
	profileImageSource = 'unknown',
	messageBody,
	messageType = 'text',
	attachmentMeta = null,
	rawPayload,
	metaMessageId = null,
	transportMode = 'live',
	existingInboundMessageId = null,
	bypassResponseCooldown = false,
}) {
	const turnStartedAt = Date.now();
	let resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	let normalizedWaId = normalizeThreadPhone(waId);
	let conversation = null;
	let createdInboundAt = new Date();
	let inboundMessage = null;

	function finalizeInboundResult({ conversation: resultConversation = null, trace: legacyTrace = null }) {
		const route = legacyTrace?.queueDecision?.queue || resultConversation?.queue || 'AUTO';
		const handoffReason = legacyTrace?.queueDecision?.reason
			|| (route === 'HUMAN' ? 'human_route' : null);
		const turnTrace = createAiTurnTrace({
			workspaceId: resolvedWorkspaceId,
			conversationId: resultConversation?.id || conversation?.id || null,
			promptVersion: legacyTrace?.promptVersion,
			promptHash: legacyTrace?.promptHash,
			route,
			intent: legacyTrace?.intent,
			retrievedFacts: legacyTrace?.factsUsed,
			provider: legacyTrace?.provider,
			model: legacyTrace?.model,
			latencyMs: Date.now() - turnStartedAt,
			usage: legacyTrace?.usage,
			audit: legacyTrace?.audit,
			handoff: handoffReason ? { reason: handoffReason } : null,
		});
		logAiTurnTrace(turnTrace);

		return {
			conversation: resultConversation,
			trace: legacyTrace ? { ...legacyTrace, turnTrace } : null,
			turnTrace,
		};
	}

	if (existingInboundMessageId) {
		inboundMessage = await prisma.message.findUnique({
			where: { id: existingInboundMessageId },
			include: {
				conversation: {
					include: {
						contact: true,
						state: true,
					},
				},
			},
		});

		if (!inboundMessage || inboundMessage.direction !== 'INBOUND') {
			return finalizeInboundResult({ conversation: null });
		}

		conversation = inboundMessage.conversation;
		resolvedWorkspaceId = inboundMessage.workspaceId;
		normalizedWaId = normalizeThreadPhone(conversation?.contact?.waId || waId);
		contactName = contactName || inboundMessage.senderName || conversation?.contact?.name || normalizedWaId;
		messageBody = inboundMessage.body;
		messageType = inboundMessage.type || messageType || 'text';
		rawPayload = inboundMessage.rawPayload || rawPayload;
		metaMessageId = inboundMessage.metaMessageId || metaMessageId;
		attachmentMeta = {
			attachmentUrl: inboundMessage.attachmentUrl,
			attachmentMimeType: inboundMessage.attachmentMimeType,
			attachmentName: inboundMessage.attachmentName,
			...(attachmentMeta || {}),
		};
		createdInboundAt = inboundMessage.createdAt || createdInboundAt;
	} else {
		conversation = await getOrCreateConversation({
			workspaceId: resolvedWorkspaceId,
			waId: normalizedWaId,
			contactName,
			profileImageUrl,
			profileImageSource
		});
	}

	if (!existingInboundMessageId && metaMessageId) {
		const existingMessage = await prisma.message.findFirst({
			where: {
				workspaceId: resolvedWorkspaceId,
				metaMessageId
			}
		});

		if (existingMessage) {
			return finalizeInboundResult({ conversation });
		}
	}

	if (!existingInboundMessageId) {
		inboundMessage = await prisma.message.create({
			data: {
				conversationId: conversation.id,
				workspaceId: resolvedWorkspaceId,
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
		await persistChatConfirmationConversions({
			workspaceId: resolvedWorkspaceId,
			conversationId: conversation.id,
			messageId: inboundMessage.id,
			messageBody,
			contactName,
			phone: normalizedWaId,
			createdAt: createdInboundAt,
		}).catch((error) => {
			logger.warn('campaign.attribution_chat_failed', {
				workspaceId: resolvedWorkspaceId,
				conversationId: conversation.id,
				phone: maskPhone(normalizedWaId),
				error,
			});
		});
	}

	if (!existingInboundMessageId) {
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
	}

	if (!existingInboundMessageId) {
		publishInboxEvent({
			workspaceId: resolvedWorkspaceId,
			scope: 'message',
			action: 'inbound-created',
			conversationId: conversation.id,
			queue: conversation.queue,
			direction: 'INBOUND',
			metaMessageId,
			createdAt: createdInboundAt.toISOString(),
		});
	}

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
		return finalizeInboundResult({ conversation });
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
		shouldReply: false,
		menuAssistantContext: null,
		campaignAssistantContext: null,
	};

	const abandonedCartDecision = await maybeHandleAbandonedCartReply({
		conversation: freshConversation,
		currentState,
		contactName,
		messageBody,
		messageType,
		rawPayload,
		transportMode,
	});

	if (abandonedCartDecision?.handled) {
		trace = {
			...trace,
			intent: 'campaign_reply',
			assistantMessage: null,
			provider: 'system',
			model: abandonedCartDecision.traceModel || 'campaign-reply-router',
			shouldReply: !abandonedCartDecision.suppressReply,
		};
		return finalizeInboundResult({ conversation: freshConversation, trace });
	}

	const menuDecision = await maybeHandleMenuFlow({
		conversation: freshConversation,
		currentState,
		contactName,
		messageBody,
		messageType,
		rawPayload,
		transportMode,
		skipMenu: isCampaignOutboundMessage(lastOutbound),
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
		return finalizeInboundResult({ conversation: freshConversation, trace });
	}

	const effectiveMessageBody = normalizeText(
		menuDecision?.effectiveMessageBody || messageBody
	);
	const summaryUserMessage = normalizeText(
		menuDecision?.summaryUserMessage || effectiveMessageBody || messageBody
	);
	const isCampaignReply = isCampaignOutboundMessage(lastOutbound);
	const campaignAssistantContext = getActiveCampaignContext(lastOutbound, currentState);
	const forceIntent = menuDecision?.forceIntent || null;
	const menuStatePatch = menuDecision?.statePatch || null;
	const workspaceConfig = await getWorkspaceRuntimeConfig(resolvedWorkspaceId);
	const aiBrand = workspaceConfig.ai;
	const aiProfile = resolveAiProfile({ workspaceConfig, workspaceId: resolvedWorkspaceId });
	const vertical = resolveAiVertical({ workspaceConfig, workspaceId: resolvedWorkspaceId });
	const verticalProfile = getAiVerticalProfile(aiProfile);
	const useCommerceEngine = usesCommerceEngine(aiProfile);

	let intent = forceIntent || detectIntent(effectiveMessageBody, currentState, { vertical });
	if (
		['complaint', 'return_exchange'].includes(String(intent || '')) &&
		shouldTreatAsPreSaleObjection({
			text: effectiveMessageBody,
			campaignContext: campaignAssistantContext,
			currentState,
		})
	) {
		intent = 'product';
	}
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

	const attachmentClassification = await classifyInboundAttachment({
		messageType,
		messageBody: effectiveMessageBody,
		rawPayload,
		attachmentMeta,
		currentState,
		recentMessages,
		waId: normalizedWaId,
	});

	const memoryPatch = analyzeConversationTurn({
		messageBody: effectiveMessageBody,
		intent,
		currentState,
		recentMessages,
		campaignContext: campaignAssistantContext,
		aiProfile,
	});

	if (intent === 'human_handoff') {
		memoryPatch.needsHuman = true;
		memoryPatch.handoffReason = 'requested_human';
	}

	const detectedPaymentProof = isPaymentProofMessage({
		messageType,
		body: effectiveMessageBody,
		rawPayload,
		currentState,
		recentMessages,
		attachmentClassification
	}) || looksLikePaymentClarifierConfirmation({
		text: effectiveMessageBody,
		lastOutbound,
	});

	const ambiguousPaymentAttachment = isAmbiguousPaymentAttachment({
		messageType,
		body: effectiveMessageBody,
		rawPayload,
		currentState,
		recentMessages,
		attachmentClassification
	});

	let queueDecision = resolveConversationQueue({
		currentConversation: freshConversation,
		memoryPatch,
		detectedPaymentProof,
		aiDeclaredHandoff: false
	});

	const replyGate = resolveReplyGate({
		workspaceId: resolvedWorkspaceId,
		messageBody: effectiveMessageBody,
		messageType,
		intent,
		currentState,
		lastOutbound,
		recentMessages,
		currentMessageAt: bypassResponseCooldown ? new Date() : createdInboundAt,
		campaignAssistantContext,
	});

	const handoffExpiredNewTopic = replyGate.reason === 'handoff_expired_new_topic';

	if (handoffExpiredNewTopic && !detectedPaymentProof) {
		memoryPatch.needsHuman = false;
		memoryPatch.handoffReason = null;
		queueDecision = {
			queue: 'AUTO',
			aiEnabled: true,
		};
	}

	if (menuDecision?.queueDecisionOverride && !detectedPaymentProof) {
		queueDecision = menuDecision.queueDecisionOverride;
	}

	if (
		!detectedPaymentProof &&
		!ambiguousPaymentAttachment &&
		replyGate.action === 'suppress' &&
		!isCampaignReply
	) {
		trace = {
			...trace,
			intent,
			provider: 'system',
			model: 'reply-gate',
			shouldReply: false,
			responsePolicy: {
				action: 'suppress',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 0,
				tone: 'silent',
				reason: replyGate.reason,
			},
		};

		return finalizeInboundResult({ conversation: freshConversation, trace });
	}

	if (!detectedPaymentProof && !ambiguousPaymentAttachment && replyGate.action === 'fixed_reply') {
		const gateStatePatch = {
			customerName: contactName || normalizedWaId,
			lastIntent: intent,
			lastDetectedIntent: intent,
			lastUserGoal: 'hablar_con_humano',
			needsHuman: Boolean(replyGate.statePatch?.needsHuman),
			handoffReason: replyGate.statePatch?.handoffReason || replyGate.reason,
			interactionCount: Number(currentState.interactionCount || 0) + 1,
		};

		await prisma.conversationState.upsert({
			where: { conversationId: freshConversation.id },
			update: gateStatePatch,
			create: {
				conversationId: freshConversation.id,
				...gateStatePatch,
			},
		});

		await prisma.conversation.update({
			where: { id: freshConversation.id },
			data: {
				queue: replyGate.queue || 'HUMAN',
				aiEnabled: replyGate.aiEnabled ?? false,
				lastMessageAt: new Date(),
			},
		});

		await sendAndPersistOutbound({
			conversationId: freshConversation.id,
			body: replyGate.reply,
			deliveryMode: transportMode,
			aiMeta: {
				provider: 'system',
				model: 'reply-gate',
				raw: {
					reason: replyGate.reason,
				},
			},
		});

		await prisma.conversation.update({
			where: { id: freshConversation.id },
			data: {
				lastSummary: buildConversationSummary({
					intent,
					enrichedState: { ...currentState, ...gateStatePatch },
					lastUserMessage: summaryUserMessage,
					lastAssistantMessage: replyGate.reply,
					liveOrderContext: null,
				}),
			},
		});

		trace = {
			...trace,
			intent,
			queueDecision: {
				queue: replyGate.queue || 'HUMAN',
				aiEnabled: replyGate.aiEnabled ?? false,
				reason: replyGate.reason,
			},
			responsePolicy: {
				action: 'fixed_reply',
				useAI: false,
				allowHandoffMention: true,
				maxChars: 220,
				tone: 'empatico_concreto',
				reason: replyGate.reason,
			},
			assistantMessage: replyGate.reply,
			provider: 'system',
			model: 'reply-gate',
			shouldReply: false,
		};

		return finalizeInboundResult({ conversation: freshConversation, trace });
	}

	if (
		!detectedPaymentProof &&
		!ambiguousPaymentAttachment &&
		!bypassResponseCooldown &&
		transportMode === 'live' &&
		AUTO_REPLY_COOLDOWN_MS > 0
	) {
		scheduleAutoReplyCooldown({
			conversationId: freshConversation.id,
			workspaceId: resolvedWorkspaceId,
			messageId: inboundMessage?.id || null,
			transportMode,
		});

		trace = {
			...trace,
			intent,
			provider: 'system',
			model: 'reply-cooldown',
			shouldReply: false,
			responsePolicy: {
				action: 'cooldown',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 0,
				tone: 'silent',
				reason: 'waiting_for_message_burst_to_finish',
				cooldownMs: AUTO_REPLY_COOLDOWN_MS,
			},
		};

		return finalizeInboundResult({ conversation: freshConversation, trace });
	}

	const intentResult = await resolveIntentAction({
		workspaceId: resolvedWorkspaceId,
		vertical,
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
	if (campaignAssistantContext) {
		nextStatePayload.campaignContext = {
			category: campaignAssistantContext.category,
			objective: campaignAssistantContext.objective,
			campaignId: campaignAssistantContext.campaignId || null,
			audienceSource: campaignAssistantContext.audienceSource || campaignAssistantContext.source || null,
			templateName: campaignAssistantContext.templateName || null,
			campaignText: campaignAssistantContext.previewText || null,
			previewText: campaignAssistantContext.previewText || null,
			responseFrame: campaignAssistantContext.responseFrame || null,
			detectedAt:
				campaignAssistantContext.detectedAt ||
				currentState?.campaignContext?.detectedAt ||
				createdInboundAt.toISOString(),
			lastUsedAt: new Date().toISOString(),
		};
	}

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

	if (
		freshConversation.queue !== queueDecision.queue ||
		freshConversation.aiEnabled !== queueDecision.aiEnabled
	) {
		publishInboxEvent({
			workspaceId: resolvedWorkspaceId,
			scope: 'conversation',
			action: 'queue-updated',
			conversationId: freshConversation.id,
			queue: queueDecision.queue,
			previousQueue: freshConversation.queue,
			aiEnabled: queueDecision.aiEnabled,
		});
	}

	const enrichedState = {
		...currentState,
		...nextStatePayload
	};
	let promptState = sanitizeStateForSupportPrompt(enrichedState, intent);

	if (
		attachmentClassificationLooksLikeReturnEvidence(attachmentClassification) &&
		(enrichedState?.handoffReason === 'return_exchange' || currentState?.handoffReason === 'return_exchange')
	) {
		const reply =
			'Gracias, ya sumo la foto al caso. Queda derivado para que una asesora lo revise y te responda por aca.';
		trace = {
			...trace,
			attachmentClassification,
			assistantMessage: reply,
			provider: 'system',
			model: 'return-evidence-router',
			shouldReply: false,
		};

		await sendAndPersistOutbound({
			conversationId: freshConversation.id,
			body: reply,
			deliveryMode: transportMode,
			aiMeta: {
				provider: 'system',
				model: 'return-evidence-router',
				raw: { attachmentClassification }
			}
		});

		await prisma.conversation.update({
			where: { id: freshConversation.id },
			data: {
				queue: 'HUMAN',
				aiEnabled: false,
				lastSummary: buildConversationSummary({
					intent,
					enrichedState: { ...enrichedState, needsHuman: true, handoffReason: 'return_exchange' },
					lastUserMessage: summaryUserMessage,
					lastAssistantMessage: reply,
					liveOrderContext
				})
			}
		});

		await prisma.conversationState.update({
			where: { conversationId: freshConversation.id },
			data: {
				needsHuman: true,
				handoffReason: 'return_exchange',
			},
		});

		return finalizeInboundResult({ conversation: freshConversation, trace });
	}

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

		return finalizeInboundResult({ conversation: freshConversation, trace });
	}

	if (detectedPaymentProof) {
		const ack = PAYMENT_REVIEW_ACK;
		const paymentProofForward = await maybeForwardPaymentProof({
			workspaceId: resolvedWorkspaceId,
			transportMode,
			messageType,
			rawPayload,
			attachmentMeta,
			customerPhone: normalizedWaId,
			customerName: contactName || freshConversation.contact?.name || '',
			orderNumber:
				explicitOrderNumber ||
				liveOrderContext?.orderNumber ||
				enrichedState?.lastOrderNumber ||
				currentState?.lastOrderNumber ||
				'',
		}).catch((error) => {
			logger.warn('payment_proof.forward_unhandled_error', {
				workspaceId: resolvedWorkspaceId,
				conversationId: freshConversation.id,
				waId: maskPhone(normalizedWaId),
				error: error?.message || error,
			});
			return {
				ok: false,
				error: error?.message || String(error || ''),
			};
		});
		trace = {
			...trace,
			assistantMessage: ack,
			provider: 'system',
			model: 'payment-proof-router',
			paymentProofForward,
			shouldReply: false,
		};

		await sendAndPersistOutbound({
			conversationId: freshConversation.id,
			body: ack,
			deliveryMode: transportMode,
			aiMeta: {
				provider: 'system',
				model: 'payment-proof-router',
				raw: { detectedPaymentProof: true, paymentProofForward }
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

		return finalizeInboundResult({ conversation: freshConversation, trace });
	}

	const handoffJustTriggered = enrichedState.needsHuman && !currentState.needsHuman;

	if (handoffJustTriggered) {
		const handoffReply = isDkvWorkspace(resolvedWorkspaceId) || !useCommerceEngine
			? buildUnableToContinueHandoffReply()
			: buildHandoffReply({
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

		return finalizeInboundResult({ conversation: freshConversation, trace });
	}

	const isAiEnabledGlobal =
		String(process.env.AI_AUTOREPLY_ENABLED || 'true').toLowerCase() === 'true';
	const isAiEnabledForWorkspace = await isWorkspaceFeatureEnabled(
		resolvedWorkspaceId,
		WORKSPACE_FEATURE_FLAGS.AI_AUTO_REPLIES
	);

	const shouldReply =
		isAiEnabledGlobal &&
		isAiEnabledForWorkspace &&
		queueDecision.aiEnabled &&
		queueDecision.queue === 'AUTO';

	logger.debug('ai.autoreply_decision', {
		workspaceId: resolvedWorkspaceId,
		conversationId: freshConversation.id,
		isAiEnabledGlobal,
		isAiEnabledForWorkspace,
		queue: queueDecision.queue,
		queueAiEnabled: queueDecision.aiEnabled,
		shouldReply,
		intent: intent?.name || intent?.type || intent || null,
		waId: maskPhone(freshConversation.contact.waId),
	});

	if (!shouldReply) {
		trace = {
			...trace,
			shouldReply: false,
		};
		return finalizeInboundResult({ conversation: freshConversation, trace });
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
	const promptCampaignAssistantContext = isSupportIntent(intent) || !useCommerceEngine ? null : campaignAssistantContext;

	try {
		if (!useCommerceEngine) {
			catalogProducts = [];
			catalogContext = '';
			commercialPlan = buildVerticalNonCommercePlan({
				vertical,
				messageBody: effectiveMessageBody,
				currentState: enrichedState,
				intent,
			});
			commercialHints = commercialPlan.greetingOnly
				? verticalProfile.greetingHints
				: verticalProfile.serviceHints || [verticalProfile.defaultHint];
		} else if (isSupportIntent(intent)) {
			catalogProducts = [];
			catalogContext = '';
			commercialPlan = {
				stage: 'SUPPORT',
				mood: enrichedState.customerMood || 'neutral',
				buyingIntentLevel: null,
				requestedAction: 'SUPPORT',
				productFocus: null,
				productFocusLabel: null,
				productFamily: null,
				productFamilyLabel: null,
				categoryLocked: false,
				rankedProducts: [],
				bestOffer: null,
				fallbackOffer: null,
				offerOptions: [],
				offerCandidates: [],
				alreadyShared: {
					sharedLinks: [],
					shownPrices: [],
					shownOffers: []
				},
				shareLinkNow: false,
				repeatPriceNow: false,
				shouldEscalate: Boolean(enrichedState.needsHuman),
				handoffReason: enrichedState.handoffReason || null,
				recommendedAction: enrichedState.needsHuman ? 'handoff_human' : 'support_reply',
				responseRules: [
					'Responde como soporte, no como venta.',
					'No menciones promos, precios, links de producto ni catalogo.',
					'No prometas acciones operativas que el sistema no confirmo.'
				],
				greetingOnly: false
			};
			commercialHints = [
				'Es una conversacion de soporte o postventa.',
				'No abras promociones ni productos.',
				'No prometas tracking, cancelaciones, devoluciones ni revisiones si no estan confirmadas.'
			];
		} else {
			const catalogQueryContext = buildCatalogQueryContext({
				messageBody: effectiveMessageBody,
				currentState: enrichedState,
				recentMessages: fullRecentMessages,
			});
			const commercialMessageBody = isCatalogFollowUpRequest(effectiveMessageBody)
				? catalogQueryContext
				: effectiveMessageBody;
			const catalogInterestHints = [
				...(Array.isArray(enrichedState.interestedProducts) ? enrichedState.interestedProducts : []),
				enrichedState.currentProductFocus,
				enrichedState.lastRecommendedProduct,
				enrichedState.currentProductFamily,
			].filter(Boolean);

			catalogProducts = await searchCatalogProducts({
				query: catalogQueryContext || effectiveMessageBody,
				interestedProducts: catalogInterestHints,
				limit: 5,
				workspaceId: resolvedWorkspaceId,
				aiProfile,
			});

			const catalogStatus = await getCatalogLookupStatus({ workspaceId: resolvedWorkspaceId });

			commercialPlan = {
				...resolveCommercialBrainV2({
					intent,
					messageBody: commercialMessageBody,
					currentState: enrichedState,
					recentMessages: fullRecentMessages,
					catalogProducts,
					aiProfile,
				}),
				catalogAvailable: catalogStatus.available !== false,
				catalogStatusReason: catalogStatus.reason || 'ok',
				catalogStatusMessage: catalogStatus.message || null
			};
		}

		catalogProducts = commercialPlan?.rankedProducts?.length
			? commercialPlan.rankedProducts.slice(0, 5)
			: catalogProducts;

		if (!useCommerceEngine) {
			catalogProducts = [];
			catalogContext = '';
		} else if (isSupportIntent(intent)) {
			catalogProducts = [];
			catalogContext = '';
		} else if (commercialPlan?.greetingOnly) {
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
			commercialHints = pickCommercialHints(catalogProducts, commercialPlan, { aiProfile });
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
				aiGuidance.hasLocation
					? 'La clienta ya dio ubicacion o codigo postal. No se lo vuelvas a pedir.'
					: 'Si falta ubicacion, pedi zona, localidad o provincia sin cortar el hilo.'
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

		if (promptCampaignAssistantContext) {
			commercialHints.unshift(
				`La conversacion viene de una campania de ${promptCampaignAssistantContext.objective}.`
			);
			commercialHints.push(promptCampaignAssistantContext.responseFrame);
			commercialHints.push(
				'Si el cliente responde algo ambiguo, interpretalo desde la campania; si cambia de tema claramente, segui el nuevo tema.'
			);
			if (promptCampaignAssistantContext.category === 'cart_recovery') {
				commercialHints.push(
					'En carrito, dudas de talle, cambio, tela, comodidad, precio o envio son objeciones preventa: resolvelas antes de derivar.'
				);
			}
			if (promptCampaignAssistantContext.category === 'pending_payment') {
				commercialHints.push(
					'En pago pendiente, no vendas otro producto: ayuda a completar el pago, evitar duplicacion o recibir comprobante.'
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

		if (!useCommerceEngine) {
			const bannedHintPattern = /(stock|talle|carrito|checkout|promo|promocion|pack|envio|producto|catalogo|link)/i;
			commercialHints = commercialHints.filter((hint) => !bannedHintPattern.test(String(hint || '')));
			commercialHints.push('No menciones stock, talles, carrito, checkout, promos ni envios.');
			commercialHints.push('Si requiere datos personales o estado de poliza, deriva a asesor.');
		}

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
		logger.warn('catalog.conversation_lookup_failed', {
			workspaceId: resolvedWorkspaceId,
			conversationId: freshConversation.id,
			error: catalogError,
		});
	}

	promptState = sanitizeStateForSupportPrompt(enrichedState, intent);

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
			workspaceId: resolvedWorkspaceId,
			intent,
			currentState: enrichedState,
			responsePolicy,
			commercialPlan,
			queueDecision,
		});
	} catch (menuContextError) {
		logger.warn('menu_assistant.context_build_failed', {
			workspaceId: resolvedWorkspaceId,
			conversationId: freshConversation.id,
			error: menuContextError,
		});
	}

	trace = {
		...trace,
		responsePolicy,
		commercialPlan,
		catalogProducts,
		commercialHints,
		shouldReply: true,
		menuAssistantContext,
		campaignAssistantContext: promptCampaignAssistantContext,
	};

	let finalReply = forcedReply || null;
	let aiMeta = null;
	let prompt = null;

	if (!finalReply && !responsePolicy.useAI) {
		if (intent === 'order_status' && liveOrderContext) {
			finalReply = buildFixedOrderReply(liveOrderContext);
		} else {
			finalReply = buildAiFailureFallback({
				workspaceId: resolvedWorkspaceId,
				vertical,
				intent,
				enrichedState,
				catalogProducts,
				commercialPlan
			});
		}
	}

	if (
		!finalReply &&
		shouldForceCatalogSafetyFallback({
			intent,
			messageBody: effectiveMessageBody,
			enrichedState,
			catalogProducts,
			commercialPlan,
		})
	) {
		finalReply = buildCatalogSafetyFallback({
			workspaceId: resolvedWorkspaceId,
			vertical,
			aiProfile,
			intent,
			messageBody: effectiveMessageBody,
			enrichedState,
			commercialPlan,
		});
		aiMeta = {
			provider: 'fallback',
			model: 'catalog-safety-fallback',
			raw: {
				reason: 'no_confirmed_catalog_match',
			},
		};
	}

	if (!finalReply) {
		try {
			const compiledPrompt = compilePrompt({
				businessName: aiBrand.businessName,
				workspaceConfig,
				contactName: freshConversation.contact.name || freshConversation.contact.waId,
				recentMessages: fullRecentMessages,
				conversationSummary: freshConversation.lastSummary || '',
				customerContext: {
					name: freshConversation.contact.name || freshConversation.contact.waId,
					waId: freshConversation.contact.waId
				},
				conversationState: promptState,
				liveOrderContext,
				catalogProducts,
				catalogContext,
				commercialHints,
				commercialPlan,
				responsePolicy,
				menuAssistantContext,
				campaignAssistantContext: promptCampaignAssistantContext
			});
			prompt = compiledPrompt.text;

			const aiResult = await runAssistantReply({
				compiledPrompt,
				detectedIntent: intent,
			});

			const fallbackReply = buildFallbackOrderAwareReply({
				workspaceId: resolvedWorkspaceId,
				vertical,
				aiProfile,
				intent,
				liveOrderContext,
				enrichedState,
				catalogProducts,
				commercialPlan,
				campaignAssistantContext: promptCampaignAssistantContext,
			});

			const audited = auditAssistantReply({
				text: aiResult?.text || '',
				responsePolicy,
				liveOrderContext,
				fallbackReply,
				commercialPlan,
				recentMessages: fullRecentMessages,
				contactName: freshConversation.contact.name || freshConversation.contact.waId,
				businessName: aiBrand.businessName,
				agentName: aiBrand.agentName
			});

			finalReply = appendMenuHintIfNeeded(
				audited.finalText,
				menuAssistantContext
			);
			const output = validateAssistantOutput({
				...aiResult.output,
				reply: finalReply,
				needsHuman: audited.triggerHumanHandoff,
				handoffReason: audited.triggerHumanHandoff
					? commercialPlan?.handoffReason || 'ai_declared_handoff'
					: null,
			});
			finalReply = output.reply;
			aiMeta = { ...aiResult, text: output.reply, output };

			if (audited.triggerHumanHandoff) {
				await syncHumanHandoff({
					conversationId: freshConversation.id,
					reason: commercialPlan?.handoffReason || 'ai_declared_handoff'
				});
			}
		} catch (aiError) {
			logger.error('ai.autoreply_failed', {
				workspaceId: resolvedWorkspaceId,
				conversationId: freshConversation.id,
				error: aiError,
			});

			finalReply = buildFallbackOrderAwareReply({
				workspaceId: resolvedWorkspaceId,
				vertical,
				aiProfile,
				intent,
				liveOrderContext,
				enrichedState,
				catalogProducts,
				commercialPlan,
				campaignAssistantContext: promptCampaignAssistantContext,
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

	if (
		(isDkvWorkspace(resolvedWorkspaceId) || !useCommerceEngine) &&
		isUnableToContinueHandoffReply(finalReply)
	) {
		await syncHumanHandoff({
			conversationId: freshConversation.id,
			reason: 'ai_cannot_continue',
		});
		queueDecision = {
			queue: 'HUMAN',
			aiEnabled: false,
			reason: 'ai_cannot_continue',
		};
		enrichedState.needsHuman = true;
		enrichedState.handoffReason = 'ai_cannot_continue';
		aiMeta = {
			provider: aiMeta?.provider || 'system',
			model: 'human-handoff-router',
			raw: {
				...(aiMeta?.raw || {}),
				handoffReason: 'ai_cannot_continue',
			},
		};
	}

	trace = {
		...trace,
		queueDecision,
		prompt,
		promptVersion: aiMeta?.promptVersion || null,
		promptHash: aiMeta?.promptHash || null,
		factsUsed: aiMeta?.factsUsed || [],
		assistantMessage: finalReply,
		provider: aiMeta?.provider || (forcedReply ? 'system' : null),
		model: aiMeta?.model || (forcedReply ? 'rule-based-forced-reply' : null),
		usage: aiMeta?.usage || null,
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

	return finalizeInboundResult({ conversation: freshConversation, trace });
}
