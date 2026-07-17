import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { syncEnboxShipments } from '../services/enbox/enbox-sync.service.js';

dotenv.config();

function resolveMode() {
	const modeArg = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1];
	const mode = String(modeArg || process.env.ENBOX_SYNC_MODE || 'incremental').trim().toLowerCase();
	return mode === 'backfill' ? 'backfill' : 'incremental';
}

async function main() {
	const mode = resolveMode();
	const workspaceId = String(process.env.ENBOX_SYNC_WORKSPACE_ID || '').trim();
	if (!workspaceId) {
		throw new Error('ENBOX_SYNC_WORKSPACE_ID es obligatoria para ejecutar el job de Enbox.');
	}
	logger.info('enbox.sync_job_started', { mode, workspaceId });

	const result = await syncEnboxShipments({ mode, workspaceId });

	logger.info('enbox.sync_job_finished', {
		ok: result.ok,
		started: result.started,
		mode: result.lastMode || mode,
		shipmentsChecked: result.shipmentsChecked,
		shipmentsUpserted: result.shipmentsUpserted,
		ordersScanned: result.ordersScanned,
		ordersMatched: result.ordersMatched,
		message: result.message,
	});

	if (!result.ok) {
		process.exitCode = 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
	main()
		.catch((error) => {
			logger.error('enbox.sync_job_failed', { error });
			process.exitCode = 1;
		})
		.finally(async () => {
			await prisma.$disconnect();
		});
}
