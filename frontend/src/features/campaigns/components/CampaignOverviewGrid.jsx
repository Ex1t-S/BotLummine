import CampaignKpiCard from '../../../components/campaigns/CampaignKpiCard.jsx';

export default function CampaignOverviewGrid({ overview }) {
	return (
		<div className="campaign-kpi-grid">
			<CampaignKpiCard
				label="Templates listos"
				value={overview.templatesCount}
				hint={`${overview.approvedTemplatesCount} aprobados para usar`}
				accent="violet"
			/>
			<CampaignKpiCard
				label="Campañas creadas"
				value={overview.campaignsCount}
				hint={`${overview.activeCampaignsCount} activas o en cola`}
				accent="slate"
			/>
			<CampaignKpiCard
				label="Audiencia total"
				value={overview.recipientsCount}
				hint="destinatarios acumulados"
				accent="emerald"
			/>
			<CampaignKpiCard
				label="Actividad estimada"
				value={`USD ${Number(overview.estimatedMonthlyCostUsd || 0).toFixed(2)}`}
				hint="referencia rápida del uso actual"
				accent="amber"
			/>
		</div>
	);
}
