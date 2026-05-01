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
			<div className="login-grid" aria-hidden="true" />

			<main className="login-shell">
				<section className="login-story" aria-label="Resumen de la plataforma">
					<div className="login-brand">
						<span className="login-brand__mark" aria-hidden="true">AI</span>
						<div>
							<strong>Commerce AI</strong>
							<span>Acceso multi-marca</span>
						</div>
					</div>

					<div>
						<p className="login-eyebrow">Panel operativo multi-marca</p>
						<h1>Gestiona WhatsApp, ventas y clientes de cada marca.</h1>
						<p className="login-lead">
							Ingresa con tu usuario y accede al workspace correspondiente para operar inbox, campanas, catalogo y automatizaciones.
						</p>
					</div>

					<div className="login-metrics" aria-label="Capacidades principales">
						<div>
							<strong>24/7</strong>
							<span>Asistencia IA</span>
						</div>
						<div>
							<strong>Multi</strong>
							<span>Marca</span>
						</div>
						<div>
							<strong>Live</strong>
							<span>Tracking</span>
						</div>
					</div>

					<div className="login-flow-card">
						<div className="login-flow-card__header">
							<span>Estado del ecosistema</span>
							<strong>Sincronizado</strong>
						</div>
						<div className="login-flow-list">
							<span>WhatsApp</span>
							<span>Tiendanube</span>
							<span>Campanas</span>
						</div>
					</div>
				</section>

				<form className="login-card" onSubmit={handleSubmit}>
					<div className="login-card__header">
						<span className="login-card__kicker">Acceso seguro</span>
						<h2>Ingresar al workspace</h2>
						<p>La cuenta define a que marca y permisos accedes.</p>
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

					<p className="login-footnote">
						Sesion protegida para equipos autorizados.
					</p>
				</form>
			</main>
		</div>
	);
}
