export const PENDING_REPLY_LEASE_MS = 15 * 60 * 1000;
export function availablePendingReplyLease(now = new Date()) {
	return { OR: [
		{ pendingAutoReplyLockedAt: null },
		{ pendingAutoReplyLockedAt: { lt: new Date(now.getTime() - PENDING_REPLY_LEASE_MS) } },
	] };
}
export function ownedPendingReplyLease(scope, messageId, lockedAt) {
	return { ...scope, pendingAutoReplyMessageId: messageId, pendingAutoReplyLockedAt: lockedAt };
}
