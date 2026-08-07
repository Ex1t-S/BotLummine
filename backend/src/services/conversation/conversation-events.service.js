import { prisma } from '../../lib/prisma.js';

export const HUMAN_LOCK_MODE = Object.freeze({
	HARD: 'HARD',
	COMMERCIAL_24H: 'COMMERCIAL_24H',
});

const HARD_HANDOFF_REASONS = new Set([
	'cancel_request',
	'customer_frustration',
	'explicit_human_request',
	'menu_requested_human',
	'menu_unresolved',
	'payment_review',
	'return_exchange',
	'return_exchange_needs_human',
	'return_exchange_followup_received',
	'requested_human',
	'sensitive_support',
	'tracking_followup',
	'tracking_followup_needs_human',
	'ai_cannot_continue',
]);

const COMMERCIAL_INTENTS = new Set([
	'general',
	'product',
	'stock_check',
	'size_help',
	'shipping',
	'payment',
	'campaign_reply',
]);

export function resolveHumanLockMode({ reason = '', currentState = {} } = {}) {
	const normalizedReason = String(reason || '').trim().toLowerCase();
	if (HARD_HANDOFF_REASONS.has(normalizedReason)) return HUMAN_LOCK_MODE.HARD;

	const lastIntent = String(currentState?.lastIntent || currentState?.lastDetectedIntent || '')
		.trim()
		.toLowerCase();
	if (COMMERCIAL_INTENTS.has(lastIntent) || normalizedReason === 'manual_handoff') {
		return HUMAN_LOCK_MODE.COMMERCIAL_24H;
	}

	return HUMAN_LOCK_MODE.HARD;
}

export function resolveHumanAutoResumeAt({ mode, lockedAt = new Date() } = {}) {
	if (mode !== HUMAN_LOCK_MODE.COMMERCIAL_24H) return null;
	return new Date(new Date(lockedAt).getTime() + 24 * 60 * 60 * 1000);
}

export function isHumanLockActive(state = {}, now = new Date()) {
	if (!state?.needsHuman) return false;

	if (state.humanLockMode === HUMAN_LOCK_MODE.HARD) return true;

	if (state.humanLockMode === HUMAN_LOCK_MODE.COMMERCIAL_24H) {
		const resumeAt = state.humanAutoResumeAt
			? new Date(state.humanAutoResumeAt).getTime()
			: 0;
		return !resumeAt || resumeAt > new Date(now).getTime();
	}

	if (
		!state.humanLockMode &&
		resolveHumanLockMode({ reason: state.handoffReason, currentState: state }) === HUMAN_LOCK_MODE.HARD
	) {
		return true;
	}

	const updatedAt = state.updatedAt ? new Date(state.updatedAt).getTime() : 0;
	return !updatedAt || new Date(now).getTime() - updatedAt < 24 * 60 * 60 * 1000;
}

export async function recordConversationEvent({
	workspaceId,
	conversationId,
	eventType,
	actorType = 'SYSTEM',
	actorUserId = null,
	fromQueue = null,
	toQueue = null,
	reason = null,
	idempotencyKey = null,
	metadata = null,
	db = prisma,
} = {}) {
	if (!workspaceId || !conversationId || !eventType) return null;

	if (idempotencyKey) {
		const existing = await db.conversationEvent.findFirst({
			where: { workspaceId, idempotencyKey },
		});
		if (existing) return existing;
	}

	return db.conversationEvent.create({
		data: {
			workspaceId,
			conversationId,
			eventType,
			actorType,
			actorUserId,
			fromQueue,
			toQueue,
			reason,
			idempotencyKey,
			metadata,
		},
	});
}
