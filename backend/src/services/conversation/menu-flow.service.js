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
	if (currentState?.needsHuman) return false;
	return Boolean(currentState?.menuActive && currentState?.menuPath);
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
		const targetMenuPath = option.actionValue || DEFAULT_MAIN_MENU_KEY;

		await patchConversationState(conversationId, {
			menuActive: true,
			menuPath: targetMenuPath,
			menuLastSelection: selectionId,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId,
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
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId,
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
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId,
			...safeStatePatch,
		});

		return {
			handled: false,
			effectiveMessageBody: normalizeText(option.effectiveMessageBody || option.title),
			summaryUserMessage: normalizeText(option.summaryUserMessage || `Cliente eligió menú: ${option.title}`),
			forceIntent: option.actionValue || null,
			statePatch: {
				menuLastSelection: selectionId,
				...safeStatePatch,
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
			statePatch: null,
		};
	}

	const shouldOfferMenu = shouldForceMenuFirst({
		currentState,
		freshConversation: conversation,
		messageBody,
	});

	if (!currentState?.needsHuman && shouldOfferMenu) {
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
		});

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
			handoffReason: shouldEnableAuto ? null : currentState?.handoffReason || 'manual_human_lock',
		});

		await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				queue: 'AUTO',
				aiEnabled: true,
				lastMessageAt: new Date(),
			},
		});

		await sendMenuPrompt({
			conversationId: conversation.id,
			menuPath: MENU_PATHS.MAIN,
			bodyPrefix: 'Perfecto, abrimos el menú de nuevo.',
		});

		return { handled: true };
	}

	if (!currentState?.needsHuman && currentState?.menuActive && currentState?.menuPath) {
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
	};
}
