import CampaignKpiCard from '../../../components/campaigns/CampaignKpiCard.jsx';

export default function CampaignOverviewGrid({ overview }) {
	return (
		<div className="campaign-kpi-grid campaign-kpi-grid--clean">
			<CampaignKpiCard
				label="Templates"
				value={overview.templatesCount}
				hint={`${overview.approvedTemplatesCount} aprobados`}
				accent="violet"
			/>
			<CampaignKpiCard
				label="Campañas"
				value={overview.campaignsCount}
				hint={`${overview.activeCampaignsCount} activas o en cola`}
				accent="slate"
			/>
			<CampaignKpiCard
				label="Audiencia"
				value={overview.recipientsCount}
				hint="destinatarios acumulados"
				accent="emerald"
			/>
			<CampaignKpiCard
				label="Actividad"
				value={`USD ${Number(overview.estimatedMonthlyCostUsd || 0).toFixed(2)}`}
				hint="estimación actual"
				accent="amber"
			/>
		</div>
	);
}