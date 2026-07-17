import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyPrivateMediaCachePolicy,
	PRIVATE_MEDIA_CACHE_CONTROL,
} from './http-cache-policy.js';

describe('private media cache policy', () => {
	it('prevents authenticated attachments from entering shared or browser caches', () => {
		const headers = new Map();
		const response = {
			setHeader(name, value) {
				headers.set(name, value);
			},
		};

		applyPrivateMediaCachePolicy(response);

		assert.equal(PRIVATE_MEDIA_CACHE_CONTROL, 'private, no-store');
		assert.deepEqual(Object.fromEntries(headers), {
			'Cache-Control': 'private, no-store',
			Pragma: 'no-cache',
			Expires: '0',
			'X-Content-Type-Options': 'nosniff',
		});
	});

	it('rejects invalid response objects', () => {
		assert.throws(
			() => applyPrivateMediaCachePolicy(null),
			(error) => error instanceof TypeError,
		);
	});
});
