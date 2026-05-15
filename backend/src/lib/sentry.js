import { logger } from './logger.js';

let sentryClient = null;
let initStarted = false;

export async function initSentry() {
	const dsn = String(process.env.SENTRY_DSN || '').trim();
	if (!dsn || initStarted) return null;

	initStarted = true;

	try {
		const Sentry = await import('@sentry/node');
		Sentry.init({
			dsn,
			environment: process.env.NODE_ENV || 'development',
			release: process.env.RELEASE_ID || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
			tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
		});
		sentryClient = Sentry;
		logger.info('sentry.initialized', { enabled: true });
		return Sentry;
	} catch (error) {
		logger.warn('sentry.initialization_failed', { error });
		return null;
	}
}

export function captureException(error, context = {}) {
	if (!sentryClient) return;

	try {
		sentryClient.captureException(error, {
			tags: context.tags || {},
			extra: context.extra || context,
		});
	} catch (captureError) {
		logger.warn('sentry.capture_failed', { error: captureError });
	}
}

export function captureSecurityEvent(event, context = {}) {
	if (!sentryClient) return;

	try {
		sentryClient.captureMessage(event, {
			level: context.level || 'warning',
			tags: {
				security: 'true',
				event,
				...(context.tags || {}),
			},
			extra: context.extra || context,
		});
	} catch (error) {
		logger.warn('sentry.capture_failed', { error });
	}
}
