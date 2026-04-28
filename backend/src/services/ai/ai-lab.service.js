import { randomUUID } from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { getOrCreateConversation, processInboundMessage } from '../conversation/chat.service.js';
import { createResetConversationState } from '../conversation/conversation-helpers.service.js';
import { patchConversationState } from '../conversation/menu-flow.service.js';
import { sendAndPersistOutbound } from '../conversation/outbound-message.service.js';
import { getAiLabFixture, AI_LAB_FIXTURES } from '../../data/ai-lab-fixtures.js';
import {
	getWhatsAppMenuRuntimeConfig,
	DEFAULT_MAIN_MENU_KEY
} from '../whatsapp/whatsapp-menu.service.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';

const SESSIONS = new Map();
const AI_LAB_CONTACT_PREFIX = '__AI_LAB__::';

function buildFakeWaId() {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`.slice(-10);
	return `54911${suffix}`;
}

function extractInteractivePayload(message = {}) {
	const rawPayload = message?.rawPayload;
	if (!rawPayload || typeof rawPayload !== 'object') return null;
	return rawPayload.interactivePayload || null;
}

function buildTracePayload(trace = null) {
	if (!trace) return null;
	return {
		intent: trace.intent || null,
		queueDecision: trace.queueDecision || null,
		responsePolicy: trace.responsePolicy || null,
		commercialPlan: trace.commercialPlan || null,
		catalogProducts: trace.catalogProducts || [],
		commercialHints: trace.commercialHints || [],
		prompt: trace.prompt || null,
		assistantMessage: trace.assistantMessage || null,
		provider: trace.provider || null,
		model: trace.model || null,
		aiGuidance: trace.aiGuidance || null,
		liveOrderContext: trace.liveOrderContext || null,
		shouldReply: trace.shouldReply ?? true,
		menuAssistantContext: trace.menuAssistantContext || null,
	};
}

async function listPersistedRuns(conversationId, sessionId, workspaceId = DEFAULT_WORKSPACE_ID) {
	if (!conversationId || !sessionId) return [];
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;

	const runs = await prisma.aiLabRun.findMany({
		where: {
			workspaceId: resolvedWorkspaceId,
			conversationId,
			sessionId,
		},
		orderBy: {
			createdAt: 'asc',
		},
	});

	return runs.map((run) => ({
		id: run.id,
		sessionId: run.sessionId,
		fixtureKey: run.fixtureKey,
		action: run.action || '',
		selectionId: run.selectionId || '',
		userMessage: run.userMessage || '',
		assistantMessage: run.assistantMessage || '',
		intent: run.intent || '',
		provider: run.provider || '',
		model: run.model || '',
		tracePayload: run.tracePayload || null,
		createdAt: run.createdAt,
	}));
}

async function persistAiLabRun({
	sessionId,
	workspaceId = DEFAULT_WORKSPACE_ID,
	fixtureKey,
	conversationId,
	action = '',
	selectionId = '',
	userMessage = '',
	trace = null,
} = {}) {
	if (!sessionId || !fixtureKey || !conversationId) return null;

	const tracePayload = buildTracePayload(trace);
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;

	return prisma.aiLabRun.create({
		data: {
			workspaceId: resolvedWorkspaceId,
			sessionId,
			fixtureKey,
			conversationId,
			action: String(action || '').trim() || null,
			selectionId: String(selectionId || '').trim() || null,
			userMessage: String(userMessage || '').trim() || null,
			assistantMessage:
				String(
					tracePayload?.assistantMessage?.text ||
					tracePayload?.assistantMessage ||
					''
				).trim() || null,
			intent: tracePayload?.intent || null,
			provider: tracePayload?.provider || null,
			model: tracePayload?.model || null,
			tracePayload: tracePayload || null,
		},
	});
}

function assertSessionWorkspace(session, workspaceId = DEFAULT_WORKSPACE_ID) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	if (!session || normalizeWorkspaceId(session.workspaceId) !== resolvedWorkspaceId) {
		const error = new Error('Sesion de AI Lab no encontrada.');
		error.status = 404;
		throw error;
	}
	return resolvedWorkspaceId;
}

async function fetchSessionConversation(conversationId, workspaceId = DEFAULT_WORKSPACE_ID) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	return prisma.conversation.findFirst({
		where: { id: conversationId, workspaceId: resolvedWorkspaceId },
		include: {
			contact: true,
			state: true,
			messages: {
				orderBy: { createdAt: 'asc' }
			}
		}
	});
}

async function buildMenuPreview(conversation = null) {
	if (!conversation?.messages?.length) return null;

	const runtime = await getWhatsAppMenuRuntimeConfig({
		workspaceId: conversation.workspaceId || DEFAULT_WORKSPACE_ID
	});
	const runtimeMenuPath = conversation.state?.menuPath || DEFAULT_MAIN_MENU_KEY;
	const runtimeMenu =
		runtime?.menusByKey?.[runtimeMenuPath] ||
		runtime?.menusByKey?.[runtime?.mainMenuKey] ||
		null;

	if (conversation.state?.menuActive && runtimeMenu) {
		return {
			messageId: null,
			menuActive: true,
			menuPath: runtimeMenu.path || runtimeMenu.key || runtimeMenuPath,
			menuLastSelection: conversation.state?.menuLastSelection || null,
			headerText: runtimeMenu.headerText || null,
			footerText: runtimeMenu.footerText || null,
			buttonText: runtimeMenu.buttonText || null,
			fallbackText: runtimeMenu.textFallback || runtimeMenu.body || '',
			options: (runtimeMenu.options || []).map((option) => ({
				id: option.id,
				title: option.title,
				description: option.description || '',
				sectionTitle: runtimeMenu.sectionTitle || runtimeMenu.title || ''
			}))
		};
	}

	const lastInteractiveMessage = [...conversation.messages]
		.reverse()
		.find((message) => extractInteractivePayload(message)?.sections?.length);

	if (!lastInteractiveMessage) return null;

	const interactivePayload = extractInteractivePayload(lastInteractiveMessage);
	const rawMenuPath = lastInteractiveMessage?.model?.startsWith('menu-')
		? String(lastInteractiveMessage.model).replace(/^menu-/, '').toUpperCase()
		: null;
	const lastMenuPath =
		lastInteractiveMessage?.rawPayload?.aiMeta?.raw?.menuPath ||
		conversation.state?.menuPath ||
		rawMenuPath ||
		null;
	const lastRuntimeMenu = lastMenuPath ? runtime?.menusByKey?.[lastMenuPath] || null : null;
	const options = lastRuntimeMenu
		? (lastRuntimeMenu.options || []).map((option) => ({
			id: option.id,
			title: option.title,
			description: option.description || '',
			sectionTitle: lastRuntimeMenu.sectionTitle || lastRuntimeMenu.title || ''
		}))
		: (interactivePayload?.sections || []).flatMap((section) =>
			(section?.rows || []).map((row) => ({
				id: row.id,
				title: row.title,
				description: row.description || '',
				sectionTitle: section.title || ''
			}))
		);

	return {
		messageId: lastInteractiveMessage.id,
		menuActive: Boolean(conversation.state?.menuActive && conversation.state?.menuPath),
		menuPath: lastRuntimeMenu?.path || lastRuntimeMenu?.key || lastMenuPath || null,
		menuLastSelection: conversation.state?.menuLastSelection || null,
		headerText: lastRuntimeMenu?.headerText || interactivePayload?.headerText || null,
		footerText: lastRuntimeMenu?.footerText || interactivePayload?.footerText || null,
		buttonText: lastRuntimeMenu?.buttonText || interactivePayload?.buttonText || null,
		fallbackText: lastRuntimeMenu?.textFallback || interactivePayload?.fallbackText || lastInteractiveMessage.body || '',
		options
	};
}

async function resolveRuntimeMenuOption({
	workspaceId = DEFAULT_WORKSPACE_ID,
	menuPath = DEFAULT_MAIN_MENU_KEY,
	selectionId = ''
} = {}) {
	const runtime = await getWhatsAppMenuRuntimeConfig({ workspaceId });
	const activeMenu =
		runtime?.menusByKey?.[menuPath] ||
		runtime?.menusByKey?.[runtime?.mainMenuKey] ||
		null;

	return {
		activeMenu,
		option: activeMenu?.optionById?.[selectionId] || null
	};
}

async function openAiLabMenu({
	workspaceId = DEFAULT_WORKSPACE_ID,
	conversationId,
	contactName = '',
	menuPath = DEFAULT_MAIN_MENU_KEY,
	bodyPrefix = ''
} = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const runtime = await getWhatsAppMenuRuntimeConfig({ workspaceId: resolvedWorkspaceId });
	const menu =
		runtime?.menusByKey?.[menuPath] ||
		runtime?.menusByKey?.[runtime?.mainMenuKey] ||
		Object.values(runtime?.menusByKey || {})[0] ||
		null;

	if (!menu) return null;

	await patchConversationState(conversationId, {
		customerName: contactName || null,
		menuActive: true,
		menuPath: menu.path || menu.key || menuPath,
		menuLastPromptAt: new Date()
	});

	const body = [String(bodyPrefix || '').trim(), menu.body].filter(Boolean).join('\n\n');

	return sendAndPersistOutbound({
		conversationId,
		body: body || menu.body,
		deliveryMode: 'lab',
		messageType: 'interactive',
		interactivePayload: {
			headerText: menu.headerText,
			footerText: menu.footerText,
			buttonText: menu.buttonText,
			sections: menu.sections,
			fallbackText: menu.textFallback || menu.body
		},
		aiMeta: {
			provider: 'system',
			model: `menu-${String(menu.path || menu.key || menuPath).toLowerCase()}`,
			raw: {
				menuPath: menu.path || menu.key || menuPath,
				menuTitle: menu.title,
				source: 'ai-lab'
			}
		}
	});
}

async function serializeConversation(conversation, fixtureMeta, lastTrace = null, sessionId = null) {
	if (!conversation) return null;

	const rawName = conversation.contact?.name || 'Cliente';
	const contactName = rawName.startsWith(AI_LAB_CONTACT_PREFIX)
		? rawName.slice(AI_LAB_CONTACT_PREFIX.length)
		: rawName;

	const runs = await listPersistedRuns(
		conversation.id,
		sessionId,
		conversation.workspaceId || DEFAULT_WORKSPACE_ID
	);

	return {
		id: sessionId,
		conversationId: conversation.id,
		fixtureMeta,
		contactName,
		customerContext: {
			name: contactName,
			waId: conversation.contact?.waId || ''
		},
		conversationState: conversation.state || {},
		messages: (conversation.messages || []).map((message) => ({
			id: message.id,
			role: message.direction === 'INBOUND' ? 'user' : 'assistant',
			type: message.type || 'text',
			text: message.body,
			createdAt: message.createdAt,
			provider: message.provider || null,
			model: message.model || null,
			tokenTotal: message.tokenTotal ?? null,
			interactivePayload: extractInteractivePayload(message)
		})),
		lastTrace: buildTracePayload(lastTrace),
		runs,
		menuPreview: await buildMenuPreview(conversation),
		updatedAt: conversation.updatedAt,
		queue: conversation.queue,
		aiEnabled: conversation.aiEnabled
	};
}

async function resetConversationForFixture(conversationId, fixture, workspaceId = DEFAULT_WORKSPACE_ID) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const baseState = {
		...createResetConversationState(),
		...(fixture.stateOverrides || {})
	};

	await prisma.$transaction([
		prisma.message.deleteMany({
			where: {
				conversationId,
				workspaceId: resolvedWorkspaceId,
			},
		}),
		prisma.conversation.updateMany({
			where: {
				id: conversationId,
				workspaceId: resolvedWorkspaceId,
			},
			data: {
				queue: 'AUTO',
				aiEnabled: true,
				lastSummary: null,
				lastMessageAt: null
			}
		}),
		prisma.conversationState.upsert({
			where: { conversationId },
			update: baseState,
			create: {
				conversationId,
				...baseState
			}
		})
	]);

	if (Array.isArray(fixture.seedMessages) && fixture.seedMessages.length) {
		const now = Date.now();
		await prisma.message.createMany({
			data: fixture.seedMessages.map((message, index) => ({
				conversationId,
				workspaceId: resolvedWorkspaceId,
				direction: message.direction,
				type: message.type || 'text',
				body: message.body,
				senderName:
					message.direction === 'OUTBOUND'
						? (process.env.BUSINESS_NAME || 'Lummine')
						: (fixture.contactName || 'Cliente'),
				provider: message.direction === 'OUTBOUND' ? 'fixture' : null,
				model: message.direction === 'OUTBOUND' ? 'fixture' : null,
				rawPayload: message.direction === 'INBOUND' ? { source: 'ai-lab' } : null,
				createdAt: new Date(now + index * 1000)
			}))
		});

		await prisma.conversation.updateMany({
			where: {
				id: conversationId,
				workspaceId: resolvedWorkspaceId,
			},
			data: {
				lastMessageAt: new Date(now + fixture.seedMessages.length * 1000)
			}
		});
	}
}

function fixtureMetaFromFixture(fixture = {}) {
	return {
		key: fixture.key,
		name: fixture.name,
		description: fixture.description,
		expected: fixture.expected || []
	};
}

export function listAiLabFixtures() {
	return AI_LAB_FIXTURES.map((fixture) => ({
		key: fixture.key,
		name: fixture.name,
		description: fixture.description,
		expected: fixture.expected || [],
		messageCount: Array.isArray(fixture.seedMessages) ? fixture.seedMessages.length : 0
	}));
}

export async function createAiLabSession({
	workspaceId = DEFAULT_WORKSPACE_ID,
	fixtureKey = 'blank'
} = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const fixture = getAiLabFixture(fixtureKey);
	const waId = buildFakeWaId();
	const contactName = `${AI_LAB_CONTACT_PREFIX}${fixture.contactName || 'German'}`;

	const conversation = await getOrCreateConversation({
		workspaceId: resolvedWorkspaceId,
		waId,
		contactName,
		queue: 'AUTO',
		aiEnabled: true
	});

	await resetConversationForFixture(conversation.id, fixture, resolvedWorkspaceId);

	if (fixture.startWithMainMenu) {
		await openAiLabMenu({
			workspaceId: resolvedWorkspaceId,
			conversationId: conversation.id,
			contactName,
			menuPath: fixture.menuPath || DEFAULT_MAIN_MENU_KEY,
			bodyPrefix: fixture.menuIntroText || ''
		});
	}

	const sessionId = randomUUID();
	SESSIONS.set(sessionId, {
		sessionId,
		workspaceId: resolvedWorkspaceId,
		conversationId: conversation.id,
		fixtureKey: fixture.key,
		lastTrace: null
	});

	const hydrated = await fetchSessionConversation(conversation.id, resolvedWorkspaceId);
	return await serializeConversation(hydrated, fixtureMetaFromFixture(fixture), null, sessionId);
}

export async function getAiLabSession(sessionId, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const session = SESSIONS.get(String(sessionId || ''));
	if (!session) return null;
	const resolvedWorkspaceId = assertSessionWorkspace(session, workspaceId);

	const fixture = getAiLabFixture(session.fixtureKey);
	const conversation = await fetchSessionConversation(session.conversationId, resolvedWorkspaceId);
	return await serializeConversation(conversation, fixtureMetaFromFixture(fixture), session.lastTrace, session.sessionId);
}

export async function resetAiLabSession(sessionId, { workspaceId = DEFAULT_WORKSPACE_ID, fixtureKey } = {}) {
	const session = SESSIONS.get(String(sessionId || ''));
	if (!session) {
		const error = new Error('Sesion de AI Lab no encontrada.');
		error.status = 404;
		throw error;
	}
	const resolvedWorkspaceId = assertSessionWorkspace(session, workspaceId);

	const fixture = getAiLabFixture(fixtureKey || session.fixtureKey);
	session.fixtureKey = fixture.key;
	session.lastTrace = null;

	await prisma.aiLabRun.deleteMany({
		where: {
			workspaceId: resolvedWorkspaceId,
			sessionId: session.sessionId,
		},
	});

	await resetConversationForFixture(session.conversationId, fixture, resolvedWorkspaceId);

	if (fixture.startWithMainMenu) {
		const baseConversation = await fetchSessionConversation(session.conversationId, resolvedWorkspaceId);
		await openAiLabMenu({
			workspaceId: resolvedWorkspaceId,
			conversationId: session.conversationId,
			contactName: baseConversation?.contact?.name || `${AI_LAB_CONTACT_PREFIX}German`,
			menuPath: fixture.menuPath || DEFAULT_MAIN_MENU_KEY,
			bodyPrefix: fixture.menuIntroText || ''
		});
	}

	const conversation = await fetchSessionConversation(session.conversationId, resolvedWorkspaceId);
	return await serializeConversation(conversation, fixtureMetaFromFixture(fixture), null, session.sessionId);
}

export async function sendAiLabMessage(sessionId, { workspaceId = DEFAULT_WORKSPACE_ID, body, selectionId = '', action = '' }) {
	const session = SESSIONS.get(String(sessionId || ''));
	if (!session) {
		const error = new Error('Sesion de AI Lab no encontrada.');
		error.status = 404;
		throw error;
	}
	const resolvedWorkspaceId = assertSessionWorkspace(session, workspaceId);

	const conversation = await fetchSessionConversation(session.conversationId, resolvedWorkspaceId);
	if (!conversation) {
		const error = new Error('Conversacion de AI Lab no encontrada.');
		error.status = 404;
		throw error;
	}

	const cleanAction = String(action || '').trim();
	const cleanSelectionId = String(selectionId || '').trim();
	const cleanBody = String(body || '').trim();

	if (cleanAction === 'open_menu') {
		await openAiLabMenu({
			workspaceId: session.workspaceId || conversation.workspaceId || DEFAULT_WORKSPACE_ID,
			conversationId: conversation.id,
			contactName: conversation.contact?.name || `${AI_LAB_CONTACT_PREFIX}German`,
			menuPath: conversation.state?.menuPath || DEFAULT_MAIN_MENU_KEY,
			bodyPrefix: 'Simulacion AI LAB: abrimos el menu comprador.'
		});

		session.lastTrace = {
			intent: 'menu',
			queueDecision: null,
			responsePolicy: null,
			commercialPlan: null,
			catalogProducts: [],
			commercialHints: [],
			prompt: null,
			assistantMessage: null,
			provider: 'system',
			model: 'ai-lab-menu-open',
			aiGuidance: null,
			liveOrderContext: null,
			shouldReply: false,
			menuAssistantContext: null,
		};

		await persistAiLabRun({
			sessionId: session.sessionId,
			workspaceId: session.workspaceId || conversation.workspaceId || DEFAULT_WORKSPACE_ID,
			fixtureKey: session.fixtureKey,
			conversationId: conversation.id,
			action: 'open_menu',
			userMessage: 'open_menu',
			trace: session.lastTrace,
		});
	} else {
		if (!cleanBody && !cleanSelectionId) {
			const error = new Error('El mensaje no puede estar vacio.');
			error.status = 400;
			throw error;
		}

		let nextMessageBody = cleanBody;
		let nextMessageType = 'text';
		let nextRawPayload = {
			source: 'ai-lab',
			sessionId
		};

		if (cleanSelectionId) {
			const { activeMenu, option } = await resolveRuntimeMenuOption({
				workspaceId: session.workspaceId || conversation.workspaceId || DEFAULT_WORKSPACE_ID,
				menuPath: conversation.state?.menuPath || DEFAULT_MAIN_MENU_KEY,
				selectionId: cleanSelectionId
			});

			nextMessageBody = option?.title || cleanSelectionId;
			nextMessageType = 'interactive';
			nextRawPayload = {
				source: 'ai-lab',
				sessionId,
				message: {
					interactive: {
						list_reply: {
							id: cleanSelectionId,
							title: option?.title || cleanSelectionId,
							description: option?.description || activeMenu?.title || ''
						}
					}
				}
			};
		}

		const result = await processInboundMessage({
			workspaceId: session.workspaceId || conversation.workspaceId || DEFAULT_WORKSPACE_ID,
			waId: conversation.contact?.waId,
			contactName: conversation.contact?.name || `${AI_LAB_CONTACT_PREFIX}German`,
			messageBody: nextMessageBody,
			messageType: nextMessageType,
			attachmentMeta: null,
			rawPayload: nextRawPayload,
			transportMode: 'lab'
		});

		session.lastTrace = result.trace || null;

		await persistAiLabRun({
			sessionId: session.sessionId,
			workspaceId: session.workspaceId || conversation.workspaceId || DEFAULT_WORKSPACE_ID,
			fixtureKey: session.fixtureKey,
			conversationId: conversation.id,
			action: cleanSelectionId ? 'selection' : 'message',
			selectionId: cleanSelectionId,
			userMessage: nextMessageBody,
			trace: session.lastTrace,
		});
	}

	const fixture = getAiLabFixture(session.fixtureKey);
	const updatedConversation = await fetchSessionConversation(session.conversationId, resolvedWorkspaceId);
	return await serializeConversation(updatedConversation, fixtureMetaFromFixture(fixture), session.lastTrace, session.sessionId);
}
