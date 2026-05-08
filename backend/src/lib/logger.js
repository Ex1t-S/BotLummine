import crypto from 'node:crypto';

const LEVELS = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

function shouldLog(level) {
	const configuredLevel = String(process.env.LOG_LEVEL || 'info').trim().toLowerCase();
	const currentLevel = LEVELS[configuredLevel] || LEVELS.info;
	return (LEVELS[level] || LEVELS.info) >= currentLevel;
}

export function isDebugPayloadLoggingEnabled() {
	return String(process.env.DEBUG_EXTERNAL_PAYLOADS || 'false').trim().toLowerCase() === 'true';
}

export function maskPhone(value = '') {
	const digits = String(value || '').replace(/\D/g, '');
	if (!digits) return null;
	if (digits.length <= 4) return `***${digits}`;
	return `${digits.slice(0, 3)}***${digits.slice(-4)}`;
}

export function fingerprint(value = '') {
	const normalized = String(value || '').trim();
	if (!normalized) return null;

	return crypto
		.createHash('sha256')
		.update(normalized)
		.digest('hex')
		.slice(0, 12);
}

function redactValue(key, value) {
	const normalizedKey = String(key || '').toLowerCase();
	if (/(token|secret|password|authorization|cookie|access_token|client_secret)/.test(normalizedKey)) {
		return value ? '[redacted]' : value;
	}
	if (/(phone|waid|wa_id|to|from)/.test(normalizedKey) && typeof value !== 'object') {
		return maskPhone(value);
	}
	return value;
}

export function sanitizeLogData(input, depth = 0) {
	if (input === null || input === undefined) return input;
	if (depth > 4) return '[truncated]';
	if (input instanceof Error) {
		return {
			name: input.name,
			message: input.message,
			status: input.status || input.statusCode || null,
		};
	}
	if (Array.isArray(input)) {
		return input.slice(0, 20).map((item) => sanitizeLogData(item, depth + 1));
	}
	if (typeof input === 'object') {
		return Object.fromEntries(
			Object.entries(input).map(([key, value]) => [
				key,
				sanitizeLogData(redactValue(key, value), depth + 1),
			])
		);
	}
	return input;
}

export function logEvent(level, event, data = {}) {
	if (!shouldLog(level)) return;

	const payload = {
		ts: new Date().toISOString(),
		level,
		event,
		...sanitizeLogData(data),
	};

	const line = JSON.stringify(payload);
	if (level === 'error') {
		console.error(line);
		return;
	}
	if (level === 'warn') {
		console.warn(line);
		return;
	}
	console.log(line);
}

export const logger = {
	debug: (event, data) => logEvent('debug', event, data),
	info: (event, data) => logEvent('info', event, data),
	warn: (event, data) => logEvent('warn', event, data),
	error: (event, data) => logEvent('error', event, data),
};
