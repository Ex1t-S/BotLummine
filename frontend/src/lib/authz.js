export const ROLE_ADMIN = 'ADMIN';
export const ROLE_AGENT = 'AGENT';

export function normalizeRole(role = '') {
	return String(role || '').trim().toUpperCase();
}

export function isAdminRole(role = '') {
	return normalizeRole(role) === ROLE_ADMIN;
}

export function isAdminUser(user = null) {
	return isAdminRole(user?.role);
}

export function getDefaultRouteForRole(role = '') {
	return isAdminRole(role) ? '/catalog' : '/inbox';
}

export function canAccessRoute(role = '', path = '/') {
	const normalizedPath = String(path || '/').trim();

	if (isAdminRole(role)) {
		return true;
	}

	return normalizedPath === '/' || normalizedPath.startsWith('/inbox');
}
