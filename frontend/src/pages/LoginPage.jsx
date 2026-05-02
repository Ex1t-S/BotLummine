import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canAccessRoute, getDefaultRouteForRole } from '../lib/authz.js';
import './LoginPage.css';

const pricingPlans = [
	{
		name: 'Basico',
		price: 'A definir',
		description: 'Para ordenar la atencion diaria y centralizar clientes desde WhatsApp.',
		features: [
			'Inbox de WhatsApp',
			'CRM de clientes',
			'Respuestas asistidas',
			'Catalogo conectado',
			'Reportes basicos',
		],
	},
	{
		name: 'Avanzado',
		price: 'A definir',
		description: 'Para crecer con automatizaciones, campanas y medicion comercial.',
		features: [
			'Todo lo del plan Basico',
			'Campanas por WhatsApp API',
			'Segmentacion de audiencias',
			'Recuperacion de carritos',
			'Metricas avanzadas y atribucion',
			'Soporte prioritario',
		],
	},
];

const featureCards = [
	{
		title: 'Entende cada conversacion',
		description: 'Centraliza inbox, clientes y contexto comercial para responder con mas precision.',
	},
	{
		title: 'Activa campanas medibles',
		description: 'Segmenta audiencias y lanza mensajes por WhatsApp API con seguimiento comercial.',
	},
	{
		title: 'Opera con continuidad',
		description: 'Combina asistencia 24/7, CRM y catalogo para que el equipo venda sin perder historial.',
	},
];

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
			setError(err.response?.data?.error || 'No se pudo iniciar sesion');
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="login-page">
			<div className="login-orb login-orb--one" aria-hidden="true" />
			<div className="login-orb login-orb--two" aria-hidden="true" />
			<div className="login-grid" aria-hidden="true" />
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

			<header className="public-nav">
				<Link className="public-nav__brand" to="/inicio" aria-label="Ir a inicio">
					<span className="login-brand-chip__dot" />
					Lummine Commerce AI
				</Link>
				<nav className="public-nav__links" aria-label="Navegacion publica">
					<Link className={publicPath === '/inicio' ? 'active' : ''} to="/inicio">
						Inicio
					</Link>
					<Link className={publicPath === '/contacto' ? 'active' : ''} to="/contacto">
						Contacto
					</Link>
					<Link className={publicPath === '/precios' ? 'active' : ''} to="/precios">
						Precios
					</Link>
				</nav>
			</header>

			<main className="login-shell">
				{publicPath === '/contacto' ? (
					<section className="public-section public-section--single" aria-labelledby="contact-title">
						<p className="login-eyebrow">Contacto</p>
						<h1 id="contact-title">Hablemos de tu operacion comercial.</h1>
						<p className="login-lead">
							Dejanos tus datos o escribinos por los canales principales para evaluar como conectar WhatsApp,
							ventas y campanas en tu marca.
						</p>

						<div className="contact-grid">
							<article className="contact-card">
								<span>Email</span>
								<strong>contacto@tumarca.com</strong>
							</article>
							<article className="contact-card">
								<span>Telefono</span>
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
							El plan Basico ordena la atencion y el CRM. El Avanzado suma campanas, automatizacion y
							medicion para escalar ventas.
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

				{publicPath !== '/contacto' && publicPath !== '/precios' ? (
					<>
						<section className="login-story" aria-label="Resumen de la plataforma">
							<div className="login-brand-chip">
								<span className="login-brand-chip__dot" />
								Lummine Commerce AI
							</div>

							<div>
								<p className="login-eyebrow">Panel operativo</p>
								<h1>Gestiona WhatsApp, ventas y campanas de marketing.</h1>
							</div>

							<div className="login-metrics" aria-label="Capacidades principales">
								<div>
									<strong>24/7</strong>
									<span>asistencia IA</span>
								</div>
								<div>
									<strong>CRM</strong>
									<span>clientes y seguimiento</span>
								</div>
								<div>
									<strong>API</strong>
									<span>campanas por WhatsApp</span>
								</div>
							</div>
						</section>

						<form className="login-card" onSubmit={handleSubmit}>
							<div className="login-card__header">
								<h2>Entra a tu workspace</h2>
							</div>

							<label className="login-field">
								<span>Email</span>
								<input
									type="email"
									autoComplete="email"
									placeholder="usuario@empresa.com"
									value={form.email}
									onChange={(e) => setForm({ ...form, email: e.target.value })}
									aria-invalid={Boolean(error)}
									required
								/>
							</label>

							<label className="login-field">
								<span>Contrasena</span>
								<div className="login-password-control">
									<input
										type={showPassword ? 'text' : 'password'}
										autoComplete="current-password"
										placeholder="Tu contrasena"
										value={form.password}
										onChange={(e) => setForm({ ...form, password: e.target.value })}
										aria-invalid={Boolean(error)}
										required
									/>
									<button
										type="button"
										className="login-password-toggle"
										onClick={() => setShowPassword((current) => !current)}
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
								<span>{submitting ? 'Validando acceso...' : 'Ingresar al panel'}</span>
								<i aria-hidden="true">-&gt;</i>
							</button>
						</form>
					</>
				) : null}
			</main>

			{publicPath !== '/contacto' && publicPath !== '/precios' ? (
				<section className="product-showcase" aria-label="Vista previa de la plataforma">
					<div className="product-window">
						<div className="product-window__topbar">
							<span />
							<span />
							<span />
							<strong>Lummine workspace</strong>
						</div>
						<div className="product-window__body">
							<aside className="product-sidebar" aria-hidden="true">
								<span className="active" />
								<span />
								<span />
								<span />
							</aside>
							<div className="product-panel product-panel--main">
								<div className="product-panel__header">
									<span>Inbox comercial</span>
									<strong>Automatico</strong>
								</div>
								<div className="product-message product-message--inbound">
									<p>Necesito ayuda para elegir talle y consultar envio.</p>
								</div>
								<div className="product-message product-message--outbound">
									<p>Te ayudo. Tengo tu historial, catalogo y stock actualizados.</p>
								</div>
								<div className="product-composer">
									<span>Respuesta sugerida por IA</span>
									<button type="button">Enviar</button>
								</div>
							</div>
							<div className="product-panel product-panel--side">
								<span>CRM</span>
								<strong>Cliente activo</strong>
								<div className="product-chart" aria-hidden="true">
									<i />
								</div>
								<ul>
									<li>Campana: recuperacion</li>
									<li>Ultimo pedido: hace 12 dias</li>
									<li>Canal: WhatsApp API</li>
								</ul>
							</div>
						</div>
					</div>

					<div className="feature-strip">
						{featureCards.map((feature) => (
							<article className="feature-card" key={feature.title}>
								<h2>{feature.title}</h2>
								<p>{feature.description}</p>
							</article>
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}
