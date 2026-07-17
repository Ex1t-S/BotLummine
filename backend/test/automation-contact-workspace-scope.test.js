import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	getAbandonedCartAutomationSettings,
	runAbandonedCartAutomation,
	updateAbandonedCartAutomationSettings,
} from '../src/services/campaigns/abandoned-cart-automation.service.js';
import {
	getPendingPaymentAutomationSettings,
	runPendingPaymentAutomation,
	updatePendingPaymentAutomationSettings,
} from '../src/services/campaigns/pending-payment-automation.service.js';
import {
	getShipmentNotificationSettings,
	listShipmentNotificationCandidates,
	sendShipmentNotifications,
	updateShipmentNotificationSettings,
} from '../src/services/campaigns/shipment-notification.service.js';
import {
	findContactByWaId,
	findOrCreateContactByWaId,
} from '../src/services/contacts/contact-directory.service.js';

function rejectsMissingWorkspace(operation) {
	return assert.rejects(
		operation,
		(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
	);
}

describe('automation and contact workspace boundaries', () => {
	it('rejects contact reads and writes without an explicit workspace', async () => {
		await rejectsMissingWorkspace(() => findContactByWaId('5491100000000'));
		await rejectsMissingWorkspace(() => findOrCreateContactByWaId({ waId: '5491100000000' }));
	});

	it('rejects abandoned-cart automation operations without an explicit workspace', async () => {
		await rejectsMissingWorkspace(() => getAbandonedCartAutomationSettings());
		await rejectsMissingWorkspace(() => updateAbandonedCartAutomationSettings());
		await rejectsMissingWorkspace(() => runAbandonedCartAutomation());
	});

	it('rejects pending-payment automation operations without an explicit workspace', async () => {
		await rejectsMissingWorkspace(() => getPendingPaymentAutomationSettings());
		await rejectsMissingWorkspace(() => updatePendingPaymentAutomationSettings());
		await rejectsMissingWorkspace(() => runPendingPaymentAutomation());
	});

	it('rejects shipment operations without an explicit workspace', async () => {
		await rejectsMissingWorkspace(() => getShipmentNotificationSettings());
		await rejectsMissingWorkspace(() => updateShipmentNotificationSettings());
		await rejectsMissingWorkspace(() => listShipmentNotificationCandidates());
		await rejectsMissingWorkspace(() => sendShipmentNotifications());
	});
});
