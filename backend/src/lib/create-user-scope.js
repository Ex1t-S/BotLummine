const ALLOWED_USER_ROLES = new Set(['PLATFORM_ADMIN', 'ADMIN', 'AGENT']);

export function resolveCreateUserScope({ role = 'AGENT', workspaceId = '' } = {}) {
	const normalizedRole = String(role || 'AGENT').trim().toUpperCase();
	if (!ALLOWED_USER_ROLES.has(normalizedRole)) {
		const error = new Error('El rol debe ser PLATFORM_ADMIN, ADMIN o AGENT.');
		error.code = 'INVALID_USER_ROLE';
		throw error;
	}

	if (normalizedRole === 'PLATFORM_ADMIN') {
		return { role: normalizedRole, workspaceId: null };
	}

	const normalizedWorkspaceId = String(workspaceId || '').trim();
	if (!normalizedWorkspaceId) {
		const error = new Error('workspaceId es obligatorio para crear usuarios ADMIN o AGENT.');
		error.code = 'WORKSPACE_SCOPE_REQUIRED';
		throw error;
	}

	return { role: normalizedRole, workspaceId: normalizedWorkspaceId };
}
