import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availablePendingReplyLease, ownedPendingReplyLease, PENDING_REPLY_LEASE_MS } from '../src/services/conversation/pending-reply-lease.js';

test('pending work can recover a crashed worker but does not claim a fresh lease', () => {
	const now = new Date('2026-09-09T12:30:00Z');
	const filter = availablePendingReplyLease(now);
	assert.equal(filter.OR[0].pendingAutoReplyLockedAt, null);
	assert.equal(filter.OR[1].pendingAutoReplyLockedAt.lt.getTime(), now.getTime() - PENDING_REPLY_LEASE_MS);
});
test('old completion or failure cannot clear a newer worker lease or inbound', () => {
	const lockedAt = new Date();
	const scope = { conversationId: 'c', conversation: { workspaceId: 'w' } };
	assert.deepEqual(ownedPendingReplyLease(scope, 'old-inbound', lockedAt), {
		...scope, pendingAutoReplyMessageId: 'old-inbound', pendingAutoReplyLockedAt: lockedAt,
	});
});
