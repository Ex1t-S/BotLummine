import { prisma } from '../../lib/prisma.js';
import { normalizeText } from './conversation-helpers.service.js';
import { buildHandoffReply } from './conversation-analysis.service.js';
import { sendAndPersistOutbound } from './outbound-message.service.js';
import {
	getWhatsAppMenuRuntimeConfig,
	DEFAULT_MAIN_MENU_KEY,
	DEFAULT_MENU_PATHS,
} from '../whatsapp/whatsapp-menu.service.js';

const MENU_PATHS = DEFAULT_MENU_PATHS;

const ALLOWED_MENU_STATE_PATCH_KEYS = new Set([
	'lastUserGoal',
	'currentProductFocus',
	'currentProductFamily',
	'interestedProducts',
	'notes',
	'paymentPreference',
	'deliveryPreference',
	'frequentSize',
	'customerMood',
	'preferredTone',
	'handoffReason',
	'needsHuman',
	'requestedOfferType',
	'excludedProductKeywords',
	'categoryLocked',
	'salesStage',
]);

function normalizeLooseText(value = '') {
	return normalizeText(value)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');
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
		'0',
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
				...(Array.isArray(value) ? value : [value]),
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

async function detectMenuSelectionAcrossMenus({ messageBody, rawPayload, preferredMenuPath = MENU_PATHS.MAIN }) {
	const runtime = await getWhatsAppMenuRuntimeConfig();
	const menusByKey = runtime?.menusByKey || {};
	const interactiveId = getInteractiveReplyId(rawPayload);
	const orderedMenuPaths = [
		preferredMenuPath,
		runtime?.mainMenuKey,
		MENU_PATHS.MAIN,
		...Object.keys(menusByKey),
	].filter(Boolean);
	const visited = new Set();

	for (const menuPath of orderedMenuPaths) {
		if (visited.has(menuPath)) continue;
		visited.add(menuPath);

		const menuConfig = menusByKey[menuPath];
		if (!menuConfig) continue;

		if (interactiveId && menuConfig.optionById?.[interactiveId]) {
			return { selectionId: interactiveId, menuPath };
		}

		if (!interactiveId) {
			const selectionId = await detectMenuSelection({
				messageBody,
				rawPayload,
				menuPath,
			});

			if (selectionId) {
				return { selectionId, menuPath };
			}
		}
	}

	return null;
}

async function getMenuOptionDefinition({ menuPath, selectionId }) {
	const menuConfig = await getMenuConfig(menuPath);
	return menuConfig?.optionById?.[selectionId] || null;
}

export async function patchConversationState(conversationId, patch = {}) {
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
			...safePatch,
		},
	});
}

export async function syncHumanHandoff({ conversationId, reason = 'ai_declared_handoff' }) {
	await prisma.conversation.update({
		where: { id: conversationId },
		data: {
			queue: 'HUMAN',
			aiEnabled: false,
			lastMessageAt: new Date(),
		},
	});

	await patchConversationState(conversationId, {
		needsHuman: true,
		handoffReason: reason,
		menuActive: false,
		menuPath: null,
	});
}

async function enableAutomaticConversation({ conversationId }) {
	await prisma.conversation.update({
		where: { id: conversationId },
		data: {
			queue: 'AUTO',
			aiEnabled: true,
			lastMessageAt: new Date(),
		},
	});

	await patchConversationState(conversationId, {
		needsHuman: false,
		handoffReason: null,
	});
}

async function sendMenuPrompt({ conversationId, menuPath, bodyPrefix = '', deliveryMode = 'live' }) {
	const menuConfig = await getMenuConfig(menuPath);
	if (!menuConfig) return null;

	const body = [bodyPrefix ? normalizeText(bodyPrefix) : null, menuConfig.body]
		.filter(Boolean)
		.join('\n\n');

	return sendAndPersistOutbound({
		conversationId,
		body: body || menuConfig.body,
		deliveryMode,
		messageType: 'interactive',
		interactivePayload: {
			headerText: menuConfig.headerText,
			footerText: menuConfig.footerText,
			buttonText: menuConfig.buttonText,
			sections: menuConfig.sections,
			fallbackText: menuConfig.textFallback,
		},
		aiMeta: {
			provider: 'system',
			model: `menu-${String(menuConfig.path || menuConfig.key || menuPath).toLowerCase()}`,
			raw: {
				menuPath: menuConfig.path || menuConfig.key || menuPath,
				menuTitle: menuConfig.title,
			},
		},
	});
}

async function sendMenuTextOnly({ conversationId, body, model = 'menu-text', deliveryMode = 'live' }) {
	return sendAndPersistOutbound({
		conversationId,
		body,
		deliveryMode,
		aiMeta: {
			provider: 'system',
			model,
			raw: { kind: 'menu_text' },
		},
	});
}

function shouldForceMenuFirst({ currentState, freshConversation, messageBody }) {
	if (Boolean(currentState?.menuActive && currentState?.menuPath)) return true;

	const normalizedMessage = normalizeText(messageBody);
	if (!normalizedMessage) return false;

	const hasAssistantHistory = Array.isArray(freshConversation?.messages)
		? freshConversation.messages.some((message) => message?.direction === 'OUTBOUND')
		: false;

	if (!hasAssistantHistory) {
		return true;
	}

	if (isGreetingOnlyMessage(normalizedMessage)) {
		return true;
	}

	return false;
}

function getMenuReentryThresholdMs() {
	const hours = Math.max(1, Number(process.env.MENU_REENTRY_HOURS || 24) || 24);
	return hours * 60 * 60 * 1000;
}

function getPreviousConversationActivityAt(messages = []) {
	const safeMessages = Array.isArray(messages) ? messages : [];
	if (safeMessages.length <= 1) return null;

	const previousMessages = safeMessages.slice(0, -1);
	if (!previousMessages.length) return null;

	const previousTimestamp = new Date(
		previousMessages[previousMessages.length - 1]?.createdAt || 0
	).getTime();

	return Number.isFinite(previousTimestamp) && previousTimestamp > 0
		? previousTimestamp
		: null;
}

function isConversationStaleForMenu(messages = []) {
	const previousActivityAt = getPreviousConversationActivityAt(messages);
	if (!previousActivityAt) return false;

	return Date.now() - previousActivityAt >= getMenuReentryThresholdMs();
}

function isHardHumanLock(currentState = {}) {
	return Boolean(
		currentState?.needsHuman === true &&
		currentState?.handoffReason &&
		currentState?.handoffReason !== 'manual_human_lock'
	);
}

function shouldLetFreeTextBypassMenu(messageBody = '') {
	const normalized = normalizeLooseText(messageBody);
	if (!normalized) return false;
	if (isMenuResetCommand(normalized)) return false;
	if (/^\d+$/.test(normalized)) return false;
	if (normalized.length >= 18) return true;

	const meaningfulTerms = normalized.split(/\s+/).filter(Boolean);
	if (meaningfulTerms.length >= 3) return true;

	return /(body|bodys|calza|calzas|pedido|pago|comprobante|envio|envios|talle|talles|catalogo|promo|precio|link|comprar|asesora|humano)/i.test(normalized);
}

async function handleMenuSelection({
	selectionId,
	conversation,
	currentState,
	contactName,
	transportMode = 'live',
}) {
	const conversationId = conversation.id;
	const waId = conversation.contact?.waId || '';
	const menuPath = currentState?.menuPath || MENU_PATHS.MAIN;
	const option = await getMenuOptionDefinition({ menuPath, selectionId });

	if (!option) {
		return { handled: false };
	}

	const safeStatePatch = sanitizeMenuStatePatch(option.statePatch || {}, currentState);

	if (option.actionType === 'SUBMENU') {
		await enableAutomaticConversation({ conversationId });

		const targetMenuPath = option.actionValue || DEFAULT_MAIN_MENU_KEY;

		await patchConversationState(conversationId, {
			menuActive: true,
			menuPath: targetMenuPath,
			menuLastSelection: selectionId,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId,
			needsHuman: false,
			handoffReason: null,
		});

		await sendMenuPrompt({
			conversationId,
			menuPath: targetMenuPath,
			bodyPrefix: option.promptPrefix || '',
			deliveryMode: transportMode,
		});

		return { handled: true };
	}

	if (option.actionType === 'HUMAN') {
		await syncHumanHandoff({
			conversationId,
			reason: option.handoffReason || 'menu_requested_human',
		});

		const handoffReply = normalizeText(option.replyBody) || buildHandoffReply({
			contactName: contactName || '',
			reason: option.handoffReason || 'menu_requested_human',
		});

		await sendMenuTextOnly({
			conversationId,
			body: handoffReply,
			model: option.model || 'menu-human-handoff',
			deliveryMode: transportMode,
		});

		return { handled: true };
	}

	if (option.actionType === 'MESSAGE') {
		await enableAutomaticConversation({ conversationId });

		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId,
			needsHuman: false,
			handoffReason: null,
			...safeStatePatch,
		});

		await sendMenuTextOnly({
			conversationId,
			body: normalizeText(option.replyBody || option.title || 'Listo.'),
			model: option.model || `menu-message-${selectionId}`,
			deliveryMode: transportMode,
		});

		return { handled: true };
	}

	if (option.actionType === 'INTENT') {
		await enableAutomaticConversation({ conversationId });

		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId,
			needsHuman: false,
			handoffReason: null,
			...safeStatePatch,
		});

		return {
			handled: false,
			effectiveMessageBody: normalizeText(option.effectiveMessageBody || option.title),
			summaryUserMessage: normalizeText(option.summaryUserMessage || `Cliente eligió menú: ${option.title}`),
			forceIntent: option.actionValue || null,
			statePatch: {
				menuLastSelection: selectionId,
				needsHuman: false,
				handoffReason: null,
				...safeStatePatch,
			},
			queueDecisionOverride: {
				queue: 'AUTO',
				aiEnabled: true,
			},
		};
	}

	return { handled: false };
}

export async function maybeHandleMenuFlow({
	conversation,
	currentState,
	contactName,
	messageBody,
	messageType,
	rawPayload,
	transportMode = 'live',
	skipMenu = false,
}) {
	if (skipMenu) {
		return {
			handled: false,
			effectiveMessageBody: messageBody,
			summaryUserMessage: messageBody,
			forceIntent: null,
			statePatch: null,
			queueDecisionOverride: null,
		};
	}

	const waId = conversation.contact?.waId || '';
	const wantsMenu = isMenuResetCommand(messageBody);
	const menuPath = currentState?.menuPath || MENU_PATHS.MAIN;
	const interactiveReplyId = getInteractiveReplyId(rawPayload);
	const hardHumanLock = isHardHumanLock(currentState);
	const isStaleConversation = isConversationStaleForMenu(conversation?.messages);

	if (!hardHumanLock && interactiveReplyId) {
		const resolvedSelection = await detectMenuSelectionAcrossMenus({
			messageBody,
			rawPayload,
			preferredMenuPath: currentState?.menuPath || menuPath,
		});

		if (resolvedSelection?.selectionId) {
			return handleMenuSelection({
				selectionId: resolvedSelection.selectionId,
				conversation,
				currentState: {
					...currentState,
					menuPath: resolvedSelection.menuPath || currentState?.menuPath || menuPath,
				},
				contactName,
				transportMode,
			});
		}
	}

	const shouldOfferMenu =
		!hardHumanLock &&
		(
			isStaleConversation ||
			shouldForceMenuFirst({
				currentState,
				freshConversation: conversation,
				messageBody,
			})
		);

	if (shouldOfferMenu) {
		const selectionId = await detectMenuSelection({
			messageBody,
			rawPayload,
			menuPath,
		});

		if (selectionId) {
			return handleMenuSelection({
				selectionId,
				conversation,
				currentState,
				contactName,
				transportMode,
			});
		}

		await patchConversationState(conversation.id, {
			menuActive: true,
			menuPath: MENU_PATHS.MAIN,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId,
			needsHuman: false,
			handoffReason: null,
		});

		await enableAutomaticConversation({ conversationId: conversation.id });

		await sendMenuPrompt({
			conversationId: conversation.id,
			menuPath: MENU_PATHS.MAIN,
			deliveryMode: transportMode,
			bodyPrefix: isGreetingOnlyMessage(messageBody)
				? '¡Hola!'
				: 'Antes de seguir, te dejo el menú para ayudarte más rápido.',
		});

		return { handled: true };
	}

	if (wantsMenu) {
		await patchConversationState(conversation.id, {
			menuActive: true,
			menuPath: MENU_PATHS.MAIN,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId,
			needsHuman: false,
			handoffReason: null,
		});

		await enableAutomaticConversation({ conversationId: conversation.id });

		await sendMenuPrompt({
			conversationId: conversation.id,
			menuPath: MENU_PATHS.MAIN,
			bodyPrefix: 'Perfecto, abrimos el menú de nuevo.',
		});

		return { handled: true };
	}

	if (!hardHumanLock && currentState?.menuActive && currentState?.menuPath) {
		const selectionId = await detectMenuSelection({
			messageBody,
			rawPayload,
			menuPath: currentState.menuPath,
		});

		if (selectionId) {
			return handleMenuSelection({
				selectionId,
				conversation,
				currentState,
				contactName,
				transportMode,
			});
		}

		if (messageType === 'text' && normalizeText(messageBody)) {
			if (shouldLetFreeTextBypassMenu(messageBody)) {
				await patchConversationState(conversation.id, {
					menuActive: false,
					menuPath: null,
					menuLastPromptAt: new Date(),
				});

				return {
					handled: false,
					effectiveMessageBody: messageBody,
					summaryUserMessage: messageBody,
					forceIntent: null,
					statePatch: {
						menuLastSelection: 'free_text_override',
						needsHuman: false,
						handoffReason: null,
					},
					queueDecisionOverride: {
						queue: 'AUTO',
						aiEnabled: true,
					},
				};
			}

			await patchConversationState(conversation.id, {
				menuLastPromptAt: new Date(),
			});

			await sendMenuPrompt({
				conversationId: conversation.id,
				menuPath: currentState.menuPath,
				bodyPrefix: 'No llegué a entender esa opción. Elegí una de la lista así vamos más rápido.',
			});

			return { handled: true };
		}
	}

	return {
		handled: false,
		effectiveMessageBody: messageBody,
		summaryUserMessage: messageBody,
		forceIntent: null,
		statePatch: null,
		queueDecisionOverride: null,
	};
}
