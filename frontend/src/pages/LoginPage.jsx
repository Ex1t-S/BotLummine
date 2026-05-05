import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canAccessRoute, getDefaultRouteForRole } from '../lib/authz.js';
import logoBladeIA from '../assets/bladeia-logo.svg';
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
		label: 'Atención asistida para responder consultas y pedidos',
	},
	{
		value: 'CRM',
		label: 'Clientes, historial y seguimiento en una sola vista',
	},
	{
		value: 'API',
		label: 'Campañas, carritos y mensajes conectados',
	},
];

const publicNavLinks = [
	{ label: 'Producto', to: '/inicio', activePaths: ['/inicio'] },
	{ label: 'Precios', to: '/precios', activePaths: ['/precios'] },
	{ label: 'Contacto', to: '/contacto', activePaths: ['/contacto'] },
];

const footerColumns = [
	{
		title: 'Producto',
		links: [
			{ label: 'Producto', to: '/inicio' },
			{ label: 'Precios', to: '/precios' },
			{ label: 'Acceso al panel', to: '/login' },
		],
	},
	{
		title: 'Soluciones',
		staticItems: ['WhatsApp AI', 'CRM comercial', 'Campañas', 'Carritos'],
	},
	{
		title: 'Empresa',
		links: [
			{ label: 'Contacto', to: '/contacto' },
		],
	},
];

const socialLinks = [
	{ label: 'Instagram', href: 'https://www.instagram.com/', icon: 'instagram' },
	{ label: 'LinkedIn', href: 'https://www.linkedin.com/', icon: 'linkedin' },
	{ label: 'X', href: 'https://x.com/', icon: 'x' },
	{ label: 'YouTube', href: 'https://www.youtube.com/', icon: 'youtube' },
];

function resolveRedirectPath(user, requestedPath = '') {
	if (requestedPath && canAccessRoute(user?.role, requestedPath)) {
		return requestedPath;
	}

	return getDefaultRouteForRole(user?.role);
}

function SocialIcon({ icon }) {
	if (icon === 'instagram') {
		return (
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
				<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
				<circle cx="17.5" cy="6.5" r="1.1" />
			</svg>
		);
	}

	if (icon === 'linkedin') {
		return (
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13Zm1.78 13.02H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45C23.2 24 24 23.23 24 22.27V1.73C24 .77 23.2 0 22.22 0Z" />
			</svg>
		);
	}

	if (icon === 'youtube') {
		return (
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.51 3.55 12 3.55 12 3.55s-7.51 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.87.5 9.38.5 9.38.5s7.51 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z" />
			</svg>
		);
	}

	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.63 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.94L18.9 1.15Zm-1.29 19.49h2.04L6.49 3.24H4.3l13.31 17.4Z" />
		</svg>
	);
}

function MenuIcon({ open = false }) {
	if (open) {
		return (
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M6 6l12 12M18 6 6 18" />
			</svg>
		);
	}

	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M4 7h16M4 12h16M4 17h16" />
		</svg>
	);
}

export default function LoginPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { user, login, loading } = useAuth();
	const publicPath = location.pathname;
	const isLogin = publicPath === '/login';
	const isHome = publicPath === '/inicio';

	const [form, setForm] = useState({
		email: '',
		password: '',
	});
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [navScrolled, setNavScrolled] = useState(false);
	const [mobileNavOpen, setMobileNavOpen] = useState(false);

	const requestedPath = location.state?.from?.pathname || '';
	const redirectTo = resolveRedirectPath(user, requestedPath);

	useEffect(() => {
		if (!loading && user) {
			navigate(redirectTo, { replace: true });
		}
	}, [loading, user, navigate, redirectTo]);

	useEffect(() => {
		function updateNavState() {
			setNavScrolled(window.scrollY > 24);
		}

		updateNavState();
		window.addEventListener('scroll', updateNavState, { passive: true });

		return () => {
			window.removeEventListener('scroll', updateNavState);
		};
	}, []);

	useEffect(() => {
		setMobileNavOpen(false);
	}, [publicPath]);

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

	function isActiveNavLink(link) {
		return link.activePaths?.includes(publicPath);
	}

	return (
		<div
			id={isLogin ? 'login' : 'inicio'}
			className={`login-page ${isLogin ? 'login-page--login' : isHome ? 'login-page--home' : 'login-page--public'}`}
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

			<header className={`login-nav-shell${navScrolled ? ' is-scrolled' : ''}${mobileNavOpen ? ' menu-open' : ''}`}>
				<div className="login-nav-frame">
					<div className="login-nav">
						<Link className="login-nav__brand" to="/inicio" aria-label="BladeIA">
							<span className="login-nav__mark" aria-hidden="true">
								<img src={logoBladeIA} alt="" />
							</span>
							<span className="login-nav__brand-text">BladeIA</span>
						</Link>
						<nav className="login-nav__links" aria-label="Navegación pública">
							{publicNavLinks.map((link) => (
								<Link
									className={`login-nav__link${isActiveNavLink(link) ? ' login-nav__link--active' : ''}`}
									key={link.label}
									to={link.to}
								>
									{link.label}
								</Link>
							))}
						</nav>

						<div className="login-nav__actions">
							<Link className="login-nav__login" to="/login">
								Ingresar
							</Link>
						</div>

						<button
							className="login-nav__menu"
							type="button"
							aria-expanded={mobileNavOpen}
							aria-controls="mobile-nav"
							aria-label={mobileNavOpen ? 'Cerrar menú' : 'Abrir menú'}
							onClick={() => setMobileNavOpen((current) => !current)}
						>
							<MenuIcon open={mobileNavOpen} />
						</button>
					</div>
				</div>

				<div
					id="mobile-nav"
					className={`login-mobile-nav${mobileNavOpen ? ' is-open' : ''}`}
					aria-hidden={!mobileNavOpen}
				>
					<button
						type="button"
						className="login-mobile-nav__backdrop"
						aria-label="Cerrar menú"
						tabIndex={mobileNavOpen ? 0 : -1}
						onClick={() => setMobileNavOpen(false)}
					/>
					<nav className="login-mobile-nav__panel" aria-label="Navegación móvil">
						<div className="login-mobile-nav__links">
							{publicNavLinks.map((link) => (
								<Link
									className={`login-mobile-nav__link${isActiveNavLink(link) ? ' is-active' : ''}`}
									key={link.label}
									tabIndex={mobileNavOpen ? 0 : -1}
									to={link.to}
								>
									{link.label}
								</Link>
							))}
						</div>

						<div className="login-mobile-nav__actions">
							<Link to="/login" tabIndex={mobileNavOpen ? 0 : -1}>
								Ingresar
							</Link>
						</div>
					</nav>
				</div>
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
								<h1>Gestiona WhatsApp, ventas y campañas de marketing</h1>
								<p className="login-lead">
									Centraliza WhatsApp, ventas, CRM y campañas en una consola operativa con IA para
									responder más rápido, ordenar oportunidades y medir cada conversación.
								</p>
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

					</>
				) : null}
			</main>

			{isLogin ? (
				<section className="login-access-section" aria-labelledby="login-access-title">
					<form className="login-card login-card--centered" onSubmit={handleSubmit}>
						<div className="login-card__header">
							<div>
								<h2 id="login-access-title">Bienvenido de nuevo</h2>
								<small>Ingresá tus credenciales para acceder a tu cuenta.</small>
							</div>
						</div>

						<label className="login-field">
							<span>Email</span>
							<div className="login-input-shell">
								<input
									type="email"
									autoComplete="email"
									placeholder="nombre@empresa.com"
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
								<input
									type={showPassword ? 'text' : 'password'}
									autoComplete="current-password"
									placeholder="••••••••"
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
							<strong>{submitting ? 'Ingresando...' : 'Ingresar al panel'}</strong>
						</button>
					</form>
				</section>
			) : null}

			<footer className="login-footer">
					<div className="login-footer__inner">
						<div className="login-footer__top">
							<div className="login-footer__brand">
								<Link className="login-footer__brand-link" to="/inicio" aria-label="BladeIA">
									<span className="login-footer__mark" aria-hidden="true">
										<img src={logoBladeIA} alt="" />
									</span>
									<span>BladeIA</span>
								</Link>
								<p>
									App comercial con IA para centralizar WhatsApp, clientes, campañas y ventas en una sola
									consola operativa.
								</p>
							</div>

							<div className="login-footer__columns">
								{footerColumns.map((column) => (
									<div className="login-footer__column" key={column.title}>
										<h2>{column.title}</h2>
										<ul>
											{column.staticItems?.map((item) => (
												<li key={`${column.title}-${item}`}>
													<span>{item}</span>
												</li>
											))}
											{column.links?.map((link) => (
												<li key={`${column.title}-${link.label}`}>
													{link.href ? (
														<a href={link.href}>{link.label}</a>
													) : (
														<Link to={link.to}>{link.label}</Link>
													)}
												</li>
											))}
										</ul>
									</div>
								))}
							</div>
						</div>

						<div className="login-footer__bottom">
							<p>© 2026 BladeIA. Todos los derechos reservados.</p>
							<div className="login-footer__socials" aria-label="Redes sociales">
								{socialLinks.map((social) => (
									<a
										href={social.href}
										key={social.label}
										target="_blank"
										rel="noopener noreferrer"
										aria-label={`BladeIA en ${social.label}`}
									>
										<SocialIcon icon={social.icon} />
									</a>
								))}
							</div>
						</div>
					</div>
			</footer>

		</div>
	);
}
