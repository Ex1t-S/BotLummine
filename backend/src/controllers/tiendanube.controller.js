import axios from 'axios';
import { prisma } from '../lib/prisma.js';
import { getTiendanubeConfig } from '../services/tiendanube/client.js';
import {
	syncCatalogFromTiendanube,
	getCatalogSummary,
	getCatalogPage
} from '../services/catalog/catalog.service.js';
import {
	DEFAULT_WORKSPACE_ID,
	requireRequestWorkspaceId,
} from '../services/workspaces/workspace-context.service.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const ORDER_WEBHOOK_EVENTS = [
	'order/created',
	'order/updated',
	'order/paid',
	'order/pending',
	'order/voided',
	'order/cancelled',
	'order/edited'
];

function normalizeUrl(value = '') {
	return String(value || '').trim().replace(/\/+$/, '');
}

function pickLocalized(value) {
	if (value == null) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'object') {
		return value.es || value['es_AR'] || value['es-AR'] || value.en || value.pt || Object.values(value).find((item) => typeof item === 'string') || null;
	}
	return null;
}

function normalizeAssetUrl(value = '') {
	const normalized = String(value || '').trim();
	if (!normalized) return null;
	if (normalized.startsWith('//')) return `https:${normalized}`;
	return normalized;
}

function getRegisterSecret() {
	return String(
		process.env.TIENDANUBE_REGISTER_SECRET ||
		process.env.TIENDANUBE_CLIENT_SECRET ||
		''
	).trim();
}

function isAuthorizedAdminRequest(req) {
	if (req.user) {
		return true;
	}

	const expected = getRegisterSecret();
	if (!expected) {
		return false;
	}

	const provided = String(
		req.headers['x-admin-secret'] ||
		req.body?.secret ||
		req.query?.secret ||
		''
	).trim();

	return Boolean(provided) && provided === expected;
}

function buildInstallUrl(workspaceId = DEFAULT_WORKSPACE_ID) {
	const appId = process.env.TIENDANUBE_APP_ID;
	const redirectUri = process.env.TIENDANUBE_REDIRECT_URI;

	if (!appId || !redirectUri) {
		throw new Error('Faltan TIENDANUBE_APP_ID o TIENDANUBE_REDIRECT_URI en el .env');
	}

	const url = new URL('https://www.tiendanube.com/apps/authorize');
	url.searchParams.set('client_id', appId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('state', workspaceId);
	url.searchParams.set(
		'scope',
		process.env.TIENDANUBE_APP_SCOPES || 'read_orders read_products'
	);
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

function buildTiendanubeHeaders(accessToken) {
	return {
		Authentication: `bearer ${accessToken}`,
		'Content-Type': 'application/json',
		'User-Agent':
			process.env.TIENDANUBE_USER_AGENT ||
			'Multi Brand IA Assistant'
	};
}

function resolvePublicBackendBaseUrl(req) {
	const candidates = [
		process.env.TIENDANUBE_WEBHOOK_BASE_URL,
		process.env.BACKEND_PUBLIC_URL,
		process.env.BACKEND_URL,
		process.env.PUBLIC_APP_URL,
		process.env.APP_URL,
		process.env.RAILWAY_STATIC_URL
			? `https://${process.env.RAILWAY_STATIC_URL}`
			: null,
		req
			? `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`
			: null
	]
		.map(normalizeUrl)
		.filter(Boolean);

	const baseUrl = candidates[0] || null;
	if (!baseUrl) {
		throw new Error(
			'No se pudo resolver la URL pública del backend. Configurá TIENDANUBE_WEBHOOK_BASE_URL o BACKEND_PUBLIC_URL.'
		);
	}

	if (!baseUrl.startsWith('https://')) {
		throw new Error(
			`La URL pública del backend debe ser HTTPS para webhooks de Tiendanube. Valor actual: ${baseUrl}`
		);
	}

	return baseUrl;
}

function buildOrdersWebhookUrl(req) {
	return `${resolvePublicBackendBaseUrl(req)}/api/webhook/tiendanube/orders`;
}

async function listTiendanubeWebhooks({ storeId, accessToken }) {
	const response = await axios.get(
		`https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/webhooks`,
		{
			headers: buildTiendanubeHeaders(accessToken),
			timeout: 15000
		}
	);

	return Array.isArray(response.data) ? response.data : [];
}

async function createTiendanubeWebhook({ storeId, accessToken, event, url }) {
	const response = await axios.post(
		`https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/webhooks`,
		{ event, url },
		{
			headers: buildTiendanubeHeaders(accessToken),
			timeout: 15000
		}
	);

	return response.data;
}

async function fetchTiendanubeStore({ storeId, accessToken }) {
	const response = await axios.get(
		`https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/store`,
		{
			headers: buildTiendanubeHeaders(accessToken),
			timeout: 15000
		}
	);

	return response.data || null;
}

async function syncTiendanubeBranding({ workspaceId, storeId, accessToken }) {
	const store = await fetchTiendanubeStore({ storeId, accessToken });
	if (!store) return null;

	const storeName = pickLocalized(store.name) || store.business_name || null;
	const storeUrl =
		(Array.isArray(store.domains) && store.domains[0] ? `https://${store.domains[0]}` : null) ||
		(store.original_domain ? `https://${store.original_domain}` : null);
	const logoUrl = normalizeAssetUrl(store.logo);

	await prisma.storeInstallation.update({
		where: { storeId: String(storeId) },
		data: {
			storeName,
			storeUrl
		}
	});

	await prisma.workspaceBranding.upsert({
		where: { workspaceId },
		update: {
			logoUrl,
			rawProviderBranding: {
				provider: 'TIENDANUBE',
				store
			}
		},
		create: {
			workspaceId,
			logoUrl,
			rawProviderBranding: {
				provider: 'TIENDANUBE',
				store
			}
		}
	});

	if (storeName) {
		await prisma.workspaceAiConfig.upsert({
			where: { workspaceId },
			update: { businessName: storeName },
			create: {
				workspaceId,
				businessName: storeName,
				agentName: 'Sofi',
				tone: 'humana, directa y comercial'
			}
		});
	}

	return { storeName, storeUrl, logoUrl };
}

async function ensureTiendanubeOrderWebhooks({ storeId, accessToken, webhookUrl }) {
	const existing = await listTiendanubeWebhooks({ storeId, accessToken });
	const existingKeys = new Set(
		existing.map(
			(item) =>
				`${String(item?.event || '').trim()}::${normalizeUrl(item?.url || '')}`
		)
	);

	const created = [];
	const reused = [];

	for (const event of ORDER_WEBHOOK_EVENTS) {
		const key = `${event}::${normalizeUrl(webhookUrl)}`;
		if (existingKeys.has(key)) {
			reused.push(event);
			continue;
		}

		await createTiendanubeWebhook({
			storeId,
			accessToken,
			event,
			url: webhookUrl
		});
		created.push(event);
	}

	return {
		webhookUrl,
		created,
		reused,
		total: ORDER_WEBHOOK_EVENTS.length
	};
}

async function resolveInstallationForWebhook(requestedStoreId = null, workspaceId = DEFAULT_WORKSPACE_ID) {
	const requested = requestedStoreId ? String(requestedStoreId).trim() : null;

	if (requested) {
		const byStore = await prisma.storeInstallation.findFirst({
			where: { storeId: requested, workspaceId }
		});

		if (byStore?.storeId && byStore?.accessToken) {
			return {
				storeId: String(byStore.storeId),
				accessToken: String(byStore.accessToken),
				workspaceId: byStore.workspaceId,
				scope: byStore.scope || null,
				source: 'database:requested'
			};
		}
	}

	const latestInstallation = await prisma.storeInstallation.findFirst({
		where: { workspaceId, provider: 'TIENDANUBE' },
		orderBy: { installedAt: 'desc' }
	});

	if (latestInstallation?.storeId && latestInstallation?.accessToken) {
		return {
			storeId: String(latestInstallation.storeId),
			accessToken: String(latestInstallation.accessToken),
			workspaceId: latestInstallation.workspaceId,
			scope: latestInstallation.scope || null,
			source: 'database:latest'
		};
	}

	const envStoreId = String(process.env.TIENDANUBE_STORE_ID || '').trim();
	const envAccessToken = String(process.env.TIENDANUBE_ACCESS_TOKEN || '').trim();

	if (requested && envStoreId && requested !== envStoreId) {
		throw new Error(
			`No existe una instalación guardada para storeId ${requested} y el TIENDANUBE_STORE_ID del entorno es ${envStoreId}.`
		);
	}

	if (workspaceId === DEFAULT_WORKSPACE_ID && envStoreId && envAccessToken) {
		return {
			storeId: envStoreId,
			accessToken: envAccessToken,
			workspaceId,
			scope: null,
			source: 'env'
		};
	}

	throw new Error(
		'No hay credenciales activas de Tiendanube para registrar webhooks o sincronizar catálogo. Necesitás StoreInstallation o TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN.'
	);
}

export async function startTiendanubeInstall(req, res) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		return res.redirect(buildInstallUrl(workspaceId));
	} catch (error) {
		console.error('Error iniciando instalación Tiendanube:', error.message);
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export async function handleTiendanubeCallback(req, res) {
	try {
		const { code } = req.query;
		const workspaceId = String(req.query?.state || DEFAULT_WORKSPACE_ID).trim() || DEFAULT_WORKSPACE_ID;

		if (!code) {
			return res.status(400).send('Falta code');
		}

		const data = await exchangeCodeForToken(code);

		await prisma.storeInstallation.upsert({
			where: { storeId: String(data.user_id) },
			update: {
				workspaceId,
				provider: 'TIENDANUBE',
				accessToken: data.access_token,
				scope: data.scope || null
			},
			create: {
				workspaceId,
				provider: 'TIENDANUBE',
				storeId: String(data.user_id),
				accessToken: data.access_token,
				scope: data.scope || null
			}
		});

		let brandingResult = null;
		try {
			brandingResult = await syncTiendanubeBranding({
				workspaceId,
				storeId: String(data.user_id),
				accessToken: data.access_token
			});
		} catch (error) {
			console.error('[TIENDANUBE][CALLBACK][BRANDING]', error?.message || error);
		}

		let webhookResult = null;
		let webhookError = null;

		try {
			const webhookUrl = buildOrdersWebhookUrl(req);
			webhookResult = await ensureTiendanubeOrderWebhooks({
				storeId: String(data.user_id),
				accessToken: data.access_token,
				webhookUrl
			});
		} catch (error) {
			webhookError =
				error?.message ||
				'No se pudieron registrar webhooks automáticamente.';
			console.error('[TIENDANUBE][CALLBACK][WEBHOOKS]', webhookError);
		}

		return res.send(`
			<h2>Integración Tiendanube OK</h2>
			<p><b>store_id:</b> ${data.user_id}</p>
			<p><b>scope:</b> ${data.scope || ''}</p>
			<p>El token quedó guardado en StoreInstallation.</p>
			<p><b>Webhooks:</b> ${
				webhookResult
					? `ok · creados ${webhookResult.created.length} · reutilizados ${webhookResult.reused.length}`
					: `pendiente (${webhookError || 'sin detalle'})`
			}</p>
		`);
	} catch (error) {
		console.error(
			'Error en callback Tiendanube:',
			error.response?.data || error.message
		);
		return res.status(500).json({
			ok: false,
			error: error.response?.data || error.message
		});
	}
}

export async function registerTiendanubeWebhooks(req, res) {
	try {
		if (!isAuthorizedAdminRequest(req)) {
			return res.status(401).json({
				ok: false,
				error: 'No autenticado. Iniciá sesión o enviá x-admin-secret.'
			});
		}

		const workspaceId = req.user ? requireRequestWorkspaceId(req) : String(req.body?.workspaceId || req.query?.workspaceId || DEFAULT_WORKSPACE_ID);
		const installation = await resolveInstallationForWebhook(
			req.body?.storeId || req.query?.storeId,
			workspaceId
		);

		const webhookUrl = buildOrdersWebhookUrl(req);
		const result = await ensureTiendanubeOrderWebhooks({
			storeId: installation.storeId,
			accessToken: installation.accessToken,
			webhookUrl
		});

		return res.json({
			ok: true,
			storeId: installation.storeId,
			source: installation.source || 'unknown',
			...result
		});
	} catch (error) {
		console.error(
			'[TIENDANUBE][REGISTER WEBHOOKS]',
			error.response?.data || error.message
		);
		return res.status(500).json({
			ok: false,
			error: error.response?.data || error.message
		});
	}
}

export async function runTiendanubeCatalogSync(req, res) {
	try {
		if (!isAuthorizedAdminRequest(req)) {
			return res.status(401).json({
				ok: false,
				error: 'No autenticado. Iniciá sesión o enviá x-admin-secret.'
			});
		}

		const workspaceId = req.user ? requireRequestWorkspaceId(req) : String(req.body?.workspaceId || req.query?.workspaceId || DEFAULT_WORKSPACE_ID);
		await resolveInstallationForWebhook(req.body?.storeId || req.query?.storeId, workspaceId);

		const result = await syncCatalogFromTiendanube({
			workspaceId,
			pageSize: Number(req.body?.pageSize || req.query?.pageSize) || 100,
			delayMs: Number(req.body?.delayMs || req.query?.delayMs) || 250,
			markMissingAsUnpublished:
				String(req.body?.markMissingAsUnpublished || req.query?.markMissingAsUnpublished || 'true') !== 'false'
		});

		return res.json(result);
	} catch (error) {
		console.error('[TIENDANUBE][CATALOG SYNC]', error.message);
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export async function getTiendanubeCatalogStatus(req, res) {
	try {
		if (!isAuthorizedAdminRequest(req)) {
			return res.status(401).json({
				ok: false,
				error: 'No autenticado. Iniciá sesión o enviá x-admin-secret.'
			});
		}

		const workspaceId = req.user ? requireRequestWorkspaceId(req) : String(req.query?.workspaceId || DEFAULT_WORKSPACE_ID);
		const summary = await getCatalogSummary({ workspaceId });
		return res.json({ ok: true, ...summary });
	} catch (error) {
		console.error('[TIENDANUBE][CATALOG STATUS]', error.message);
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export async function getTiendanubeCatalogProducts(req, res) {
	try {
		if (!isAuthorizedAdminRequest(req)) {
			return res.status(401).json({
				ok: false,
				error: 'No autenticado. Iniciá sesión o enviá x-admin-secret.'
			});
		}

		const result = await getCatalogPage({
			workspaceId: req.user ? requireRequestWorkspaceId(req) : String(req.query?.workspaceId || DEFAULT_WORKSPACE_ID),
			q: req.query?.q || '',
			page: req.query?.page,
			pageSize: req.query?.pageSize,
			published:
				req.query?.published == null || req.query?.published === ''
					? undefined
					: String(req.query.published) === 'true'
		});

		return res.json({ ok: true, ...result });
	} catch (error) {
		console.error('[TIENDANUBE][CATALOG PRODUCTS]', error.message);
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export async function getTiendanubeStatus(req, res) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const installation = await prisma.storeInstallation.findFirst({
			where: { workspaceId, provider: 'TIENDANUBE' },
			orderBy: { installedAt: 'desc' }
		});

		let activeConfig = null;
		try {
			activeConfig = await getTiendanubeConfig({ workspaceId });
		} catch {
			activeConfig = null;
		}

		const catalogSummary = await getCatalogSummary({ workspaceId }).catch(() => null);

		return res.json({
			ok: true,
			hasDatabaseInstallation: Boolean(installation),
			hasEnvCredentials: Boolean(
				process.env.TIENDANUBE_STORE_ID &&
				process.env.TIENDANUBE_ACCESS_TOKEN
			),
			hasAppSecret: Boolean(
				process.env.TIENDANUBE_APP_SECRET ||
				process.env.TIENDANUBE_CLIENT_SECRET
			),
			hasRegisterSecret: Boolean(getRegisterSecret()),
			activeSource: activeConfig?.source || null,
			storeId: activeConfig?.storeId || installation?.storeId || null,
			scope: installation?.scope || null,
			installedAt: installation?.installedAt || null,
			orderWebhookEvents: ORDER_WEBHOOK_EVENTS,
			catalog: catalogSummary
		});
	} catch (error) {
		console.error('Error obteniendo estado de Tiendanube:', error.message);
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export const tiendanubeCallback = handleTiendanubeCallback;
