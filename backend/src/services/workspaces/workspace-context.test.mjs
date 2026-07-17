import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	ensureWorkspaceAccess,
	getWhatsAppChannelForWorkspace,
	getWorkspaceOrThrow,
	getWorkspaceRuntimeConfig,
	resolveRequestWorkspaceId,
} from './workspace-context.service.js';

function requestFor(user, overrides = {}) {
	return {
		user,
		params: { workspaceId: 'workspace-attacker' },
		query: { workspaceId: 'workspace-attacker' },
		headers: { 'x-workspace-id': 'workspace-attacker' },
		body: { workspaceId: 'workspace-attacker' },
		...overrides,
	};
}

describe('workspace request isolation', () => {
	it('ignores every client-controlled workspace id for a brand admin', () => {
		const req = requestFor({ role: 'ADMIN', workspaceId: 'workspace-owner' });
		assert.equal(resolveRequestWorkspaceId(req), 'workspace-owner');
		assert.equal(ensureWorkspaceAccess(req, 'workspace-attacker'), false);
	});

	it('ignores every client-controlled workspace id for an agent', () => {
		const req = requestFor({ role: 'AGENT', workspaceId: 'workspace-owner' });
		assert.equal(resolveRequestWorkspaceId(req), 'workspace-owner');
		assert.equal(ensureWorkspaceAccess(req, 'workspace-attacker'), false);
	});

	it('allows a platform admin to select an explicit workspace', () => {
		const req = requestFor({ role: 'PLATFORM_ADMIN', workspaceId: null });
		assert.equal(resolveRequestWorkspaceId(req), 'workspace-attacker');
		assert.equal(ensureWorkspaceAccess(req, 'workspace-attacker'), true);
	});

	it('does not invent a workspace for an unauthenticated request', () => {
		assert.equal(resolveRequestWorkspaceId(requestFor(null)), '');
	});

	it('rejects shared workspace configuration lookups before Prisma when scope is absent', async () => {
		for (const operation of [
			() => getWorkspaceOrThrow(),
			() => getWorkspaceRuntimeConfig(),
			() => getWhatsAppChannelForWorkspace(),
		]) {
			await assert.rejects(
				operation,
				(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
			);
		}
	});
});
