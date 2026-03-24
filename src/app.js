import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import authRoutes from './routes/auth.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import { attachUser } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(attachUser);

app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.appName = process.env.BUSINESS_NAME || 'WhatsApp AI Assistant';
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, provider: process.env.AI_PROVIDER || 'gemini' });
});

app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/webhook', webhookRoutes);

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'No encontrado',
    message: 'La página que buscaste no existe.'
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Error interno',
    message: err.message || 'Ocurrió un error inesperado.'
  });
});

export default app;
