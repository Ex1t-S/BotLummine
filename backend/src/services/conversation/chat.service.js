import { prisma } from '../../lib/prisma.js';
import { runAssistantReply } from '../ai/index.js';
import { sendWhatsAppText, sendWhatsAppInteractiveList } from '../whatsapp/whatsapp.service.js';
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
import { buildFixedOrderReply } from '../intents/order-status.service.js';
import {
	searchCatalogProducts,
	buildCatalogContext,
	pickCommercialHints
} from '../catalog/catalog-search.service.js';
import { resolveCommercialBrainV2 } from '../ai/commercial-brain.service.js';
import {
	isPaymentProofMessage,
	buildPaymentReviewAck,
	resolveConversationQueue
} from './inbox-routing.service.js';
import {
	getWhatsAppMenuRuntimeConfig,
	DEFAULT_MAIN_MENU_KEY,
	DEFAULT_MENU_PATHS
} from '../whatsapp/whatsapp-menu.service.js';
import {
	normalizeText,
	summarizeText,
	buildConversationSummary,
	buildAiFailureFallback,
	buildResponsePolicy,
	auditAssistantReply,
	resolveIntentAction,
	buildStatePayload,
	buildFallbackOrderAwareReply,
} from './conversation-helpers.service.js';

const MENU_PATHS = DEFAULT_MENU_PATHS;

const ALLOWED_MENU_STATE_PATCH_KEYS = new Set([
	'lastUserGoal',
	'currentProductFocus',
	'interestedProducts',
	'notes',
	'paymentPreference',
	'deliveryPreference',
	'frequentSize',
	'customerMood',
	'preferredTone',
	'handoffReason',
	'needsHuman'
]);

function normalizeLooseText(value = '') {
	return normalizeText(value)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

function uniqueStringArray(values = []) {
	return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map((value) => String(value)))];
}

function isGreetingOnlyMessage(messageBody = '') {
	const text = normalizeLooseText(messageBody);
	if (!text) return false;

	return /^(hola+|holaaa+|buenas+|buen dia|buen diaa+|buenas tardes|buenas noches|hello+|hi+|hey+|alo+|ey+)$/i.test(text);
}

function isMenuResetCommand(messageBody = '') {
	const text = normalizeLooseText(messageBody);
	return [
		'menu',
		'menú',
		'inicio',
		'volver',
		'volver al menu',
		'volver al menú',
		'opciones',
		'0'
	].includes(text);
}

function getInteractiveReplyId(rawPayload = null) {
	const message = rawPayload?.message || {};
	return (
		message?.interactive?.list_reply?.id ||
		message?.interactive?.button_reply?.id ||
		message?.button?.payload ||
		null
	);
}

async function getMenuRuntime(menuPath = MENU_PATHS.MAIN) {
	const runtime = await getWhatsAppMenuRuntimeConfig();
	const menu =
		runtime?.menusByKey?.[menuPath] ||
		runtime?.menusByKey?.[runtime?.mainMenuKey] ||
		Object.values(runtime?.menusByKey || {})[0] ||
		null;

	return { runtime, menu };
}

async function getMenuConfig(menuPath = MENU_PATHS.MAIN) {
	const { menu } = await getMenuRuntime(menuPath);
	return menu;
}

function sanitizeMenuStatePatch(statePatch = {}, currentState = {}) {
	const patch = {};

	for (const [key, value] of Object.entries(statePatch || {})) {
		if (!ALLOWED_MENU_STATE_PATCH_KEYS.has(key) || value === undefined) continue;

		if (key === 'interestedProducts') {
			patch.interestedProducts = uniqueStringArray([
				...(Array.isArray(currentState?.interestedProducts) ? currentState.interestedProducts : []),
				...(Array.isArray(value) ? value : [value])
			]);
			continue;
		}

		patch[key] = value;
	}

	return patch;
}

async function detectMenuSelection({ messageBody, rawPayload, menuPath }) {
	const menuConfig = await getMenuConfig(menuPath);
	if (!menuConfig) return null;

	const interactiveId = getInteractiveReplyId(rawPayload);

	if (interactiveId && menuConfig.optionById?.[interactiveId]) {
		return interactiveId;
	}

	const normalized = normalizeLooseText(messageBody);
	if (!normalized) return null;

	for (const option of menuConfig.options || []) {
		if (!option?.isActive) continue;

		const aliases = Array.isArray(option.aliases) ? option.aliases : [];
		const normalizedTitle = normalizeLooseText(option.title || '');
		const normalizedDescription = normalizeLooseText(option.description || '');

		if (normalizedTitle && normalizedTitle === normalized) {
			return option.id;
		}

		if (normalizedDescription && normalizedDescription === normalized) {
			return option.id;
		}

		if (aliases.some((alias) => normalizeLooseText(alias) === normalized)) {
			return option.id;
		}
	}

	return null;
}

async function getMenuOptionDefinition({ menuPath, selectionId }) {
	const menuConfig = await getMenuConfig(menuPath);
	return menuConfig?.optionById?.[selectionId] || null;
}

async function patchConversationState(conversationId, patch = {}) {
	const safePatch = Object.fromEntries(
		Object.entries(patch).filter(([, value]) => value !== undefined)
	);

	return prisma.conversationState.upsert({
		where: { conversationId },
		update: safePatch,
		create: {
			conversationId,
			interactionCount: 0,
			interestedProducts: [],
			objections: [],
			...safePatch
		}
	});
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

async function syncHumanHandoff({ conversationId, reason = 'ai_declared_handoff' }) {
	await prisma.conversation.update({
		where: { id: conversationId },
		data: {
			queue: 'HUMAN',
			aiEnabled: false,
			lastMessageAt: new Date()
		}
	});

	await patchConversationState(conversationId, {
		needsHuman: true,
		handoffReason: reason,
		menuActive: false,
		menuPath: null
	});
}

async function sendMenuPrompt({ conversationId, waId, menuPath, bodyPrefix = '' }) {
	const menuConfig = await getMenuConfig(menuPath);
	if (!menuConfig) return null;

	const body = [bodyPrefix ? normalizeText(bodyPrefix) : null, menuConfig.body]
		.filter(Boolean)
		.join('\n\n');

	return sendAndPersistOutbound({
		conversationId,
		body: body || menuConfig.body,
		messageType: 'interactive',
		interactivePayload: {
			headerText: menuConfig.headerText,
			footerText: menuConfig.footerText,
			buttonText: menuConfig.buttonText,
			sections: menuConfig.sections,
			fallbackText: menuConfig.textFallback
		},
		aiMeta: {
			provider: 'system',
			model: `menu-${menuConfig.path.toLowerCase()}`,
			raw: { menuPath: menuConfig.path, menuTitle: menuConfig.title }
		}
	});
}

async function sendMenuTextOnly({ conversationId, body, model = 'menu-text' }) {
	return sendAndPersistOutbound({
		conversationId,
		body,
		aiMeta: {
			provider: 'system',
			model,
			raw: { kind: 'menu_text' }
		}
	});
}

function shouldForceMenuFirst({ currentState, freshConversation, messageBody }) {
	if (isMenuResetCommand(messageBody)) return true;
	if (currentState?.needsHuman) return false;
	if (currentState?.menuActive && currentState?.menuPath) return true;

	if (isGreetingOnlyMessage(messageBody)) return true;

	const inboundCount = (freshConversation?.messages || []).filter((msg) => msg.direction === 'INBOUND').length;
	const outboundCount = (freshConversation?.messages || []).filter((msg) => msg.direction === 'OUTBOUND').length;
	const hasNoMeaningfulHistory = !currentState?.lastIntent && (currentState?.interactionCount || 0) === 0;

	return inboundCount === 1 && outboundCount === 0 && hasNoMeaningfulHistory;
}

async function handleMenuSelection({
	selectionId,
	conversation,
	currentState,
	contactName,
	waId
}) {
	const conversationId = conversation.id;
	const menuPath = currentState?.menuPath || MENU_PATHS.MAIN;
	const option = await getMenuOptionDefinition({ menuPath, selectionId });

	if (!option) {
		return { handled: false };
	}

	const safeStatePatch = sanitizeMenuStatePatch(option.statePatch || {}, currentState);

	if (option.actionType === 'SUBMENU') {
		const targetMenuPath = option.actionValue || DEFAULT_MAIN_MENU_KEY;

		await patchConversationState(conversationId, {
			menuActive: true,
			menuPath: targetMenuPath,
			menuLastSelection: selectionId,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId
		});

		await sendMenuPrompt({
			conversationId,
			waId,
			menuPath: targetMenuPath,
			bodyPrefix: option.promptPrefix || ''
		});

		return { handled: true };
	}

	if (option.actionType === 'HUMAN') {
		await syncHumanHandoff({
			conversationId,
			reason: option.handoffReason || 'menu_requested_human'
		});

		const handoffReply = normalizeText(option.replyBody) || buildHandoffReply({
			contactName: contactName || '',
			reason: option.handoffReason || 'menu_requested_human'
		});

		await sendMenuTextOnly({
			conversationId,
			body: handoffReply,
			model: option.model || 'menu-human-handoff'
		});

		return { handled: true };
	}

	if (option.actionType === 'MESSAGE') {
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId,
			...safeStatePatch
		});

		await sendMenuTextOnly({
			conversationId,
			body: normalizeText(option.replyBody || option.title || 'Listo.'),
			model: option.model || `menu-message-${selectionId}`
		});

		return { handled: true };
	}

	if (option.actionType === 'INTENT') {
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId,
			...safeStatePatch
		});

		return {
			handled: false,
			effectiveMessageBody: normalizeText(option.effectiveMessageBody || option.title),
			summaryUserMessage: normalizeText(option.summaryUserMessage || `Cliente eligió menú: ${option.title}`),
			forceIntent: option.actionValue || null,
			statePatch: {
				menuLastSelection: selectionId,
				...safeStatePatch
			}
		};
	}

	return { handled: false };
}

async function maybeHandleMenuFlow({
	conversation,
	currentState,
	contactName,
	messageBody,
	messageType,
	rawPayload
}) {
	const waId = conversation.contact?.waId || '';
	const wantsMenu = isMenuResetCommand(messageBody);
	const menuPath = currentState?.menuPath || MENU_PATHS.MAIN;
	const isAiEnabledGlobal =
		String(process.env.AI_AUTOREPLY_ENABLED || 'true').toLowerCase() === 'true';

	const isCampaignLocked =
		currentState?.handoffReason === 'campaign_reply_pending_human';

	const isAutomaticConversation =
		conversation?.queue === 'AUTO' &&
		conversation?.aiEnabled !== false &&
		currentState?.needsHuman !== true &&
		!isCampaignLocked;

	if (!isAutomaticConversation) {
		return {
			handled: false,
			effectiveMessageBody: messageBody,
			summaryUserMessage: messageBody,
			forceIntent: null,
			statePatch: null
		};
	}

	const shouldOfferMenu = shouldForceMenuFirst({
		currentState,
		freshConversation: conversation,
		messageBody
	});

	if (!currentState?.needsHuman && shouldOfferMenu) {
		const selectionId = await detectMenuSelection({
			messageBody,
			rawPayload,
			menuPath
		});

		if (selectionId) {
			return handleMenuSelection({
				selectionId,
				conversation,
				currentState,
				contactName,
				waId
			});
		}

		await patchConversationState(conversation.id, {
			menuActive: true,
			menuPath: MENU_PATHS.MAIN,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId
		});

		await sendMenuPrompt({
			conversationId: conversation.id,
			waId,
			menuPath: MENU_PATHS.MAIN,
			bodyPrefix: isGreetingOnlyMessage(messageBody)
				? '¡Hola!'
				: 'Antes de seguir, te dejo el menú para ayudarte más rápido.'
		});

		return { handled: true };
	}

	if (wantsMenu) {
		const shouldEnableAuto =
			isAiEnabledGlobal &&
			!currentState?.needsHuman &&
			conversation.queue === 'AUTO';

		await patchConversationState(conversation.id, {
			menuActive: true,
			menuPath: MENU_PATHS.MAIN,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId,
			needsHuman: shouldEnableAuto ? false : (currentState?.needsHuman ?? true),
			handoffReason: shouldEnableAuto ? null : currentState?.handoffReason || 'manual_human_lock'
		});

		await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				queue: 'AUTO',
				aiEnabled: true,
				lastMessageAt: new Date()
			}
		});

		await sendMenuPrompt({
			conversationId: conversation.id,
			waId,
			menuPath: MENU_PATHS.MAIN,
			bodyPrefix: 'Perfecto, abrimos el menú de nuevo.'
		});

		return { handled: true };
	}

	if (!currentState?.needsHuman && currentState?.menuActive && currentState?.menuPath) {
		const selectionId = await detectMenuSelection({
			messageBody,
			rawPayload,
			menuPath: currentState.menuPath
		});

		if (selectionId) {
			return handleMenuSelection({
				selectionId,
				conversation,
				currentState,
				contactName,
				waId
			});
		}

		if (messageType === 'text' && normalizeText(messageBody)) {
			await patchConversationState(conversation.id, {
				menuLastPromptAt: new Date()
			});

			await sendMenuPrompt({
				conversationId: conversation.id,
				waId,
				menuPath: currentState.menuPath,
				bodyPrefix: 'No llegué a entender esa opción. Elegí una de la lista así vamos más rápido.'
			});

			return { handled: true };
		}
	}

	return {
		handled: false,
		effectiveMessageBody: messageBody,
		summaryUserMessage: messageBody,
		forceIntent: null,
		statePatch: null
	};
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

export async function sendAndPersistOutbound({
	conversationId,
	body,
	userId = null,
	provider = 'whatsapp-cloud-api',
	model = null,
	replyMessageId = null,
	aiMeta = null,
	messageType = 'text',
	interactivePayload = null,
}) {
	const cleanBody = String(body || '').trim();

	if (!conversationId) {
		throw new Error('Falta conversationId para enviar el mensaje.');
	}

	if (!cleanBody) {
		throw new Error('El mensaje no puede estar vacío.');
	}

	const conversation = await prisma.conversation.findUnique({
		where: { id: conversationId },
		include: {
			contact: true,
		},
	});

	if (!conversation) {
		throw new Error('Conversación no encontrada.');
	}

	const waId = conversation.contact?.waId;

	console.log('[OUTBOUND DEBUG] sendAndPersistOutbound', {
		conversationId,
		waId,
		contactName: conversation.contact?.name || null,
		messageType,
		bodyPreview: cleanBody.slice(0, 160),
		replyMessageId,
	});

	if (!waId) {
		throw new Error('La conversación no tiene un waId válido para enviar el mensaje.');
	}

	let sendResult = null;

	if (messageType === 'interactive') {
		sendResult = await sendWhatsAppInteractiveList({
			to: waId,
			body: cleanBody,
			headerText: interactivePayload?.headerText || null,
			footerText: interactivePayload?.footerText || null,
			buttonText: interactivePayload?.buttonText || 'Ver opciones',
			sections: interactivePayload?.sections || []
		});

		if (!sendResult?.ok && interactivePayload?.fallbackText) {
			sendResult = await sendWhatsAppText({
				to: waId,
				body: interactivePayload.fallbackText
			});
		}
	} else {
		sendResult = await sendWhatsAppText({
			to: waId,
			body: cleanBody,
		});
	}

	console.log('[OUTBOUND DEBUG] send result', sendResult);

	if (!sendResult?.ok) {
		throw new Error(
			sendResult?.error?.message ||
			'No se pudo enviar el mensaje por WhatsApp.'
		);
	}

	const createdMessage = await prisma.message.create({
		data: {
			conversationId: conversation.id,
			direction: 'OUTBOUND',
			type: messageType,
			body: messageType === 'interactive' && interactivePayload?.fallbackText
				? interactivePayload.fallbackText
				: cleanBody,
			senderName: process.env.BUSINESS_NAME || 'Lummine',
			provider: aiMeta?.provider || provider,
			model: aiMeta?.model || model,
			metaMessageId:
				sendResult?.rawPayload?.messages?.[0]?.id ||
				replyMessageId ||
				null,
			rawPayload: aiMeta
				? {
					sendResult: sendResult?.rawPayload || null,
					aiMeta: aiMeta?.raw || null,
					userId,
					messageType,
				}
				: sendResult?.rawPayload || null,
		},
	});

	await prisma.conversation.update({
		where: { id: conversation.id },
		data: {
			lastMessageAt: createdMessage.createdAt,
		},
	});

	publishInboxEvent({
	scope: 'message',
	action: 'outbound-created',
	conversationId: conversation.id,
	queue: conversation.queue,
	direction: 'OUTBOUND',
	messageId: createdMessage.id,
	createdAt: createdMessage.createdAt,
	});

	return {
		ok: true,
		message: createdMessage,
		sendResult,
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
	publishInboxEvent({
		scope: 'message',
		action: 'inbound-created',
		conversationId: conversation.id,
		queue: conversation.queue,
		direction: 'INBOUND',
		metaMessageId,
		createdAt: new Date().toISOString(),
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

	const menuDecision = await maybeHandleMenuFlow({
		conversation: freshConversation,
		currentState,
		contactName,
		messageBody,
		messageType,
		rawPayload
	});

	if (menuDecision?.handled) {
		return { conversation: freshConversation };
	}

	const effectiveMessageBody = normalizeText(menuDecision?.effectiveMessageBody || messageBody);
	const summaryUserMessage = normalizeText(menuDecision?.summaryUserMessage || effectiveMessageBody || messageBody);
	const forceIntent = menuDecision?.forceIntent || null;
	const menuStatePatch = menuDecision?.statePatch || null;

	const intent = forceIntent || detectIntent(effectiveMessageBody, currentState);
	const explicitOrderNumber =
		extractOrderNumber(effectiveMessageBody, currentState) || extractStandaloneOrderNumber(effectiveMessageBody);

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

	const detectedPaymentProof = isPaymentProofMessage({
		messageType,
		body: effectiveMessageBody,
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
		messageBody: effectiveMessageBody,
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

	if (detectedPaymentProof) {
		const ack = buildPaymentReviewAck();

		await sendAndPersistOutbound({
			conversationId: freshConversation.id,
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
					lastUserMessage: summaryUserMessage,
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
					lastUserMessage: summaryUserMessage,
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

	try {
		catalogProducts = await searchCatalogProducts({
			query: effectiveMessageBody,
			interestedProducts: enrichedState.interestedProducts || [],
			limit: 5
		});

		commercialPlan = resolveCommercialBrainV2({
			intent,
			messageBody: effectiveMessageBody,
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
				commercialPlan
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

	await sendAndPersistOutbound({
		conversationId: freshConversation.id,
		body: finalReply,
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

	return { conversation: freshConversation };
}