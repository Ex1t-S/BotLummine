import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAiTurnTrace } from '../src/services/ai/turn-trace.js';

describe('AI turn trace', () => {
	it('builds a bounded correlatable trace without prompt or message contents', () => {
		const trace = createAiTurnTrace({
			traceId: 'trace-demo',
			workspaceId: 'workspace-demo',
			conversationId: 'conversation-demo',
			promptVersion: 'conversation-v1',
			promptHash: 'a'.repeat(64),
			route: 'HUMAN',
			intent: { name: 'PAYMENT_PROOF', confidence: 1.7 },
			retrievedFacts: ['catalog', 'order', ...Array.from({ length: 30 }, (_, index) => `fact-${index}`)],
			provider: 'gemini',
			model: 'model-demo',
			latencyMs: 125.7,
			usage: { inputTokens: 50, outputTokens: 12 },
			audit: { passed: false, flags: ['unverified_stock'] },
			handoff: { reason: 'payment_review' },
			prompt: 'must never be copied',
			message: 'must never be copied',
		});

		assert.equal(trace.intent.confidence, 1);
		assert.equal(trace.latencyMs, 126);
		assert.equal(trace.retrievedFacts.length, 20);
		assert.equal(trace.audit.passed, false);
		assert.equal(trace.handoff.reason, 'payment_review');
		assert.equal('prompt' in trace, false);
		assert.equal('message' in trace, false);
		assert.equal(JSON.stringify(trace).includes('must never be copied'), false);
	});

	it('rejects malformed hashes and normalizes negative numeric values', () => {
		const trace = createAiTurnTrace({
			promptHash: 'not-a-hash',
			latencyMs: -10,
			usage: { inputTokens: -4, outputTokens: null },
		});

		assert.equal(trace.promptHash, null);
		assert.equal(trace.latencyMs, 0);
		assert.equal(trace.inputTokens, 0);
		assert.equal(trace.outputTokens, 0);
	});
});
