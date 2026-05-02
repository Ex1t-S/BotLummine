import express from 'express';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import cors from 'cors';

import { attachUser } from './middleware/auth.js';
import authRoutes from './routes/auth.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import campaignRoutes from './routes/campaign.routes.js';
import tiendanubeRoutes from './routes/tiendanube.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import aiLabRoutes from './routes/ai-lab.routes.js';
import mediaRoutes from './routes/media.routes.js';
import whatsappMenuRoutes from './routes/whatsapp-menu.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { attachRequestId } from './lib/request-id.js';

dotenv.config();

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = [
	'http://localhost:5173',
	'http://127.0.0.1:5173',
	'http://localhost:3000',
	'http://127.0.0.1:3000',
	process.env.FRONTEND_URL,
	process.env.FRONTEND_URL_PROD
]
	.filter(Boolean)
	.map((value) => value.replace(/\/+$/, ''));

function normalizeOrigin(origin) {
	return String(origin || '').trim().replace(/\/+$/, '');
}

function isAllowedOrigin(origin) {
	if (!origin) return true;

	const normalizedOrigin = normalizeOrigin(origin);

	if (allowedOrigins.includes(normalizedOrigin)) {
		return true;
	}

	if (
		process.env.ALLOW_VERCEL_PREVIEWS === 'true' &&
		/^https:\/\/.*\.vercel\.app$/.test(normalizedOrigin)
	) {
		return true;
	}

	return false;
}

const corsOptions = {
	origin(origin, callback) {
		const normalizedOrigin = normalizeOrigin(origin);

		if (isAllowedOrigin(origin)) {
			return callback(null, true);
		}

		logger.warn('cors.origin_blocked', { origin: normalizedOrigin || null });
		return callback(new Error(`Origen no permitido por CORS: ${origin}`));
	},
	credentials: true,
	methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowedHeaders: [
		'Origin',
		'X-Requested-With',
		'Content-Type',
		'Accept',
		'Authorization',
		'X-Admin-Secret'
	]
};

app.use(attachRequestId);
app.use(cors(corsOptions));

app.options('/api/auth/login', cors(corsOptions));
app.options('/api/auth/me', cors(corsOptions));
app.options('/api/tiendanube/webhooks/register', cors(corsOptions));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api/webhook/tiendanube', express.raw({ type: 'application/json', limit: '2mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(attachUser);

const RELEASE_ID = 'backend-hardening-20260501';

app.get('/api/health', async (_req, res) => {
	const shouldCheckDb = String(process.env.HEALTHCHECK_DB || 'false').trim().toLowerCase() === 'true';
	let database = shouldCheckDb ? 'unchecked' : 'skipped';

	if (shouldCheckDb) {
		try {
			await prisma.$queryRaw`SELECT 1`;
			database = 'ok';
		} catch (error) {
			database = 'error';
			logger.warn('health.database_check_failed', { error });
		}
	}

	res.json({
		ok: true,
		service: 'whatsapp-ai-assistant-backend',
		release: RELEASE_ID,
		env: process.env.NODE_ENV || 'development',
		commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
		database,
	});
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/tiendanube', tiendanubeRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/ai-lab', aiLabRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/whatsapp-menu', whatsappMenuRoutes);
app.use('/api/admin', adminRoutes);

app.use((err, req, res, _next) => {
	const status = err.status || err.statusCode || 500;
	logger.error('http.unhandled_error', {
		requestId: req.requestId || null,
		method: req.method,
		path: req.originalUrl || req.url,
		status,
		error: err,
	});

	if (err.message?.startsWith('Origen no permitido por CORS')) {
		return res.status(403).json({
			ok: false,
			error: 'Origen no permitido por CORS',
			requestId: req.requestId || null,
		});
	}

	res.status(status).json({
		ok: false,
		error: status >= 500 && process.env.NODE_ENV === 'production'
			? 'Internal server error'
			: err.message || 'Internal server error',
		requestId: req.requestId || null,
	});
});

export default app;
