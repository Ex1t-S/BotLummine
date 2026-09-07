import assert from 'node:assert/strict';
import { test } from 'node:test';
// Inject a plain client before importing the graph: no live database or transport in this test.
const prisma = {
	message: { findFirst: async () => null, create: async () => assert.fail('unexpected message write') },
	workspaceFeatureFlag: { findUnique: async () => null },
	conversationEvent: { create: async ({ data }) => data },
	aiTurnTrace: { create: async ({ data }) => data },
	conversation: { findFirst: async () => assert.fail('must not reach routing') },
};
globalThis.prisma = prisma;
const { processInboundMessage } = await import('../src/services/conversation/chat.service.js');

for (const scenario of [
	{ name: 'old Meta retry', timestamp: '1788367795', enabled: true, reason: 'stale_meta_message' },
	{ name: 'paused workspace with a current message', enabled: false, reason: 'auto_replies_paused' },
]) {
	test(`${scenario.name} exits before any automatic route, even when resuming a pending reply`, async (t) => {
		const workspaceId = 'test-workspace';
		const inbound = {
			id: 'inbound', metaMessageId: 'wamid.test', createdAt: new Date(), type: 'text', body: 'hola',
			rawPayload: { message: { timestamp: scenario.timestamp || String(Math.floor(Date.now() / 1000)) } },
			conversation: { id: 'conversation', workspaceId, queue: 'AUTO', contact: { waId: '5491100000000' } },
		};
		t.mock.method(prisma.message, 'findFirst', async () => inbound);
		t.mock.method(prisma.workspaceFeatureFlag, 'findUnique', async () => ({ enabled: scenario.enabled }));
		t.mock.method(prisma.conversationEvent, 'create', async ({ data }) => data);
		t.mock.method(prisma.aiTurnTrace, 'create', async ({ data }) => data);
		t.mock.method(prisma.conversation, 'findFirst', async () => assert.fail('must not reach routing'));
		t.mock.method(prisma.message, 'create', async () => assert.fail('must not create outbound'));
		const result = await processInboundMessage({ workspaceId, existingInboundMessageId: 'inbound', bypassResponseCooldown: true });
		assert.equal(result.trace.shouldReply, false);
		assert.equal(result.trace.responsePolicy.reason, scenario.reason);
	});
}
