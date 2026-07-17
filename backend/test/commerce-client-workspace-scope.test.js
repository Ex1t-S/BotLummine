import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	createTiendanubeClient,
	getTiendanubeClient,
	getTiendanubeConfig,
} from '../src/services/tiendanube/client.js';
import {
	getShopifyClient,
	getShopifyConfig,
} from '../src/services/shopify/client.js';

describe('commerce client workspace boundary', () => {
	it('rejects provider credential resolution without an explicit workspace', async () => {
		for (const operation of [
			() => getTiendanubeConfig(),
			() => getTiendanubeClient(),
			() => getShopifyConfig(),
			() => getShopifyClient(),
		]) {
			await assert.rejects(
				operation,
				(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
			);
		}
	});

	it('does not build a Tiendanube client from ambient credentials', () => {
		assert.throws(
			() => createTiendanubeClient(),
			/Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN/,
		);
	});
});
