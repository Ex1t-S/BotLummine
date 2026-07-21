import CampaignKpiCard from '../../../components/campaigns/CampaignKpiCard.jsx';

function formatPercent(value) {
	const ratio = Math.min(1, Math.max(0, Number(value || 0)));
	return `${Math.ceil(ratio * 100)}%`;
}

export default function CampaignOverviewGrid({ overview }) {
	return (
		<div className="campaign-kpi-grid campaign-kpi-grid--clean">
			<CampaignKpiCard
				label="Señales de compra"
				value={overview.conversionSignalRecipients}
				hint={`${formatPercent(overview.conversionSignalRate)} sobre enviados`}
				accent="emerald"
			/>
			<CampaignKpiCard
				label="Compras reales"
				value={overview.purchasedRecipients}
				hint={`${formatPercent(overview.purchaseRate)} con pedido atribuido`}
				accent="slate"
			/>
			<CampaignKpiCard
				label="Campañas"
				value={overview.campaignsCount}
				hint={`${overview.activeCampaignsCount} activas o en cola`}
				accent="violet"
			/>
		</div>
	);
}
