import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateInboundFreshness, createInboundOnce, advanceInboundConversation, MAX_AUTO_REPLY_AGE_MS } from '../src/services/conversation/inbound-safety.js';

const now = Date.parse('2026-09-07T17:00:00Z');
const policy = (timestamp, options = {}) => evaluateInboundFreshness({
	rawPayload: { message: { timestamp } }, metaMessageId: 'wamid.test', now, ...options,
});

test('fresh inbound is allowed; backlog is retained at its original time without a reply', () => {
	assert.equal(policy(String(now / 1000)).allowed, true);
	assert.equal(policy((now - MAX_AUTO_REPLY_AGE_MS) / 1000).allowed, true);
	assert.equal(policy((now - MAX_AUTO_REPLY_AGE_MS - 1000) / 1000).reason, 'stale_meta_message');
	const old = policy('1788367795');
	assert.equal(old.allowed, false);
	assert.equal(old.sentAt.getTime(), 1788367795000);
});

test('missing, malformed and future Meta timestamps fail closed', () => {
	for (const value of [undefined, null, '', 'oops', '1e9', 0, -1, {}, Infinity, '99999999999999999999']) {
		assert.equal(policy(value).allowed, false, String(value));
	}
	assert.equal(policy(now / 1000 + 61).reason, 'future_meta_timestamp');
	assert.equal(policy(now / 1000 + 30).sentAt.getTime(), now);
});

test('lab simulation is unaffected and missing timestamp on live Meta is suppressed', () => {
	assert.equal(policy(undefined, { transportMode: 'lab' }).allowed, true);
	assert.equal(evaluateInboundFreshness({ metaMessageId: 'wamid.test', now }).allowed, false);
});

test('legacy duplicates with a null channel are detected by the actual unique key', async () => {
	const client = { message: {
		findUnique: async ({ where }) => {
			assert.deepEqual(where, { workspaceId_metaMessageId: { workspaceId: 'w', metaMessageId: 'm' } });
			return { id: 'existing', whatsappChannelId: null };
		},
		create: async () => assert.fail('duplicate must not insert'),
	} };
	assert.equal(await createInboundOnce(client, { workspaceId: 'w', metaMessageId: 'm', whatsappChannelId: 'channel' }), null);
});

test('concurrent webhook retries create and process exactly one inbound', async () => {
	let row = null;
	const client = { message: {
		findUnique: async () => row,
		create: async ({ data }) => {
			if (row) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
			row = { id: 'winner', ...data }; return row;
		},
	} };
	const results = await Promise.all(Array.from({ length: 3 }, () => createInboundOnce(client, { workspaceId: 'w', metaMessageId: 'm' })));
	assert.equal(results.filter(Boolean).length, 1);
});

test('unrelated persistence failures propagate', async () => {
	const error = new Error('database unavailable');
	await assert.rejects(createInboundOnce({ message: {
		findUnique: async () => null, create: async () => { throw error; },
	} }, { workspaceId: 'w', metaMessageId: 'm' }), error);
});

test('inbox timestamp advances are workspace scoped and conditional; unread count increments once', async () => {
	const calls = [];
	const createdAt = new Date(now);
	await advanceInboundConversation({
		conversation: { updateMany: (query) => { calls.push(query); return query; } },
		$transaction: async (operations) => assert.equal(operations.length, 3),
	}, { id: 'c', workspaceId: 'w', createdAt });
	assert.deepEqual(calls[0], { where: { id: 'c', workspaceId: 'w' }, data: { unreadCount: { increment: 1 } } });
	for (const [index, field] of ['lastMessageAt', 'lastInboundMessageAt'].entries()) {
		assert.deepEqual(calls[index + 1].where, { id: 'c', workspaceId: 'w', OR: [{ [field]: null }, { [field]: { lt: createdAt } }] });
	}
});
