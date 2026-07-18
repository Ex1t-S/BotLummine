import crypto from 'crypto';

const LEGACY_SECRET_ENV_NAMES = [
	'WHATSAPP_APP_SECRET',
	'META_APP_SECRET',
	'FACEBOOK_APP_SECRET'
];

function timingSafeEquals(leftValue = '', rightValue = '') {
	const left = Buffer.from(String(leftValue), 'utf8');
	const right = Buffer.from(String(rightValue), 'utf8');

	return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function splitSecrets(value) {
	return String(value || '')
		.split(',')
		.map((secret) => secret.trim())
		.filter(Boolean);
}

/**
 * Supports a short transition in which Meta can sign webhooks from more than
 * one app. The legacy single-secret variables remain supported so existing
 * deployments do not need to change immediately.
 */
export function getWhatsAppWebhookSecrets(env = process.env) {
	const configuredSecrets = splitSecrets(env.WHATSAPP_APP_SECRETS);
	const legacySecrets = LEGACY_SECRET_ENV_NAMES.flatMap((name) => splitSecrets(env[name]));

	return [...new Set([...configuredSecrets, ...legacySecrets])];
}

export function verifyWhatsAppWebhookSignature(rawBodyBuffer, signatureHeader, env = process.env) {
	const secrets = getWhatsAppWebhookSecrets(env);
	const provided = String(signatureHeader || '').replace(/^sha256=/i, '').toLowerCase();

	if (!secrets.length || !/^[a-f0-9]{64}$/.test(provided)) {
		return false;
	}

	let matches = false;
	for (const secret of secrets) {
		const expected = crypto
			.createHmac('sha256', secret)
			.update(rawBodyBuffer)
			.digest('hex');
		const isMatch = timingSafeEquals(provided, expected);
		matches = isMatch || matches;
	}

	return matches;
}
