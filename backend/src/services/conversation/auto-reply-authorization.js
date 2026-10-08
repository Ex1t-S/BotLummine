import { isHumanLockActive } from './conversation-events.service.js';

function cancelled(reason) {
	const error = new Error('La respuesta automática quedó sin autorización.');
	Object.assign(error, { code: 'OUTBOUND_TURN_CANCELLED', status: 409, retryable: false, reason });
	return error;
}

// Re-read after generation and again immediately before transport. This closes
// the long generation window; it does not claim atomicity with a remote API.
export async function assertAutoReplyAuthorized(db, { workspaceId, conversationId, inboundMessageId, expectedHandoff = null }) {
	if (!workspaceId || !conversationId || !inboundMessageId) throw cancelled('missing_turn_scope');
	const conversation = await db.conversation.findFirst({
		where: { id: conversationId, workspaceId }, include: { state: true },
	});
	if (!conversation) throw cancelled('conversation_missing');
	const latest = await db.message.findFirst({
		where: { conversationId, workspaceId, direction: 'INBOUND' },
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true },
	});
	if (latest?.id !== inboundMessageId) throw cancelled('newer_inbound');
	const state = conversation.state || {};
	const ownsHandoff = expectedHandoff?.reason !== 'manual_handoff'
		&& Boolean(expectedHandoff?.lockedAt)
		&& state.needsHuman === true && conversation.queue === 'HUMAN'
		&& state.handoffReason === expectedHandoff?.reason
		&& new Date(state.humanLockedAt).getTime() === new Date(expectedHandoff.lockedAt).getTime();
	if (!ownsHandoff && (conversation.aiEnabled !== true || conversation.queue !== 'AUTO' || isHumanLockActive(state))) {
		throw cancelled('human_control');
	}
	return conversation;
}
