import { prisma } from '../../lib/prisma.js';
import { normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import { requireWorkspaceScope } from '../workspaces/workspace-scope.js';
import {
	ATTRIBUTION_WINDOW_HOURS,
	messageSuggestsCompletedPurchase,
} from './campaign-attribution.service.js';

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING'];
const STATUS_BUCKETS = ['DRAFT', 'QUEUED', 'RUNNING', 'FINISHED', 'PARTIAL', 'FAILED', 'CANCELED'];
const DEFAULT_ESTIMATED_MESSAGE_COST_USD = Number(process.env.WHATSAPP_ESTIMATED_MESSAGE_COST_USD || 0);
const REAL_CONVERSION_SOURCES = new Set(['ABANDONED_CART', 'PENDING_PAYMENT', 'MARKETING']);
const APP_CONVERSION_SOURCE = 'APP';
const APP_CONVERSION_SOURCES = new Set([APP_CONVERSION_SOURCE, 'CHAT_CONFIRMATION']);

function toNumber(value) {
	if (value == null) return 0;
	if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
	if (typeof value.toNumber === 'function') return value.toNumber();
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeConversionSource(source = '') {
	const normalized = String(source || '').trim().toUpperCase();
	return APP_CONVERSION_SOURCES.has(normalized) ? APP_CONVERSION_SOURCE : normalized;
}

function getRecipientDispatchAt(recipient = {}) {
	return recipient.sentAt || recipient.deliveredAt || recipient.readAt || null;
}

function addHours(date, hours) {
	return new Date(new Date(date).getTime() + hours * 60 * 60 * 1000);
}

async function getAutomationHealth(workspaceId) {
	const settings = await Promise.all([
		prisma.abandonedCartAutomationSetting.findUnique({ where: { workspaceId }, select: { enabled: true, intervalMinutes: true, lastRunAt: true, lastError: true } }),
		prisma.pendingPaymentAutomationSetting.findUnique({ where: { workspaceId }, select: { enabled: true, intervalMinutes: true, lastRunAt: true, lastError: true } }),
		prisma.shipmentNotificationSetting.findUnique({ where: { workspaceId }, select: { enabled: true, lastRunAt: true, lastError: true } }),
	]);
	const names = ['abandoned_carts', 'pending_payment', 'shipments'];
	return settings.map((setting, index) => {
		const intervalMinutes = Number(setting?.intervalMinutes || 60);
		const threshold = (intervalMinutes * 2 + 15) * 60 * 1000;
		const stale = Boolean(setting?.enabled && (!setting.lastRunAt || Date.now() - new Date(setting.lastRunAt).getTime() > threshold));
		return { type: names[index], enabled: Boolean(setting?.enabled), lastRunAt: setting?.lastRunAt || null, intervalMinutes, stale, lastError: setting?.lastError || null };
	});
}

async function getChatConfirmedPurchaseRecipients(workspaceId, campaignWhere = {}) {
	const recipients = await prisma.campaignRecipient.findMany({
		where: {
			workspaceId,
			...(Object.keys(campaignWhere).length ? { campaign: campaignWhere } : {}),
			conversationId: { not: null },
			status: { in: ['SENT', 'DELIVERED', 'READ'] },
			OR: [
				{ sentAt: { not: null } },
				{ deliveredAt: { not: null } },
				{ readAt: { not: null } },
			],
		},
		select: {
			id: true,
			conversationId: true,
			sentAt: true,
			deliveredAt: true,
			readAt: true,
		},
	});

	const dispatchedRecipients = recipients.filter((recipient) => Boolean(getRecipientDispatchAt(recipient)));
	if (!dispatchedRecipients.length) return new Set();

	const earliestDispatchAt = dispatchedRecipients.reduce((earliest, recipient) => {
		const dispatchAt = getRecipientDispatchAt(recipient);
		if (!earliest) return dispatchAt;
		return new Date(dispatchAt).getTime() < new Date(earliest).getTime() ? dispatchAt : earliest;
	}, null);

	const latestWindowEnd = dispatchedRecipients.reduce((latest, recipient) => {
		const windowEnd = addHours(getRecipientDispatchAt(recipient), ATTRIBUTION_WINDOW_HOURS);
		if (!latest) return windowEnd;
		return windowEnd.getTime() > new Date(latest).getTime() ? windowEnd : latest;
	}, null);

	const conversationIds = [...new Set(dispatchedRecipients.map((recipient) => recipient.conversationId).filter(Boolean))];
	const messages = await prisma.message.findMany({
		where: {
			workspaceId,
			conversationId: { in: conversationIds },
			direction: 'INBOUND',
			createdAt: {
				gte: earliestDispatchAt,
				lte: latestWindowEnd,
			},
		},
		select: {
			conversationId: true,
			body: true,
			createdAt: true,
		},
		orderBy: { createdAt: 'asc' },
	});

	const messagesByConversation = new Map();
	for (const message of messages) {
		if (!messagesByConversation.has(message.conversationId)) {
			messagesByConversation.set(message.conversationId, []);
		}
		messagesByConversation.get(message.conversationId).push(message);
	}

	const chatRecipients = new Set();
	for (const recipient of dispatchedRecipients) {
		const dispatchAt = new Date(getRecipientDispatchAt(recipient));
		const windowEnd = addHours(dispatchAt, ATTRIBUTION_WINDOW_HOURS);
		const hasPurchaseMessage = (messagesByConversation.get(recipient.conversationId) || []).some((message) => {
			const createdAt = new Date(message.createdAt);
			return (
				createdAt >= dispatchAt &&
				createdAt <= windowEnd &&
				messageSuggestsCompletedPurchase(message.body || '')
			);
		});

		if (hasPurchaseMessage) {
			chatRecipients.add(recipient.id);
		}
	}

	return chatRecipients;
}

export async function getCampaignStats({ workspaceId, dateFrom, dateTo, kind, audienceSource, archiveScope = 'all' } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const workspaceWhere = { workspaceId: resolvedWorkspaceId };
	const campaignWhere = { ...workspaceWhere };
	if (dateFrom || dateTo) {
		campaignWhere.createdAt = {};
		if (dateFrom && !Number.isNaN(new Date(dateFrom).getTime())) campaignWhere.createdAt.gte = new Date(dateFrom);
		if (dateTo && !Number.isNaN(new Date(dateTo).getTime())) {
			const to = new Date(dateTo);
			if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateTo))) to.setUTCHours(23, 59, 59, 999);
			campaignWhere.createdAt.lte = to;
		}
	}
	if (String(kind || '').toLowerCase() === 'manual') campaignWhere.automationRunId = null;
	if (String(kind || '').toLowerCase() === 'automated') campaignWhere.automationRunId = { not: null };
	if (audienceSource) campaignWhere.audienceSource = String(audienceSource);
	if (String(archiveScope || '').toLowerCase() === 'current') campaignWhere.archivedAt = null;
	const recipientWhere = { ...workspaceWhere, ...(Object.keys(campaignWhere).length > 1 ? { campaign: Object.fromEntries(Object.entries(campaignWhere).filter(([key]) => key !== 'workspaceId')) } : {}) };
	const [
		templatesCount,
		approvedTemplatesCount,
		campaignsCount,
		activeCampaignsCount,
		recipientsCount,
		sentRecipientsCount,
		deliveredRecipientsCount,
		billableRecipientsCount,
		statusGroups,
		conversions,
		chatDetectedRecipients,
	] = await Promise.all([
		prisma.whatsAppTemplate.count({ where: { ...workspaceWhere, deletedAt: null } }),
		prisma.whatsAppTemplate.count({ where: { ...workspaceWhere, deletedAt: null, status: 'APPROVED' } }),
		prisma.campaign.count({ where: campaignWhere }),
		prisma.campaign.count({ where: { ...campaignWhere, status: { in: ACTIVE_STATUSES } } }),
		prisma.campaignRecipient.count({ where: recipientWhere }),
		prisma.campaignRecipient.count({
			where: {
				...recipientWhere,
				status: { in: ['SENT', 'DELIVERED', 'READ'] },
			},
		}),
		prisma.campaignRecipient.count({ where: { ...recipientWhere, status: { in: ['DELIVERED', 'READ'] } } }),
		prisma.campaignRecipient.count({ where: { ...recipientWhere, billable: true } }),
		prisma.campaign.groupBy({
			by: ['status'],
			where: campaignWhere,
			_count: { _all: true },
		}),
		prisma.campaignConversion.findMany({
			where: { ...workspaceWhere, ...(Object.keys(campaignWhere).length > 1 ? { campaign: Object.fromEntries(Object.entries(campaignWhere).filter(([key]) => key !== 'workspaceId')) } : {}) },
			select: {
				recipientId: true,
				source: true,
				amount: true,
				currency: true,
			},
		}),
		getChatConfirmedPurchaseRecipients(resolvedWorkspaceId, Object.fromEntries(Object.entries(campaignWhere).filter(([key]) => key !== 'workspaceId'))),
	]);

	const statusBreakdown = STATUS_BUCKETS.reduce((acc, status) => {
		acc[status] = 0;
		return acc;
	}, {});

	for (const row of statusGroups) {
		statusBreakdown[row.status] = row._count?._all || 0;
	}

	const estimatedMonthlyCostUsd = Number(
		(billableRecipientsCount * DEFAULT_ESTIMATED_MESSAGE_COST_USD).toFixed(2)
	);
	const signalRecipients = new Set();
	const realRecipients = new Set();
	const chatRecipients = new Set(chatDetectedRecipients);
	const conversionsBySource = {};
	let attributedRevenue = 0;
	let attributedCurrency = 'ARS';

	for (const conversion of conversions) {
		const normalizedSource = normalizeConversionSource(conversion.source);
		conversionsBySource[normalizedSource] = (conversionsBySource[normalizedSource] || 0) + 1;
		if (conversion.recipientId) signalRecipients.add(conversion.recipientId);
		if (conversion.currency) attributedCurrency = conversion.currency;

		if (APP_CONVERSION_SOURCES.has(normalizedSource) && conversion.recipientId) {
			chatRecipients.add(conversion.recipientId);
		}

		if (REAL_CONVERSION_SOURCES.has(normalizedSource)) {
			if (conversion.recipientId) realRecipients.add(conversion.recipientId);
			attributedRevenue += toNumber(conversion.amount);
		}
	}
	for (const recipientId of chatRecipients) {
		signalRecipients.add(recipientId);
	}
	if (chatRecipients.size > 0) {
		conversionsBySource.APP = Math.max(Number(conversionsBySource.APP || 0), chatRecipients.size);
		delete conversionsBySource.CHAT_CONFIRMATION;
	}
	const conversionSignalRecipients = signalRecipients.size;
	const purchasedRecipients = realRecipients.size;
	const chatConfirmedPurchaseRecipients = chatRecipients.size;
	const automationHealth = await getAutomationHealth(resolvedWorkspaceId);

	return {
		templatesCount,
		approvedTemplatesCount,
		campaignsCount,
		activeCampaignsCount,
		recipientsCount,
		sentRecipientsCount,
		deliveredRecipientsCount,
		estimatedMonthlyCostUsd,
		statusBreakdown,
		conversionSignalRecipients,
		purchasedRecipients,
		chatConfirmedPurchaseRecipients,
		conversionSignalRate: sentRecipientsCount > 0 ? conversionSignalRecipients / sentRecipientsCount : 0,
		purchaseRate: sentRecipientsCount > 0 ? purchasedRecipients / sentRecipientsCount : 0,
		attributedRevenue,
		attributedCurrency,
		conversionsBySource,
		period: { dateFrom: dateFrom || null, dateTo: dateTo || null, archiveScope, kind: kind || null, audienceSource: audienceSource || null },
		updatedAt: new Date().toISOString(),
		attribution: { realSources: [...REAL_CONVERSION_SOURCES], chatSource: APP_CONVERSION_SOURCE, deduplication: 'recipientId' },
		automationHealth,
	};
}
