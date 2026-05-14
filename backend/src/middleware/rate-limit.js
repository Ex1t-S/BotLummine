const buckets = new Map();

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

export function createRateLimiter({
	scope = 'global',
	windowMs = 60_000,
	max = 60,
	keyGenerator = null,
	message = 'Demasiadas solicitudes. Probá de nuevo en unos minutos.',
} = {}) {
	const resolvedWindowMs = normalizeNumber(windowMs, 60_000, { min: 1_000, max: 24 * 60 * 60 * 1000 });
	const resolvedMax = normalizeNumber(max, 60, { min: 1, max: 100_000 });

	return (req, res, next) => {
		const now = Date.now();
		if (Math.random() < 0.01) cleanupExpired(now);

		const key = keyGenerator ? keyGenerator(req) : getClientKey(req, scope);
		const current = buckets.get(key);
		const bucket = current && current.resetAt > now
			? current
			: { count: 0, resetAt: now + resolvedWindowMs };

		bucket.count += 1;
		buckets.set(key, bucket);

		const remaining = Math.max(0, resolvedMax - bucket.count);
		res.setHeader('RateLimit-Limit', String(resolvedMax));
		res.setHeader('RateLimit-Remaining', String(remaining));
		res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

		if (bucket.count > resolvedMax) {
			const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
			res.setHeader('Retry-After', String(retryAfterSeconds));
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
