import { runCampaignDispatchTick } from './whatsapp-campaign.service.js';
import { processDueCampaignSchedules } from './campaign-schedule.service.js';
import { processAutomaticShipmentNotifications } from './shipment-notification.service.js';
import { processAutomaticAbandonedCartAutomations } from './abandoned-cart-automation.service.js';
import { processAutomaticPendingPaymentAutomations } from './pending-payment-automation.service.js';
import { prisma } from '../../lib/prisma.js';

let dispatcherBusy = false;
const taskLastRunAt = new Map();

const DEFAULT_AUTOMATION_TIMEZONE = 'America/Argentina/Buenos_Aires';
const DEFAULT_QUIET_START_HOUR = 21;
const DEFAULT_QUIET_END_HOUR = 9;

function normalizeHour(value, fallback) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : fallback;
}

function getLocalHour(date = new Date(), timezone = DEFAULT_AUTOMATION_TIMEZONE) {
	const formatted = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone || DEFAULT_AUTOMATION_TIMEZONE,
		hour: '2-digit',
		hourCycle: 'h23',
	}).format(date);
	return Number(formatted);
}

/**
 * Automated campaigns are intentionally paused overnight to avoid contacting
 * customers outside the configured attention window. Manual campaigns remain
 * dispatchable because they are explicitly triggered by an operator.
 */
export function isAutomationDispatchPaused(date = new Date()) {
	const timezone = process.env.CAMPAIGN_AUTOMATION_TIMEZONE || DEFAULT_AUTOMATION_TIMEZONE;
	const startHour = normalizeHour(process.env.CAMPAIGN_AUTOMATION_QUIET_START_HOUR, DEFAULT_QUIET_START_HOUR);
	const endHour = normalizeHour(process.env.CAMPAIGN_AUTOMATION_QUIET_END_HOUR, DEFAULT_QUIET_END_HOUR);
	const hour = getLocalHour(date, timezone);

	if (startHour === endHour) return false;
	if (startHour > endHour) return hour >= startHour || hour < endHour;
	return hour >= startHour && hour < endHour;
}

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

async function executeCampaignDispatcherTickWithLock() {
	if (dispatcherBusy) {
		return {
			ok: true,
			skipped: true,
			message: 'El dispatcher ya estaba ejecutandose.'
		};
	}

	dispatcherBusy = true;

	try {
		if (isAutomationDispatchPaused()) {
			const campaigns = await runCampaignDispatchTick({ excludeAutomated: true });
			return {
				ok: true,
				skipped: true,
				reason: 'automation_quiet_hours',
				quietHours: {
					from: Number(process.env.CAMPAIGN_AUTOMATION_QUIET_START_HOUR || DEFAULT_QUIET_START_HOUR),
					to: Number(process.env.CAMPAIGN_AUTOMATION_QUIET_END_HOUR || DEFAULT_QUIET_END_HOUR),
					timezone: process.env.CAMPAIGN_AUTOMATION_TIMEZONE || DEFAULT_AUTOMATION_TIMEZONE,
				},
				campaigns,
			};
		}

		const schedules = await runTaskIfDue(
			'schedules',
			normalizeIntervalMs('CAMPAIGN_SCHEDULE_INTERVAL_MINUTES', 60, 60),
			() => processDueCampaignSchedules()
		);
		const abandonedCartAutomations = await processAutomaticAbandonedCartAutomations();
		const pendingPaymentAutomations = await runTaskIfDue(
			'pending_payments',
			normalizeIntervalMs('PENDING_PAYMENT_AUTOMATION_INTERVAL_MINUTES', 60, 60),
			() => processAutomaticPendingPaymentAutomations()
		);
		const shipmentNotifications = await runTaskIfDue(
			'shipment_notifications',
			normalizeIntervalMs('SHIPMENT_NOTIFICATION_INTERVAL_MINUTES', 60, 60),
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

export async function executeCampaignDispatcherTick() {
	return prisma.$transaction(async (transaction) => {
		const rows = await transaction.$queryRaw`
			SELECT pg_try_advisory_xact_lock(
				hashtextextended('bladeia:campaign-dispatch', 0)
			) AS locked
		`;
		const locked = Boolean(rows?.[0]?.locked);

		if (!locked) {
			return {
				ok: true,
				skipped: true,
				message: 'Otro dispatcher mantiene el lock global de PostgreSQL.',
			};
		}

		return executeCampaignDispatcherTickWithLock();
	}, {
		maxWait: 10_000,
		timeout: 60 * 60 * 1000,
	});
}
