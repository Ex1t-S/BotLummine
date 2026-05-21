export const ROLE_ADMIN = 'ADMIN';
export const ROLE_AGENT = 'AGENT';
export const ROLE_PLATFORM_ADMIN = 'PLATFORM_ADMIN';
const AI_LAB_WORKSPACE_SLUGS = new Set(['dkv-seguros']);
const AI_LAB_ONLY_WORKSPACE_SLUGS = new Set(['dkv-seguros']);

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

export function isAiLabOnlyWorkspace(user = null) {
	return AI_LAB_ONLY_WORKSPACE_SLUGS.has(String(user?.workspace?.slug || '').trim());
}

export function canUseAiLab(user = null) {
	if (isPlatformAdminUser(user)) return true;
	return AI_LAB_WORKSPACE_SLUGS.has(String(user?.workspace?.slug || '').trim());
}

export function getDefaultRouteForRole(role = '') {
	if (normalizeRole(role) === ROLE_PLATFORM_ADMIN) return '/operations';
	return isAdminRole(role) ? '/operations' : '/inbox/automatico';
}

export function getDefaultRouteForUser(user = null) {
	if (isAiLabOnlyWorkspace(user)) return '/ai-lab';
	return getDefaultRouteForRole(user?.role);
}

export function canAccessRoute(role = '', path = '/') {
	const normalizedPath = String(path || '/').trim();

	if (isAdminRole(role)) {
		return true;
	}

	return normalizedPath === '/' || normalizedPath.startsWith('/inbox');
}

export function canAccessRouteForUser(user = null, path = '/') {
	const normalizedPath = String(path || '/').trim();

	if (normalizedPath.startsWith('/ai-lab')) {
		return canUseAiLab(user);
	}

	if (isAiLabOnlyWorkspace(user)) {
		return normalizedPath === '/' || normalizedPath.startsWith('/ai-lab');
	}

	return canAccessRoute(user?.role, normalizedPath);
}
