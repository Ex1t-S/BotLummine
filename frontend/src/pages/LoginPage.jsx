import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canAccessRoute, getDefaultRouteForRole } from '../lib/authz.js';

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
		password: ''
	});
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);

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

	return (
		<div className="page-center login-page">
			<form className="card login-card" onSubmit={handleSubmit}>
				<h2>Ingresar</h2>

				<input
					type="email"
					placeholder="Email"
					value={form.email}
					onChange={(e) => setForm({ ...form, email: e.target.value })}
				/>

				<input
					type="password"
					placeholder="Contraseña"
					value={form.password}
					onChange={(e) => setForm({ ...form, password: e.target.value })}
				/>

				{error ? <p className="error-text">{error}</p> : null}

				<button type="submit" disabled={submitting}>
					{submitting ? 'Ingresando...' : 'Entrar'}
				</button>
			</form>
		</div>
	);
}
