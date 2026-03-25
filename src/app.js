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

/**
 * Callback OAuth de Tiendanube
 * Recibe el code y lo intercambia por access_token
 */
app.get('/integrations/tiendanube/callback', async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send('Falta code');
    }

    const response = await fetch('https://www.tiendanube.com/apps/authorize/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.TIENDANUBE_APP_ID,
        client_secret: process.env.TIENDANUBE_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error Tiendanube token:', data);
      return res.status(500).send(`Error al obtener token: ${JSON.stringify(data)}`);
    }

    console.log('TIENDANUBE TOKEN OK');
    console.log('access_token:', data.access_token);
    console.log('scope:', data.scope);
    console.log('user_id (store_id):', data.user_id);

    return res.send(`
      <h2>Integración Tiendanube OK</h2>
      <p><b>store_id:</b> ${data.user_id}</p>
      <p><b>scope:</b> ${data.scope}</p>
      <p><b>access_token:</b> ${data.access_token}</p>
    `);
  } catch (error) {
    console.error('Error callback Tiendanube:', error);
    return res.status(500).send(`Error interno: ${error.message}`);
  }
});

/**
 * Endpoint de prueba:
 * trae pedidos reales desde Tiendanube
 */
app.get('/integrations/tiendanube/test-orders', async (_req, res) => {
  try {
    const storeId = process.env.TIENDANUBE_STORE_ID;
    const accessToken = process.env.TIENDANUBE_ACCESS_TOKEN;
    const userAgent =
      process.env.TIENDANUBE_USER_AGENT ||
      'Lummine IA Assistant (germanarroyo016@gmail.com)';

    if (!storeId || !accessToken) {
      return res.status(400).json({
        ok: false,
        message: 'Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN en el .env'
      });
    }

    const response = await fetch(
      `https://api.tiendanube.com/v1/${storeId}/orders`,
      {
        method: 'GET',
        headers: {
          Authentication: `bearer ${accessToken}`,
          'User-Agent': userAgent,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Error consultando pedidos de Tiendanube:', data);
      return res.status(response.status).json({
        ok: false,
        error: data
      });
    }

    return res.json({
      ok: true,
      total: Array.isArray(data) ? data.length : 0,
      orders: data
    });
  } catch (error) {
    console.error('Error test-orders Tiendanube:', error);
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});
app.get('/integrations/tiendanube/order/:number', async (req, res) => {
  try {
    const storeId = process.env.TIENDANUBE_STORE_ID;
    const accessToken = process.env.TIENDANUBE_ACCESS_TOKEN;
    const userAgent =
      process.env.TIENDANUBE_USER_AGENT ||
      'Lummine IA Assistant (germanarroyo016@gmail.com)';

    const { number } = req.params;

    if (!storeId || !accessToken) {
      return res.status(400).json({
        ok: false,
        message: 'Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN en el .env'
      });
    }

    const response = await fetch(
      `https://api.tiendanube.com/v1/${storeId}/orders?q=${encodeURIComponent(number)}`,
      {
        method: 'GET',
        headers: {
          Authentication: `bearer ${accessToken}`,
          'User-Agent': userAgent,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: data
      });
    }

    const order = Array.isArray(data)
      ? data.find((o) => String(o.number) === String(number))
      : null;

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: `No encontré el pedido ${number}`
      });
    }

    return res.json({
      ok: true,
      order: {
        id: order.id,
        number: order.number,
        customer_name: order.customer?.name || order.name || null,
        contact_email: order.contact_email || null,
        contact_phone: order.contact_phone || null,
        total: order.total,
        currency: order.currency,
        payment_status: order.payment_status,
        shipping_status: order.shipping_status,
        status: order.status,
        tracking_number: order.shipping_tracking_number || null,
        tracking_url: order.shipping_tracking_url || null,
        created_at: order.created_at
      }
    });
  } catch (error) {
    console.error('Error buscando pedido Tiendanube:', error);
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});
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