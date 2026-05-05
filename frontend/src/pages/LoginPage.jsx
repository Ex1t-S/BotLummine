import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canAccessRoute, getDefaultRouteForRole } from '../lib/authz.js';
import './LoginPage.css';

const DottedSurface = lazy(() => import('../components/ui/dotted-surface.tsx'));

const pricingPlans = [
	{
		name: 'Básico',
		price: 'A definir',
		description: 'Para ordenar la atención diaria y centralizar clientes desde WhatsApp.',
		features: [
			'Inbox de WhatsApp',
			'CRM de clientes',
			'Respuestas asistidas',
			'Catálogo conectado',
			'Reportes básicos',
		],
	},
	{
		name: 'Avanzado',
		price: 'A definir',
		description: 'Para crecer con automatizaciones, campañas y medición comercial.',
		features: [
			'Todo lo del plan Básico',
			'Campañas por WhatsApp API',
			'Segmentación de audiencias',
			'Recuperación de carritos',
			'Métricas avanzadas y atribución',
			'Soporte prioritario',
		],
	},
];

const commandMetrics = [
	{
		value: '24/7',
		label: 'respuestas asistidas',
	},
	{
		value: 'CRM',
		label: 'clientes y seguimiento',
	},
	{
		value: 'API',
		label: 'campañas automatizadas',
	},
];

const systemStates = ['IA lista', 'Canales listos', 'CRM listo'];

function resolveRedirectPath(user, requestedPath = '') {
	if (requestedPath && canAccessRoute(user?.role, requestedPath)) {
		return requestedPath;
	}

	return getDefaultRouteForRole(user?.role);
}

export default function LoginPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { user, login, loading } = useAuth();
	const publicPath = location.pathname;
	const isHome = publicPath !== '/contacto' && publicPath !== '/precios';

	const [form, setForm] = useState({
		email: '',
		password: '',
	});
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [showPassword, setShowPassword] = useState(false);

	const requestedPath = location.state?.from?.pathname || '';
	const redirectTo = resolveRedirectPath(user, requestedPath);

	useEffect(() => {
		if (!loading && user) {
			navigate(redirectTo, { replace: true });
		}
	}, [loading, user, navigate, redirectTo]);

	async function handleSubmit(e) {
		e.preventDefault();
		setError('');
		setSubmitting(true);

		try {
			const result = await login(form);
			const nextPath = resolveRedirectPath(result?.user || null, requestedPath);
			navigate(nextPath, { replace: true });
		} catch (err) {
			setError(err.response?.data?.error || 'No se pudo iniciar sesión');
		} finally {
			setSubmitting(false);
		}
	}

	function handlePointerMove(e) {
		const bounds = e.currentTarget.getBoundingClientRect();
		const x = ((e.clientX - bounds.left) / bounds.width) * 100;
		const y = ((e.clientY - bounds.top) / bounds.height) * 100;

		e.currentTarget.style.setProperty('--pointer-x', `${x.toFixed(2)}%`);
		e.currentTarget.style.setProperty('--pointer-y', `${y.toFixed(2)}%`);
	}

	return (
		<div
			id="inicio"
			className={`login-page ${isHome ? 'login-page--home' : 'login-page--public'}`}
			onPointerMove={handlePointerMove}
		>
			<Suspense fallback={null}>
				<DottedSurface className="login-dotted-surface" />
			</Suspense>
			<div className="login-orb login-orb--one" aria-hidden="true" />
			<div className="login-orb login-orb--two" aria-hidden="true" />
			<div className="login-grid" aria-hidden="true" />
			<div className="login-beam login-beam--one" aria-hidden="true" />
			<div className="login-beam login-beam--two" aria-hidden="true" />
			<div className="login-signal-field" aria-hidden="true">
				<span />
				<span />
				<span />
				<span />
				<span />
				<span />
				<span />
				<span />
			</div>

			<header className="login-nav">
				<Link className="login-nav__brand" to="/inicio" aria-label="Lummine Commerce AI">
					<span className="login-nav__status" aria-hidden="true" />
					<span className="login-nav__brand-text">LUMMINE COMMERCE AI</span>
				</Link>
				<nav className="login-nav__links" aria-label="Navegación pública">
					<Link className={`login-nav__link ${publicPath === '/inicio' ? 'login-nav__link--active' : ''}`} to="/inicio">
						Inicio
					</Link>
					<Link className={`login-nav__link ${publicPath === '/contacto' ? 'login-nav__link--active' : ''}`} to="/contacto">
						Contacto
					</Link>
					<Link className={`login-nav__link ${publicPath === '/precios' ? 'login-nav__link--active' : ''}`} to="/precios">
						Precios
					</Link>
				</nav>
				<a className="login-nav__cta" href={isHome ? '#login' : '/inicio#login'}>
					Acceder
					<span className="login-nav__cta-arrow" aria-hidden="true">-&gt;</span>
				</a>
			</header>

			<main className="login-shell">
				{publicPath === '/contacto' ? (
					<section className="public-section public-section--single" aria-labelledby="contact-title">
						<p className="login-eyebrow">Contacto</p>
						<h1 id="contact-title">Hablemos de tu operación comercial.</h1>
						<p className="login-lead">
							Dejanos tus datos o escribinos por los canales principales para evaluar cómo conectar WhatsApp,
							ventas y campañas en tu marca.
						</p>

						<div className="contact-grid">
							<article className="contact-card">
								<span>Email</span>
								<strong>contacto@tumarca.com</strong>
							</article>
							<article className="contact-card">
								<span>Teléfono</span>
								<strong>+54 9 11 0000-0000</strong>
							</article>
							<article className="contact-card">
								<span>WhatsApp</span>
								<strong>+54 9 11 0000-0000</strong>
							</article>
						</div>
					</section>
				) : null}

				{publicPath === '/precios' ? (
					<section className="public-section public-section--single" aria-labelledby="pricing-title">
						<p className="login-eyebrow">Precios</p>
						<h1 id="pricing-title">Planes para operar y crecer con WhatsApp.</h1>
						<p className="login-lead">
							El plan Básico ordena la atención y el CRM. El Avanzado suma campañas, automatización y
							medición para escalar ventas.
						</p>

						<div className="pricing-board" aria-label="Comparación de planes">
							{pricingPlans.map((plan) => (
								<article className="pricing-plan" key={plan.name}>
									<div>
										<h2>{plan.name}</h2>
										<strong>{plan.price}</strong>
										<p>{plan.description}</p>
									</div>
									<ul>
										{plan.features.map((feature) => (
											<li key={feature}>{feature}</li>
										))}
									</ul>
								</article>
							))}
						</div>
					</section>
				) : null}

				{isHome ? (
					<>
						<section className="login-story" aria-label="Resumen de la plataforma">
							<div className="login-hero-copy">
								<p className="login-eyebrow">PANEL OPERATIVO</p>
								<h1>Gestiona WhatsApp, ventas y campañas de marketing.</h1>
								<p className="login-lead">
									Centraliza WhatsApp, ventas, CRM y campañas en una consola operativa con IA para
									responder, medir y automatizar sin perder contexto comercial.
								</p>
							</div>

							<div className="login-status-row" aria-label="Estado del sistema">
								{systemStates.map((state) => (
									<span key={state}>
										{state}
									</span>
								))}
							</div>

							<div className="login-metrics" aria-label="Capacidades principales">
								{commandMetrics.map((metric) => (
									<article className="login-metric-card" key={metric.value}>
										<strong>{metric.value}</strong>
										<span>{metric.label}</span>
									</article>
								))}
							</div>
						</section>

						<form id="login" className="login-card" onSubmit={handleSubmit}>
							<div className="login-card__beam" aria-hidden="true" />
							<div className="login-card__header">
								<div>
									<p>Acceso</p>
									<h2>Entra a tu workspace</h2>
								</div>
								<span className="login-card__status">
									<i aria-hidden="true" />
									Listo
								</span>
							</div>

							<label className="login-field">
								<span>Email</span>
								<div className="login-input-shell">
									<i aria-hidden="true">@</i>
									<input
										type="email"
										autoComplete="email"
										placeholder="usuario@empresa.com"
										value={form.email}
										onChange={(e) => setForm({ ...form, email: e.target.value })}
										aria-invalid={Boolean(error)}
										required
									/>
								</div>
							</label>

							<label className="login-field">
								<span>Contraseña</span>
								<div className="login-password-control">
									<i aria-hidden="true">#</i>
									<input
										type={showPassword ? 'text' : 'password'}
										autoComplete="current-password"
										placeholder="Tu contraseña"
										value={form.password}
										onChange={(e) => setForm({ ...form, password: e.target.value })}
										aria-invalid={Boolean(error)}
										required
									/>
									<button
										type="button"
										className="login-password-toggle"
										onClick={() => setShowPassword((current) => !current)}
										aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
									>
										{showPassword ? 'Ocultar' : 'Mostrar'}
									</button>
								</div>
							</label>

							{error ? (
								<p className="login-error" role="alert">
									{error}
								</p>
							) : null}

							<button className="login-submit" type="submit" disabled={submitting || !form.email || !form.password}>
								<strong>Ingresar al panel</strong>
							</button>
						</form>
					</>
				) : null}
			</main>

		</div>
	);
}
