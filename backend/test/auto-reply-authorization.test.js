import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertAutoReplyAuthorized } from '../src/services/conversation/auto-reply-authorization.js';

const scope = { workspaceId: 'demo', conversationId: 'chat', inboundMessageId: 'inbound' };
function client(conversation, latest = 'inbound') {
	return {
		conversation: { findFirst: async ({ where }) => {
			assert.deepEqual(where, { id: 'chat', workspaceId: 'demo' }); return conversation;
		} },
		message: { findFirst: async ({ where }) => {
			assert.equal(where.workspaceId, 'demo'); assert.equal(where.conversationId, 'chat');
			assert.equal(where.direction, 'INBOUND'); return { id: latest };
		} },
	};
}
test('current automatic turn is authorized', async () => {
	await assertAutoReplyAuthorized(client({ queue: 'AUTO', aiEnabled: true }), scope);
});
test('operator takeover during generation cancels the old reply', async () => {
	await assert.rejects(assertAutoReplyAuthorized(client({ queue: 'HUMAN', aiEnabled: false }), scope),
		error => error.code === 'OUTBOUND_TURN_CANCELLED' && error.retryable === false);
});
test('new inbound cancels a reply to an obsolete turn', async () => {
	await assert.rejects(assertAutoReplyAuthorized(client({ queue: 'AUTO', aiEnabled: true }, 'newer'), scope),
		error => error.reason === 'newer_inbound');
});
test('only the exact handoff created by this turn can acknowledge it', async () => {
	const lockedAt = new Date('2026-09-09T12:00:00Z');
	const expectedHandoff = { reason: 'requested_human', lockedAt };
	const conversation = { queue: 'HUMAN', aiEnabled: false, state: { needsHuman: true, handoffReason: 'requested_human', humanLockedAt: lockedAt } };
	await assertAutoReplyAuthorized(client(conversation), { ...scope, expectedHandoff });
	conversation.state.humanLockedAt = new Date('2026-09-09T12:00:01Z');
	await assert.rejects(assertAutoReplyAuthorized(client(conversation), { ...scope, expectedHandoff }));
	conversation.state.handoffReason = 'manual_handoff';
	await assert.rejects(assertAutoReplyAuthorized(client(conversation), { ...scope, expectedHandoff: { reason: 'manual_handoff', lockedAt: conversation.state.humanLockedAt } }));
});
test('no authorization is possible without a scoped inbound', async () => {
	await assert.rejects(assertAutoReplyAuthorized({}, { workspaceId: 'demo' }), e => e.reason === 'missing_turn_scope');
});
