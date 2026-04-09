import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { getDefaultRouteForRole, normalizeRole } from '../lib/authz.js';

export default function ProtectedRoute({ children, allowedRoles = null }) {
	const { user, loading } = useAuth();
	const location = useLocation();

	if (loading) {
		return (
			<div className="page-center">
				<div className="card">
					<h2>Cargando sesión...</h2>
				</div>
			</div>
		);
	}

	if (!user) {
		return <Navigate to="/login" replace state={{ from: location }} />;
	}

	if (Array.isArray(allowedRoles) && allowedRoles.length) {
		const currentRole = normalizeRole(user.role);
		const normalizedAllowed = allowedRoles.map(normalizeRole);

		if (!normalizedAllowed.includes(currentRole)) {
			return <Navigate to={getDefaultRouteForRole(user.role)} replace />;
		}
	}

	return children;
}
