import axios from 'axios';
import { prisma } from '../lib/prisma.js';
import { getTiendanubeConfig } from '../services/tiendanube/client.js';

function buildInstallUrl() {
	const appId = process.env.TIENDANUBE_APP_ID;
	const redirectUri = process.env.TIENDANUBE_REDIRECT_URI;

	if (!appId || !redirectUri) {
		throw new Error('Faltan TIENDANUBE_APP_ID o TIENDANUBE_REDIRECT_URI en el .env');
	}

	const url = new URL('https://www.tiendanube.com/apps/authorize');
	url.searchParams.set('client_id', appId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', process.env.TIENDANUBE_APP_SCOPES || 'read_orders read_products');
	return url.toString();
}

async function exchangeCodeForToken(code) {
	const response = await axios.post(
		'https://www.tiendanube.com/apps/authorize/token',
		{
			client_id: process.env.TIENDANUBE_APP_ID,
			client_secret: process.env.TIENDANUBE_CLIENT_SECRET,
			grant_type: 'authorization_code',
			code
		},
		{
			headers: {
				'Content-Type': 'application/json'
			},
			timeout: 15000
		}
	);

	return response.data;
}

export async function startTiendanubeInstall(_req, res) {
	try {
		return res.redirect(buildInstallUrl());
	} catch (error) {
		console.error('Error iniciando instalación Tiendanube:', error.message);
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export async function handleTiendanubeCallback(req, res) {
	try {
		const { code } = req.query;

		if (!code) {
			return res.status(400).send('Falta code');
		}

		const data = await exchangeCodeForToken(code);

		await prisma.storeInstallation.upsert({
			where: { storeId: String(data.user_id) },
			update: {
				accessToken: data.access_token,
				scope: data.scope || null
			},
			create: {
				storeId: String(data.user_id),
				accessToken: data.access_token,
				scope: data.scope || null
			}
		});

		return res.send(`
			<h2>Integración Tiendanube OK</h2>
			<p><b>store_id:</b> ${data.user_id}</p>
			<p><b>scope:</b> ${data.scope || ''}</p>
			<p>El token quedó guardado en StoreInstallation.</p>
		`);
	} catch (error) {
		console.error('Error en callback Tiendanube:', error.response?.data || error.message);
		return res.status(500).json({
			ok: false,
			error: error.response?.data || error.message
		});
	}
}

export async function registerTiendanubeWebhooks(_req, res) {
	return res.status(501).json({
		ok: false,
		message: 'Registro automático de webhooks todavía no implementado.'
	});
}

export async function getTiendanubeStatus(_req, res) {
	try {
		const installation = await prisma.storeInstallation.findFirst({
			orderBy: { installedAt: 'desc' }
		});

		let activeConfig = null;
		try {
			activeConfig = await getTiendanubeConfig();
		} catch {
			activeConfig = null;
		}

		return res.json({
			ok: true,
			hasDatabaseInstallation: Boolean(installation),
			hasEnvCredentials: Boolean(process.env.TIENDANUBE_STORE_ID && process.env.TIENDANUBE_ACCESS_TOKEN),
			activeSource: activeConfig?.source || null,
			storeId: activeConfig?.storeId || installation?.storeId || null,
			scope: installation?.scope || null,
			installedAt: installation?.installedAt || null
		});
	} catch (error) {
		console.error('Error obteniendo estado de Tiendanube:', error.message);
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export const tiendanubeCallback = handleTiendanubeCallback;