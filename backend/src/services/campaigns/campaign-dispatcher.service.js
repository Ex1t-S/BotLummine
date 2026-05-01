import { runCampaignDispatchTick } from './whatsapp-campaign.service.js';
import { processDueCampaignSchedules } from './campaign-schedule.service.js';

let dispatcherTimer = null;
let dispatcherBusy = false;

function isDispatcherEnabled() {
	return String(process.env.CAMPAIGN_DISPATCHER_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function getDispatcherIntervalMs() {
	return Math.max(5_000, Number(process.env.CAMPAIGN_DISPATCHER_INTERVAL_MS || 15_000) || 15_000);
}

export async function executeCampaignDispatcherTick() {
	if (dispatcherBusy) {
		return {
			ok: true,
			skipped: true,
			message: 'El dispatcher ya estaba ejecutándose.'
		};
	}

	dispatcherBusy = true;

	try {
		const schedules = await processDueCampaignSchedules();
		const campaigns = await runCampaignDispatchTick();

		return {
			ok: true,
			schedules,
			campaigns,
		};
	} finally {
		dispatcherBusy = false;
	}
}

export function startCampaignDispatcher() {
	if (!isDispatcherEnabled()) {
		console.log('[CAMPAIGN DISPATCHER] deshabilitado por configuración.');
		return;
	}

	if (dispatcherTimer) {
		return;
	}

	const intervalMs = getDispatcherIntervalMs();

	dispatcherTimer = setInterval(async () => {
		try {
			await executeCampaignDispatcherTick();
		} catch (error) {
			console.error('[CAMPAIGN DISPATCHER] error', error);
		}
	}, intervalMs);

	if (typeof dispatcherTimer.unref === 'function') {
		dispatcherTimer.unref();
	}

	console.log(`[CAMPAIGN DISPATCHER] activo cada ${intervalMs} ms.`);
}
