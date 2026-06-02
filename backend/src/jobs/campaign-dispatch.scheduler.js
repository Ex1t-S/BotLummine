import { logger } from '../lib/logger.js';
import { executeCampaignDispatcherTick } from '../services/campaigns/campaign-dispatcher.service.js';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_START_DELAY_MS = 30 * 1000;
const MIN_INTERVAL_MS = 60 * 60 * 1000;

let timer = null;
let started = false;

function normalizeBoolean(value, fallback = true) {
	const normalized = String(value ?? '').trim().toLowerCase();
	if (!normalized) return fallback;
	return !['0', 'false', 'no', 'off', 'disabled'].includes(normalized);
}

function normalizeIntervalMs(value) {
	const parsed = Number(value || DEFAULT_INTERVAL_MS);
	if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS;
	return Math.max(MIN_INTERVAL_MS, parsed);
}

function shouldStartScheduler() {
	if (process.env.NODE_ENV === 'test') return false;
	return normalizeBoolean(process.env.CAMPAIGN_DISPATCHER_ENABLED, false);
}

async function runScheduledTick() {
	try {
		const result = await executeCampaignDispatcherTick();
		logger.info('campaign.dispatch_scheduler_tick', {
			ok: result?.ok !== false,
			skipped: Boolean(result?.skipped),
			schedulesProcessed: Number(result?.schedules?.processed || 0),
			shipmentNotificationsProcessed: Number(result?.shipmentNotifications?.processed || 0),
			campaignProcessed: Boolean(result?.campaigns?.processed),
			message: result?.message || result?.campaigns?.message || null,
		});
	} catch (error) {
		logger.error('campaign.dispatch_scheduler_failed', { error });
	}
}

export function startCampaignDispatchScheduler() {
	if (started || !shouldStartScheduler()) {
		return {
			started: false,
			enabled: shouldStartScheduler(),
		};
	}

	started = true;
	const intervalMs = normalizeIntervalMs(process.env.CAMPAIGN_DISPATCHER_INTERVAL_MS);

	logger.info('campaign.dispatch_scheduler_started', { intervalMs });

	timer = setInterval(() => {
		void runScheduledTick();
	}, intervalMs);

	if (typeof timer.unref === 'function') {
		timer.unref();
	}

	setTimeout(() => {
		void runScheduledTick();
	}, DEFAULT_START_DELAY_MS).unref?.();

	return {
		started: true,
		enabled: true,
		intervalMs,
	};
}

export function stopCampaignDispatchScheduler() {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}

	started = false;
}
