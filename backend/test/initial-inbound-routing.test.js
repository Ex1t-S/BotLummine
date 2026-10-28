import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
const unused = async () => assert.fail('Unexpected database operation');
const prisma = {
	contact: { upsert: unused },
	conversation: { findUnique: unused, create: unused },
	workspaceAiConfig: { findUnique: unused },
	conversationState: { findMany: async () => [] },
};
globalThis.prisma = prisma;
const { getInitialInboundRouting } = await import('../src/services/conversation/initial-routing.service.js');
const { getOrCreateConversation } = await import('../src/services/conversation/chat.service.js');

describe('initial inbound routing', () => {
	it('uses only the requested workspace policy and preserves human default elsewhere', async () => {
		const prismaClient = { workspaceAiConfig: { findUnique: async ({ where }) => ({ policyConfig: { defaultInboundQueue: where.workspaceId === 'pampa' ? 'AUTO' : 'HUMAN' } }) } };
		assert.deepEqual(await getInitialInboundRouting('pampa', { prismaClient }), { queue: 'AUTO', aiEnabled: true });
		assert.deepEqual(await getInitialInboundRouting('other', { prismaClient }), { queue: 'HUMAN', aiEnabled: false });
		await assert.rejects(() => getInitialInboundRouting('', { prismaClient }), e => e.code === 'WORKSPACE_SCOPE_REQUIRED');
	});
	it('keeps unknown and unset policies in human mode', async () => {
		for (const config of [null, {}, { policyConfig: { defaultInboundQueue: 'PAYMENT_REVIEW' } }]) {
			const prismaClient = { workspaceAiConfig: { findUnique: async () => config } };
			assert.deepEqual(await getInitialInboundRouting('other', { prismaClient }), { queue: 'HUMAN', aiEnabled: false });
		}
	});
	it('creates a new inbound conversation in automatic mode with consistent state', async (t) => {
		t.mock.method(prisma.contact, 'upsert', async () => ({ id: 'contact' }));
		t.mock.method(prisma.conversation, 'findUnique', async () => null);
		t.mock.method(prisma.workspaceAiConfig, 'findUnique', async ({ where }) => {
			assert.equal(where.workspaceId, 'pampa');
			return { policyConfig: { defaultInboundQueue: 'AUTO' } };
		});
		t.mock.method(prisma.conversation, 'create', async ({ data }) => {
			assert.equal(data.queue, 'AUTO'); assert.equal(data.aiEnabled, true);
			assert.equal(data.state.create.needsHuman, false);
			return { ...data, state: data.state.create };
		});
		await getOrCreateConversation({ workspaceId: 'pampa', waId: '5492210000000', useWorkspaceRouting: true });
	});
	it('does not override existing human assignments or locks when a new message arrives', async (t) => {
		const existing = { id: 'existing', queue: 'HUMAN', aiEnabled: false, state: { needsHuman: true, humanLockMode: 'MANUAL' } };
		t.mock.method(prisma.contact, 'upsert', async () => ({ id: 'contact' }));
		t.mock.method(prisma.conversation, 'findUnique', async () => existing);
		t.mock.method(prisma.workspaceAiConfig, 'findUnique', async () => { throw new Error('must not read initial routing for an existing conversation'); });
		assert.equal(await getOrCreateConversation({ workspaceId: 'pampa', waId: '5492210000000', useWorkspaceRouting: true }), existing);
	});
});
