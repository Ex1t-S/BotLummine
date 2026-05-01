import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/prisma.js';
import { executeCampaignDispatcherTick } from '../services/campaigns/campaign-dispatcher.service.js';

dotenv.config();

async function main() {
	console.log('[JOB][CAMPAIGN DISPATCH] start');

	const result = await executeCampaignDispatcherTick();

	console.log('[JOB][CAMPAIGN DISPATCH] result', {
		ok: result.ok,
		skipped: result.skipped || false,
		schedules: result.schedules || null,
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
			console.error('[JOB][CAMPAIGN DISPATCH] failed', error);
			process.exitCode = 1;
		})
		.finally(async () => {
			await prisma.$disconnect();
		});
}
