import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRecentConversation } from '../src/services/conversation/recent-history.js';

test('history reads at most the bounded window and one previous outbound', async () => {
	const source = [{ id: 'new', direction: 'INBOUND', createdAt: new Date(300) }, { id: 'old', direction: 'INBOUND', createdAt: new Date(200) }];
	const result = await loadRecentConversation({
		conversation: { findFirst: async query => {
			assert.deepEqual(query.where, { id: 'chat', workspaceId: 'demo' });
			assert.equal(query.include.messages.take, 20);
			return { messages: source };
		} },
		message: { findFirst: async query => {
			assert.equal(query.where.workspaceId, 'demo');
			assert.equal(query.where.createdAt.lte.getTime(), 200);
			return { id: 'outbound', direction: 'OUTBOUND', createdAt: new Date(100) };
		} },
	}, { conversationId: 'chat', workspaceId: 'demo', contextLimit: 12 });
	assert.deepEqual(result.messages.map(m => m.id), ['outbound', 'old', 'new']);
	assert.deepEqual(source.map(m => m.id), ['new', 'old']);
});
test('recent outbound avoids another query and context cannot grow without limit', async () => {
	await loadRecentConversation({ conversation: { findFirst: async query => {
		assert.equal(query.include.messages.take, 100);
		return { messages: [{ direction: 'OUTBOUND' }] };
	} } }, { conversationId: 'chat', workspaceId: 'demo', contextLimit: 99999 });
	await assert.rejects(loadRecentConversation({}, { conversationId: 'chat' }));
});
