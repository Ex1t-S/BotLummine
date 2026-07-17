import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	conversationStateForWorkspaceWhere,
	findConversationForWorkspace,
	findInboundMessageForWorkspace,
	whatsAppTemplateWebhookWhere,
	workspaceIdsWhere,
	workspaceOwnedWhere,
} from './workspace-scope.js';

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

	it('queries outbound conversations with an immutable workspace boundary', async () => {
		let receivedQuery = null;
		const include = { contact: true };
		const prismaClient = {
			conversation: {
				findFirst: async (query) => {
					receivedQuery = query;
					return null;
				},
			},
		};

		await findConversationForWorkspace(prismaClient, {
			id: 'conversation-a',
			workspaceId: 'workspace-a',
			include,
		});

		assert.deepEqual(receivedQuery, {
			where: {
				id: 'conversation-a',
				workspaceId: 'workspace-a',
			},
			include,
		});
	});

	it('requires the WABA boundary for template webhook lookups', () => {
		assert.throws(
			() => whatsAppTemplateWebhookWhere({ metaTemplateId: 'template-a' }),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
		assert.deepEqual(
			whatsAppTemplateWebhookWhere({
				metaTemplateId: 'template-a',
				wabaId: 'waba-a',
			}),
			{
				metaTemplateId: 'template-a',
				wabaId: 'waba-a',
			},
		);
	});

	it('keeps analytics queries scoped when no workspace is accessible', () => {
		assert.deepEqual(workspaceIdsWhere([]), {
			workspaceId: { in: [] },
		});
		assert.deepEqual(workspaceIdsWhere([' workspace-a ', '', 'workspace-a', 'workspace-b']), {
			workspaceId: { in: ['workspace-a', 'workspace-b'] },
		});
	});

	it('scopes conversation state operations through the owning conversation', () => {
		assert.throws(
			() => conversationStateForWorkspaceWhere({ conversationId: 'conversation-a' }),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
		assert.deepEqual(
			conversationStateForWorkspaceWhere({
				conversationId: 'conversation-a',
				workspaceId: 'workspace-a',
				pendingAutoReplyLockedAt: null,
			}),
			{
				conversationId: 'conversation-a',
				conversation: { is: { workspaceId: 'workspace-a' } },
				pendingAutoReplyLockedAt: null,
			},
		);
	});
});
