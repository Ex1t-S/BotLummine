export default function CampaignKpiCard({ label, value, hint, accent = 'slate' }) {
	return (
		<article className={`campaign-kpi-card campaign-kpi-card--${accent}`}>
			<span className="campaign-kpi-label">{label}</span>
			<strong className="campaign-kpi-value">{value}</strong>
			<small className="campaign-kpi-hint">{hint}</small>
		</article>
	);
}
