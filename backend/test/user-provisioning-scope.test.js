import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveCreateUserScope } from '../src/lib/create-user-scope.js';

describe('user provisioning workspace boundary', () => {
	it('requires an explicit workspace for brand admins and agents', () => {
		for (const role of ['ADMIN', 'AGENT']) {
			assert.throws(
				() => resolveCreateUserScope({ role }),
				(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
			);
		}

		assert.deepEqual(
			resolveCreateUserScope({ role: 'agent', workspaceId: ' workspace-a ' }),
			{ role: 'AGENT', workspaceId: 'workspace-a' },
		);
	});

	it('keeps platform admins global and rejects unknown roles', () => {
		assert.deepEqual(
			resolveCreateUserScope({ role: 'PLATFORM_ADMIN', workspaceId: 'workspace-a' }),
			{ role: 'PLATFORM_ADMIN', workspaceId: null },
		);
		assert.throws(
			() => resolveCreateUserScope({ role: 'OWNER', workspaceId: 'workspace-a' }),
			(error) => error?.code === 'INVALID_USER_ROLE',
		);
	});
});
