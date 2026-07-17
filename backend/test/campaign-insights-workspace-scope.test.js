import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	attributeOrderConversions,
	attributeOrdersByIds,
	getPersistedConversionInsights,
	persistChatConfirmationConversions,
} from '../src/services/campaigns/campaign-attribution.service.js';
import { getCampaignStats } from '../src/services/campaigns/campaign-stats.service.js';

describe('campaign attribution workspace boundary', () => {
	it('rejects attribution and metrics even for empty inputs when workspace is absent', async () => {
		for (const operation of [
			() => attributeOrderConversions({ orderId: 'order-a' }),
			() => attributeOrdersByIds({ orderIds: [] }),
			() => persistChatConfirmationConversions({ messageBody: 'gracias' }),
			() => getPersistedConversionInsights({ recipientIds: [] }),
			() => getCampaignStats(),
		]) {
			await assert.rejects(
				operation,
				(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
			);
		}
	});
});
