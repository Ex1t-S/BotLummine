import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findInboundMessageForWorkspace, workspaceOwnedWhere } from './workspace-scope.js';

describe('workspace-owned record lookups', () => {
	it('requires both record and workspace identifiers', () => {
		assert.throws(
			() => workspaceOwnedWhere({ id: 'message-a' }),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
		assert.throws(
			() => workspaceOwnedWhere({ workspaceId: 'workspace-a' }),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
	});

	it('queries an inbound message with an immutable workspace boundary', async () => {
		let receivedQuery = null;
		const prismaClient = {
			message: {
				findFirst: async (query) => {
					receivedQuery = query;
					return null;
				},
			},
		};

		await findInboundMessageForWorkspace(prismaClient, {
			id: 'message-a',
			workspaceId: 'workspace-a',
		});

		assert.deepEqual(receivedQuery.where, {
			id: 'message-a',
			workspaceId: 'workspace-a',
			direction: 'INBOUND',
		});
	});
});
