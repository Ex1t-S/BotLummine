import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canFallbackInteractiveMessage, resolveAssistantHandoff, contextMessageLimit } from '../src/services/conversation/reply-safety.js';

test('interactive fallback requires a definite provider validation rejection', () => {
	for (const result of [
		{ ok: false, outcome: 'UNKNOWN', error: { message: 'timeout' } },
		{ ok: false, httpStatus: 503, error: { error: { code: 100 } } },
		{ ok: false, httpStatus: 401, error: { error: { code: 190 } } },
		{ ok: false, httpStatus: 429, error: { error: { code: 130429 } } },
		{ ok: true, httpStatus: 400, error: { error: { code: 100 } } },
	]) assert.equal(canFallbackInteractiveMessage(result), false);
	for (const code of [100, 131008, 131009]) {
		assert.equal(canFallbackInteractiveMessage({ ok: false, httpStatus: 400, error: { error: { code } } }), true);
	}
});

test('a structured human request cannot be overridden by a negative text audit', () => {
	assert.deepEqual(resolveAssistantHandoff({ output: { needsHuman: true, handoffReason: 'requested_human' }, audit: { triggerHumanHandoff: false } }),
		{ needsHuman: true, handoffReason: 'requested_human' });
	assert.deepEqual(resolveAssistantHandoff({ output: { needsHuman: false }, audit: { triggerHumanHandoff: true } }),
		{ needsHuman: true, handoffReason: 'ai_declared_handoff' });
	assert.deepEqual(resolveAssistantHandoff({ output: { needsHuman: false, handoffReason: 'stale' } }),
		{ needsHuman: false, handoffReason: null });
});

test('context size has safe defaults and an upper bound', () => {
	for (const value of [undefined, 'NaN', Infinity, -1, 0]) assert.equal(contextMessageLimit(value), 12);
	assert.equal(contextMessageLimit(4.9), 4);
	assert.equal(contextMessageLimit(10000), 100);
});
