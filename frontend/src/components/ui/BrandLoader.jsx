import logoBladeIA from '../../assets/bladeia-logo.png';

export default function BrandLoader({ label = 'Cargando' }) {
	return (
		<div className="brand-loader" role="status" aria-live="polite" aria-label={label}>
			<div className="brand-loader__mark" aria-hidden="true">
				<img src={logoBladeIA} alt="" />
			</div>
			<span className="brand-loader__pulse" aria-hidden="true" />
			<span className="brand-loader__label">{label}</span>
		</div>
	);
}
