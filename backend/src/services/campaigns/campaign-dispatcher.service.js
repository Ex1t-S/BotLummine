import { runCampaignDispatchTick } from './whatsapp-campaign.service.js';
import { processDueCampaignSchedules } from './campaign-schedule.service.js';
import { processAutomaticShipmentNotifications } from './shipment-notification.service.js';
import { processAutomaticAbandonedCartAutomations } from './abandoned-cart-automation.service.js';
import { processAutomaticPendingPaymentAutomations } from './pending-payment-automation.service.js';

let dispatcherBusy = false;

export async function executeCampaignDispatcherTick() {
	if (dispatcherBusy) {
		return {
			ok: true,
			skipped: true,
			message: 'El dispatcher ya estaba ejecutandose.'
		};
	}

	dispatcherBusy = true;

	try {
		const schedules = await processDueCampaignSchedules();
		const abandonedCartAutomations = await processAutomaticAbandonedCartAutomations();
		const pendingPaymentAutomations = await processAutomaticPendingPaymentAutomations();
		const shipmentNotifications = await processAutomaticShipmentNotifications();
		const campaigns = await runCampaignDispatchTick();

		return {
			ok: true,
			schedules,
			abandonedCartAutomations,
			pendingPaymentAutomations,
			shipmentNotifications,
			campaigns,
		};
	} finally {
		dispatcherBusy = false;
	}
}
