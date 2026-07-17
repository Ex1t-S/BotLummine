import { randomUUID } from 'node:crypto';
import { logger } from '../../lib/logger.js';

const MAX_FACTS = 20;
const MAX_FLAGS = 20;

function boundedText(value, maxLength = 128) {
	const text = String(value || '').trim();
	return text ? text.slice(0, maxLength) : null;
}

function boundedList(values, maxItems) {
	if (!Array.isArray(values)) return [];
	return values
		.map((value) => boundedText(typeof value === 'string' ? value : value?.source || value?.name, 120))
		.filter(Boolean)
		.slice(0, maxItems);
}

function normalizeConfidence(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 0;
	return Math.min(1, Math.max(0, numeric));
}

function normalizeIntent(intent) {
	if (typeof intent === 'string') {
		return { name: boundedText(intent, 80), confidence: 0 };
	}

	return {
		name: boundedText(intent?.name || intent?.intent || intent?.type, 80),
		confidence: normalizeConfidence(intent?.confidence),
	};
}

export function createAiTurnTrace({
	traceId = randomUUID(),
	workspaceId = null,
	conversationId = null,
	promptVersion = null,
	promptHash = null,
	route = 'AUTO',
	intent = null,
	retrievedFacts = [],
	provider = null,
	model = null,
	latencyMs = 0,
	usage = null,
	audit = null,
	handoff = null,
} = {}) {
	const flags = boundedList(audit?.flags || [], MAX_FLAGS);
	const normalizedRoute = boundedText(route, 40) || 'AUTO';

	return Object.freeze({
		traceId: boundedText(traceId, 128),
		workspaceId: boundedText(workspaceId, 128),
		conversationId: boundedText(conversationId, 128),
		promptVersion: boundedText(promptVersion, 80),
		promptHash: /^[a-f0-9]{64}$/i.test(String(promptHash || '')) ? String(promptHash).toLowerCase() : null,
		route: normalizedRoute,
		intent: Object.freeze(normalizeIntent(intent)),
		retrievedFacts: Object.freeze(boundedList(retrievedFacts, MAX_FACTS)),
		provider: boundedText(provider, 80),
		model: boundedText(model, 120),
		latencyMs: Math.max(0, Math.round(Number(latencyMs) || 0)),
		inputTokens: Math.max(0, Math.round(Number(usage?.inputTokens) || 0)),
		outputTokens: Math.max(0, Math.round(Number(usage?.outputTokens) || 0)),
		audit: Object.freeze({
			passed: audit?.passed === undefined ? flags.length === 0 : Boolean(audit.passed),
			flags: Object.freeze(flags),
		}),
		handoff: handoff
			? Object.freeze({ reason: boundedText(handoff?.reason || handoff, 120) })
			: null,
	});
}

export function logAiTurnTrace(trace) {
	logger.info('ai.turn.completed', trace);
	return trace;
}
