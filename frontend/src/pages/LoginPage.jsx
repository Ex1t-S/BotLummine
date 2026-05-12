import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canAccessRoute, getDefaultRouteForRole } from '../lib/authz.js';
import logoBladeIA from '../assets/app-logo-mark.png';
import './LoginPage.css';

const DottedSurface = lazy(() => import('../components/ui/dotted-surface.tsx'));

const pricingPlans = [
	{
		name: 'Basico',
		price: 'US$ 50',
		description: 'Para ordenar la atencion diaria y centralizar clientes desde WhatsApp.',
		features: ['Inbox de WhatsApp', 'CRM de clientes', 'Respuestas asistidas', 'Catalogo conectado', 'Reportes basicos'],
	},
	{
		name: 'Avanzado',
		price: 'US$ 80',
		description: 'Para crecer con automatizaciones, campañas y medicion comercial.',
		features: [
			'Todo lo del plan Basico',
			'Campañas por WhatsApp API',
			'Segmentacion de audiencias',
			'Recuperacion de carritos',
			'Metricas avanzadas y atribucion',
			'Soporte prioritario',
		],
	},
];

const commandMetrics = [
	{ value: '24/7', label: 'Atencion asistida para responder consultas y pedidos' },
	{ value: 'CRM', label: 'Clientes, historial y seguimiento en una sola vista' },
	{ value: 'API', label: 'Campañas, carritos y mensajes conectados' },
];

const trustStats = [
	{ label: 'Conversaciones ordenadas', value: '+12k' },
	{ label: 'Tiempo medio ahorrado', value: '42%' },
];

const integrationLogos = ['Tiendanube', 'Shopify', 'WhatsApp API', 'Meta Ads', 'CRM', 'Catalogo'];

const productPillars = [
	{
		title: 'Ventas y costos visibles',
		copy: 'Reuni ingresos, carritos, conversaciones y seguimiento comercial en un mismo tablero.',
	},
	{
		title: 'Campañas sin hojas sueltas',
		copy: 'Segmenta clientes, dispara WhatsApp API y mide respuesta desde la misma operacion.',
	},
	{
		title: 'Atencion con contexto',
		copy: 'Cada mensaje llega con historial, estado del cliente y proximo paso recomendado.',
	},
];

const dashboardRows = [
	['Ventas', '$37.0M', '+12.4%'],
	['Carritos', '183', '+8.2%'],
	['ROI', '5.11', '+2.1%'],
	['Clientes', '1.528', '+18.0%'],
	['Campañas', '24', '+6.4%'],
	['Respuestas', '94%', '+11.6%'],
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
	{ title: 'Soluciones', staticItems: ['WhatsApp AI', 'CRM comercial', 'Campañas', 'Carritos'] },
	{ title: 'Empresa', links: [{ label: 'Contacto', to: '/contacto' }] },
];

function resolveRedirectPath(user, requestedPath = '') {
	if (requestedPath && canAccessRoute(user?.role, requestedPath)) {
		return requestedPath;
	}

	return getDefaultRouteForRole(user?.role);
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

function ProductPreview({ compact = false }) {
	return (
		<aside className={`login-product-preview${compact ? ' login-product-preview--compact' : ''}`} aria-label="Vista previa del producto">
			<div className="login-product-preview__bar">
				<span>Dashboard</span>
				<strong>Hoy</strong>
			</div>
			<div className="login-product-preview__grid">
				{dashboardRows.map(([label, value, trend]) => (
					<div className="login-product-preview__tile" key={label}>
						<span>{label}</span>
						<strong>{value}</strong>
						<small>{trend}</small>
					</div>
				))}
			</div>
			<div className="login-product-preview__footer">
				<strong>76%</strong>
				<span>de las tiendas mejoran seguimiento comercial en los primeros 30 dias</span>
			</div>
		</aside>
	);
}

function LoginForm({ error, form, onChange, onSubmit, showPassword, submitting, togglePassword }) {
	return (
		<form className="login-card login-card--centered" onSubmit={onSubmit}>
			<div className="login-card__header">
				<span className="login-card__brand">
					<span aria-hidden="true">
						<img src={logoBladeIA} alt="" />
					</span>
					BladeIA
				</span>
				<div>
					<h2 id="login-access-title">Bienvenido de nuevo</h2>
					<small>Ingresa tus credenciales para acceder a tu cuenta.</small>
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
						onChange={(e) => onChange({ ...form, email: e.target.value })}
						aria-invalid={Boolean(error)}
						required
					/>
				</div>
			</label>

			<label className="login-field">
				<span>Contrasena</span>
				<div className="login-password-control">
					<input
						type={showPassword ? 'text' : 'password'}
						autoComplete="current-password"
						placeholder="********"
						value={form.password}
						onChange={(e) => onChange({ ...form, password: e.target.value })}
						aria-invalid={Boolean(error)}
						required
					/>
					<button
						type="button"
						className="login-password-toggle"
						onClick={togglePassword}
						aria-label={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
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
	);
}

export default function LoginPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { user, login, loading } = useAuth();
	const publicPath = location.pathname;
	const isLogin = publicPath === '/login';
	const isHome = publicPath === '/inicio';

	const [form, setForm] = useState({ email: '', password: '' });
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [navScrolled, setNavScrolled] = useState(false);
	const [mobileNavOpen, setMobileNavOpen] = useState(false);

	const requestedPath = location.state?.from?.pathname || '';
	const redirectTo = resolveRedirectPath(user, requestedPath);
	const accessPath = user ? redirectTo : '/login';
	const accessLabel = user ? 'Dashboard' : 'Ingresar';

	useEffect(() => {
		if (isLogin && !loading && user) {
			navigate(redirectTo, { replace: true });
		}
	}, [isLogin, loading, user, navigate, redirectTo]);

	useEffect(() => {
		function updateNavState() {
			setNavScrolled(window.scrollY > 24);
		}

		updateNavState();
		window.addEventListener('scroll', updateNavState, { passive: true });

		return () => window.removeEventListener('scroll', updateNavState);
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
			setError(err.response?.data?.error || 'No se pudo iniciar sesion');
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
						<nav className="login-nav__links" aria-label="Navegacion publica">
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
							<Link className="login-nav__login" to={accessPath}>
								{accessLabel}
							</Link>
						</div>

						<button
							className="login-nav__menu"
							type="button"
							aria-expanded={mobileNavOpen}
							aria-controls="mobile-nav"
							aria-label={mobileNavOpen ? 'Cerrar menu' : 'Abrir menu'}
							onClick={() => setMobileNavOpen((current) => !current)}
						>
							<MenuIcon open={mobileNavOpen} />
						</button>
					</div>
				</div>

				<div id="mobile-nav" className={`login-mobile-nav${mobileNavOpen ? ' is-open' : ''}`} aria-hidden={!mobileNavOpen}>
					<button
						type="button"
						className="login-mobile-nav__backdrop"
						aria-label="Cerrar menu"
						tabIndex={mobileNavOpen ? 0 : -1}
						onClick={() => setMobileNavOpen(false)}
					/>
					<nav className="login-mobile-nav__panel" aria-label="Navegacion movil">
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
							<Link to={accessPath} tabIndex={mobileNavOpen ? 0 : -1}>
								{accessLabel}
							</Link>
						</div>
					</nav>
				</div>
			</header>

			<main className="login-shell">
				{publicPath === '/contacto' ? (
					<section className="public-section public-section--single" aria-labelledby="contact-title">
						<p className="login-eyebrow">Contacto</p>
						<h1 id="contact-title">Conectemos tu operacion comercial.</h1>
						<p className="login-lead">
							Escribinos por email o WhatsApp y coordinamos el mejor camino para ordenar ventas, clientes y
							campañas.
						</p>

						<div className="contact-list" aria-label="Canales de contacto">
							<a href="mailto:germanarroyo016@gmail.com">germanarroyo016@gmail.com</a>
							<a href="mailto:mendozatomas600@gmail.com">mendozatomas600@gmail.com</a>
							<a href="https://wa.me/5492923562286" target="_blank" rel="noopener noreferrer">
								+54 9 2923 562286
							</a>
						</div>
					</section>
				) : null}

				{publicPath === '/precios' ? (
					<section className="public-section public-section--single" aria-labelledby="pricing-title">
						<p className="login-eyebrow">Precios</p>
						<h1 id="pricing-title">Planes para operar y crecer con WhatsApp.</h1>
						<p className="login-lead">
							El plan Basico ordena la atencion y el CRM. El Avanzado suma campañas, automatizacion y medicion
							para escalar ventas.
						</p>

						<div className="pricing-board" aria-label="Comparacion de planes">
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
								<p className="login-eyebrow">Confiado por equipos de e-commerce</p>
								<h1>Resultados reales, en tiempo real.</h1>
								<p className="login-lead">
									BladeIA centraliza WhatsApp, ventas, CRM y campañas para que sepas que pasa, que cliente
									responder y que accion comercial conviene tomar.
								</p>
							</div>

							<ProductPreview />

							<div className="login-metrics" aria-label="Capacidades principales">
								{commandMetrics.map((metric) => (
									<article className="login-metric-card" key={metric.value}>
										<strong>{metric.value}</strong>
										<span>{metric.label}</span>
									</article>
								))}
							</div>
						</section>

						<section className="login-trust-section" aria-label="Prueba social">
							<div className="login-trust-stats">
								{trustStats.map((stat) => (
									<article key={stat.label}>
										<strong>{stat.value}</strong>
										<span>{stat.label}</span>
									</article>
								))}
							</div>
							<div className="login-logo-wall" aria-label="Integraciones y canales">
								{integrationLogos.map((logo) => (
									<span key={logo}>{logo}</span>
								))}
							</div>
						</section>

						<section className="login-pillar-section" aria-label="Que resuelve BladeIA">
							{productPillars.map((pillar) => (
								<article className="login-pillar-card" key={pillar.title}>
									<h2>{pillar.title}</h2>
									<p>{pillar.copy}</p>
								</article>
							))}
						</section>
					</>
				) : null}
			</main>

			{isLogin ? (
				<section className="login-access-section" aria-labelledby="login-access-title">
					<div className="login-access-copy">
						<p className="login-eyebrow">Acceso privado</p>
						<h1>Gestiona tus ventas desde un solo panel.</h1>
						<p>
							Entra a la consola para responder WhatsApp, revisar clientes, activar campañas y medir el avance
							comercial.
						</p>
						<ProductPreview compact />
					</div>

					<LoginForm
						error={error}
						form={form}
						onChange={setForm}
						onSubmit={handleSubmit}
						showPassword={showPassword}
						submitting={submitting}
						togglePassword={() => setShowPassword((current) => !current)}
					/>
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
							<p>App comercial con IA para centralizar WhatsApp, clientes, campañas y ventas.</p>
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
												<Link to={link.to}>{link.label}</Link>
											</li>
										))}
									</ul>
								</div>
							))}
						</div>
					</div>

					<div className="login-footer__bottom">
						<p>2026 BladeIA. Todos los derechos reservados.</p>
						<div className="login-footer__socials" aria-label="Redes sociales">
							<a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer">
								Instagram
							</a>
						</div>
					</div>
				</div>
			</footer>
		</div>
	);
}
