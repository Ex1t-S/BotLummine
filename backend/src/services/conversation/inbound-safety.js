// Meta retries webhooks after outages. Keep history, but never answer a backlog.
export const MAX_AUTO_REPLY_AGE_MS = 15 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

export function evaluateInboundFreshness({ rawPayload, metaMessageId, transportMode = 'live', now = Date.now() }) {
	if (transportMode === 'lab') return { allowed: true, reason: null, sentAt: null };
	const timestamp = rawPayload?.message?.timestamp;
	const isMetaMessage = Boolean(metaMessageId || rawPayload?.message);
	if (!isMetaMessage) return { allowed: true, reason: null, sentAt: null };
	const seconds = typeof timestamp === 'string' && /^\d+$/.test(timestamp)
		? Number(timestamp) : typeof timestamp === 'number' ? timestamp : NaN;
	const sentAtMs = seconds * 1000;
	if (!Number.isSafeInteger(seconds) || seconds <= 0 || !Number.isFinite(new Date(sentAtMs).getTime())) {
		return { allowed: false, reason: 'invalid_meta_timestamp', sentAt: null };
	}
	if (sentAtMs > now + MAX_CLOCK_SKEW_MS) {
		return { allowed: false, reason: 'future_meta_timestamp', sentAt: null };
	}
	return {
		allowed: now - sentAtMs <= MAX_AUTO_REPLY_AGE_MS,
		reason: now - sentAtMs > MAX_AUTO_REPLY_AGE_MS ? 'stale_meta_message' : null,
		sentAt: new Date(Math.min(sentAtMs, now)),
	};
}

export async function createInboundOnce(prismaClient, data) {
	const where = data.metaMessageId ? { workspaceId_metaMessageId: {
		workspaceId: data.workspaceId, metaMessageId: data.metaMessageId,
	} } : null;
	// Match the database unique key, including legacy rows without a channel.
	if (where && await prismaClient.message.findUnique({ where })) return null;
	try {
		return await prismaClient.message.create({ data });
	} catch (error) {
		// Concurrent deliveries can both pass the lookup. Only the insert winner responds.
		if (where && error?.code === 'P2002' && await prismaClient.message.findUnique({ where })) return null;
		throw error;
	}
}

export async function advanceInboundConversation(prismaClient, { id, workspaceId, createdAt }) {
	return prismaClient.$transaction([
		prismaClient.conversation.updateMany({ where: { id, workspaceId }, data: { unreadCount: { increment: 1 } } }),
		...['lastMessageAt', 'lastInboundMessageAt'].map((field) => prismaClient.conversation.updateMany({
			where: { id, workspaceId, OR: [{ [field]: null }, { [field]: { lt: createdAt } }] },
			data: { [field]: createdAt },
		})),
	]);
}
