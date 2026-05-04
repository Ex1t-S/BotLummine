import CampaignKpiCard from '../../../components/campaigns/CampaignKpiCard.jsx';

function formatMoney(value, currency = 'ARS') {
	try {
		return new Intl.NumberFormat('es-AR', {
			style: 'currency',
			currency: currency || 'ARS',
			maximumFractionDigits: 0,
		}).format(Number(value || 0));
	} catch {
		return `${value || 0} ${currency || 'ARS'}`;
	}
}

function formatPercent(value) {
	return `${Math.ceil(Number(value || 0) * 100)}%`;
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
				label="Facturación"
				value={formatMoney(overview.attributedRevenue, overview.attributedCurrency)}
				hint="ventas atribuidas"
				accent="amber"
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
