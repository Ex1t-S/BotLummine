import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	getCatalogPage,
	getCatalogSummary,
	syncCatalogForWorkspace,
	syncCatalogFromProvider,
	syncCatalogFromShopify,
	syncCatalogFromTiendanube,
} from '../src/services/catalog/catalog.service.js';
import {
	getCatalogLookupStatus,
	searchCatalogProducts,
} from '../src/services/catalog/catalog-search.service.js';

describe('catalog workspace boundary', () => {
	it('rejects reads, searches and syncs without an explicit workspace', async () => {
		for (const operation of [
			() => getCatalogPage(),
			() => getCatalogSummary(),
			() => getCatalogLookupStatus(),
			() => searchCatalogProducts({ query: 'remera' }),
			() => syncCatalogFromTiendanube(),
			() => syncCatalogFromShopify(),
			() => syncCatalogFromProvider(),
			() => syncCatalogForWorkspace(),
		]) {
			await assert.rejects(
				operation,
				(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
			);
		}
	});
});
