import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { getDefaultRouteForRole, normalizeRole } from '../lib/authz.js';
import BrandLoader from './ui/BrandLoader.jsx';

export default function ProtectedRoute({ children, allowedRoles = null }) {
	const { user, loading } = useAuth();
	const location = useLocation();

	if (loading) {
		return <BrandLoader label="Cargando" />;
	}

	if (!user) {
		return <Navigate to="/inicio" replace state={{ from: location }} />;
	}

	if (Array.isArray(allowedRoles) && allowedRoles.length) {
		const currentRole = normalizeRole(user.role);
		const normalizedAllowed = allowedRoles.map(normalizeRole);

		if (currentRole !== 'PLATFORM_ADMIN' && !normalizedAllowed.includes(currentRole)) {
			return <Navigate to={getDefaultRouteForRole(user.role)} replace />;
		}
	}

	return children;
}
