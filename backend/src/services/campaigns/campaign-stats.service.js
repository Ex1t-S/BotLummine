import { prisma } from '../../lib/prisma.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING'];
const STATUS_BUCKETS = ['DRAFT', 'QUEUED', 'RUNNING', 'FINISHED', 'PARTIAL', 'FAILED', 'CANCELED'];
const DEFAULT_ESTIMATED_MESSAGE_COST_USD = Number(process.env.WHATSAPP_ESTIMATED_MESSAGE_COST_USD || 0);
const REAL_CONVERSION_SOURCES = new Set(['ABANDONED_CART', 'PENDING_PAYMENT', 'MARKETING']);

function toNumber(value) {
	if (value == null) return 0;
	if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
	if (typeof value.toNumber === 'function') return value.toNumber();
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

export async function getCampaignStats({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const workspaceWhere = { workspaceId: resolvedWorkspaceId };
	const [
		templatesCount,
		approvedTemplatesCount,
		campaignsCount,
		activeCampaignsCount,
		recipientsCount,
		sentRecipientsCount,
		billableRecipientsCount,
		statusGroups,
		conversions,
	] = await Promise.all([
		prisma.whatsAppTemplate.count({ where: { ...workspaceWhere, deletedAt: null } }),
		prisma.whatsAppTemplate.count({ where: { ...workspaceWhere, deletedAt: null, status: 'APPROVED' } }),
		prisma.campaign.count({ where: workspaceWhere }),
		prisma.campaign.count({ where: { ...workspaceWhere, status: { in: ACTIVE_STATUSES } } }),
		prisma.campaignRecipient.count({ where: workspaceWhere }),
		prisma.campaignRecipient.count({
			where: {
				...workspaceWhere,
				status: { in: ['SENT', 'DELIVERED', 'READ'] },
			},
		}),
		prisma.campaignRecipient.count({ where: { ...workspaceWhere, billable: true } }),
		prisma.campaign.groupBy({
			by: ['status'],
			where: workspaceWhere,
			_count: { _all: true },
		}),
		prisma.campaignConversion.findMany({
			where: workspaceWhere,
			select: {
				recipientId: true,
				source: true,
				amount: true,
				currency: true,
			},
		}),
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
	const chatRecipients = new Set();
	const conversionsBySource = {};
	let attributedRevenue = 0;
	let attributedCurrency = 'ARS';

	for (const conversion of conversions) {
		conversionsBySource[conversion.source] = (conversionsBySource[conversion.source] || 0) + 1;
		if (conversion.recipientId) signalRecipients.add(conversion.recipientId);
		if (conversion.currency) attributedCurrency = conversion.currency;

		if (conversion.source === 'CHAT_CONFIRMATION' && conversion.recipientId) {
			chatRecipients.add(conversion.recipientId);
		}

		if (REAL_CONVERSION_SOURCES.has(conversion.source)) {
			if (conversion.recipientId) realRecipients.add(conversion.recipientId);
			attributedRevenue += toNumber(conversion.amount);
		}
	}
	const conversionSignalRecipients = signalRecipients.size;
	const purchasedRecipients = realRecipients.size;
	const chatConfirmedPurchaseRecipients = chatRecipients.size;

	return {
		templatesCount,
		approvedTemplatesCount,
		campaignsCount,
		activeCampaignsCount,
		recipientsCount,
		sentRecipientsCount,
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
	};
}
