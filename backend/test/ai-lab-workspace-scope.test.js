import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	createAiLabSession,
	getAiLabSession,
	listAiLabFixtures,
	resetAiLabSession,
	sendAiLabMessage,
} from '../src/services/ai/ai-lab.service.js';

function hasMissingWorkspaceCode(error) {
	return error?.code === 'WORKSPACE_SCOPE_REQUIRED';
}

describe('AI Lab workspace boundary', () => {
	it('rejects every public operation without an explicit workspace', async () => {
		assert.throws(() => listAiLabFixtures(), hasMissingWorkspaceCode);

		for (const operation of [
			() => createAiLabSession(),
			() => getAiLabSession('missing-session'),
			() => resetAiLabSession('missing-session'),
			() => sendAiLabMessage('missing-session', { body: 'hola' }),
		]) {
			await assert.rejects(operation, hasMissingWorkspaceCode);
		}
	});

	it('keeps an unknown session lookup bounded to the requested workspace', async () => {
		assert.equal(
			await getAiLabSession('missing-session', { workspaceId: 'workspace-a' }),
			null,
		);
	});
});
