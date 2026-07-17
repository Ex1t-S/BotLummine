import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
	applyCampaignMessageStatusWebhook,
	appendCampaignRecipients,
	buildCampaignRecipientInsights,
	cancelCampaign,
	createCampaignDraft,
	createOrAppendAutomationCampaignDraft,
	deleteCampaign,
	getCampaignDetail,
	launchCampaign,
	listCampaigns,
	previewAbandonedCartAudience,
	previewCampaignAudience,
	retryFailedCampaignRecipients,
} from '../src/services/campaigns/whatsapp-campaign.service.js';

function rejectsMissingWorkspace(operation) {
	return assert.rejects(
		operation,
		(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
	);
}

describe('campaign workspace boundaries', () => {
	it('rejects every public campaign operation without an explicit workspace', async () => {
		for (const operation of [
			() => previewAbandonedCartAudience(),
			() => previewCampaignAudience(),
			() => listCampaigns(),
			() => buildCampaignRecipientInsights([]),
			() => getCampaignDetail('campaign-a'),
			() => createCampaignDraft({}),
			() => appendCampaignRecipients('campaign-a'),
			() => createOrAppendAutomationCampaignDraft(),
			() => launchCampaign('campaign-a'),
			() => cancelCampaign('campaign-a'),
			() => deleteCampaign('campaign-a'),
			() => retryFailedCampaignRecipients('campaign-a'),
			() => applyCampaignMessageStatusWebhook({ id: 'message-a' }),
		]) {
			await rejectsMissingWorkspace(operation);
		}
	});

	it('does not retain default-tenant or id-only public mutation fallbacks', async () => {
		const source = await readFile(
			new URL('../src/services/campaigns/whatsapp-campaign.service.js', import.meta.url),
			'utf8',
		);

		assert.doesNotMatch(source, /DEFAULT_WORKSPACE_ID/);
		assert.match(source, /workspaceOwnedWhere\(\{ id: campaignId, workspaceId: resolvedWorkspaceId \}\)/);
		assert.match(source, /workspaceOwnedWhere\(\{ id: recipient\.id, workspaceId: campaign\.workspaceId \}\)/);
		assert.match(source, /workspaceId: resolvedWorkspaceId,[\s\S]*waMessageId/);
	});
});
