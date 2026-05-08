import {
	AlertCircle,
	CheckCircle2,
	Info,
	Loader2,
	Search,
} from 'lucide-react';
import './InternalPage.css';

export function PageHeader({
	eyebrow,
	title,
	description,
	children,
	className = '',
}) {
	return (
		<header className={`internal-page-header ${className}`.trim()}>
			<div className="internal-page-header__copy">
				{eyebrow ? <span className="internal-page-header__eyebrow">{eyebrow}</span> : null}
				<h2>{title}</h2>
				{description ? <p>{description}</p> : null}
			</div>
			{children ? <div className="internal-page-header__actions">{children}</div> : null}
		</header>
	);
}

export function SurfaceCard({
	as: Component = 'section',
	children,
	className = '',
	compact = false,
}) {
	return (
		<Component className={`internal-surface-card${compact ? ' is-compact' : ''} ${className}`.trim()}>
			{children}
		</Component>
	);
}

export function ActionButton({
	children,
	variant = 'primary',
	icon: Icon,
	className = '',
	...props
}) {
	return (
		<button type="button" className={`internal-action-btn is-${variant} ${className}`.trim()} {...props}>
			{Icon ? <Icon size={16} strokeWidth={2.2} aria-hidden="true" /> : null}
			<span>{children}</span>
		</button>
	);
}

export function StatusBadge({ children, tone = 'neutral', className = '' }) {
	return (
		<span className={`internal-status-badge tone-${tone} ${className}`.trim()}>
			{children}
		</span>
	);
}

export function EmptyState({
	title,
	description,
	tone = 'neutral',
	icon: Icon,
	children,
	className = '',
}) {
	const FallbackIcon =
		tone === 'error' ? AlertCircle : tone === 'success' ? CheckCircle2 : tone === 'loading' ? Loader2 : Info;
	const StateIcon = Icon || FallbackIcon;

	return (
		<div className={`internal-empty-state tone-${tone} ${className}`.trim()}>
			<StateIcon
				size={22}
				strokeWidth={2.2}
				aria-hidden="true"
				className={tone === 'loading' ? 'is-spinning' : ''}
			/>
			<strong>{title}</strong>
			{description ? <span>{description}</span> : null}
			{children}
		</div>
	);
}

export function FilterBar({ children, onSubmit, className = '' }) {
	return (
		<form className={`internal-filter-bar ${className}`.trim()} onSubmit={onSubmit}>
			{children}
		</form>
	);
}

export function SearchField({ label, value, onChange, placeholder }) {
	return (
		<label className="internal-field internal-field--search">
			<span>{label}</span>
			<div>
				<Search size={16} strokeWidth={2.1} aria-hidden="true" />
				<input value={value} onChange={onChange} placeholder={placeholder} type="text" />
			</div>
		</label>
	);
}
