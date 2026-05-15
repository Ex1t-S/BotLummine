import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { executeCampaignDispatcherTick } from '../services/campaigns/campaign-dispatcher.service.js';

dotenv.config();

async function main() {
	logger.info('campaign.dispatch_job_started');

	const result = await executeCampaignDispatcherTick();

	logger.info('campaign.dispatch_job_finished', {
		ok: result.ok,
		skipped: result.skipped || false,
		schedules: result.schedules || null,
		shipmentNotifications: result.shipmentNotifications || null,
		campaigns: result.campaigns || null,
		message: result.message || null,
	});

	if (!result.ok) {
		process.exitCode = 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
	main()
		.catch((error) => {
			logger.error('campaign.dispatch_job_failed', { error });
			process.exitCode = 1;
		})
		.finally(async () => {
			await prisma.$disconnect();
		});
}
