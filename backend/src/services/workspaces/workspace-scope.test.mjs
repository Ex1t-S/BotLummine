import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	adminManagedUserWhere,
	conversationStateForWorkspaceWhere,
	findConversationForWorkspace,
	findInboundMessageForWorkspace,
	findWorkspaceOwnedRecord,
	requireWorkspaceScope,
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

	it('rejects implicit default workspaces and normalizes explicit scope', () => {
		assert.throws(
			() => requireWorkspaceScope(''),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
		assert.equal(requireWorkspaceScope(' workspace-a '), 'workspace-a');
	});

	it('keeps brand-admin user management inside its workspace', () => {
		assert.throws(
			() => adminManagedUserWhere({ userId: 'user-a' }),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
		assert.deepEqual(
			adminManagedUserWhere({ userId: 'user-a', workspaceId: 'workspace-a' }),
			{ id: 'user-a', workspaceId: 'workspace-a' },
		);
		assert.deepEqual(
			adminManagedUserWhere({ userId: 'user-a', platformAdmin: true }),
			{ id: 'user-a' },
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

	it('queries generic workspace-owned records without a global ID fallback', async () => {
		let receivedQuery = null;
		const modelDelegate = {
			findFirst: async (query) => {
				receivedQuery = query;
				return { id: 'connection-a' };
			},
		};

		const record = await findWorkspaceOwnedRecord(modelDelegate, {
			id: 'connection-a',
			workspaceId: 'workspace-a',
			select: { id: true },
		});

		assert.deepEqual(record, { id: 'connection-a' });
		assert.deepEqual(receivedQuery, {
			where: { id: 'connection-a', workspaceId: 'workspace-a' },
			select: { id: true },
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
