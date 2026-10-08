import { createHash } from 'node:crypto';

// Conservative at-most-one attempt for the ordinary automatic reply to an
// inbound. Retain reservations after crashes/timeouts; a human must reconcile
// an uncertain send instead of resetting the reservation and sending blindly.
export async function reserveAutomaticReply(db, { workspaceId, conversationId, inboundMessageId }) {
	if (!workspaceId || !conversationId || !inboundMessageId) throw new Error('Automatic reply reservation requires a scoped inbound.');
	const idempotencyKey = `auto-reply:${createHash('sha256').update(JSON.stringify([conversationId, inboundMessageId])).digest('hex')}`;
	try {
		const event = await db.conversationEvent.create({ data: {
			workspaceId, conversationId, idempotencyKey, eventType: 'AUTO_REPLY_RESERVED',
			reason: 'prevent_duplicate_outbound', metadata: { inboundMessageId, outcome: 'RESERVED' },
		} });
		return { acquired: true, eventId: event.id };
	} catch (error) {
		if (error.code !== 'P2002') throw error;
		const existing = await db.conversationEvent.findFirst({ where: { workspaceId, conversationId, idempotencyKey } });
		if (!existing) throw error;
		return { acquired: false, eventId: existing.id };
	}
}
