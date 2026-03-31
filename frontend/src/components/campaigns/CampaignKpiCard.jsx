export default function CampaignKpiCard({ label, value, hint }) {
  return (
    <article className="campaign-kpi-card">
      <span className="campaign-kpi-label">{label}</span>
      <strong className="campaign-kpi-value">{value}</strong>
      <small className="campaign-kpi-hint">{hint}</small>
    </article>
  );
}
