import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	fetchEnboxShipmentDetailByDid,
	getEnboxConfig,
	resolveEnboxTracking,
} from '../src/services/enbox/enbox.service.js';
import {
	findCachedEnboxShipment,
	getEnboxSyncStatus,
	syncEnboxShipments,
} from '../src/services/enbox/enbox-sync.service.js';

describe('Enbox workspace boundary', () => {
	it('rejects config, tracking, cache and sync operations without an explicit workspace', async () => {
		for (const operation of [
			() => getEnboxConfig(),
			() => fetchEnboxShipmentDetailByDid('shipment-a'),
			() => resolveEnboxTracking({ id: 'order-a' }),
			() => findCachedEnboxShipment('order-a'),
			() => syncEnboxShipments(),
		]) {
			await assert.rejects(
				operation,
				(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
			);
		}

		assert.throws(
			() => getEnboxSyncStatus(),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
	});

	it('returns a tenant-specific empty status instead of another workspace state', () => {
		const alphaStatus = getEnboxSyncStatus('workspace-alpha');
		const betaStatus = getEnboxSyncStatus('workspace-beta');

		assert.equal(alphaStatus.workspaceId, 'workspace-alpha');
		assert.equal(betaStatus.workspaceId, 'workspace-beta');
		assert.equal(alphaStatus.running, false);
		assert.equal(betaStatus.running, false);
		assert.deepEqual(alphaStatus.errors, []);
		assert.deepEqual(betaStatus.errors, []);
	});
});
