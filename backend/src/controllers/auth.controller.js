import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { issueAuthCookie, clearAuthCookie } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import { captureSecurityEvent } from '../lib/sentry.js';
import { verifyTurnstileToken } from '../services/auth/turnstile.service.js';

export async function login(req, res, next) {
	try {
		const { email, password, turnstileToken } = req.body || {};

		if (!email || !password) {
			return res.status(400).json({
				ok: false,
				error: 'Faltan credenciales'
			});
		}

		const turnstile = await verifyTurnstileToken({
			token: turnstileToken,
			ip: String(req.headers?.['cf-connecting-ip'] || req.ip || '').trim(),
			requestId: req.requestId || null,
		});

		if (!turnstile.ok) {
			return res.status(403).json({
				ok: false,
				error: turnstile.error || 'Verificacion anti-bot requerida.'
			});
		}

		const user = await prisma.user.findUnique({
			where: {
				email: String(email).trim().toLowerCase()
			},
			include: {
				workspace: {
					include: {
						branding: true,
						aiConfig: true,
					},
				},
			},
		});

		if (!user) {
			logger.warn('security.login_failed', {
				requestId: req.requestId || null,
				reason: 'unknown_user',
			});
			return res.status(401).json({
				ok: false,
				error: 'Credenciales inválidas'
			});
		}

		const isValid = await bcrypt.compare(password, user.passwordHash);

		if (!isValid) {
			logger.warn('security.login_failed', {
				requestId: req.requestId || null,
				reason: 'invalid_password',
				userId: user.id,
			});
			return res.status(401).json({
				ok: false,
				error: 'Credenciales inválidas'
			});
		}

		if (
			user.role !== 'PLATFORM_ADMIN' &&
			user.workspaceId &&
			user.workspace?.status &&
			user.workspace.status !== 'ACTIVE'
		) {
			captureSecurityEvent('security.login_inactive_workspace', {
				extra: {
					requestId: req.requestId || null,
					userId: user.id,
					workspaceId: user.workspaceId || null,
				},
			});
			return res.status(403).json({
				ok: false,
				error: 'Workspace inactivo'
			});
		}

		issueAuthCookie(res, user);

		return res.json({
			ok: true,
			user: {
				id: user.id,
				email: user.email,
				name: user.name,
				role: user.role,
				workspaceId: user.workspaceId || null,
				workspace: user.workspace
					? {
							id: user.workspace.id,
							name: user.workspace.name,
							slug: user.workspace.slug,
							status: user.workspace.status,
							branding: user.workspace.branding || null,
					  }
					: null,
			}
		});
	} catch (error) {
		next(error);
	}
}

export async function logout(_req, res, next) {
	try {
		clearAuthCookie(res);
		return res.json({ ok: true });
	} catch (error) {
		next(error);
	}
}

export async function me(req, res, next) {
	try {
		if (!req.user) {
			return res.status(401).json({
				ok: false,
				error: 'No autenticado'
			});
		}

		return res.json({
			ok: true,
			user: {
				id: req.user.id,
				email: req.user.email,
				name: req.user.name,
				role: req.user.role,
				workspaceId: req.user.workspaceId || null,
				workspace: req.user.workspace
					? {
							id: req.user.workspace.id,
							name: req.user.workspace.name,
							slug: req.user.workspace.slug,
							status: req.user.workspace.status,
							branding: req.user.workspace.branding || null,
					  }
					: null,
			}
		});
	} catch (error) {
		next(error);
	}
}
