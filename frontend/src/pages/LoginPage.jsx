import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canAccessRoute, getDefaultRouteForRole } from '../lib/authz.js';
import './LoginPage.css';

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

	const [form, setForm] = useState({
		email: '',
		password: '',
	});
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [pointer, setPointer] = useState({ x: 50, y: 45 });

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

	function handlePointerMove(event) {
		const rect = event.currentTarget.getBoundingClientRect();
		setPointer({
			x: Math.round(((event.clientX - rect.left) / rect.width) * 100),
			y: Math.round(((event.clientY - rect.top) / rect.height) * 100),
		});
	}

	return (
		<div
			className="login-page"
			style={{ '--pointer-x': `${pointer.x}%`, '--pointer-y': `${pointer.y}%` }}
			onPointerMove={handlePointerMove}
		>
			<div className="login-orb login-orb--one" aria-hidden="true" />
			<div className="login-orb login-orb--two" aria-hidden="true" />
			<div className="login-grid" aria-hidden="true" />
			<div className="login-signal-field" aria-hidden="true">
				<span />
				<span />
				<span />
				<span />
				<span />
			</div>

			<main className="login-shell">
				<section className="login-story" aria-label="Resumen de la plataforma">
					<div className="login-brand-chip">
						<span className="login-brand-chip__dot" />
						Lummine Commerce AI
					</div>

					<div>
						<p className="login-eyebrow">Panel operativo</p>
						<h1>Ventas conversacionales con senales en tiempo real.</h1>
						<p className="login-lead">
							Un acceso central para inbox, campanas, clientes, catalogo y automatizacion de WhatsApp.
						</p>
					</div>

					<div className="login-metrics" aria-label="Capacidades principales">
						<div>
							<strong>24/7</strong>
							<span>asistencia IA</span>
						</div>
						<div>
							<strong>Multi</strong>
							<span>marca</span>
						</div>
						<div>
							<strong>Live</strong>
							<span>tracking</span>
						</div>
					</div>

					<div className="login-flow-card">
						<div className="login-flow-card__header">
							<span>Estado del ecosistema</span>
							<strong>Sincronizado</strong>
						</div>
						<div className="login-flow-list">
							<span>WhatsApp conectado</span>
							<span>Tiendanube preparada</span>
							<span>Campanas auditables</span>
						</div>
					</div>
				</section>

				<form className="login-card" onSubmit={handleSubmit}>
					<div className="login-card__header">
						<span className="login-card__kicker">Acceso seguro</span>
						<h2>Entra a tu workspace</h2>
						<p>Usa tus credenciales internas para continuar al panel de operacion.</p>
					</div>

					<label className="login-field">
						<span>Correo de acceso</span>
						<input
							type="email"
							autoComplete="email"
							placeholder="nombre@marca.com"
							value={form.email}
							onChange={(e) => setForm({ ...form, email: e.target.value })}
						/>
					</label>

					<label className="login-field">
						<span>Clave segura</span>
						<input
							type="password"
							autoComplete="current-password"
							placeholder="Tu clave privada"
							value={form.password}
							onChange={(e) => setForm({ ...form, password: e.target.value })}
						/>
					</label>

					{error ? (
						<p className="login-error" role="alert">
							{error}
						</p>
					) : null}

					<button className="login-submit" type="submit" disabled={submitting}>
						<span>{submitting ? 'Validando acceso...' : 'Ingresar al panel'}</span>
						<i aria-hidden="true">-&gt;</i>
					</button>

					<p className="login-footnote">
						Acceso protegido para equipos autorizados. Las sesiones se validan con cookies seguras.
					</p>
				</form>
			</main>
		</div>
	);
}
