import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldFallbackInteractiveToText } from './interactive-fallback-policy.js';

describe('interactive message fallback policy', () => {
	it('falls back only when Meta explicitly rejects an interactive payload', () => {
		assert.equal(
			shouldFallbackInteractiveToText({ httpStatus: 400, error: { code: 131009, message: 'Invalid parameter value' } }),
			true
		);
		assert.equal(
			shouldFallbackInteractiveToText({ httpStatus: 400, error: { code: 100, message: 'Invalid interactive list parameter' } }),
			true
		);
	});

	it('does not retry after auth failures, ambiguous failures, or accepted messages', () => {
		assert.equal(shouldFallbackInteractiveToText({ httpStatus: 400, error: { code: 190, message: 'Invalid OAuth access token' } }), false);
		assert.equal(shouldFallbackInteractiveToText({ httpStatus: null, error: { message: 'timeout' } }), false);
		assert.equal(shouldFallbackInteractiveToText({ httpStatus: 500, error: { message: 'server error' } }), false);
		assert.equal(shouldFallbackInteractiveToText({ ok: true }), false);
	});
});
