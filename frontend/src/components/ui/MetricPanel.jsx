import { ArrowRight, ShieldCheck } from 'lucide-react';
import './MetricPanel.css';

export default function MetricPanel({
	label,
	value,
	helper,
	tone = 'neutral',
	onClick,
	icon: Icon = ShieldCheck,
	formatValue = (nextValue) => nextValue,
}) {
	const content = (
		<>
			<div className="metric-panel__orb" aria-hidden="true" />
			<div className="metric-panel__icon">
				<Icon size={17} strokeWidth={2.2} aria-hidden="true" />
			</div>
			<span className="metric-panel__label">{label}</span>
			<strong className="metric-panel__value">{formatValue(value)}</strong>
			<small className="metric-panel__helper">{helper}</small>
			{onClick ? (
				<em className="metric-panel__action">
					Ver <ArrowRight size={13} strokeWidth={2.4} aria-hidden="true" />
				</em>
			) : null}
		</>
	);

	if (onClick) {
		return (
			<button type="button" className={`metric-panel tone-${tone}`} onClick={onClick}>
				{content}
			</button>
		);
	}

	return <div className={`metric-panel tone-${tone}`}>{content}</div>;
}
