import axios from 'axios';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { getTiendanubeClient } from '../services/tiendanube/client.js';
import { registerDefaultWebhooks } from '../services/tiendanube/orders.service.js';

function buildSignedState(req) {
  return jwt.sign(
    {
      userId: req.user?.id || null,
      ts: Date.now()
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

export function startTiendanubeInstall(req, res) {
  const appId = process.env.TIENDANUBE_APP_ID;
  const state = buildSignedState(req);

  if (!appId || !process.env.TIENDANUBE_REDIRECT_URI) {
    return res.status(500).json({
      ok: false,
      message: 'Faltan TIENDANUBE_APP_ID o TIENDANUBE_REDIRECT_URI en el .env'
    });
  }

  const url = `https://www.tiendanube.com/apps/${appId}/authorize?state=${encodeURIComponent(state)}`;
  return res.redirect(url);
}

export async function handleTiendanubeCallback(req, res) {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).render('error', {
        title: 'Integración Tiendanube',
        message: 'Falta code o state en el callback.'
      });
    }

    jwt.verify(String(state), process.env.JWT_SECRET);

    const response = await axios.post(
      'https://www.tiendanube.com/apps/authorize/token',
      {
        client_id: process.env.TIENDANUBE_APP_ID,
        client_secret: process.env.TIENDANUBE_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code)
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    const { access_token: accessToken, scope, user_id: storeId } = response.data;

    await prisma.storeInstallation.upsert({
      where: { storeId: String(storeId) },
      update: {
        accessToken,
        scope,
        installedAt: new Date()
      },
      create: {
        storeId: String(storeId),
        accessToken,
        scope
      }
    });

    return res.redirect('/dashboard');
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Integración Tiendanube',
      message: error.response?.data?.description || error.message || 'No se pudo completar la instalación.'
    });
  }
}

export async function registerTiendanubeWebhooks(_req, res) {
  try {
    const baseUrl = process.env.TIENDANUBE_WEBHOOK_BASE_URL || process.env.APP_URL;
    const results = await registerDefaultWebhooks(baseUrl);

    return res.json({ ok: true, results });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.response?.data?.description || error.message
    });
  }
}

export async function getTiendanubeStatus(_req, res) {
  try {
    const { installation } = await getTiendanubeClient();
    return res.json({
      ok: true,
      installation: {
        storeId: installation.storeId,
        scope: installation.scope,
        storeName: installation.storeName,
        storeUrl: installation.storeUrl
      }
    });
  } catch (error) {
    return res.status(404).json({
      ok: false,
      message: error.message
    });
  }
}
