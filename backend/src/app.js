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

dotenv.config();

const app = express();

const allowedOrigins = [
	'http://localhost:5173',
	'http://127.0.0.1:5173',
	'http://localhost:3000',
	'http://127.0.0.1:3000',
	process.env.FRONTEND_URL,
	process.env.FRONTEND_URL_PROD
].filter(Boolean);

function isAllowedOrigin(origin) {
	if (!origin) return true;

	if (allowedOrigins.includes(origin)) {
		return true;
	}

	if (
		process.env.ALLOW_VERCEL_PREVIEWS === 'true' &&
		/^https:\/\/.*\.vercel\.app$/.test(origin)
	) {
		return true;
	}

	return false;
}

const corsOptions = {
	origin(origin, callback) {
		if (isAllowedOrigin(origin)) {
			return callback(null, true);
		}

		return callback(new Error(`Origen no permitido por CORS: ${origin}`));
	},
	credentials: true,
	methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(attachUser);

app.get('/api/health', (_req, res) => {
	res.json({ ok: true, service: 'whatsapp-ai-assistant-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/tiendanube', tiendanubeRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/ai-lab', aiLabRoutes);

app.use((err, _req, res, _next) => {
	console.error(err);

	if (err.message?.startsWith('Origen no permitido por CORS')) {
		return res.status(403).json({
			ok: false,
			error: err.message
		});
	}

	res.status(err.status || 500).json({
		ok: false,
		error: err.message || 'Internal server error'
	});
});

export default app;