export function normalizeOverview(data = {}) {
	const stats = data?.stats || data;
	const templatesCount = stats?.templatesCount ?? data?.templatesCount ?? data?.templates?.length ?? 0;
	const approvedTemplatesCount =
		stats?.approvedTemplatesCount ?? data?.approvedTemplatesCount ?? data?.approvedTemplates ?? 0;
	const campaignsCount = stats?.campaignsCount ?? data?.campaignsCount ?? data?.campaigns?.length ?? 0;
	const activeCampaignsCount =
		stats?.activeCampaignsCount ?? data?.activeCampaignsCount ?? data?.activeCampaigns ?? 0;
	const recipientsCount = stats?.recipientsCount ?? data?.recipientsCount ?? 0;
	const estimatedMonthlyCostUsd =
		stats?.estimatedMonthlyCostUsd ?? data?.estimatedMonthlyCostUsd ?? 0;

	return {
		templatesCount,
		approvedTemplatesCount,
		campaignsCount,
		activeCampaignsCount,
		recipientsCount,
		estimatedMonthlyCostUsd,
		statusBreakdown: stats?.statusBreakdown || data?.statusBreakdown || {},
	};
}

export function extractCreatedCampaignId(response) {
	return (
		response?.id ||
		response?.campaign?.id ||
		response?.data?.id ||
		response?.data?.campaign?.id ||
		null
	);
}

export function formatPreviewText(text = '', max = 220) {
	const value = String(text || '').trim();
	if (!value) return '';
	if (value.length <= max) return value;
	return `${value.slice(0, max - 1).trim()}…`;
}

export function buildAbandonedCartFilters(state = {}) {
	return {
		daysBack: Number(state.daysBack || 7),
		status: state.status || 'NEW',
		limit: Number(state.limit || 50),
		minTotal:
			state.minTotal === '' || state.minTotal === null || state.minTotal === undefined
				? null
				: Number(state.minTotal),
		productQuery: String(state.productQuery || '').trim(),
	};
}

export function getTemplateCollection(data) {
	if (Array.isArray(data)) return data;
	return data?.items || data?.templates || [];
}

export function getCampaignCollection(data) {
	if (Array.isArray(data)) return data;
	return data?.items || data?.campaigns || [];
}

export function getCampaignDetailPayload(detail, campaigns, selectedCampaignId) {
	if (detail?.campaign) {
		return {
			...detail.campaign,
			template: detail.template || null,
			recipients: Array.isArray(detail.recipients) ? detail.recipients : [],
			pagination: detail.pagination || null,
		};
	}

	return campaigns.find((campaign) => campaign.id === selectedCampaignId) || null;
}
