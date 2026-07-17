import { prisma } from '../../lib/prisma.js';

const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;
const DEFAULT_PRUNE_BATCH_SIZE = 500;
const MAX_PRUNE_BATCH_SIZE = 2_000;

function boundedInteger(value, fallback, min, max) {
	const numeric = Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(numeric)) return fallback;
	return Math.min(max, Math.max(min, numeric));
}

export function getAiTraceRetentionDays(value = process.env.AI_TRACE_RETENTION_DAYS) {
	return boundedInteger(value, DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
}

function buildTraceRecord({ trace, inboundMessageId = null, now = new Date(), retentionDays } = {}) {
	if (!trace?.traceId || !trace?.workspaceId || !trace?.conversationId) return null;

	const expiresAt = new Date(now.getTime());
	expiresAt.setUTCDate(expiresAt.getUTCDate() + getAiTraceRetentionDays(retentionDays));

	return {
		traceId: trace.traceId,
		workspaceId: trace.workspaceId,
		conversationId: trace.conversationId,
		inboundMessageId: inboundMessageId || null,
		promptVersion: trace.promptVersion || null,
		promptHash: trace.promptHash || null,
		route: trace.route || 'AUTO',
		intentName: trace.intent?.name || null,
		intentConfidence: Number(trace.intent?.confidence || 0),
		retrievedFacts: Array.isArray(trace.retrievedFacts) ? [...trace.retrievedFacts] : [],
		provider: trace.provider || null,
		model: trace.model || null,
		latencyMs: Number(trace.latencyMs || 0),
		inputTokens: Number(trace.inputTokens || 0),
		outputTokens: Number(trace.outputTokens || 0),
		auditPassed: trace.audit?.passed !== false,
		auditFlags: Array.isArray(trace.audit?.flags) ? [...trace.audit.flags] : [],
		handoffReason: trace.handoff?.reason || null,
		expiresAt,
		createdAt: now,
	};
}

export async function persistAiTurnTrace({
	trace,
	inboundMessageId = null,
	now = new Date(),
	retentionDays,
	client = prisma,
} = {}) {
	const data = buildTraceRecord({ trace, inboundMessageId, now, retentionDays });
	if (!data) return null;

	return client.aiTurnTrace.create({ data });
}

export async function pruneExpiredAiTurnTraces({
	now = new Date(),
	batchSize = DEFAULT_PRUNE_BATCH_SIZE,
	workspaceId = null,
	client = prisma,
} = {}) {
	const take = boundedInteger(batchSize, DEFAULT_PRUNE_BATCH_SIZE, 1, MAX_PRUNE_BATCH_SIZE);
	const where = {
		expiresAt: { lte: now },
		...(workspaceId ? { workspaceId } : {}),
	};
	const expired = await client.aiTurnTrace.findMany({
		where,
		select: { id: true },
		orderBy: { expiresAt: 'asc' },
		take,
	});

	if (!expired.length) return { selected: 0, deleted: 0 };

	const result = await client.aiTurnTrace.deleteMany({
		where: {
			id: { in: expired.map((item) => item.id) },
			...(workspaceId ? { workspaceId } : {}),
			expiresAt: { lte: now },
		},
	});

	return {
		selected: expired.length,
		deleted: Number(result?.count || 0),
	};
}
