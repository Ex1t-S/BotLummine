import { contextMessageLimit } from './reply-safety.js';

export async function loadRecentConversation(db, { conversationId, workspaceId, contextLimit }) {
	if (!conversationId || !workspaceId) throw new Error('Recent history requires a scoped conversation.');
	const conversation = await db.conversation.findFirst({
		where: { id: conversationId, workspaceId },
		include: {
			contact: true, state: true,
			messages: {
				orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
				take: Math.max(20, contextMessageLimit(contextLimit)),
			},
		},
	});
	if (!conversation) return null;
	const messages = [...conversation.messages].reverse();
	if (messages.length && !messages.some(message => message.direction === 'OUTBOUND')) {
		// Preserve menu/campaign history without loading every historical message.
		const historicalOutbound = await db.message.findFirst({
			where: { conversationId, workspaceId, direction: 'OUTBOUND', createdAt: { lte: messages[0].createdAt } },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		});
		if (historicalOutbound) messages.unshift(historicalOutbound);
	}
	return { ...conversation, messages };
}
