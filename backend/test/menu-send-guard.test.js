import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reserveMenuPrompt } from '../src/services/conversation/menu-send-guard.js';
import { planInboundTimestampRepair } from '../scripts/repair-inbound-event-times.mjs';

test('concurrent same-menu attempts reserve only once, without blocking other menu paths or workspaces', async () => {
	const events = [];
	let tail = Promise.resolve();
	const client = { $transaction: (run) => {
		const next = tail.then(() => run({
			$queryRaw: async () => [{ id: 'conversation' }],
			conversationEvent: {
				findFirst: async ({ where: w }) => events.find((e) => e.workspaceId === w.workspaceId && e.conversationId === w.conversationId
					&& e.metadata.menuPath === w.metadata.equals && e.createdAt > w.createdAt.gt),
				create: async ({ data }) => { events.push(data); return data; },
			},
		}));
		tail = next.catch(() => {}); return next;
	} };
	const params = { workspaceId: 'w', conversationId: 'c', menuPath: 'MAIN_MENU', now: new Date() };
	assert.deepEqual(await Promise.all([1, 2, 3].map(() => reserveMenuPrompt(client, params))), [true, false, false]);
	assert.equal(await reserveMenuPrompt(client, { ...params, menuPath: 'ORDERS_MENU' }), true);
	assert.equal(await reserveMenuPrompt(client, { ...params, workspaceId: 'other' }), true);
	assert.equal(await reserveMenuPrompt(client, { ...params, now: new Date(params.now.getTime() + 60_001) }), true);
});

test('menu reservation fails closed for absent workspace or conversation', async () => {
	await assert.rejects(reserveMenuPrompt({}, { conversationId: 'c', menuPath: 'MAIN' }));
	await assert.rejects(reserveMenuPrompt({ $transaction: (run) => run({ $queryRaw: async () => [] }) }, {
		workspaceId: 'w', conversationId: 'foreign', menuPath: 'MAIN',
	}));
});

test('repair only selects genuine delayed timestamps and preserves original ingestion time for audit', () => {
	const received = new Date('2026-09-07T16:43:45.132Z');
	const row = { id: 'm', conversationId: 'c', createdAt: received, metaMessageId: 'wamid', rawPayload: { message: { timestamp: '1788367795' } } };
	const repair = planInboundTimestampRepair(row);
	assert.equal(repair.sentAt.toISOString(), '2026-09-02T16:49:55.000Z');
	assert.equal(repair.receivedAt.toISOString(), received.toISOString());
	assert.equal(planInboundTimestampRepair({ ...row, rawPayload: null }), null);
	assert.equal(planInboundTimestampRepair({ ...row, createdAt: repair.sentAt }), null);
	assert.equal(planInboundTimestampRepair({ ...row, rawPayload: { message: { timestamp: '9999999999' } } }), null);
});
