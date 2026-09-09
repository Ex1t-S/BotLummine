import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reserveAutomaticReply } from '../src/services/conversation/outbound-reservation.js';

test('only one concurrent attempt is acquired; restart does not erase the reservation', async () => {
	const rows = new Map();
	const db = { conversationEvent: {
		create: async ({ data }) => {
			const key = `${data.workspaceId}:${data.idempotencyKey}`;
			if (rows.has(key)) throw Object.assign(new Error('unique'), { code: 'P2002' });
			const row = { id: key, ...data }; rows.set(key, row); await Promise.resolve(); return row;
		},
		findFirst: async ({ where }) => rows.get(`${where.workspaceId}:${where.idempotencyKey}`),
	} };
	const scope = { workspaceId: 'demo', conversationId: 'chat', inboundMessageId: 'inbound' };
	const attempts = await Promise.all(Array.from({ length: 5 }, () => reserveAutomaticReply(db, scope)));
	assert.equal(attempts.filter(row => row.acquired).length, 1);
	assert.equal((await reserveAutomaticReply(db, scope)).acquired, false);
	assert.equal((await reserveAutomaticReply(db, { ...scope, workspaceId: 'another-demo' })).acquired, true);
	assert.equal((await reserveAutomaticReply(db, { ...scope, inboundMessageId: 'another-inbound' })).acquired, true);
});
test('unexpected database errors fail closed before transport', async () => {
	await assert.rejects(reserveAutomaticReply({ conversationEvent: { create: async () => { throw new Error('offline'); } } },
		{ workspaceId: 'w', conversationId: 'c', inboundMessageId: 'i' }), /offline/);
	await assert.rejects(reserveAutomaticReply({}, { workspaceId: 'w' }), /scoped/);
});
