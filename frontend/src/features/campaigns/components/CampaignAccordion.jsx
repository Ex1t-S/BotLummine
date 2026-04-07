export default function CampaignAccordion({
	title,
	description,
	defaultOpen = true,
	className = '',
	children,
}) {
	return (
		<details className={`campaign-accordion ${className}`.trim()} open={defaultOpen}>
			<summary className="campaign-accordion-summary campaign-accordion-summary--clean">
				<div className="campaign-accordion-copy">
					<strong>{title}</strong>
					{description ? <span>{description}</span> : null}
				</div>

				<span className="campaign-accordion-chevron" aria-hidden="true">
					⌄
				</span>
			</summary>

			<div className="campaign-accordion-body">{children}</div>
		</details>
	);
}