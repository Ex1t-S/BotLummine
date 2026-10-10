import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { encryptSecret } from '../lib/secret-crypto.js';
import { syncCatalogFromShopify } from '../services/catalog/catalog.service.js';
import { syncCustomers } from '../services/customers/customer.service.js';
import { markPrimaryCommerceConnection } from '../services/commerce/active-commerce.service.js';
import { DEFAULT_WORKSPACE_ID, requireRequestWorkspaceId } from '../services/workspaces/workspace-context.service.js';

const SHOPIFY_DEFAULT_SCOPES = 'read_products,read_orders,read_customers,read_fulfillments,read_inventory,read_locations,read_checkouts,read_themes';
const SHOPIFY_ALLOWED_SCOPES = new Set([
	'read_products',
	'read_orders',
	'read_all_orders',
	'read_customers',
	'read_fulfillments',
	'read_inventory',
	'read_locations',
	'read_checkouts',
	'read_themes'
]);
const SHOPIFY_WEBHOOK_TOPICS = [
	'orders/create',
	'orders/updated',
	'orders/paid',
	'orders/cancelled',
	'orders/fulfilled',
	'refunds/create',
	'fulfillments/create',
	'fulfillment_events/create',
	'products/create',
	'products/update',
	'products/delete',
	'customers/create',
	'customers/update',
	'app/uninstalled'
];

function cleanString(value = '') {
	return String(value || '').trim();
}

function normalizeUrl(value = '') {
	return cleanString(value).replace(/\/+$/, '');
}

function normalizeShopDomain(value = '') {
	const raw = cleanString(value)
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '')
		.toLowerCase();
	if (!raw) return '';
	return raw.endsWith('.myshopify.com') ? raw : `${raw}.myshopify.com`;
}

function getClientId() {
	return cleanString(process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_API_KEY);
}

function getClientSecret() {
	return cleanString(process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_API_SECRET);
}

function getScopes() {
	const configuredScopes = cleanString(process.env.SHOPIFY_APP_SCOPES || SHOPIFY_DEFAULT_SCOPES)
		.split(',')
		.map((scope) => scope.trim())
		.filter(Boolean)
		.filter((scope) => SHOPIFY_ALLOWED_SCOPES.has(scope));
	return (configuredScopes.length ? configuredScopes : SHOPIFY_DEFAULT_SCOPES.split(',')).join(',');
}

function getApiVersion() {
	return cleanString(process.env.SHOPIFY_API_VERSION || '2026-04');
}

function resolveFrontendAppBaseUrl() {
	return [
		process.env.FRONTEND_URL_PROD,
		process.env.FRONTEND_URL,
		process.env.PUBLIC_APP_URL,
		process.env.APP_URL
	].map(normalizeUrl).find(Boolean) || null;
}

function resolvePublicBackendBaseUrl(req) {
	const candidates = [
		process.env.SHOPIFY_WEBHOOK_BASE_URL,
		process.env.BACKEND_PUBLIC_URL,
		process.env.BACKEND_URL,
		process.env.PUBLIC_APP_URL,
		process.env.APP_URL,
		process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : null,
		req ? `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}` : null
	].map(normalizeUrl).filter(Boolean);
	const baseUrl = candidates[0] || null;
	if (!baseUrl) throw new Error('No se pudo resolver la URL publica del backend para Shopify.');
	if (!baseUrl.startsWith('https://')) {
		throw new Error(`La URL publica del backend debe ser HTTPS para Shopify. Valor actual: ${baseUrl}`);
	}
	return baseUrl;
}

function getRedirectUri(req) {
	const configured = normalizeUrl(process.env.SHOPIFY_REDIRECT_URI);
	if (configured) return configured;
	return `${resolvePublicBackendBaseUrl(req)}/api/shopify/callback`;
}

function signState(payload) {
	const secret = getClientSecret();
	if (!secret) throw new Error('Falta SHOPIFY_CLIENT_SECRET en el entorno.');
	const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
	return `${body}.${signature}`;
}

function verifyState(value = '') {
	const [body, signature] = cleanString(value).split('.');
	if (!body || !signature) throw new Error('State Shopify invalido.');
	const expected = crypto.createHmac('sha256', getClientSecret()).update(body).digest('base64url');
	if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
		throw new Error('State Shopify no coincide.');
	}
	const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
	if (!payload?.workspaceId) throw new Error('State Shopify sin workspaceId.');
	const ageMs = Date.now() - Number(payload.ts || 0);
	if (!Number.isFinite(ageMs) || ageMs > 60 * 60 * 1000) {
		throw new Error('State Shopify vencido.');
	}
	return payload;
}

function verifyShopifyQueryHmac(query = {}) {
	const secret = getClientSecret();
	const provided = cleanString(query.hmac);
	if (!secret || !provided) return false;
	const message = Object.entries(query)
		.filter(([key]) => key !== 'hmac' && key !== 'signature')
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`)
		.join('&');
	const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
	return provided.length === expected.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function buildInstallResultUrl({ workspaceId, status, shop = '', message = '' }) {
	const frontendBaseUrl = resolveFrontendAppBaseUrl();
	if (!frontendBaseUrl) return null;
	const url = new URL('/admin', `${frontendBaseUrl}/`);
	url.searchParams.set('tab', 'integrations');
	url.searchParams.set('workspaceId', workspaceId || DEFAULT_WORKSPACE_ID);
	url.searchParams.set('shopify', status);
	if (shop) url.searchParams.set('shop', shop);
	if (message) url.searchParams.set('message', message);
	return url.toString();
}

function redirectInstallResult(res, result) {
	const resultUrl = buildInstallResultUrl(result);
	if (resultUrl) return res.redirect(resultUrl);
	return res.json({ ok: result.status === 'connected', ...result });
}

async function fetchShopInfo(shopDomain, accessToken) {
	const response = await fetch(`https://${shopDomain}/admin/api/${getApiVersion()}/shop.json`, {
		headers: {
			'X-Shopify-Access-Token': accessToken,
			'Content-Type': 'application/json'
		}
	});
	if (!response.ok) {
		throw new Error(`Shopify no devolvio datos de la tienda (${response.status}).`);
	}
	return response.json();
}

async function listShopifyWebhooks(shopDomain, accessToken) {
	const response = await fetch(`https://${shopDomain}/admin/api/${getApiVersion()}/webhooks.json?limit=250`, {
		headers: {
			'X-Shopify-Access-Token': accessToken,
			'Content-Type': 'application/json'
		}
	});
	if (!response.ok) {
		throw new Error(`No se pudieron consultar los webhooks existentes de Shopify (${response.status}).`);
	}
	const body = await response.json();
	return Array.isArray(body?.webhooks) ? body.webhooks : [];
}

async function registerWebhook(shopDomain, accessToken, topic, address) {
	const response = await fetch(`https://${shopDomain}/admin/api/${getApiVersion()}/webhooks.json`, {
		method: 'POST',
		headers: {
			'X-Shopify-Access-Token': accessToken,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			webhook: {
				topic,
				address,
				format: 'json'
			}
		})
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`No se pudo registrar webhook Shopify ${topic}: ${response.status} ${body}`);
	}
	return response.json();
}

async function registerShopifyWebhooks(req, { shopDomain, accessToken }) {
	const baseUrl = resolvePublicBackendBaseUrl(req);
	const address = `${baseUrl}/api/webhook/shopify`;
	let existingWebhooks = [];
	try {
		existingWebhooks = await listShopifyWebhooks(shopDomain, accessToken);
	} catch (error) {
		return [{
			topic: 'list',
			error: error?.message || 'No se pudieron consultar los webhooks existentes de Shopify.'
		}];
	}
	const existingTopics = new Set(
		existingWebhooks
			.filter((webhook) => webhook.address === address)
			.map((webhook) => webhook.topic)
	);
	const results = [];
	for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
		if (existingTopics.has(topic)) {
			results.push({ topic, existing: true });
			continue;
		}
		try {
			results.push(await registerWebhook(shopDomain, accessToken, topic, address));
		} catch (error) {
			results.push({ topic, error: error.message });
		}
	}
	return results;
}

export async function startShopifyInstall(req, res) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const shopDomain = normalizeShopDomain(req.query?.shop || req.query?.shopDomain);
		const clientId = getClientId();
		if (!clientId || !getClientSecret()) {
			throw new Error('Faltan SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET en el entorno.');
		}
		if (!shopDomain) {
			return res.status(400).json({ ok: false, error: 'Falta el dominio Shopify.' });
		}

		const state = signState({ workspaceId, shopDomain, ts: Date.now(), nonce: crypto.randomUUID() });
		const url = new URL(`https://${shopDomain}/admin/oauth/authorize`);
		url.searchParams.set('client_id', clientId);
		url.searchParams.set('scope', getScopes());
		url.searchParams.set('redirect_uri', getRedirectUri(req));
		url.searchParams.set('state', state);
		return res.redirect(url.toString());
	} catch (error) {
		return res.status(500).json({ ok: false, error: error.message });
	}
}

export async function handleShopifyCallback(req, res) {
	let workspaceId = null;
	let shopDomain = normalizeShopDomain(req.query?.shop);
	const state = cleanString(req.query?.state);
	let statePayload = null;
	try {
		if (state) {
			statePayload = verifyState(state);
			workspaceId = statePayload.workspaceId;
		}
	} catch {
		// The signed state is validated again below; don't trust workspace IDs from query parameters.
	}

	try {
		const code = cleanString(req.query?.code);
		const oauthError = cleanString(req.query?.error);
		if (oauthError) {
			return redirectInstallResult(res, {
				workspaceId,
				status: oauthError === 'access_denied' ? 'cancelled' : 'error',
				shop: shopDomain,
				message: oauthError === 'access_denied'
					? 'La autorización de Shopify fue cancelada.'
					: 'Shopify no pudo autorizar la app. Revisá la versión y los permisos publicados.'
			});
		}
		if (!shopDomain || !code || !state) {
			return redirectInstallResult(res, {
				workspaceId,
				status: 'error',
				shop: shopDomain,
				message: 'Shopify no devolvió los datos necesarios para completar la conexión.'
			});
		}
		statePayload = statePayload || verifyState(state);
		workspaceId = statePayload.workspaceId;
		if (statePayload.shopDomain && normalizeShopDomain(statePayload.shopDomain) !== shopDomain) {
			return redirectInstallResult(res, {
				workspaceId,
				status: 'error',
				shop: shopDomain,
				message: 'La tienda del retorno OAuth no coincide con la tienda solicitada.'
			});
		}
		if (!verifyShopifyQueryHmac(req.query)) {
			return redirectInstallResult(res, {
				workspaceId,
				status: 'error',
				shop: shopDomain,
				message: 'Firma OAuth Shopify invalida.'
			});
		}

		const tokenResponse = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				client_id: getClientId(),
				client_secret: getClientSecret(),
				code
			})
		});
		if (!tokenResponse.ok) {
			const body = await tokenResponse.text();
			throw new Error(`No se pudo obtener token Shopify: ${tokenResponse.status} ${body}`);
		}
		const tokenData = await tokenResponse.json();
		const accessToken = cleanString(tokenData.access_token);
		if (!accessToken) throw new Error('Shopify no devolvio access_token.');
		const encryptedAccessToken = encryptSecret(accessToken);

		const existingExternal = await prisma.commerceConnection.findUnique({
			where: {
				provider_externalStoreId: {
					provider: 'SHOPIFY',
					externalStoreId: shopDomain
				}
			},
			select: { workspaceId: true }
		});
		if (existingExternal?.workspaceId && existingExternal.workspaceId !== workspaceId) {
			return redirectInstallResult(res, {
				workspaceId,
				status: 'error',
				shop: shopDomain,
				message: 'Esa tienda Shopify ya esta conectada a otro workspace.'
			});
		}

		const shopInfo = await fetchShopInfo(shopDomain, accessToken).catch(() => null);
		const shop = shopInfo?.shop || {};
		const connection = await prisma.commerceConnection.upsert({
			where: {
				workspaceId_provider: {
					workspaceId,
					provider: 'SHOPIFY'
				}
			},
			update: {
				externalStoreId: shopDomain,
				shopDomain,
				accessToken: encryptedAccessToken,
				scope: tokenData.scope || getScopes(),
				status: 'ACTIVE',
				storeName: shop.name || shopDomain,
				storeUrl: shop.domain ? `https://${shop.domain}` : `https://${shopDomain}`,
				rawPayload: {
					source: 'oauth-callback',
					apiVersion: getApiVersion(),
					shop,
					scope: tokenData.scope || getScopes()
				}
			},
			create: {
				workspaceId,
				provider: 'SHOPIFY',
				externalStoreId: shopDomain,
				shopDomain,
				accessToken: encryptedAccessToken,
				scope: tokenData.scope || getScopes(),
				status: 'ACTIVE',
				storeName: shop.name || shopDomain,
				storeUrl: shop.domain ? `https://${shop.domain}` : `https://${shopDomain}`,
				rawPayload: {
					source: 'oauth-callback',
					apiVersion: getApiVersion(),
					shop,
					scope: tokenData.scope || getScopes()
				}
			}
		});
		await markPrimaryCommerceConnection(connection.id, { workspaceId });

		let webhookResult = [];
		try {
			webhookResult = await registerShopifyWebhooks(req, { shopDomain, accessToken });
		} catch (error) {
			webhookResult = [{ topic: 'registration', error: error?.message || 'No se pudieron registrar los webhooks Shopify.' }];
		}
		let catalogError = null;
		let customerSyncError = null;
		let customerSyncStarted = false;
		try {
			await syncCatalogFromShopify({ workspaceId });
		} catch (error) {
			catalogError = error?.message || 'No se pudo sincronizar catalogo Shopify.';
		}
		try {
			const customerSync = await syncCustomers({ workspaceId, provider: 'SHOPIFY' });
			customerSyncStarted = Boolean(customerSync?.started || customerSync?.running);
		} catch (error) {
			customerSyncError = error?.message || 'No se pudo iniciar la sincronización de clientes y pedidos Shopify.';
		}

		const webhookErrors = webhookResult.filter((item) => item?.error);
		const hasPendingTasks = Boolean(webhookErrors.length || catalogError || customerSyncError || !customerSyncStarted);
		return redirectInstallResult(res, {
			workspaceId,
			status: hasPendingTasks ? 'partial' : 'connected',
			shop: shopDomain,
			message: hasPendingTasks
				? `Shopify quedó conectado para ${shopDomain}, pero la sincronización inicial requiere revisión.`
				: `Shopify conectado para ${shopDomain}. Catálogo sincronizado y clientes/pedidos en proceso.`
		});
	} catch (error) {
		return redirectInstallResult(res, {
			workspaceId,
			status: 'error',
			shop: shopDomain,
			message: 'No se pudo completar OAuth con Shopify. Revisá la URL de retorno, el flujo de instalación y los permisos de la versión activa.'
		});
	}
}

export async function getShopifyStatus(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const connection = await prisma.commerceConnection.findUnique({
			where: {
				workspaceId_provider: {
					workspaceId,
					provider: 'SHOPIFY'
				}
			}
		});
		return res.json({
			ok: true,
			connected: Boolean(connection?.accessToken && connection.status === 'ACTIVE'),
			shopDomain: connection?.shopDomain || connection?.externalStoreId || null,
			storeName: connection?.storeName || null,
			storeUrl: connection?.storeUrl || null,
			scope: connection?.scope || null,
			status: connection?.status || 'DISABLED',
			apiVersion: connection?.rawPayload?.apiVersion || getApiVersion(),
			hasClientSecret: Boolean(getClientSecret()),
			source: connection?.rawPayload?.source || null
		});
	} catch (error) {
		next(error);
	}
}
