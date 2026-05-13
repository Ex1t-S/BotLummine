import { runCampaignDispatchTick } from './whatsapp-campaign.service.js';
import { processDueCampaignSchedules } from './campaign-schedule.service.js';
import { processAutomaticShipmentNotifications } from './shipment-notification.service.js';
import { processAutomaticAbandonedCartAutomations } from './abandoned-cart-automation.service.js';
import { processAutomaticPendingPaymentAutomations } from './pending-payment-automation.service.js';

let dispatcherBusy = false;
const taskLastRunAt = new Map();

function normalizeIntervalMs(envName, fallbackMinutes, minMinutes = 5) {
	const parsed = Number(process.env[envName] || fallbackMinutes);
	const minutes = Number.isFinite(parsed) ? parsed : fallbackMinutes;
	return Math.max(minMinutes, minutes) * 60 * 1000;
}

async function runTaskIfDue(key, intervalMs, task) {
	const lastRunAt = taskLastRunAt.get(key) || 0;
	const now = Date.now();

	if (lastRunAt && now - lastRunAt < intervalMs) {
		return {
			processed: 0,
			skipped: true,
			reason: 'dispatcher_interval',
			nextRunInMs: intervalMs - (now - lastRunAt),
		};
	}

	taskLastRunAt.set(key, now);
	return task();
}

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
		const schedules = await runTaskIfDue(
			'schedules',
			normalizeIntervalMs('CAMPAIGN_SCHEDULE_INTERVAL_MINUTES', 5, 5),
			() => processDueCampaignSchedules()
		);
		const abandonedCartAutomations = await processAutomaticAbandonedCartAutomations();
		const pendingPaymentAutomations = await runTaskIfDue(
			'pending_payments',
			normalizeIntervalMs('PENDING_PAYMENT_AUTOMATION_INTERVAL_MINUTES', 15, 5),
			() => processAutomaticPendingPaymentAutomations()
		);
		const shipmentNotifications = await runTaskIfDue(
			'shipment_notifications',
			normalizeIntervalMs('SHIPMENT_NOTIFICATION_INTERVAL_MINUTES', 30, 5),
			() => processAutomaticShipmentNotifications()
		);
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
