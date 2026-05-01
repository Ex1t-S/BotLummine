import jwt from 'jsonwebtoken';
import cookie from 'cookie';
import { prisma } from '../lib/prisma.js';

const cookieName = process.env.AUTH_COOKIE_NAME || 'wa_assistant_token';

export function normalizeRole(value = '') {
	return String(value || '').trim().toUpperCase();
}

export function hasAnyRole(user, allowedRoles = []) {
	if (!user) return false;
	if (!Array.isArray(allowedRoles) || !allowedRoles.length) return true;

	const currentRole = normalizeRole(user.role);
	const normalizedAllowed = allowedRoles.map(normalizeRole);

	return currentRole === 'PLATFORM_ADMIN' || normalizedAllowed.includes(currentRole);
}

export async function attachUser(req, _res, next) {
	try {
		const rawCookieHeader = req.headers?.cookie || '';
		const parsedCookies = req.cookies && Object.keys(req.cookies).length
			? req.cookies
			: cookie.parse(rawCookieHeader || '');

		const token = parsedCookies?.[cookieName];

		if (!token) {
			req.user = null;
			return next();
		}

		const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');

		const user = await prisma.user.findUnique({
			where: { id: payload.sub },
			include: {
				workspace: {
					include: {
						branding: true,
						aiConfig: true,
					},
				},
			},
		});

		req.user = user || null;
		return next();
	} catch (error) {
		console.warn('[AUTH] attachUser failed:', error.message);
		req.user = null;
		return next();
	}
}

export function requireAuth(req, res, next) {
	if (!req.user) {
		return res.status(401).json({
			ok: false,
			error: 'No autenticado'
		});
	}

	if (
		normalizeRole(req.user.role) !== 'PLATFORM_ADMIN' &&
		req.user.workspaceId &&
		req.user.workspace?.status &&
		req.user.workspace.status !== 'ACTIVE'
	) {
		return res.status(403).json({
			ok: false,
			error: 'Workspace inactivo'
		});
	}

	return next();
}

export function requireAnyRole(allowedRoles = []) {
	return (req, res, next) => {
		if (!req.user) {
			return res.status(401).json({
				ok: false,
				error: 'No autenticado'
			});
		}

		if (!hasAnyRole(req.user, allowedRoles)) {
			return res.status(403).json({
				ok: false,
				error: 'No autorizado'
			});
		}

		return next();
	};
}

export const requireAdmin = requireAnyRole(['ADMIN']);
export const requirePlatformAdmin = requireAnyRole(['PLATFORM_ADMIN']);

export function issueAuthCookie(res, user) {
	const token = jwt.sign(
		{
			sub: user.id,
			role: user.role,
			email: user.email,
			workspaceId: user.workspaceId || null,
		},
		process.env.JWT_SECRET || 'dev-secret',
		{ expiresIn: '7d' }
	);

	const cookieOptions = {
		httpOnly: true,
		secure: true,
		sameSite: 'none',
		path: '/',
		maxAge: 7 * 24 * 60 * 60 * 1000
	};

	console.log('[AUTH] cookie issued', {
		cookieName,
		userId: user.id,
		workspaceId: user.workspaceId || null,
	});

	res.cookie(cookieName, token, cookieOptions);
}

export function clearAuthCookie(res) {
	const cookieOptions = {
		httpOnly: true,
		secure: true,
		sameSite: 'none',
		path: '/'
	};

	console.log('[AUTH] cookie cleared', { cookieName });

	res.clearCookie(cookieName, cookieOptions);
}
