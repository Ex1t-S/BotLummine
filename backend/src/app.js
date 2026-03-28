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

app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use((req, res, next) => {
	const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
	res.header('Access-Control-Allow-Origin', origin);
	res.header('Access-Control-Allow-Credentials', 'true');
	res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

	if (req.method === 'OPTIONS') {
		return res.sendStatus(204);
	}

	next();
});

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