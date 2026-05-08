import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

dotenv.config();

async function main() {
	const checks = {
		app: false,
		campaignJob: false,
		enboxJob: false,
		database: false,
	};

	await import('../app.js');
	checks.app = true;

	await import('./campaign-dispatch.job.js');
	checks.campaignJob = true;

	await import('./enbox-sync.job.js');
	checks.enboxJob = true;

	await prisma.$queryRaw`SELECT 1`;
	checks.database = true;

	logger.info('jobs.diagnose_ok', checks);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
	main()
		.catch((error) => {
			logger.error('jobs.diagnose_failed', { error });
			process.exitCode = 1;
		})
		.finally(async () => {
			await prisma.$disconnect();
		});
}
