import { randomUUID } from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { getOrCreateConversation, processInboundMessage } from '../conversation/chat.service.js';
import { createResetConversationState } from '../conversation/conversation-turn.service.js';
import { getAiLabFixture, AI_LAB_FIXTURES } from '../../data/ai-lab-fixtures.js';

const SESSIONS = new Map();
const AI_LAB_CONTACT_PREFIX = '__AI_LAB__::';

function buildFakeWaId() {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`.slice(-10);
	return `54911${suffix}`;
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
		shouldReply: trace.shouldReply ?? true
	};
}

async function fetchSessionConversation(conversationId) {
	return prisma.conversation.findUnique({
		where: { id: conversationId },
		include: {
			contact: true,
			state: true,
			messages: {
				orderBy: { createdAt: 'asc' }
			}
		}
	});
}

function serializeConversation(conversation, fixtureMeta, lastTrace = null, sessionId = null) {
	if (!conversation) return null;

	const rawName = conversation.contact?.name || 'Cliente';
	const contactName = rawName.startsWith(AI_LAB_CONTACT_PREFIX)
		? rawName.slice(AI_LAB_CONTACT_PREFIX.length)
		: rawName;

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
			text: message.body,
			createdAt: message.createdAt,
			provider: message.provider || null,
			model: message.model || null,
			tokenTotal: message.tokenTotal ?? null
		})),
		lastTrace: buildTracePayload(lastTrace),
		updatedAt: conversation.updatedAt,
		queue: conversation.queue,
		aiEnabled: conversation.aiEnabled
	};
}

async function resetConversationForFixture(conversationId, fixture) {
	const baseState = {
		...createResetConversationState(),
		...(fixture.stateOverrides || {})
	};

	await prisma.$transaction([
		prisma.message.deleteMany({ where: { conversationId } }),
		prisma.conversation.update({
			where: { id: conversationId },
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

		await prisma.conversation.update({
			where: { id: conversationId },
			data: {
				lastMessageAt: new Date(now + fixture.seedMessages.length * 1000)
			}
		});
	}
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

export async function createAiLabSession({ fixtureKey = 'blank' } = {}) {
	const fixture = getAiLabFixture(fixtureKey);
	const waId = buildFakeWaId();
	const contactName = `${AI_LAB_CONTACT_PREFIX}${fixture.contactName || 'German'}`;

	const conversation = await getOrCreateConversation({
		waId,
		contactName,
		queue: 'AUTO',
		aiEnabled: true
	});

	await resetConversationForFixture(conversation.id, fixture);

	const sessionId = randomUUID();
	SESSIONS.set(sessionId, {
		sessionId,
		conversationId: conversation.id,
		fixtureKey: fixture.key,
		lastTrace: null
	});

	const hydrated = await fetchSessionConversation(conversation.id);
	return serializeConversation(
		hydrated,
		{
			key: fixture.key,
			name: fixture.name,
			description: fixture.description,
			expected: fixture.expected || []
		},
		null,
		sessionId
	);
}

export async function getAiLabSession(sessionId) {
	const session = SESSIONS.get(String(sessionId || ''));
	if (!session) return null;

	const fixture = getAiLabFixture(session.fixtureKey);
	const conversation = await fetchSessionConversation(session.conversationId);

	return serializeConversation(
		conversation,
		{
			key: fixture.key,
			name: fixture.name,
			description: fixture.description,
			expected: fixture.expected || []
		},
		session.lastTrace,
		session.sessionId
	);
}

export async function resetAiLabSession(sessionId, { fixtureKey } = {}) {
	const session = SESSIONS.get(String(sessionId || ''));
	if (!session) {
		const error = new Error('Sesión de AI Lab no encontrada.');
		error.status = 404;
		throw error;
	}

	const fixture = getAiLabFixture(fixtureKey || session.fixtureKey);
	session.fixtureKey = fixture.key;
	session.lastTrace = null;

	await resetConversationForFixture(session.conversationId, fixture);

	const conversation = await fetchSessionConversation(session.conversationId);

	return serializeConversation(
		conversation,
		{
			key: fixture.key,
			name: fixture.name,
			description: fixture.description,
			expected: fixture.expected || []
		},
		null,
		session.sessionId
	);
}

export async function sendAiLabMessage(sessionId, { body }) {
	const session = SESSIONS.get(String(sessionId || ''));
	if (!session) {
		const error = new Error('Sesión de AI Lab no encontrada.');
		error.status = 404;
		throw error;
	}

	const conversation = await fetchSessionConversation(session.conversationId);
	if (!conversation) {
		const error = new Error('Conversación de AI Lab no encontrada.');
		error.status = 404;
		throw error;
	}

	const cleanBody = String(body || '').trim();
	if (!cleanBody) {
		const error = new Error('El mensaje no puede estar vacío.');
		error.status = 400;
		throw error;
	}

	const result = await processInboundMessage({
		waId: conversation.contact?.waId,
		contactName: conversation.contact?.name || `${AI_LAB_CONTACT_PREFIX}German`,
		messageBody: cleanBody,
		messageType: 'text',
		attachmentMeta: null,
		rawPayload: {
			source: 'ai-lab',
			sessionId
		},
		transportMode: 'lab'
	});

	session.lastTrace = result.trace || null;
	const fixture = getAiLabFixture(session.fixtureKey);
	const updatedConversation = await fetchSessionConversation(session.conversationId);

	return serializeConversation(
		updatedConversation,
		{
			key: fixture.key,
			name: fixture.name,
			description: fixture.description,
			expected: fixture.expected || []
		},
		session.lastTrace,
		session.sessionId
	);
}