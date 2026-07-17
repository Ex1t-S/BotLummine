import 'dotenv/config';

import { prisma } from '../src/lib/prisma.js';
import { assertSafeDatabaseTarget } from '../src/lib/database-safety.js';
import { pruneExpiredAiTurnTraces } from '../src/services/ai/turn-trace-store.js';

const mode = process.argv.includes('--apply') ? 'apply' : 'dry-run';
const batchSize = Math.max(1, Math.min(Number(process.env.AI_TRACE_PRUNE_BATCH_SIZE || 500), 2_000));
const maxBatches = Math.max(1, Math.min(Number(process.env.AI_TRACE_PRUNE_MAX_BATCHES || 20), 100));
const now = new Date();

if (mode === 'apply') {
	assertSafeDatabaseTarget();
}

try {
	const pending = await prisma.aiTurnTrace.count({
		where: { expiresAt: { lte: now } },
	});

	console.log(JSON.stringify({
		mode,
		cutoff: now.toISOString(),
		pending,
		batchSize,
		maxBatches,
	}));

	if (mode === 'apply') {
		let deleted = 0;
		let batches = 0;

		while (batches < maxBatches) {
			const result = await pruneExpiredAiTurnTraces({ now, batchSize });
			deleted += result.deleted;
			batches += 1;
			if (result.selected < batchSize || result.deleted === 0) break;
		}

		console.log(JSON.stringify({ mode, deleted, batches }));
	}
} finally {
	await prisma.$disconnect();
}
