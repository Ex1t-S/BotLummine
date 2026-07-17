import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	getAiTraceRetentionDays,
	persistAiTurnTrace,
	pruneExpiredAiTurnTraces,
} from '../src/services/ai/turn-trace-store.js';

describe('AI turn trace persistence', () => {
	it('persists only the bounded canonical trace and sets its expiry', async () => {
		let createArgs = null;
		const now = new Date('2026-07-17T12:00:00.000Z');
		const client = {
			aiTurnTrace: {
				create: async (args) => {
					createArgs = args;
					return { id: 'trace-row', ...args.data };
				},
			},
		};

		const result = await persistAiTurnTrace({
			client,
			now,
			retentionDays: 7,
			inboundMessageId: 'message-1',
			trace: {
				traceId: 'trace-1',
				workspaceId: 'workspace-1',
				conversationId: 'conversation-1',
				promptVersion: 'conversation-v1',
				promptHash: 'a'.repeat(64),
				route: 'AUTO',
				intent: { name: 'PRODUCT_QUERY', confidence: 0.82 },
				retrievedFacts: ['catalog:verified'],
				provider: 'mock-provider',
				model: 'mock-model',
				latencyMs: 240,
				inputTokens: 120,
				outputTokens: 30,
				audit: { passed: false, flags: ['unverified_stock'] },
				handoff: { reason: 'verification_required' },
				prompt: 'secret prompt that must not be persisted',
				message: 'private customer message',
			},
		});

		assert.equal(result.id, 'trace-row');
		assert.equal(createArgs.data.expiresAt.toISOString(), '2026-07-24T12:00:00.000Z');
		assert.equal(createArgs.data.intentName, 'PRODUCT_QUERY');
		assert.equal(createArgs.data.inboundMessageId, 'message-1');
		assert.deepEqual(createArgs.data.auditFlags, ['unverified_stock']);
		assert.equal('prompt' in createArgs.data, false);
		assert.equal('message' in createArgs.data, false);
		assert.equal(JSON.stringify(createArgs.data).includes('secret prompt'), false);
		assert.equal(JSON.stringify(createArgs.data).includes('private customer'), false);
	});

	it('rejects incomplete traces without writing and bounds retention policy', async () => {
		let writes = 0;
		const client = {
			aiTurnTrace: {
				create: async () => {
					writes += 1;
				},
			},
		};

		assert.equal(await persistAiTurnTrace({ trace: { traceId: 'missing-scope' }, client }), null);
		assert.equal(writes, 0);
		assert.equal(getAiTraceRetentionDays('0'), 1);
		assert.equal(getAiTraceRetentionDays('9999'), 365);
		assert.equal(getAiTraceRetentionDays('invalid'), 30);
	});

	it('prunes an isolated bounded batch and rechecks expiry on delete', async () => {
		let findArgs = null;
		let deleteArgs = null;
		const now = new Date('2026-07-17T12:00:00.000Z');
		const client = {
			aiTurnTrace: {
				findMany: async (args) => {
					findArgs = args;
					return [{ id: 'expired-1' }, { id: 'expired-2' }];
				},
				deleteMany: async (args) => {
					deleteArgs = args;
					return { count: 2 };
				},
			},
		};

		const result = await pruneExpiredAiTurnTraces({
			client,
			now,
			batchSize: 50,
			workspaceId: 'workspace-1',
		});

		assert.deepEqual(result, { selected: 2, deleted: 2 });
		assert.deepEqual(findArgs.where, {
			expiresAt: { lte: now },
			workspaceId: 'workspace-1',
		});
		assert.equal(findArgs.take, 50);
		assert.deepEqual(deleteArgs.where.id.in, ['expired-1', 'expired-2']);
		assert.equal(deleteArgs.where.workspaceId, 'workspace-1');
		assert.deepEqual(deleteArgs.where.expiresAt, { lte: now });
	});
});
