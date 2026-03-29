import { randomUUID } from 'node:crypto';

import { detectIntent } from '../lib/intent.js';
import { analyzeConversationTurn, buildHandoffReply } from './conversation-analysis.service.js';
import {
	searchCatalogProducts,
	buildCatalogContext,
	pickCommercialHints
} from './catalog-search.service.js';
import { resolveCommercialBrainV2 } from './commercial-brain.service.js';
import { runAssistantReply } from './ai/index.js';
import { buildPrompt } from './ai/prompt-builder.js';
import { AI_LAB_FIXTURES, getAiLabFixture } from '../data/ai-lab-fixtures.js';

const SESSIONS = new Map();
const MAX_SESSION_MESSAGES = 80;

function normalizeText(value = '') {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
}

function uniqueStrings(values = []) {
	return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map((item) => String(item).trim()))];
}

function createInitialState() {
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

function createBaseSession({ fixtureKey = 'blank' } = {}) {
	const fixture = getAiLabFixture(fixtureKey);
	const businessName = process.env.BUSINESS_NAME || 'Lummine';

	return {
		id: randomUUID(),
		fixtureKey: fixture.key,
		businessName,
		contactName: fixture.contactName || 'Cliente',
		customerContext: {
			name: fixture.customerContext?.name || fixture.contactName || 'Cliente',
			waId: fixture.customerContext?.waId || '5491100000000'
		},
		conversationState: createInitialState(),
		messages: [],
		lastTrace: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		fixtureMeta: {
			key: fixture.key,
			name: fixture.name,
			description: fixture.description,
			expected: fixture.expected || []
		}
	};
}

function trimMessages(messages = []) {
	if (!Array.isArray(messages) || messages.length <= MAX_SESSION_MESSAGES) {
		return Array.isArray(messages) ? messages : [];
	}

	return messages.slice(-MAX_SESSION_MESSAGES);
}

function buildConversationSummary({ state, lastUserMessage, lastAssistantMessage, commercialPlan }) {
	const parts = [];

	if (state?.lastUserGoal) parts.push(`Objetivo: ${state.lastUserGoal}`);
	if (state?.interestedProducts?.length) parts.push(`Interés: ${state.interestedProducts.join(', ')}`);
	if (commercialPlan?.productFocus) parts.push(`Foco: ${commercialPlan.productFocus}`);
	if (commercialPlan?.bestOffer?.name) parts.push(`Oferta: ${commercialPlan.bestOffer.name}`);
	if (state?.frequentSize) parts.push(`Talle: ${state.frequentSize}`);
	if (state?.paymentPreference) parts.push(`Pago: ${state.paymentPreference}`);
	if (state?.deliveryPreference) parts.push(`Entrega: ${state.deliveryPreference}`);
	if (state?.needsHuman || commercialPlan?.shouldEscalate) {
		parts.push(`Derivar: ${state.handoffReason || commercialPlan?.handoffReason || 'sí'}`);
	}
	if (lastUserMessage) parts.push(`Último cliente: ${normalizeText(lastUserMessage).slice(0, 120)}`);
	if (lastAssistantMessage) parts.push(`Última respuesta: ${normalizeText(lastAssistantMessage).slice(0, 120)}`);

	return parts.filter(Boolean).join(' | ');
}

function buildResponsePolicy({ intent, state, commercialPlan }) {
	if (state?.needsHuman || commercialPlan?.shouldEscalate) {
		return {
			action: 'handoff_human',
			useAI: false,
			allowHandoffMention: true,
			maxChars: 220,
			tone: 'empatico_concreto'
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

	if (intent === 'product' || intent === 'stock_check') {
		return {
			action: commercialPlan?.recommendedAction || 'product_guidance',
			useAI: true,
			allowHandoffMention: false,
			maxChars:
				commercialPlan?.recommendedAction === 'close_with_single_link'
					? 200
					: commercialPlan?.recommendedAction === 'present_single_best_offer'
						? 190
						: 240,
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
		tone: state?.preferredTone || 'amigable_directo'
	};
}

function inferCommercialMemory({ previousState, commercialPlan, assistantReply }) {
	const nextState = { ...previousState };
	const reply = normalizeText(assistantReply);

	nextState.currentProductFocus = commercialPlan?.productFocus || previousState.currentProductFocus || null;
	nextState.salesStage = commercialPlan?.stage || previousState.salesStage || null;
	nextState.buyingIntentLevel = commercialPlan?.buyingIntentLevel || previousState.buyingIntentLevel || null;
	nextState.lastRecommendedProduct = commercialPlan?.bestOffer?.name || previousState.lastRecommendedProduct || null;
	nextState.lastRecommendedOffer = commercialPlan?.bestOffer?.offerKey || previousState.lastRecommendedOffer || null;
	nextState.commercialSummary = buildConversationSummary({
		state: nextState,
		lastUserMessage: null,
		lastAssistantMessage: assistantReply,
		commercialPlan
	});

	const shownOffers = [...(Array.isArray(previousState.shownOffers) ? previousState.shownOffers : [])];
	const shownPrices = [...(Array.isArray(previousState.shownPrices) ? previousState.shownPrices : [])];
	const sharedLinks = [...(Array.isArray(previousState.sharedLinks) ? previousState.sharedLinks : [])];

	if (commercialPlan?.bestOffer?.name && reply.includes(normalizeText(commercialPlan.bestOffer.name))) {
		shownOffers.push(commercialPlan.bestOffer.offerKey || commercialPlan.bestOffer.name);
	}

	if (commercialPlan?.bestOffer?.price && reply.includes(normalizeText(commercialPlan.bestOffer.price))) {
		shownPrices.push(`${commercialPlan.bestOffer.name}::${commercialPlan.bestOffer.price}`);
	}

	if (commercialPlan?.bestOffer?.productUrl && assistantReply.includes(commercialPlan.bestOffer.productUrl)) {
		sharedLinks.push(commercialPlan.bestOffer.productUrl);
	}

	nextState.shownOffers = uniqueStrings(shownOffers);
	nextState.shownPrices = uniqueStrings(shownPrices);
	nextState.sharedLinks = uniqueStrings(sharedLinks);

	return nextState;
}

function sanitizeAssistantReply({ reply, businessName, contactName }) {
	let clean = String(reply || '').trim();

	if (!clean) return '';

	const labels = [businessName, contactName, 'Cliente', 'Asesora', 'Sofi', 'Lummine']
		.filter(Boolean)
		.map((label) => String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

	for (const label of labels) {
		clean = clean.replace(new RegExp(`(^|\\n)${label}:`, 'gi'), '$1');
	}

	const lines = clean
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !/^(respond[eé]|conversaci[oó]n reciente|plan comercial|cliente:|asesora:)/i.test(line));

	return normalizeText(lines.join(' '));
}

function serializeSession(session) {
	if (!session) return null;

	return {
		id: session.id,
		fixtureKey: session.fixtureKey,
		fixtureMeta: session.fixtureMeta,
		businessName: session.businessName,
		contactName: session.contactName,
		customerContext: session.customerContext,
		conversationState: session.conversationState,
		messages: session.messages,
		lastTrace: session.lastTrace,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt
	};
}

async function replayFixtureState(session) {
	let rollingState = createInitialState();
	let rollingMessages = [];
	let lastTrace = null;

	for (const message of session.messages) {
		rollingMessages.push(message);

		if (message.role !== 'user') continue;

		const intent = detectIntent(message.text, rollingState);
		const analyzed = analyzeConversationTurn({
			messageBody: message.text,
			intent,
			currentState: rollingState,
			recentMessages: rollingMessages.slice(-12)
		});

		const mergedState = {
			...rollingState,
			...analyzed,
			lastIntent: intent,
			lastDetectedIntent: analyzed.lastDetectedIntent,
			lastUserGoal: analyzed.lastUserGoal,
			customerName: session.customerContext?.name || session.contactName
		};

		const catalogProducts = await searchCatalogProducts({
			query: message.text,
			interestedProducts: mergedState.interestedProducts,
			limit: 4
		});

		const commercialPlan = resolveCommercialBrainV2({
			intent,
			messageBody: message.text,
			currentState: mergedState,
			recentMessages: rollingMessages.slice(-12),
			catalogProducts
		});

		rollingState = {
			...mergedState,
			currentProductFocus: commercialPlan.productFocus || mergedState.currentProductFocus || null,
			salesStage: commercialPlan.stage || mergedState.salesStage || null,
			buyingIntentLevel: commercialPlan.buyingIntentLevel || mergedState.buyingIntentLevel || null,
			lastRecommendedProduct: commercialPlan.bestOffer?.name || mergedState.lastRecommendedProduct || null,
			lastRecommendedOffer: commercialPlan.bestOffer?.offerKey || mergedState.lastRecommendedOffer || null
		};

		lastTrace = {
			intent,
			commercialPlan,
			catalogProducts,
			responsePolicy: buildResponsePolicy({ intent, state: rollingState, commercialPlan }),
			mode: 'fixture_replay'
		};
	}

	session.conversationState = rollingState;
	session.lastTrace = lastTrace;
}

async function applyFixtureToSession(session, fixtureKey) {
	const fixture = getAiLabFixture(fixtureKey);

	session.fixtureKey = fixture.key;
	session.contactName = fixture.contactName || session.contactName;
	session.customerContext = {
		name: fixture.customerContext?.name || fixture.contactName || session.contactName,
		waId: fixture.customerContext?.waId || session.customerContext?.waId || '5491100000000'
	};
	session.messages = trimMessages(
		(fixture.messages || []).map((message, index) => ({
			id: `${fixture.key}-${index + 1}`,
			role: message.role,
			text: message.text,
			createdAt: new Date().toISOString()
		}))
	);
	session.conversationState = createInitialState();
	session.lastTrace = null;
	session.fixtureMeta = {
		key: fixture.key,
		name: fixture.name,
		description: fixture.description,
		expected: fixture.expected || []
	};
	session.updatedAt = new Date().toISOString();

	await replayFixtureState(session);
	SESSIONS.set(session.id, session);

	return serializeSession(session);
}

export function listAiLabFixtures() {
	return AI_LAB_FIXTURES.map((fixture) => ({
		key: fixture.key,
		name: fixture.name,
		description: fixture.description,
		expected: fixture.expected || [],
		messageCount: Array.isArray(fixture.messages) ? fixture.messages.length : 0
	}));
}

export async function createAiLabSession({ fixtureKey = 'blank' } = {}) {
	const session = createBaseSession({ fixtureKey });
	await applyFixtureToSession(session, fixtureKey);
	return serializeSession(session);
}

export function getAiLabSession(sessionId) {
	const session = SESSIONS.get(String(sessionId || ''));
	if (!session) return null;
	return serializeSession(session);
}

export async function resetAiLabSession(sessionId, { fixtureKey } = {}) {
	const session = SESSIONS.get(String(sessionId || ''));
	if (!session) {
		const error = new Error('Sesión de AI Lab no encontrada.');
		error.status = 404;
		throw error;
	}

	return applyFixtureToSession(session, fixtureKey || session.fixtureKey || 'blank');
}

export async function sendAiLabMessage(sessionId, { body }) {
	const session = SESSIONS.get(String(sessionId || ''));
	if (!session) {
		const error = new Error('Sesión de AI Lab no encontrada.');
		error.status = 404;
		throw error;
	}

	const messageBody = normalizeText(body);
	if (!messageBody) {
		const error = new Error('El mensaje no puede estar vacío.');
		error.status = 400;
		throw error;
	}

	const userMessage = {
		id: randomUUID(),
		role: 'user',
		text: messageBody,
		createdAt: new Date().toISOString()
	};

	const messagesBeforeReply = trimMessages([...session.messages, userMessage]);
	const intent = detectIntent(messageBody, session.conversationState);
	const analyzed = analyzeConversationTurn({
		messageBody,
		intent,
		currentState: session.conversationState,
		recentMessages: messagesBeforeReply.slice(-12)
	});

	let nextState = {
		...session.conversationState,
		...analyzed,
		customerName: session.customerContext?.name || session.contactName,
		lastIntent: intent,
		lastDetectedIntent: analyzed.lastDetectedIntent,
		lastUserGoal: analyzed.lastUserGoal
	};

	const catalogProducts = await searchCatalogProducts({
		query: messageBody,
		interestedProducts: nextState.interestedProducts,
		limit: 4
	});

	const commercialPlan = resolveCommercialBrainV2({
		intent,
		messageBody,
		currentState: nextState,
		recentMessages: messagesBeforeReply.slice(-12),
		catalogProducts
	});

	const catalogContext = buildCatalogContext(catalogProducts);
	const commercialHints = pickCommercialHints(catalogProducts, commercialPlan);
	const responsePolicy = buildResponsePolicy({
		intent,
		state: nextState,
		commercialPlan
	});

	const lastAssistantMessage = [...messagesBeforeReply]
		.reverse()
		.find((message) => message.role === 'assistant')?.text || '';

	const conversationSummary = buildConversationSummary({
		state: nextState,
		lastUserMessage: messageBody,
		lastAssistantMessage,
		commercialPlan
	});

	const prompt = buildPrompt({
		businessName: session.businessName,
		contactName: session.contactName,
		recentMessages: messagesBeforeReply.slice(-10),
		conversationSummary,
		customerContext: session.customerContext,
		conversationState: nextState,
		liveOrderContext: null,
		catalogProducts,
		catalogContext,
		commercialHints,
		commercialPlan,
		responsePolicy
	});

	let assistantReply = '';
	let provider = 'ai';
	let rawError = null;

	if (responsePolicy.action === 'handoff_human') {
		assistantReply = buildHandoffReply({
			contactName: session.customerContext?.name || session.contactName,
			reason: nextState.handoffReason || commercialPlan.handoffReason || 'requested_human'
		});
		provider = 'handoff';
	} else {
		try {
			assistantReply = await runAssistantReply({
				businessName: session.businessName,
				contactName: session.contactName,
				recentMessages: messagesBeforeReply.slice(-10),
				conversationSummary,
				customerContext: session.customerContext,
				conversationState: nextState,
				liveOrderContext: null,
				catalogProducts,
				catalogContext,
				commercialHints,
				commercialPlan,
				responsePolicy
			});
		} catch (error) {
			rawError = error;
			provider = 'fallback';
			assistantReply = `No pude generar la respuesta con la IA ahora mismo: ${error.message}`;
		}
	}

	const cleanedReply = sanitizeAssistantReply({
		reply: assistantReply,
		businessName: session.businessName,
		contactName: session.contactName
	});

	const assistantMessage = {
		id: randomUUID(),
		role: 'assistant',
		text: cleanedReply || assistantReply,
		createdAt: new Date().toISOString()
	};

	nextState = inferCommercialMemory({
		previousState: nextState,
		commercialPlan,
		assistantReply: assistantMessage.text
	});

	session.messages = trimMessages([...messagesBeforeReply, assistantMessage]);
	session.conversationState = nextState;
	session.lastTrace = {
		intent,
		analyzedState: analyzed,
		commercialPlan,
		responsePolicy,
		catalogProducts,
		catalogContext,
		commercialHints,
		conversationSummary,
		prompt,
		provider,
		error: rawError ? rawError.message : null,
		lastUserMessage: messageBody,
		assistantMessage: assistantMessage.text
	};
	session.updatedAt = new Date().toISOString();

	SESSIONS.set(session.id, session);

	return serializeSession(session);
}
