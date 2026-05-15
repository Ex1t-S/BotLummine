import { logger } from '../../lib/logger.js';
import { captureSecurityEvent } from '../../lib/sentry.js';

function isTurnstileRequired() {
	return String(process.env.TURNSTILE_REQUIRED || 'false').trim().toLowerCase() === 'true';
}

function getTurnstileSecret() {
	return String(process.env.TURNSTILE_SECRET_KEY || '').trim();
}

export async function verifyTurnstileToken({ token, ip, requestId } = {}) {
	if (!isTurnstileRequired()) {
		return { ok: true, skipped: true };
	}

	const secret = getTurnstileSecret();
	if (!secret) {
		logger.error('security.turnstile_missing_secret', { requestId });
		captureSecurityEvent('security.turnstile_missing_secret', { extra: { requestId } });
		return { ok: false, error: 'Turnstile no configurado.' };
	}

	if (!token) {
		return { ok: false, error: 'Verificacion anti-bot requerida.' };
	}

	try {
		const body = new URLSearchParams();
		body.set('secret', secret);
		body.set('response', token);
		if (ip) body.set('remoteip', ip);

		const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		});

		if (!response.ok) {
			throw new Error(`Turnstile respondio ${response.status}.`);
		}

		const data = await response.json();
		if (data?.success) {
			return { ok: true };
		}

		logger.warn('security.turnstile_rejected', {
			requestId,
			errorCodes: data?.['error-codes'] || [],
		});
		captureSecurityEvent('security.turnstile_rejected', {
			extra: { requestId, errorCodes: data?.['error-codes'] || [] },
		});
		return { ok: false, error: 'No se pudo validar la verificacion anti-bot.' };
	} catch (error) {
		logger.warn('security.turnstile_failed', { requestId, error });
		captureSecurityEvent('security.turnstile_failed', {
			extra: { requestId, error: error?.message || String(error) },
		});
		return { ok: false, error: 'No se pudo validar la verificacion anti-bot.' };
	}
}
