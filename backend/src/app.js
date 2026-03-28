import express from 'express';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { attachUser } from './middleware/auth.js';
import authRoutes from './routes/auth.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import campaignRoutes from './routes/campaign.routes.js';
import tiendanubeRoutes from './routes/tiendanube.routes.js';
import webhookRoutes from './routes/webhook.routes.js';

dotenv.config();

const app = express();

const allowedOrigins = new Set([
	'http://localhost:5173',
	'http://127.0.0.1:5173',
	process.env.FRONTEND_URL
].filter(Boolean));

app.use((req, res, next) => {
	const origin = req.headers.origin;

	if (origin && allowedOrigins.has(origin)) {
		res.setHeader('Access-Control-Allow-Origin', origin);
	}

	res.setHeader('Vary', 'Origin');
	res.setHeader('Access-Control-Allow-Credentials', 'true');
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
	res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

	if (req.method === 'OPTIONS') {
		return res.status(204).end();
	}

	next();
});

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

app.use((err, _req, res, _next) => {
	console.error(err);
	res.status(err.status || 500).json({
		ok: false,
		error: err.message || 'Internal server error'
	});
});

export default app;