const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isEnabled(value) {
	return String(value || '').trim().toLowerCase() === 'true';
}

export function inspectDatabaseTarget(rawUrl = '') {
	if (!String(rawUrl || '').trim()) {
		return { configured: false, host: '', isLocal: false };
	}

	try {
		const url = new URL(rawUrl);
		return {
			configured: true,
			host: url.hostname,
			isLocal: LOCAL_DATABASE_HOSTS.has(url.hostname.toLowerCase()),
		};
	} catch {
		return { configured: true, host: '', isLocal: false };
	}
}

export function assertSafeDatabaseTarget(env = process.env) {
	const target = inspectDatabaseTarget(env.DATABASE_URL);
	if (!target.configured || target.isLocal) return target;

	const isManagedRailwayEnvironment = Boolean(
		String(env.RAILWAY_ENVIRONMENT_ID || '').trim() ||
		String(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT || '').trim()
	);
	const isExplicitProductionRuntime = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
	const remoteDevelopmentAllowed = isEnabled(env.ALLOW_REMOTE_DATABASE_IN_DEVELOPMENT);

	if (isManagedRailwayEnvironment || isExplicitProductionRuntime || remoteDevelopmentAllowed) {
		return target;
	}

	const error = new Error(
		'Inicio bloqueado: DATABASE_URL apunta a una base remota fuera de un entorno administrado. ' +
		'Usa PostgreSQL local o define ALLOW_REMOTE_DATABASE_IN_DEVELOPMENT=true de forma consciente.'
	);
	error.code = 'UNSAFE_REMOTE_DATABASE_TARGET';
	throw error;
}
