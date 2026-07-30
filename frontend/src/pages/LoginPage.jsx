import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
	ArrowRight,
	CheckCircle2,
	Mail,
	MessageCircle,
	Rocket,
	ShieldCheck,
	Sparkles,
	Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { canAccessRouteForUser, getDefaultRouteForUser } from '../lib/authz.js';
import { getApiErrorMessage } from '../lib/api.js';
import logoBladeIA from '../assets/bladeia-logo.svg';
import showcaseInboxAuto from '../assets/feature-carousel/showcase-inbox-auto.png';
import showcaseInboxPayments from '../assets/feature-carousel/showcase-inbox-payments.png';
import showcaseCampaigns from '../assets/feature-carousel/showcase-campaigns.png';
import showcaseTemplates from '../assets/feature-carousel/showcase-templates.png';
import showcaseCarts from '../assets/feature-carousel/showcase-carts.png';
import showcaseOperations from '../assets/feature-carousel/showcase-operations.png';
import * as PricingCard from '../components/ui/pricing-card.tsx';
import './LoginPage.css';
import './PublicRefresh.css';

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
		idealFor: 'Para equipos que necesitan ordenar la atención diaria.',
		description: 'Para responder mejor, ordenar clientes y no perder conversaciones importantes.',
		features: ['Inbox de WhatsApp centralizado', 'Clientes e historial en una sola vista', 'Respuestas asistidas para ganar tiempo', 'Catálogo conectado a la conversación', 'Resumen simple de la actividad'],
		ctaLabel: 'Consultar por el plan Básico',
	},
	{
		name: 'Avanzado',
		price: 'US$ 80',
		period: '/mes',
		badge: 'M\u00e1s elegido',
		icon: Rocket,
		idealFor: 'Para operaciones que también recuperan y reactivan ventas.',
		description: 'Para retomar conversaciones, recuperar ventas y entender qué acciones generan más respuesta.',
		features: [
			'Todo lo del plan Básico',
			'Campañas para volver a hablar con tus clientes',
			'Audiencias mejor segmentadas',
			'Recuperación de carritos abandonados',
			'Métricas para seguir resultados',
			'Soporte prioritario cuando necesitás avanzar más rápido',
		],
		ctaLabel: 'Consultar por el plan Avanzado',
	},
];

const outcomeItems = [
	{
		icon: MessageCircle,
		title: 'Una sola bandeja para todo el equipo',
		description: 'Separá atención automática, intervención humana y comprobantes sin perder el contexto de cada cliente.',
	},
	{
		icon: Users,
		title: 'Seguimientos que se pueden operar',
		description: 'Creá campañas, elegí audiencias y revisá resultados desde un flujo guiado y trazable.',
	},
	{
		icon: Sparkles,
		title: 'IA con control humano',
		description: 'Automatizá lo repetitivo y derivá al equipo cuando una conversación necesita criterio o una decisión.',
	},
];

const workflowSteps = [
	{ number: '01', title: 'Conectá tu operación', description: 'Centralizá WhatsApp, clientes, catálogo y reglas del negocio.' },
	{ number: '02', title: 'Definí cómo atender', description: 'Elegí qué resuelve la IA y cuándo debe intervenir una persona.' },
	{ number: '03', title: 'Medí y mejorá', description: 'Revisá prioridades, campañas y oportunidades desde el mismo panel.' },
];

const productProofPoints = [
	'Bandeja compartida',
	'Campañas y carritos',
	'Control humano cuando hace falta',
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

const publicMeta = {
	'/inicio': {
		title: 'BladeIA | Operación comercial desde WhatsApp',
		description: 'Centralizá WhatsApp, campañas, clientes y recuperación de oportunidades desde una sola plataforma.',
	},
	'/precios': {
		title: 'Planes y precios | BladeIA',
		description: 'Compará los planes de BladeIA y elegí el alcance que mejor acompaña a tu operación comercial.',
	},
	'/contacto': {
		title: 'Contacto | BladeIA',
		description: 'Contanos cómo trabaja tu equipo y conversemos sobre una implementación de BladeIA.',
	},
	'/login': {
		title: 'Ingresar | BladeIA',
		description: 'Acceso seguro al panel operativo de BladeIA.',
	},
};

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
				<div className="login-product-preview__window-controls" aria-hidden="true">
					<span />
					<span />
					<span />
				</div>
				<strong>Bandeja compartida</strong>
				<span className="login-product-preview__live">Vista del producto</span>
			</div>
			<div className="login-product-preview__image">
				<img
					src={showcaseInboxAuto}
					alt="Bandeja de BladeIA con lista de conversaciones y chat activo"
					width="1280"
					height="800"
					decoding="async"
					fetchPriority="high"
				/>
			</div>
			<div className="login-product-preview__footer">
				<span>Automático</span>
				<span>Atención humana</span>
				<span>Comprobantes</span>
			</div>
		</aside>
	);
}

function LoginForm({ error, form, onChange, onSubmit, showPassword, submitting, togglePassword }) {
	return (
		<form className="login-card login-card--centered" onSubmit={onSubmit} aria-describedby={error ? 'login-error' : undefined}>
			<div className="login-card__header">
				<span className="login-card__brand">
					<span aria-hidden="true">
						<img src={logoBladeIA} alt="" />
					</span>
					BladeIA
				</span>
				<div>
					<h1 id="login-access-title">Ingresá a tu espacio</h1>
					<p>Continuá donde dejó tu equipo.</p>
				</div>
			</div>

			<div className="login-field">
				<label htmlFor="login-email">Email</label>
				<div className="login-input-shell">
					<input
						id="login-email"
						type="email"
						autoComplete="email"
						placeholder="nombre@empresa.com"
						value={form.email}
						onChange={(e) => onChange({ ...form, email: e.target.value })}
						aria-invalid={Boolean(error)}
						aria-describedby={error ? 'login-error' : undefined}
						required
					/>
				</div>
			</div>

			<div className="login-field">
				<label htmlFor="login-password">Contraseña</label>
				<div className="login-password-control">
					<input
						id="login-password"
						type={showPassword ? 'text' : 'password'}
						autoComplete="current-password"
						placeholder="********"
						value={form.password}
						onChange={(e) => onChange({ ...form, password: e.target.value })}
						aria-invalid={Boolean(error)}
						aria-describedby={error ? 'login-error' : undefined}
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
			</div>

			{error ? (
				<p className="login-error" id="login-error" role="alert">
					{error}
				</p>
			) : null}

			<button className="login-submit" type="submit" disabled={submitting || !form.email || !form.password}>
				<strong>{submitting ? 'Ingresando...' : 'Ingresar'}</strong>
			</button>

			<p className="login-help">
				¿Tenés problemas para ingresar? <Link to="/contacto">Contactanos</Link>
			</p>
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
	const requestedPlan = new URLSearchParams(location.search).get('plan');
	const selectedPlan = pricingPlans.some((plan) => plan.name === requestedPlan) ? requestedPlan : '';

	const [form, setForm] = useState({ email: '', password: '' });
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [navScrolled, setNavScrolled] = useState(false);
	const [mobileNavOpen, setMobileNavOpen] = useState(false);
	const mobileNavButtonRef = useRef(null);
	const mobileNavRef = useRef(null);
	const pointerFrameRef = useRef(0);
	const pointerPositionRef = useRef({ x: '50%', y: '42%' });

	const requestedPath = location.state?.from?.pathname || '';
	const redirectTo = resolveRedirectPath(user, requestedPath);
	const accessPath = user ? redirectTo : '/login';
	const accessLabel = user ? 'Dashboard' : 'Ingresar';

	useEffect(() => {
		const metadata = publicMeta[publicPath] || publicMeta['/inicio'];
		document.title = metadata.title;

		function setMeta(name, content, attribute = 'name') {
			let element = document.head.querySelector(`meta[${attribute}="${name}"]`);
			if (!element) {
				element = document.createElement('meta');
				element.setAttribute(attribute, name);
				document.head.appendChild(element);
			}
			element.setAttribute('content', content);
		}

		setMeta('description', metadata.description);
		setMeta('og:title', metadata.title, 'property');
		setMeta('og:description', metadata.description, 'property');
		setMeta('robots', isLogin ? 'noindex, nofollow' : 'index, follow');
	}, [isLogin, publicPath]);

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
		if (!mobileNavOpen) return undefined;

		const mobileNav = mobileNavRef.current;
		const focusFirstLinkFrame = window.requestAnimationFrame(() => {
			mobileNav?.querySelector('.login-mobile-nav__link')?.focus();
		});

		function handleMobileNavKeyDown(event) {
			if (event.key === 'Escape') {
				event.preventDefault();
				setMobileNavOpen(false);
				window.requestAnimationFrame(() => mobileNavButtonRef.current?.focus());
				return;
			}

			if (event.key !== 'Tab' || !mobileNav) return;
			const focusable = [...mobileNav.querySelectorAll('a[href], button:not([disabled])')]
				.filter((element) => element.tabIndex >= 0);
			if (!focusable.length) return;

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		}

		document.addEventListener('keydown', handleMobileNavKeyDown);
		return () => {
			window.cancelAnimationFrame(focusFirstLinkFrame);
			document.removeEventListener('keydown', handleMobileNavKeyDown);
		};
	}, [mobileNavOpen]);

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
							{!user ? (
								<Link className="login-nav__cta" to="/contacto">
									Solicitar demo
								</Link>
							) : null}
							<Link className="login-nav__login" to={accessPath}>
								{accessLabel}
							</Link>
						</div>

						<button
							ref={mobileNavButtonRef}
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

				<div
					ref={mobileNavRef}
					id="mobile-nav"
					className={`login-mobile-nav${mobileNavOpen ? ' is-open' : ''}`}
					role="dialog"
					aria-modal="true"
					aria-label="Navegación móvil"
					aria-hidden={!mobileNavOpen}
				>
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
							{!user ? (
								<Link to="/contacto" tabIndex={mobileNavOpen ? 0 : -1}>
									Solicitar demo
								</Link>
							) : null}
							<Link to={accessPath} tabIndex={mobileNavOpen ? 0 : -1}>
								{accessLabel}
							</Link>
						</div>
					</nav>
				</div>
			</header>

			<main className="login-shell">
				{publicPath === '/contacto' ? (
					<section className="public-section public-section--single public-contact" aria-labelledby="contact-title">
						<div className="public-page-heading">
							<span className="public-eyebrow">Contacto</span>
							<h1 id="contact-title">Veamos cómo ordenar tu operación.</h1>
							<p className="login-lead">
								Contanos cómo atiende hoy tu equipo, qué tareas se repiten y dónde se pierden oportunidades. Te ayudamos a evaluar un próximo paso concreto.
							</p>
							{selectedPlan ? <p className="contact-plan-context">Consulta por {selectedPlan}</p> : null}
						</div>

						<div className="contact-choice-grid" aria-label="Canales de contacto">
							<a className="contact-choice contact-choice--primary" href="https://wa.me/5492923562286" target="_blank" rel="noopener noreferrer">
								<MessageCircle aria-hidden="true" />
								<span>WhatsApp</span>
								<strong>Conversar con el equipo</strong>
								<small>+54 9 2923 562286</small>
								<ArrowRight aria-hidden="true" className="contact-choice__arrow" />
							</a>

							<div className="contact-choice contact-choice--emails">
								<Mail aria-hidden="true" />
								<span>Email</span>
								<strong>Enviar una consulta</strong>
								<a href="mailto:germanarroyo016@gmail.com">germanarroyo016@gmail.com</a>
								<a href="mailto:mendozatomas600@gmail.com">mendozatomas600@gmail.com</a>
							</div>
						</div>

						<div className="contact-prep">
							<ShieldCheck aria-hidden="true" />
							<div>
								<h2>Para aprovechar la conversación</h2>
								<p>Podés contarnos cuántas personas atienden, qué canal usan y cuál es hoy el mayor cuello de botella.</p>
							</div>
						</div>
					</section>
				) : null}

				{publicPath === '/precios' ? (
					<section className="public-section public-section--single public-pricing" aria-labelledby="pricing-title">
						<div className="public-page-heading">
							<span className="public-eyebrow">Planes</span>
							<h1 id="pricing-title">Un plan claro para cada etapa.</h1>
							<p className="login-lead">
								Empezá por ordenar la atención y sumá recuperación comercial cuando tu operación lo necesite.
							</p>
						</div>

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
											<p className="login-pricing-card__ideal">{plan.idealFor}</p>
											<PricingCard.Description className="login-pricing-card__description">{plan.description}</PricingCard.Description>
											<PricingCard.List className="login-pricing-card__features">
												{plan.features.map((feature) => (
													<PricingCard.ListItem className="login-pricing-card__feature" key={feature}>
														<CheckCircle2 aria-hidden="true" />
														<span>{feature}</span>
													</PricingCard.ListItem>
												))}
											</PricingCard.List>
											<Link className="login-pricing-card__cta" to={`/contacto?plan=${encodeURIComponent(plan.name)}`}>
												{plan.ctaLabel}
												<ArrowRight aria-hidden="true" />
											</Link>
										</PricingCard.Body>
									</PricingCard.Card>
								);
							})}
						</div>

						<div className="pricing-guidance">
							<div>
								<strong>¿No sabés cuál elegir?</strong>
								<span>Revisamos tu flujo actual y te indicamos qué alcance tiene sentido antes de activar.</span>
							</div>
							<Link to="/contacto">Hablar con el equipo <ArrowRight aria-hidden="true" /></Link>
						</div>
					</section>
				) : null}

				{isHome ? (
					<>
						<section className="login-story" aria-label="Resumen de la plataforma">
							<div className="login-hero-copy">
								<span className="public-eyebrow">Operación comercial en WhatsApp</span>
								<h1>Convertí conversaciones en trabajo comercial ordenado.</h1>
								<p className="login-lead">
									BladeIA reúne bandeja, clientes, campañas y carritos para que tu equipo sepa qué atender, qué seguir y cuándo debe intervenir una persona.
								</p>

								<div className="login-hero-actions">
									<Link className="login-primary-cta" to="/contacto">
										Solicitar una demo <ArrowRight aria-hidden="true" />
									</Link>
									<Link className="login-secondary-cta" to="/precios">Ver planes</Link>
								</div>

								<div className="login-hero-checks" aria-label="Funciones incluidas">
									{productProofPoints.map((point) => <span key={point}>{point}</span>)}
								</div>
							</div>

							<ProductPreview />
						</section>

						<section className="public-outcomes" aria-labelledby="outcomes-title">
							<div className="public-section-heading">
								<span className="public-eyebrow">Menos fricción operativa</span>
								<h2 id="outcomes-title">Cada función tiene una decisión detrás.</h2>
							</div>
							<div className="public-outcomes__grid">
								{outcomeItems.map((item) => {
									const OutcomeIcon = item.icon;
									return (
										<article key={item.title}>
											<OutcomeIcon aria-hidden="true" />
											<h3>{item.title}</h3>
											<p>{item.description}</p>
										</article>
									);
								})}
							</div>
						</section>

						<section className="login-feature-carousel" aria-label="Recorrido por BladeIA">
							<div className="public-section-heading">
								<span className="public-eyebrow">Producto real</span>
								<h2>Recorré los flujos que usa el equipo todos los días.</h2>
								<p>Las vistas usan datos sintéticos y muestran el producto sin información de clientes reales.</p>
							</div>
							<LazyWhenVisible className="login-feature-carousel__lazy" fallback={<div className="login-feature-carousel__placeholder" aria-hidden="true" />}>
								<Suspense fallback={<div className="login-feature-carousel__placeholder" aria-hidden="true" />}>
									<FeatureCarousel image={featureCarouselImages} />
								</Suspense>
							</LazyWhenVisible>
						</section>

						<section className="public-workflow" aria-labelledby="workflow-title">
							<div className="public-section-heading">
								<span className="public-eyebrow">Implementación</span>
								<h2 id="workflow-title">Un recorrido entendible desde el primer día.</h2>
							</div>
							<ol>
								{workflowSteps.map((step) => (
									<li key={step.number}>
										<span>{step.number}</span>
										<h3>{step.title}</h3>
										<p>{step.description}</p>
									</li>
								))}
							</ol>
						</section>

						<section className="public-final-cta" aria-labelledby="final-cta-title">
							<div>
								<span className="public-eyebrow">Próximo paso</span>
								<h2 id="final-cta-title">Mostranos cómo trabaja tu equipo.</h2>
								<p>Te ayudamos a identificar qué conviene centralizar primero y qué puede esperar.</p>
							</div>
							<Link className="login-primary-cta" to="/contacto">Solicitar una demo <ArrowRight aria-hidden="true" /></Link>
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
							<p>Operación comercial con IA para centralizar WhatsApp, clientes, campañas y oportunidades.</p>
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
						<Link className="login-footer__contact-link" to="/contacto">Hablar con el equipo</Link>
					</div>
				</div>
			</footer>
		</div>
	);
}
