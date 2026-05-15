import { captureSecurityEvent } from '../lib/sentry.js';
import { logger } from '../lib/logger.js';

const buckets = new Map();
let warnedUpstashFallback = false;

function normalizeNumber(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
	const parsed = Number(value);
	const number = Number.isFinite(parsed) ? parsed : fallback;
	return Math.max(min, Math.min(number, max));
}

function getClientKey(req, scope = 'global') {
	const forwardedFor = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
	const ip = forwardedFor || req.ip || req.socket?.remoteAddress || 'unknown';
	return `${scope}:${ip}`;
}

function cleanupExpired(now = Date.now()) {
	for (const [key, bucket] of buckets.entries()) {
		if (bucket.resetAt <= now) {
			buckets.delete(key);
		}
	}
}

function getRateLimitBackend() {
	return String(process.env.RATE_LIMIT_BACKEND || 'memory').trim().toLowerCase();
}

function isFailOpenEnabled() {
	return String(process.env.RATE_LIMIT_FAIL_OPEN || 'false').trim().toLowerCase() === 'true';
}

function getUpstashConfig() {
	return {
		url: String(process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, ''),
		token: String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim(),
	};
}

async function incrementUpstashBucket(key, windowMs) {
	const { url, token } = getUpstashConfig();
	if (!url || !token) {
		throw new Error('Upstash Redis no configurado.');
	}

	const redisKey = `rate-limit:${key}`;
	const response = await fetch(`${url}/pipeline`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify([
			['INCR', redisKey],
			['PTTL', redisKey],
		]),
	});

	if (!response.ok) {
		throw new Error(`Upstash Redis respondio ${response.status}.`);
	}

	const data = await response.json();
	const count = Number(data?.[0]?.result || 0);
	let ttlMs = Number(data?.[1]?.result || -1);

	if (!Number.isFinite(count) || count < 1) {
		throw new Error('Upstash Redis devolvio un contador invalido.');
	}

	if (!Number.isFinite(ttlMs) || ttlMs < 0) {
		const expireResponse = await fetch(`${url}/pexpire/${encodeURIComponent(redisKey)}/${windowMs}`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
		});

		if (!expireResponse.ok) {
			throw new Error(`Upstash Redis no pudo setear TTL (${expireResponse.status}).`);
		}

		ttlMs = windowMs;
	}

	return {
		count,
		resetAt: Date.now() + ttlMs,
	};
}

function incrementMemoryBucket(key, windowMs) {
	const now = Date.now();
	if (Math.random() < 0.01) cleanupExpired(now);

	const current = buckets.get(key);
	const bucket = current && current.resetAt > now
		? current
		: { count: 0, resetAt: now + windowMs };

	bucket.count += 1;
	buckets.set(key, bucket);
	return bucket;
}

export function createRateLimiter({
	scope = 'global',
	windowMs = 60_000,
	max = 60,
	keyGenerator = null,
	message = 'Demasiadas solicitudes. Probá de nuevo en unos minutos.',
} = {}) {
	const resolvedWindowMs = normalizeNumber(windowMs, 60_000, { min: 1_000, max: 24 * 60 * 60 * 1000 });
	const resolvedMax = normalizeNumber(max, 60, { min: 1, max: 100_000 });

	return async (req, res, next) => {
		const key = keyGenerator ? keyGenerator(req) : getClientKey(req, scope);
		let bucket;

		if (getRateLimitBackend() === 'upstash') {
			try {
				bucket = await incrementUpstashBucket(key, resolvedWindowMs);
			} catch (error) {
				if (!warnedUpstashFallback) {
					warnedUpstashFallback = true;
					logger.warn('security.rate_limit_fallback', {
						scope,
						error,
					});
					captureSecurityEvent('security.rate_limit_fallback', {
						extra: { scope, error: error?.message || String(error) },
					});
				}

				if (!isFailOpenEnabled()) {
					return res.status(503).json({
						ok: false,
						error: 'Rate limit temporalmente no disponible.',
						requestId: req.requestId || null,
					});
				}

				bucket = incrementMemoryBucket(key, resolvedWindowMs);
			}
		} else {
			bucket = incrementMemoryBucket(key, resolvedWindowMs);
		}

		const remaining = Math.max(0, resolvedMax - bucket.count);
		res.setHeader('RateLimit-Limit', String(resolvedMax));
		res.setHeader('RateLimit-Remaining', String(remaining));
		res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

		if (bucket.count > resolvedMax) {
			const now = Date.now();
			const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
			res.setHeader('Retry-After', String(retryAfterSeconds));
			captureSecurityEvent('security.rate_limit_exceeded', {
				extra: {
					requestId: req.requestId || null,
					scope,
					path: req.originalUrl || req.url,
					retryAfterSeconds,
				},
			});
			return res.status(429).json({
				ok: false,
				error: message,
				retryAfterSeconds,
				requestId: req.requestId || null,
			});
		}

		return next();
	};
}

export function makeIpEmailKey(scope = 'login') {
	return (req) => {
		const email = String(req.body?.email || '').trim().toLowerCase();
		return `${getClientKey(req, scope)}:${email || 'no-email'}`;
	};
}
