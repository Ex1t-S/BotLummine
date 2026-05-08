import { runCampaignDispatchTick } from './whatsapp-campaign.service.js';
import { processDueCampaignSchedules } from './campaign-schedule.service.js';

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
