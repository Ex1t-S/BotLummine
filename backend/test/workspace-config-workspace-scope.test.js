import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	WORKSPACE_FEATURE_FLAGS,
	isWorkspaceFeatureEnabled,
	listWorkspaceFeatureFlags,
	setWorkspaceFeatureFlag,
} from '../src/services/workspaces/workspace-feature-flags.service.js';
import {
	buildMenuAssistantContext,
	getOrCreateWhatsAppMenuSettings,
	getWhatsAppMenuRuntimeConfig,
	getWhatsAppMenuSettings,
	resetWhatsAppMenuSettings,
	updateWhatsAppMenuSettings,
} from '../src/services/whatsapp/whatsapp-menu.service.js';

function rejectsMissingWorkspace(operation) {
	return assert.rejects(
		operation,
		(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
	);
}

describe('workspace configuration boundaries', () => {
	it('rejects feature flag reads and writes without an explicit workspace', async () => {
		await rejectsMissingWorkspace(() => listWorkspaceFeatureFlags());
		await rejectsMissingWorkspace(() =>
			isWorkspaceFeatureEnabled(undefined, WORKSPACE_FEATURE_FLAGS.AI_AUTO_REPLIES),
		);
		await rejectsMissingWorkspace(() =>
			setWorkspaceFeatureFlag({ key: WORKSPACE_FEATURE_FLAGS.AI_AUTO_REPLIES, enabled: true }),
		);
	});

	it('fails closed when a feature flag lookup cannot be verified', async () => {
		const prismaClient = {
			workspaceFeatureFlag: {
				findUnique: async () => {
					throw new Error('database unavailable');
				},
			},
		};

		assert.equal(
			await isWorkspaceFeatureEnabled(
				'workspace-a',
				WORKSPACE_FEATURE_FLAGS.WHATSAPP_OUTBOUND,
				{ prismaClient },
			),
			false,
		);
	});

	it('rejects menu configuration and routing without an explicit workspace', async () => {
		for (const operation of [
			() => getOrCreateWhatsAppMenuSettings(),
			() => getWhatsAppMenuSettings(),
			() => updateWhatsAppMenuSettings(),
			() => resetWhatsAppMenuSettings(),
			() => getWhatsAppMenuRuntimeConfig(),
			() => buildMenuAssistantContext(),
		]) {
			await rejectsMissingWorkspace(operation);
		}
	});
});
