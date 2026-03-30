import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

const cookieName = process.env.COOKIE_NAME || 'wa_assistant_token';

export async function attachUser(req, _res, next) {
	try {
		const token = req.cookies?.[cookieName];
		console.log('[AUTH] origin:', req.headers.origin);
		console.log('[AUTH] cookie present:', Boolean(token));

		if (!token) {
			req.user = null;
			return next();
		}

		const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
		console.log('[AUTH] payload sub:', payload.sub);

		const user = await prisma.user.findUnique({
			where: { id: payload.sub },
		});

		console.log('[AUTH] user found:', Boolean(user));

		req.user = user || null;
		return next();
	} catch (error) {
		console.log('[AUTH] attachUser error:', error.message);
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

	return next();
}

export function issueAuthCookie(res, user) {
	const token = jwt.sign(
		{ sub: user.id, role: user.role, email: user.email },
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

	console.log('---------------- AUTH COOKIE ISSUE ----------------');
	console.log('[AUTH] seteando cookie:', cookieName);
	console.log('[AUTH] para user id:', user.id);
	console.log('[AUTH] para email:', user.email);
	console.log('[AUTH] cookie options:', cookieOptions);

	res.cookie(cookieName, token, cookieOptions);
}

export function clearAuthCookie(res) {
	const cookieOptions = {
		httpOnly: true,
		secure: true,
		sameSite: 'none',
		path: '/'
	};

	console.log('---------------- AUTH COOKIE CLEAR ----------------');
	console.log('[AUTH] limpiando cookie:', cookieName);
	console.log('[AUTH] cookie options:', cookieOptions);

	res.clearCookie(cookieName, cookieOptions);
}

export function clearAuthCookie(res) {
	res.clearCookie(cookieName);
}