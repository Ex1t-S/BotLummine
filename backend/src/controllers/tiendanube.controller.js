import axios from 'axios';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { decryptSecret, encryptSecret } from '../lib/secret-crypto.js';
import { getTiendanubeConfig } from '../services/tiendanube/client.js';
import { markPrimaryCommerceConnection } from '../services/commerce/active-commerce.service.js';
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

function normalizeTiendanubeRedirectUri(value = '') {
	const rawUrl = String(value || '').trim();
	if (!rawUrl) return '';

	try {
		const url = new URL(rawUrl);
		if (url.pathname === '/integrations/tiendanube/callback') {
			url.pathname = '/api/tiendanube/callback';
		}
		return url.toString();
	} catch {
		return rawUrl.replace(
			/\/integrations\/tiendanube\/callback\b/,
			'/api/tiendanube/callback'
		);
	}
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

function getTiendanubeStateSecret() {
	return String(
		process.env.TIENDANUBE_STATE_SECRET ||
		process.env.TIENDANUBE_CLIENT_SECRET ||
		''
	).trim();
}

function signTiendanubeState(payload = {}) {
	const secret = getTiendanubeStateSecret();
	if (!secret) {
		throw new Error('Falta TIENDANUBE_STATE_SECRET o TIENDANUBE_CLIENT_SECRET para firmar OAuth state.');
	}

	const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
	return `${body}.${signature}`;
}

function verifyTiendanubeState(value = '') {
	const secret = getTiendanubeStateSecret();
	if (!secret) {
		throw new Error('Falta TIENDANUBE_STATE_SECRET o TIENDANUBE_CLIENT_SECRET para validar OAuth state.');
	}

	const [body, signature] = String(value || '').trim().split('.');
	if (!body || !signature) {
		if (process.env.NODE_ENV !== 'production' && value) {
			return { workspaceId: String(value).trim() };
		}
		throw new Error('State Tiendanube invalido.');
	}

	const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
	if (
		signature.length !== expected.length ||
		!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
	) {
		throw new Error('State Tiendanube no coincide.');
	}

	const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
	if (!payload?.workspaceId) {
		throw new Error('State Tiendanube sin workspaceId.');
	}

	const ageMs = Date.now() - Number(payload.ts || 0);
	if (!Number.isFinite(ageMs) || ageMs > 60 * 60 * 1000) {
		throw new Error('State Tiendanube vencido.');
	}

	return payload;
}

function resolveTiendanubeStateWorkspaceId(value = '') {
	return String(verifyTiendanubeState(value)?.workspaceId || DEFAULT_WORKSPACE_ID).trim() || DEFAULT_WORKSPACE_ID;
}

function isAuthorizedAdminRequest(req) {
	return Boolean(req.user);
}

function buildInstallUrl(workspaceId = DEFAULT_WORKSPACE_ID) {
	const appId = process.env.TIENDANUBE_APP_ID;
	const redirectUri = normalizeTiendanubeRedirectUri(process.env.TIENDANUBE_REDIRECT_URI);

	if (!appId || !redirectUri) {
		throw new Error('Faltan TIENDANUBE_APP_ID o TIENDANUBE_REDIRECT_URI en el .env');
	}

	const url = new URL(`https://www.tiendanube.com/apps/${appId}/authorize`);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('state', signTiendanubeState({ workspaceId, ts: Date.now(), nonce: crypto.randomUUID() }));
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

function resolveFrontendAppBaseUrl() {
	const candidates = [
		process.env.FRONTEND_URL_PROD,
		process.env.FRONTEND_URL,
		process.env.PUBLIC_APP_URL,
		process.env.APP_URL,
	]
		.map(normalizeUrl)
		.filter(Boolean);

	return candidates[0] || null;
}

function buildTiendanubeInstallResultUrl({
	workspaceId = DEFAULT_WORKSPACE_ID,
	status = 'connected',
	storeId = '',
	message = '',
	reason = '',
}) {
	const frontendBaseUrl = resolveFrontendAppBaseUrl();
	if (!frontendBaseUrl) return null;

	const url = new URL('/admin', `${frontendBaseUrl}/`);
	url.searchParams.set('tab', 'integrations');
	url.searchParams.set('workspaceId', workspaceId);
	url.searchParams.set('tiendanube', status);
	if (storeId) {
		url.searchParams.set('storeId', storeId);
	}
	if (message) {
		url.searchParams.set('message', message);
	}
	if (reason) {
		url.searchParams.set('reason', reason);
	}
	return url.toString();
}

function buildTiendanubeFallbackHtml({
	title = 'Integracion Tiendanube',
	message = 'La integracion termino.',
	workspaceId = DEFAULT_WORKSPACE_ID,
	status = 'info'
}) {
	const safeTitle = String(title || 'Integracion Tiendanube');
	const safeMessage = String(message || 'La integracion termino.');
	const variant = status === 'error' ? '#b91c1c' : status === 'warning' ? '#b45309' : '#0f766e';
	const adminUrl = `/admin?tab=integrations&workspaceId=${encodeURIComponent(workspaceId)}`;
	return `<!doctype html>
<html lang="es">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${safeTitle}</title>
</head>
<body style="margin:0;font-family:Arial,sans-serif;background:#f5f5f4;color:#111827;">
	<div style="max-width:640px;margin:48px auto;padding:24px;">
		<div style="background:#ffffff;border:1px solid #e7e5e4;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,0.08);">
			<div style="display:inline-block;padding:6px 10px;border-radius:999px;background:${variant};color:#fff;font-size:12px;font-weight:700;letter-spacing:.02em;">Tiendanube</div>
			<h1 style="margin:16px 0 8px;font-size:28px;line-height:1.1;">${safeTitle}</h1>
			<p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#374151;">${safeMessage}</p>
			<a href="${adminUrl}" style="display:inline-block;padding:12px 16px;border-radius:10px;background:#111827;color:#fff;text-decoration:none;font-weight:700;">Volver a integraciones</a>
		</div>
	</div>
</body>
</html>`;
}

function redirectTiendanubeInstallResult(res, payload) {
	const resultUrl = buildTiendanubeInstallResultUrl(payload);
	if (resultUrl) {
		return res.redirect(resultUrl);
	}

	const status =
		payload.status === 'connected'
			? 'success'
			: payload.status === 'partial' || payload.status === 'already_connected'
				? 'warning'
				: 'error';

	return res
		.status(payload.status === 'error' ? 400 : 200)
		.send(
			buildTiendanubeFallbackHtml({
				title: 'Integracion Tiendanube',
				message: payload.message || 'La integracion termino.',
				workspaceId: payload.workspaceId,
				status
			})
		);
}

function normalizeTiendanubeCallbackFailure(errorCode = '', errorDescription = '') {
	const code = String(errorCode || '').trim().toLowerCase();
	const description = String(errorDescription || '').trim();
	const haystack = `${code} ${description}`.toLowerCase();

	if (haystack.includes('access_denied') || haystack.includes('cancel')) {
		return {
			status: 'cancelled',
			message: 'La conexion con Tiendanube fue cancelada antes de completarse.',
			reason: code || 'cancelled'
		};
	}

	if (
		haystack.includes('already') ||
		haystack.includes('instalada') ||
		haystack.includes('instalado') ||
		haystack.includes('registered') ||
		haystack.includes('conectada')
	) {
		return {
			status: 'already_connected',
			message: 'La app ya estaba conectada en esa tienda. Si queres, podes sincronizar catalogo o volver a instalarla.',
			reason: code || 'already_connected'
		};
	}

	return {
		status: 'error',
		message: description || 'No se pudo completar la conexion con Tiendanube.',
		reason: code || 'oauth_error'
	};
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

	await prisma.commerceConnection.upsert({
		where: {
			workspaceId_provider: {
				workspaceId,
				provider: 'TIENDANUBE'
			}
		},
		update: {
			externalStoreId: String(storeId),
			accessToken: encryptSecret(accessToken),
			status: 'ACTIVE',
			storeName,
			storeUrl,
			rawPayload: {
				provider: 'TIENDANUBE',
				store
			}
		},
		create: {
			workspaceId,
			provider: 'TIENDANUBE',
			externalStoreId: String(storeId),
			accessToken: encryptSecret(accessToken),
			status: 'ACTIVE',
			storeName,
			storeUrl,
			rawPayload: {
				provider: 'TIENDANUBE',
				store
			}
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
				accessToken: String(decryptSecret(byStore.accessToken)),
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
			accessToken: String(decryptSecret(latestInstallation.accessToken)),
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
		logger.error('tiendanube.install_start_failed', { error });
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export async function handleTiendanubeCallback(req, res) {
	try {
		const {
			code,
			error: callbackError,
			error_description: callbackErrorDescription
		} = req.query;
		const workspaceId = resolveTiendanubeStateWorkspaceId(req.query?.state || '');

		if (callbackError) {
			return redirectTiendanubeInstallResult(res, {
				workspaceId,
				...normalizeTiendanubeCallbackFailure(callbackError, callbackErrorDescription)
			});
		}

		if (!code) {
			return redirectTiendanubeInstallResult(res, {
				workspaceId,
				status: 'error',
				message: 'Tiendanube no devolvio el codigo de autorizacion. Proba de nuevo la conexion.',
				reason: 'missing_code'
			});
		}

		const data = await exchangeCodeForToken(code);
		const encryptedAccessToken = encryptSecret(data.access_token);

		await prisma.storeInstallation.upsert({
			where: { storeId: String(data.user_id) },
			update: {
				workspaceId,
				provider: 'TIENDANUBE',
				accessToken: encryptedAccessToken,
				scope: data.scope || null
			},
			create: {
				workspaceId,
				provider: 'TIENDANUBE',
				storeId: String(data.user_id),
				accessToken: encryptedAccessToken,
				scope: data.scope || null
			}
		});

		const connection = await prisma.commerceConnection.upsert({
			where: {
				workspaceId_provider: {
					workspaceId,
					provider: 'TIENDANUBE'
				}
			},
			update: {
				externalStoreId: String(data.user_id),
				accessToken: encryptedAccessToken,
				scope: data.scope || null,
				status: 'ACTIVE',
				rawPayload: {
					source: 'oauth-callback',
					userId: String(data.user_id),
					scope: data.scope || null
				}
			},
			create: {
				workspaceId,
				provider: 'TIENDANUBE',
				externalStoreId: String(data.user_id),
				accessToken: encryptedAccessToken,
				scope: data.scope || null,
				status: 'ACTIVE',
				rawPayload: {
					source: 'oauth-callback',
					userId: String(data.user_id),
					scope: data.scope || null
				}
			}
		});
		await markPrimaryCommerceConnection(connection.id, { workspaceId });

		let brandingResult = null;
		try {
			brandingResult = await syncTiendanubeBranding({
				workspaceId,
				storeId: String(data.user_id),
				accessToken: data.access_token
			});
		} catch (error) {
			logger.warn('tiendanube.branding_sync_failed', {
				workspaceId,
				storeId: String(data.user_id),
				error,
			});
		}

		let webhookResult = null;
		let webhookError = null;
		let catalogResult = null;
		let catalogError = null;

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
			logger.warn('tiendanube.webhook_registration_failed', {
				workspaceId,
				storeId: String(data.user_id),
				error,
			});
		}

		try {
			catalogResult = await syncCatalogFromTiendanube({ workspaceId });
		} catch (error) {
			catalogError =
				error?.message ||
				'No se pudo sincronizar el catalogo automaticamente.';
			logger.warn('tiendanube.catalog_sync_failed', {
				workspaceId,
				storeId: String(data.user_id),
				error,
			});
		}

		return redirectTiendanubeInstallResult(res, {
			workspaceId,
			status: webhookError || catalogError ? 'partial' : 'connected',
			storeId: String(data.user_id),
			message:
				webhookError || catalogError
					? `La tienda ${String(data.user_id)} se conecto, pero quedaron tareas pendientes de sincronizacion.`
					: `Tienda Nube conectada. Store ID ${String(data.user_id)}.`
		});

		const resultUrl = buildTiendanubeInstallResultUrl({
			workspaceId,
			status: webhookError || catalogError ? 'partial' : 'connected',
			storeId: String(data.user_id)
		});

		if (resultUrl) {
			return res.redirect(resultUrl);
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
		logger.error('tiendanube.callback_failed', {
			error: error.response?.data || error,
		});
		let workspaceId = DEFAULT_WORKSPACE_ID;
		try {
			workspaceId = resolveTiendanubeStateWorkspaceId(req.query?.state || '');
		} catch {
			workspaceId = DEFAULT_WORKSPACE_ID;
		}
		const rawMessage =
			error.response?.data?.error_description ||
			error.response?.data?.error ||
			error.response?.data?.message ||
			error.message;
		return redirectTiendanubeInstallResult(res, {
			workspaceId,
			...normalizeTiendanubeCallbackFailure(
				error.response?.data?.error || error.code || 'callback_error',
				rawMessage
			)
		});
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
				error: 'No autenticado. Inicia sesion admin.'
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
		logger.error('tiendanube.webhook_registration_failed', {
			error: error.response?.data || error,
		});
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
				error: 'No autenticado. Inicia sesion admin.'
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
		logger.error('tiendanube.catalog_sync_failed', { error });
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export async function getTiendanubeCatalogStatus(req, res) {
	try {
		if (!isAuthorizedAdminRequest(req)) {
			return res.status(401).json({
				ok: false,
				error: 'No autenticado. Inicia sesion admin.'
			});
		}

		const workspaceId = req.user ? requireRequestWorkspaceId(req) : String(req.query?.workspaceId || DEFAULT_WORKSPACE_ID);
		const summary = await getCatalogSummary({ workspaceId });
		return res.json({ ok: true, ...summary });
	} catch (error) {
		logger.error('tiendanube.catalog_status_failed', { error });
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export async function getTiendanubeCatalogProducts(req, res) {
	try {
		if (!isAuthorizedAdminRequest(req)) {
			return res.status(401).json({
				ok: false,
				error: 'No autenticado. Inicia sesion admin.'
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
		logger.error('tiendanube.catalog_products_failed', { error });
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
		logger.error('tiendanube.status_failed', { error });
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export const tiendanubeCallback = handleTiendanubeCallback;
