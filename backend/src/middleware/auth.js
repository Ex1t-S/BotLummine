import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

const cookieName = process.env.COOKIE_NAME || 'wa_assistant_token';

export async function attachUser(req, _res, next) {
	try {
		const token = req.cookies?.[cookieName];

		if (!token) {
			req.user = null;
			return next();
		}

		const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');

		const user = await prisma.user.findUnique({
			where: { id: payload.sub }
		});

		req.user = user || null;
		return next();
	} catch {
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

	res.cookie(cookieName, token, {
		httpOnly: true,
		sameSite: 'lax',
		secure: false,
		maxAge: 7 * 24 * 60 * 60 * 1000
	});
}

export function clearAuthCookie(res) {
	res.clearCookie(cookieName);
}