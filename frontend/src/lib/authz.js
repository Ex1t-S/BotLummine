export const ROLE_ADMIN = 'ADMIN';
export const ROLE_AGENT = 'AGENT';
export const ROLE_PLATFORM_ADMIN = 'PLATFORM_ADMIN';

export function normalizeRole(role = '') {
	return String(role || '').trim().toUpperCase();
}

export function isAdminRole(role = '') {
	return [ROLE_ADMIN, ROLE_PLATFORM_ADMIN].includes(normalizeRole(role));
}

export function isAdminUser(user = null) {
	return isAdminRole(user?.role);
}

export function isPlatformAdminUser(user = null) {
	return normalizeRole(user?.role) === ROLE_PLATFORM_ADMIN;
}

export function getDefaultRouteForRole(role = '') {
	if (normalizeRole(role) === ROLE_PLATFORM_ADMIN) return '/admin';
	return isAdminRole(role) ? '/catalog' : '/inbox/automatico';
}

export function canAccessRoute(role = '', path = '/') {
	const normalizedPath = String(path || '/').trim();

	if (isAdminRole(role)) {
		return true;
	}

	return normalizedPath === '/' || normalizedPath.startsWith('/inbox');
}
