import assert from 'node:assert/strict';
import { test } from 'node:test';

let state = {};
let messages = [];
const conversation = { id: 'c', workspaceId: 'w', contact: { waId: '5491100000000' }, queue: 'AUTO', aiEnabled: true };
const db = {
	workspace: { findUnique: async () => ({ id: 'w', name: 'Demo', aiConfig: {} }) },
	workspaceFeatureFlag: { findUnique: async () => ({ enabled: false }) },
	whatsAppMenuSetting: { findUnique: async () => ({ config: null }) },
	whatsAppChannel: { findFirst: async () => assert.fail('lab must never reach live transport') },
	conversation: {
		findFirst: async () => ({ ...conversation, state }),
		updateMany: async ({ data }) => { Object.assign(conversation, data); return { count: 1 }; },
	},
	conversationState: { upsert: async ({ update }) => { Object.assign(state, update); return state; } },
	conversationEvent: { create: async ({ data }) => data },
	message: { create: async ({ data }) => {
		const row = { id: `m-${messages.length}`, createdAt: new Date(), ...data }; messages.push(row); return row;
	} },
	$transaction: async (run) => run(db),
};
globalThis.prisma = db;
const { maybeHandleMenuFlow } = await import('../src/services/conversation/menu-flow.service.js');
const { sendAndPersistOutbound } = await import('../src/services/conversation/outbound-message.service.js');

function reset() {
	state = { menuActive: true, menuPath: 'MAIN_MENU', menuInvalidAttempts: 0, needsHuman: false };
	messages = [];
	conversation.queue = 'AUTO'; conversation.aiEnabled = true;
}
const run = (text) => maybeHandleMenuFlow({
	conversation: { ...conversation, messages: [
		{ direction: 'OUTBOUND', createdAt: new Date() }, { direction: 'INBOUND', createdAt: new Date() },
	] }, currentState: { ...state }, messageBody: text, messageType: 'text', transportMode: 'lab',
});

test('an active menu does not loop on greetings, and meaningful free text escapes it', async () => {
	reset();
	for (const greeting of ['Hola', 'OLA', 'buenas']) assert.equal((await run(greeting)).handled, true);
	assert.equal(messages.length, 0);
	assert.equal(state.menuInvalidAttempts, 0);
	assert.equal((await run('Quiero saber el precio del producto')).handled, false);
	assert.equal(state.menuActive, false);
});

test('invalid selections reach the bounded retry and human handoff instead of restarting main menu', async () => {
	reset();
	await run('xyz');
	assert.equal(state.menuInvalidAttempts, 1);
	assert.equal(messages.length, 1);
	assert.equal(messages[0].rawPayload.deliveryMode, 'lab');
	await run('zz');
	assert.equal(state.needsHuman, true);
	assert.equal(state.humanLockMode, 'HARD');
	assert.equal(messages.length, 2);
	await run('hola');
	assert.equal(messages.length, 2);
});

test('explicit menu reset in lab preserves simulation mode', async () => {
	reset();
	await run('menu');
	assert.equal(messages.length, 1);
	assert.equal(messages[0].rawPayload.deliveryMode, 'lab');
});

test('send boundary blocks an automatic turn when paused, but does not classify manual replies as automatic', async (t) => {
	reset();
	await assert.rejects(sendAndPersistOutbound({ conversationId: 'c', workspaceId: 'w', body: 'test', aiMeta: { provider: 'system' } }),
		(error) => error.code === 'AUTO_REPLIES_PAUSED');
	const stopBeforeTransport = new Error('manual reached config, stop before transport');
	t.mock.method(db.workspace, 'findUnique', async () => { throw stopBeforeTransport; });
	await assert.rejects(sendAndPersistOutbound({ conversationId: 'c', workspaceId: 'w', body: 'test', aiMeta: { provider: 'manual' } }),
		(error) => error === stopBeforeTransport);
	assert.equal(messages.length, 0);
});
