import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
	fetchShopifyOrderById,
	getCustomerSyncStatus,
	resolveStoreCredentials,
	syncCustomers,
	upsertShopifyOrder,
	upsertTiendanubeOrder,
} from '../src/services/customers/customer.service.js';

function rejectsMissingWorkspace(operation) {
	return assert.rejects(
		operation,
		(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
	);
}

describe('customer synchronization workspace boundaries', () => {
	it('rejects synchronization and order operations without an explicit workspace', async () => {
		assert.throws(
			() => getCustomerSyncStatus(),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);

		for (const operation of [
			() => resolveStoreCredentials(),
			() => syncCustomers(),
			() => fetchShopifyOrderById({ orderId: 'order-a' }),
			() => upsertTiendanubeOrder({ id: 'order-a' }, 'store-a'),
			() => upsertShopifyOrder({ id: 'order-a' }, 'store-a'),
		]) {
			await rejectsMissingWorkspace(operation);
		}
	});

	it('keeps runtime status and database mutations scoped by workspace', async () => {
		const serviceSource = await readFile(
			new URL('../src/services/customers/customer.service.js', import.meta.url),
			'utf8',
		);
		const controllerSource = await readFile(
			new URL('../src/controllers/customer.controller.js', import.meta.url),
			'utf8',
		);

		assert.match(serviceSource, /const syncStatesByWorkspace = new Map\(\)/);
		assert.match(serviceSource, /workspaceOwnedWhere\(\{ id: existing\.id, workspaceId \}\)/);
		assert.match(serviceSource, /workspaceOwnedWhere\(\{ id: item\.id, workspaceId: resolvedWorkspaceId \}\)/);
		assert.match(serviceSource, /workspaceOwnedWhere\(\{ id: syncLog\.id, workspaceId: resolvedWorkspaceId \}\)/);
		assert.match(controllerSource, /getCustomerSyncStatusService\(\{[\s\S]*workspaceId: requireRequestWorkspaceId\(req\)/);
	});
});
