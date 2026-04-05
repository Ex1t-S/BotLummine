import CampaignKpiCard from '../../../components/campaigns/CampaignKpiCard.jsx';

export default function CampaignOverviewGrid({ overview }) {
	return (
		<div className="campaign-kpi-grid">
			<CampaignKpiCard
				label="Templates totales"
				value={overview.templatesCount}
				hint={`${overview.approvedTemplatesCount} aprobados`}
			/>
			<CampaignKpiCard
				label="Campañas"
				value={overview.campaignsCount}
				hint={`${overview.activeCampaignsCount} activas o en cola`}
			/>
			<CampaignKpiCard
				label="Destinatarios"
				value={overview.recipientsCount}
				hint="audiencia acumulada"
			/>
			<CampaignKpiCard
				label="Costo estimado"
				value={`USD ${Number(overview.estimatedMonthlyCostUsd || 0).toFixed(2)}`}
				hint="según actividad actual"
			/>
		</div>
	);
}
