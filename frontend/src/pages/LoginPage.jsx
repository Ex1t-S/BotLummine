import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, MessageCircle, Rocket } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { canAccessRouteForUser, getDefaultRouteForUser } from '../lib/authz.js';
import { getApiErrorMessage } from '../lib/api.js';
import logoBladeIA from '../assets/app-logo-mark.png';
import showcaseInboxAuto from '../assets/feature-carousel/showcase-inbox-auto.png';
import showcaseInboxPayments from '../assets/feature-carousel/showcase-inbox-payments.png';
import showcaseCampaigns from '../assets/feature-carousel/showcase-campaigns.png';
import showcaseTemplates from '../assets/feature-carousel/showcase-templates.png';
import showcaseCarts from '../assets/feature-carousel/showcase-carts.png';
import showcaseOperations from '../assets/feature-carousel/showcase-operations.png';
import * as PricingCard from '../components/ui/pricing-card.tsx';
import { ProjectCard } from '../components/ui/project-card.tsx';
import './LoginPage.css';

const DottedSurface = lazy(() => import('../components/ui/dotted-surface.tsx'));
const FeatureCarousel = lazy(() =>
	import('../components/ui/animated-feature-carousel.tsx').then((module) => ({
		default: module.FeatureCarousel,
	})),
);

const pricingPlans = [
	{
		name: 'Básico',
		price: 'US$ 50',
		period: '/mes',
		icon: MessageCircle,
		description: 'Para responder mejor, ordenar clientes y no perder conversaciones importantes.',
		features: ['Inbox de WhatsApp centralizado', 'Clientes e historial en una sola vista', 'Respuestas asistidas para ganar tiempo', 'Catálogo conectado a la conversación', 'Resumen simple de la actividad'],
	},
	{
		name: 'Avanzado',
		price: 'US$ 80',
		period: '/mes',
		badge: 'M\u00e1s elegido',
		icon: Rocket,
		description: 'Para retomar conversaciones, recuperar ventas y entender qué acciones generan más respuesta.',
		features: [
			'Todo lo del plan Básico',
			'Campañas para volver a hablar con tus clientes',
			'Audiencias mejor segmentadas',
			'Recuperación de carritos abandonados',
			'Métricas para seguir resultados',
			'Soporte prioritario cuando necesitás avanzar más rápido',
		],
	},
];

const removedCommandMetrics = [
	{ value: 'Menos demora', label: 'Respondé más rápido y evitá que una consulta se enfríe antes de avanzar.' },
	{ value: 'Campañas', label: 'Activá envíos y seguimientos sin depender de tareas manuales una por una.' },
	{ value: 'Carritos', label: 'Detectá ventas abandonadas y volvé a moverlas antes de que se pierdan.' },
];

const capabilityCards = [
	{
		value: 'Respuestas sin espera',
		label: 'La IA ayuda a priorizar consultas, sugerir respuestas y mantener cada conversaci\u00f3n lista para avanzar.',
		image: showcaseInboxAuto,
	},
	{
		value: 'Campa\u00f1as con seguimiento',
		label: 'Segment\u00e1 clientes, retom\u00e1 conversaciones y med\u00ed qu\u00e9 mensajes vuelven a generar oportunidades.',
		image: showcaseCampaigns,
	},
	{
		value: 'Carritos recuperables',
		label: 'Detect\u00e1 abandonos, activ\u00e1 recordatorios y llev\u00e1 cada intento de compra de vuelta al inbox.',
		image: showcaseCarts,
	},
];

const trustStats = [
	{ label: 'Conversaciones ordenadas', value: '+12k' },
	{ label: 'Tiempo medio ahorrado', value: '42%' },
];

const featureCarouselImages = {
	alt: 'Pantallas internas de BladeIA',
	step1img1: showcaseInboxAuto,
	step1img2: showcaseInboxPayments,
	step2img1: showcaseCampaigns,
	step2img2: showcaseTemplates,
	step3img: showcaseCarts,
	step4img: showcaseOperations,
};

const dashboardRows = [
	['Ventas', '$37.0M', '+12.4%'],
	['Carritos', '183', '+8.2%'],
	['ROI', '5.11', '+2.1%'],
	['Clientes', '1.528', '+18.0%'],
	['Campañas', '24', '+6.4%'],
	['Respuestas', '94%', '+11.6%'],
];

function LazyWhenVisible({ children, className, fallback = null, rootMargin = '360px' }) {
	const containerRef = useRef(null);
	const [isVisible, setIsVisible] = useState(false);

	useEffect(() => {
		if (isVisible) return undefined;
		const node = containerRef.current;
		if (!node) return undefined;

		if (!('IntersectionObserver' in window)) {
			setIsVisible(true);
			return undefined;
		}

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					setIsVisible(true);
					observer.disconnect();
				}
			},
			{ rootMargin },
		);

		observer.observe(node);
		return () => observer.disconnect();
	}, [isVisible, rootMargin]);

	return (
		<div ref={containerRef} className={className}>
			{isVisible ? children : fallback}
		</div>
	);
}

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
	if (requestedPath && canAccessRouteForUser(user, requestedPath)) {
		return requestedPath;
	}

	return getDefaultRouteForUser(user);
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
				<strong>86%</strong>
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
					<h2 id="login-access-title">Ingreso</h2>
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
				<span>Contraseña</span>
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
				<strong>{submitting ? 'Ingresando...' : 'Ingresar'}</strong>
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
	const pointerFrameRef = useRef(0);
	const pointerPositionRef = useRef({ x: '50%', y: '42%' });

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

	useEffect(() => {
		return () => {
			if (pointerFrameRef.current) {
				window.cancelAnimationFrame(pointerFrameRef.current);
			}
		};
	}, []);

	async function handleSubmit(e) {
		e.preventDefault();
		setError('');
		setSubmitting(true);

		try {
			const result = await login(form);
			const nextPath = resolveRedirectPath(result?.user || null, requestedPath);
			navigate(nextPath, { replace: true });
		} catch (err) {
			setError(getApiErrorMessage(err, 'No se pudo iniciar sesion'));
		} finally {
			setSubmitting(false);
		}
	}

	function handlePointerMove(e) {
		const bounds = e.currentTarget.getBoundingClientRect();
		const x = ((e.clientX - bounds.left) / bounds.width) * 100;
		const y = ((e.clientY - bounds.top) / bounds.height) * 100;
		const target = e.currentTarget;

		pointerPositionRef.current = {
			x: `${x.toFixed(2)}%`,
			y: `${y.toFixed(2)}%`,
		};

		if (pointerFrameRef.current) return;
		pointerFrameRef.current = window.requestAnimationFrame(() => {
			target.style.setProperty('--pointer-x', pointerPositionRef.current.x);
			target.style.setProperty('--pointer-y', pointerPositionRef.current.y);
			pointerFrameRef.current = 0;
		});
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
						<h1 id="contact-title">Hablemos de tu operación comercial.</h1>
						<p className="login-lead">
							Escribinos por email o WhatsApp. Te ayudamos a ordenar la atención, hacer mejor seguimiento y aprovechar más conversaciones.
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
						<h1 id="pricing-title">Planes para empezar</h1>
						<p className="login-lead">
							Elegí la opción que mejor encaja con tu operación.
						</p>

						<div className="pricing-board login-pricing-board" aria-label="Comparación de planes">
							{pricingPlans.map((plan) => {
								const PlanIcon = plan.icon;

								return (
									<PricingCard.Card className={`login-pricing-card${plan.badge ? ' login-pricing-card--featured' : ''}`} key={plan.name}>
										<PricingCard.Header className="login-pricing-card__header">
											<PricingCard.Plan>
												<PricingCard.PlanName className="login-pricing-card__name">
													<PlanIcon aria-hidden="true" />
													<span>{plan.name}</span>
												</PricingCard.PlanName>
												{plan.badge ? <PricingCard.Badge className="login-pricing-card__badge">{plan.badge}</PricingCard.Badge> : null}
											</PricingCard.Plan>
											<PricingCard.Price className="login-pricing-card__price">
												<PricingCard.MainPrice>{plan.price}</PricingCard.MainPrice>
												<PricingCard.Period>{plan.period}</PricingCard.Period>
											</PricingCard.Price>
										</PricingCard.Header>
										<PricingCard.Body className="login-pricing-card__body">
											<PricingCard.Description className="login-pricing-card__description">{plan.description}</PricingCard.Description>
											<PricingCard.List className="login-pricing-card__features">
												{plan.features.map((feature) => (
													<PricingCard.ListItem className="login-pricing-card__feature" key={feature}>
														<CheckCircle2 aria-hidden="true" />
														<span>{feature}</span>
													</PricingCard.ListItem>
												))}
											</PricingCard.List>
										</PricingCard.Body>
									</PricingCard.Card>
								);
							})}
						</div>
					</section>
				) : null}

				{isHome ? (
					<>
						<section className="login-story" aria-label="Resumen de la plataforma">
							<div className="login-hero-copy">
								<h1>Responde, retoma y recupera oportunidades desde WhatsApp.</h1>
								<p className="login-lead">
									BladeIA reúne conversaciones, clientes, campañas y recuperación de carritos para que tu equipo responda mejor, haga seguimiento a tiempo y deje menos ventas dormidas.
								</p>
							</div>

							<div className="login-dashboard-stack">
								<ProductPreview />
								<div className="login-trust-stats login-trust-stats--under-dashboard">
									{trustStats.map((stat) => (
										<article key={stat.label}>
											<strong>{stat.value}</strong>
											<span>{stat.label}</span>
										</article>
									))}
								</div>
							</div>
						</section>

						<section className="login-trust-section" aria-label="Prueba social">
							<div className="login-metrics login-metrics--below-preview" aria-label="Capacidades principales">
								{capabilityCards.map((metric) => (
									<ProjectCard
										className="login-capability-card"
										description={metric.label}
										imgSrc={metric.image}
										key={metric.value}
										title={metric.value}
									/>
								))}
							</div>
						</section>

						<section className="login-feature-carousel" aria-label="Recorrido por BladeIA">
							<LazyWhenVisible className="login-feature-carousel__lazy" fallback={<div className="login-feature-carousel__placeholder" aria-hidden="true" />}>
								<Suspense fallback={<div className="login-feature-carousel__placeholder" aria-hidden="true" />}>
									<FeatureCarousel image={featureCarouselImages} />
								</Suspense>
							</LazyWhenVisible>
						</section>
					</>
				) : null}
			</main>

			{isLogin ? (
				<section className="login-access-section login-access-section--form-only" aria-labelledby="login-access-title">
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
