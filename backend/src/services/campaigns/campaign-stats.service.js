import { prisma } from '../../lib/prisma.js';

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING'];
const STATUS_BUCKETS = ['DRAFT', 'QUEUED', 'RUNNING', 'FINISHED', 'PARTIAL', 'FAILED', 'CANCELED'];
const DEFAULT_ESTIMATED_MESSAGE_COST_USD = Number(process.env.WHATSAPP_ESTIMATED_MESSAGE_COST_USD || 0);

export async function getCampaignStats() {
	const [
		templatesCount,
		approvedTemplatesCount,
		campaignsCount,
		activeCampaignsCount,
		recipientsCount,
		billableRecipientsCount,
		statusGroups,
	] = await Promise.all([
		prisma.whatsAppTemplate.count({ where: { deletedAt: null } }),
		prisma.whatsAppTemplate.count({ where: { deletedAt: null, status: 'APPROVED' } }),
		prisma.campaign.count(),
		prisma.campaign.count({ where: { status: { in: ACTIVE_STATUSES } } }),
		prisma.campaignRecipient.count(),
		prisma.campaignRecipient.count({ where: { billable: true } }),
		prisma.campaign.groupBy({
			by: ['status'],
			_count: { _all: true },
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

	return {
		templatesCount,
		approvedTemplatesCount,
		campaignsCount,
		activeCampaignsCount,
		recipientsCount,
		estimatedMonthlyCostUsd,
		statusBreakdown,
	};
}
