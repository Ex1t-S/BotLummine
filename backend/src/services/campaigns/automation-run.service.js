import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import { requireWorkspaceScope, workspaceOwnedWhere } from '../workspaces/workspace-scope.js';
import {
	buildCampaignRecipientInsights,
	retryFailedCampaignRecipients,
} from './whatsapp-campaign.service.js';

export const AUTOMATION_RUN_TYPES = {
	ABANDONED_CART: 'abandoned_carts',
	PENDING_PAYMENT: 'pending_payment',
	SHIPMENT_NOTIFICATION: 'shipment_dispatch',
};

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
const AUTOMATION_TYPE_LABELS = {
	[AUTOMATION_RUN_TYPES.ABANDONED_CART]: 'Carritos abandonados',
	[AUTOMATION_RUN_TYPES.PENDING_PAYMENT]: 'Pagos pendientes',
	[AUTOMATION_RUN_TYPES.SHIPMENT_NOTIFICATION]: 'Despachos',
};
const AUTOMATION_TYPE_ORDER = {
	[AUTOMATION_RUN_TYPES.ABANDONED_CART]: 1,
	[AUTOMATION_RUN_TYPES.PENDING_PAYMENT]: 2,
	[AUTOMATION_RUN_TYPES.SHIPMENT_NOTIFICATION]: 3,
};
const AUTOMATION_SOURCES = Object.values(AUTOMATION_RUN_TYPES);
const AUTOMATION_SOURCE_ALIASES = [
	...AUTOMATION_SOURCES,
	'abandoned_cart',
	'pending_payments',
	'shipment_notifications',
	'shipments',
];
const LIVE_CAMPAIGN_STATUSES = new Set(['QUEUED', 'RUNNING']);

function safeArray(value) {
	return Array.isArray(value) ? value : [];
}

function normalizeString(value, fallback = '') {
	const normalized = String(value ?? '').trim();
	return normalized || fallback;
}

export function normalizeAutomationRunType(type = '') {
	const normalized = normalizeString(type).toLowerCase();
	if (normalized === 'abandoned_cart' || normalized === 'abandoned_carts') {
		return AUTOMATION_RUN_TYPES.ABANDONED_CART;
	}
	if (normalized === 'pending_payments' || normalized === 'pending_payment') {
		return AUTOMATION_RUN_TYPES.PENDING_PAYMENT;
	}
	if (normalized === 'shipments' || normalized === 'shipment_notifications' || normalized === 'shipment_dispatch') {
		return AUTOMATION_RUN_TYPES.SHIPMENT_NOTIFICATION;
	}
	return normalized;
}

function normalizeCampaignStatus(status = '') {
	return normalizeString(status).toUpperCase();
}

function shouldTrackCampaignInAutomationRun(campaign = {}) {
	return !['DRAFT', 'CANCELED'].includes(normalizeCampaignStatus(campaign.status));
}

function getAutomationRunCampaigns(campaigns = []) {
	return safeArray(campaigns)
		.filter(shouldTrackCampaignInAutomationRun)
		.map((campaign) => {
			const status = normalizeCampaignStatus(campaign.status);
			return {
				...campaign,
				pendingRecipients: LIVE_CAMPAIGN_STATUSES.has(status)
					? Number(campaign.pendingRecipients || 0)
					: 0,
			};
		});
}

function getLocalRunKey(date = new Date(), timezone = DEFAULT_TIMEZONE) {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone: timezone || DEFAULT_TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(date);
	const byType = new Map(parts.map((part) => [part.type, part.value]));
	return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function pickRunName(type, runKey) {
	return `${AUTOMATION_TYPE_LABELS[type] || 'Automatizacion'} ${runKey}`;
}

function deriveRunStatus(campaigns = [], fallbackStatus = 'OPEN') {
	if (!campaigns.length) {
		return normalizeCampaignStatus(fallbackStatus) === 'ERROR' ? 'ERROR' : 'OPEN';
	}
	if (campaigns.some((campaign) => LIVE_CAMPAIGN_STATUSES.has(normalizeCampaignStatus(campaign.status)))) {
		return 'RUNNING';
	}
	if (campaigns.every((campaign) => normalizeCampaignStatus(campaign.status) === 'CANCELED')) {
		return 'CANCELED';
	}
	const pending = campaigns.reduce((sum, campaign) => sum + Number(campaign.pendingRecipients || 0), 0);
	const failed = campaigns.reduce((sum, campaign) => sum + Number(campaign.failedRecipients || 0), 0);
	if (pending > 0) return 'RUNNING';
	if (failed > 0) return 'PARTIAL';
	return 'FINISHED';
}

function summarizeCampaigns(campaigns = []) {
	return campaigns.reduce(
		(summary, campaign) => {
			summary.totalRecipients += Number(campaign.totalRecipients || 0);
			summary.pendingRecipients += Number(campaign.pendingRecipients || 0);
			summary.sentRecipients += Number(campaign.sentRecipients || 0);
			summary.deliveredRecipients += Number(campaign.deliveredRecipients || 0);
			summary.readRecipients += Number(campaign.readRecipients || 0);
			summary.failedRecipients += Number(campaign.failedRecipients || 0);
			summary.skippedRecipients += Number(campaign.skippedRecipients || 0);
			return summary;
		},
		{
			totalRecipients: 0,
			pendingRecipients: 0,
			sentRecipients: 0,
			deliveredRecipients: 0,
			readRecipients: 0,
			failedRecipients: 0,
			skippedRecipients: 0,
		}
	);
}

function selectRecipientFields() {
	return {
		id: true,
		campaignId: true,
		phone: true,
		waId: true,
		contactName: true,
		contactId: true,
		externalKey: true,
		conversationId: true,
		status: true,
		errorCode: true,
		errorSubcode: true,
		errorMessage: true,
		sentAt: true,
		deliveredAt: true,
		readAt: true,
		failedAt: true,
		createdAt: true,
		updatedAt: true,
	};
}

async function fetchRunInsightRecipients(workspaceId, campaignIds = []) {
	if (!campaignIds.length) return [];
	return prisma.campaignRecipient.findMany({
		where: { workspaceId, campaignId: { in: campaignIds } },
		select: selectRecipientFields(),
	});
}

async function serializeAutomationRun(run, { includeRecipients = false, page = 1, pageSize = 50 } = {}) {
	const campaigns = getAutomationRunCampaigns(run.campaigns);
	const campaignIds = campaigns.map((campaign) => campaign.id).filter(Boolean);
	const summary = summarizeCampaigns(campaigns);
	const [insightRecipients, totalRecipients, pageRecipients] = await Promise.all([
		fetchRunInsightRecipients(run.workspaceId, campaignIds),
		includeRecipients && campaignIds.length
			? prisma.campaignRecipient.count({ where: { workspaceId: run.workspaceId, campaignId: { in: campaignIds } } })
			: Promise.resolve(summary.totalRecipients),
		includeRecipients && campaignIds.length
			? prisma.campaignRecipient.findMany({
					where: { workspaceId: run.workspaceId, campaignId: { in: campaignIds } },
					orderBy: [{ createdAt: 'asc' }],
					skip: (page - 1) * pageSize,
					take: pageSize,
					select: selectRecipientFields(),
			  })
			: Promise.resolve([]),
	]);
	const insights = await buildCampaignRecipientInsights(insightRecipients, run.workspaceId);
	const enrichedRecipients = includeRecipients
		? pageRecipients.map((recipient) => ({
				...recipient,
				...(insights.recipientsById.get(recipient.id) || {}),
		  }))
		: [];
	const status = deriveRunStatus(campaigns, run.status);

	return {
		id: run.id,
		kind: 'automation_run',
		workspaceId: run.workspaceId,
		type: run.type,
		runKey: run.runKey,
		timezone: run.timezone,
		name: pickRunName(run.type, run.runKey),
		templateName: AUTOMATION_TYPE_LABELS[run.type] || run.type,
		status,
		notes: `${campaigns.length} campana(s) diaria(s) agrupada(s).`,
		campaigns,
		campaignIds,
		campaignCount: campaigns.length,
		runCount: Number(campaigns.length || run.runCount || 0),
		lastRunAt: run.lastRunAt,
		lastError: run.lastError,
		createdAt: run.createdAt,
		updatedAt: run.updatedAt,
		...summary,
		recipientCount: summary.totalRecipients,
		sentCount: summary.sentRecipients,
		deliveredCount: summary.deliveredRecipients,
		readCount: summary.readRecipients,
		failedCount: summary.failedRecipients,
		pendingCount: summary.pendingRecipients,
		skippedCount: summary.skippedRecipients,
		analytics: insights.summary,
		diagnostics: {
			failures: { totalFailed: summary.failedRecipients },
			controls: {
				blockedReasons: summary.pendingRecipients || summary.failedRecipients ? [] : ['no_pending_or_failed_recipients'],
				riskLevel: summary.failedRecipients ? 'warning' : summary.skippedRecipients ? 'notice' : 'clear',
				canLaunch: summary.pendingRecipients > 0,
				canRetryFailed: summary.failedRecipients > 0,
			},
		},
		recipients: enrichedRecipients,
		allRecipients: enrichedRecipients,
		pagination: includeRecipients
			? {
					page,
					pageSize,
					total: totalRecipients,
					totalPages: Math.max(1, Math.ceil(totalRecipients / pageSize)),
			  }
			: null,
	};
}

export async function getOrCreateDailyAutomationRun({
	workspaceId,
	type,
	timezone = DEFAULT_TIMEZONE,
	date = new Date(),
} = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const normalizedType = normalizeAutomationRunType(type);
	const runKey = getLocalRunKey(date, timezone);

	return prisma.automationRun.upsert({
		where: {
			workspaceId_type_runKey: {
				workspaceId: resolvedWorkspaceId,
				type: normalizedType,
				runKey,
			},
		},
		create: {
			workspaceId: resolvedWorkspaceId,
			type: normalizedType,
			runKey,
			timezone: timezone || DEFAULT_TIMEZONE,
			status: 'OPEN',
		},
		update: {
			timezone: timezone || DEFAULT_TIMEZONE,
		},
	});
}

export async function touchAutomationRun(runId, { workspaceId, status = null, error = null } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	if (!runId) return null;
	return prisma.automationRun.update({
		where: workspaceOwnedWhere({ id: runId, workspaceId: resolvedWorkspaceId }),
		data: {
			lastRunAt: new Date(),
			lastError: error,
			...(status ? { status } : {}),
			runCount: { increment: 1 },
		},
	});
}

export async function markAutomationRunError(runId, error, { workspaceId } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	if (!runId) return null;
	return prisma.automationRun.update({
		where: workspaceOwnedWhere({ id: runId, workspaceId: resolvedWorkspaceId }),
		data: {
			lastRunAt: new Date(),
			lastError: error?.message || String(error || 'Error en automatizacion.'),
			status: 'ERROR',
		},
	});
}

export async function backfillAutomationRunsForWorkspace({
	workspaceId,
	timezone = DEFAULT_TIMEZONE,
} = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const campaigns = await prisma.campaign.findMany({
		where: {
			workspaceId: resolvedWorkspaceId,
			automationRunId: null,
			status: { notIn: ['DRAFT', 'CANCELED'] },
			audienceSource: { in: AUTOMATION_SOURCE_ALIASES },
		},
		select: {
			id: true,
			workspaceId: true,
			audienceSource: true,
			createdAt: true,
		},
		orderBy: [{ createdAt: 'asc' }],
	});

	const grouped = new Map();
	for (const campaign of campaigns) {
		const type = normalizeAutomationRunType(campaign.audienceSource);
		const runKey = getLocalRunKey(campaign.createdAt || new Date(), timezone);
		const key = `${type}:${runKey}`;
		if (!grouped.has(key)) grouped.set(key, { type, runKey, campaignIds: [] });
		grouped.get(key).campaignIds.push(campaign.id);
	}

	for (const group of grouped.values()) {
		const run = await prisma.automationRun.upsert({
			where: {
				workspaceId_type_runKey: {
					workspaceId: resolvedWorkspaceId,
					type: group.type,
					runKey: group.runKey,
				},
			},
			create: {
				workspaceId: resolvedWorkspaceId,
				type: group.type,
				runKey: group.runKey,
				timezone,
				status: 'FINISHED',
				runCount: group.campaignIds.length,
			},
			update: {
				timezone,
			},
		});

		await prisma.campaign.updateMany({
			where: { workspaceId: resolvedWorkspaceId, id: { in: group.campaignIds }, automationRunId: null },
			data: { automationRunId: run.id },
		});

		if (group.type === AUTOMATION_RUN_TYPES.ABANDONED_CART) {
			await prisma.abandonedCartAutomationLog.updateMany({
				where: { workspaceId: resolvedWorkspaceId, campaignId: { in: group.campaignIds }, automationRunId: null },
				data: { automationRunId: run.id },
			});
		}
		if (group.type === AUTOMATION_RUN_TYPES.PENDING_PAYMENT) {
			await prisma.pendingPaymentAutomationLog.updateMany({
				where: { workspaceId: resolvedWorkspaceId, campaignId: { in: group.campaignIds }, automationRunId: null },
				data: { automationRunId: run.id },
			});
		}
		if (group.type === AUTOMATION_RUN_TYPES.SHIPMENT_NOTIFICATION) {
			await prisma.shipmentNotificationLog.updateMany({
				where: { workspaceId: resolvedWorkspaceId, campaignId: { in: group.campaignIds }, automationRunId: null },
				data: { automationRunId: run.id },
			});
		}
	}

	return { processed: campaigns.length, groups: grouped.size };
}

async function loadAutomationRun(runId, workspaceId) {
	return prisma.automationRun.findFirst({
		where: { id: runId, workspaceId },
		include: {
			campaigns: {
				orderBy: [{ createdAt: 'asc' }],
			},
		},
	});
}

export async function listAutomationRuns({
	workspaceId,
	limit = 30,
	timezone = DEFAULT_TIMEZONE,
} = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	try {
		await backfillAutomationRunsForWorkspace({ workspaceId: resolvedWorkspaceId, timezone });
	} catch (error) {
		logger.warn('automation_runs.backfill_failed', { workspaceId: resolvedWorkspaceId, error });
	}

	const runs = await prisma.automationRun.findMany({
		where: { workspaceId: resolvedWorkspaceId },
		orderBy: [{ runKey: 'desc' }, { createdAt: 'desc' }],
		take: Math.max(1, Math.min(Number(limit) || 30, 100)),
		include: {
			campaigns: {
				orderBy: [{ createdAt: 'asc' }],
				include: {
					recipients: {
						orderBy: [{ createdAt: 'desc' }],
						take: 15,
					},
				},
			},
		},
	});

	const serialized = await Promise.all(runs.map((run) => serializeAutomationRun(run)));
	return serialized.filter((run) => run.campaignCount > 0).sort((a, b) => {
		if (a.runKey !== b.runKey) return b.runKey.localeCompare(a.runKey);
		return (AUTOMATION_TYPE_ORDER[a.type] || 99) - (AUTOMATION_TYPE_ORDER[b.type] || 99);
	});
}

export async function getAutomationRunDetail(runId, {
	workspaceId,
	page = 1,
	pageSize = 50,
} = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const currentPage = Math.max(1, Number(page) || 1);
	const currentPageSize = Math.max(1, Math.min(Number(pageSize) || 50, 1000));
	const run = await loadAutomationRun(runId, resolvedWorkspaceId);

	if (!run) {
		throw new Error('No se encontro la corrida de automatizacion.');
	}

	const serialized = await serializeAutomationRun(run, {
		includeRecipients: true,
		page: currentPage,
		pageSize: currentPageSize,
	});

	return {
		run: serialized,
		campaign: serialized,
		recipients: serialized.recipients,
		analytics: serialized.analytics,
		diagnostics: serialized.diagnostics,
		pagination: serialized.pagination,
	};
}

export async function retryFailedAutomationRun(runId, { workspaceId } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const run = await loadAutomationRun(runId, resolvedWorkspaceId);
	if (!run) {
		throw new Error('No se encontro la corrida de automatizacion.');
	}

	const retryableCampaigns = safeArray(run.campaigns).filter(
		(campaign) => Number(campaign.failedRecipients || 0) > 0 || Number(campaign.pendingRecipients || 0) > 0
	);
	const results = [];

	for (const campaign of retryableCampaigns) {
		results.push(await retryFailedCampaignRecipients(campaign.id, { workspaceId: resolvedWorkspaceId }));
	}

	await touchAutomationRun(run.id, {
		workspaceId: resolvedWorkspaceId,
		status: retryableCampaigns.length ? 'QUEUED' : run.status,
	});
	return {
		runId: run.id,
		retriedCampaigns: retryableCampaigns.length,
		results,
	};
}
