import axios from 'axios';
import { prisma } from '../../lib/prisma.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';

function normalizeString(value = '') {
	return String(value || '').trim();
}

function normalizeShopDomain(value = '') {
	const normalized = normalizeString(value)
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '')
		.toLowerCase();

	return normalized;
}

function getEnvShopifyConfig(workspaceId = DEFAULT_WORKSPACE_ID) {
	if (workspaceId !== DEFAULT_WORKSPACE_ID) return null;

	const shopDomain = normalizeShopDomain(process.env.SHOPIFY_SHOP_DOMAIN || '');
	const accessToken = normalizeString(process.env.SHOPIFY_ACCESS_TOKEN || '');

	if (!shopDomain || !accessToken) return null;

	return {
		source: 'env',
		workspaceId,
		provider: 'SHOPIFY',
		externalStoreId: shopDomain,
		shopDomain,
		accessToken,
		storeName: normalizeString(process.env.SHOPIFY_STORE_NAME || shopDomain),
		storeUrl: `https://${shopDomain}`,
		apiVersion: normalizeString(process.env.SHOPIFY_API_VERSION || '2026-04')
	};
}

async function getStoredShopifyConfig(workspaceId = DEFAULT_WORKSPACE_ID) {
	const connection = await prisma.commerceConnection.findFirst({
		where: {
			workspaceId,
			provider: 'SHOPIFY',
			status: 'ACTIVE'
		},
		orderBy: { updatedAt: 'desc' }
	});

	if (!connection?.accessToken || !connection?.externalStoreId) return null;

	const shopDomain = normalizeShopDomain(connection.shopDomain || connection.externalStoreId);

	return {
		source: 'database',
		workspaceId,
		provider: 'SHOPIFY',
		externalStoreId: connection.externalStoreId,
		shopDomain,
		accessToken: connection.accessToken,
		storeName: connection.storeName || shopDomain,
		storeUrl: connection.storeUrl || `https://${shopDomain}`,
		apiVersion:
			normalizeString(connection.rawPayload?.apiVersion) ||
			normalizeString(process.env.SHOPIFY_API_VERSION || '2026-04')
	};
}

export async function getShopifyConfig({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const stored = await getStoredShopifyConfig(resolvedWorkspaceId);
	if (stored) return stored;

	const envConfig = getEnvShopifyConfig(resolvedWorkspaceId);
	if (envConfig) return envConfig;

	throw new Error('Faltan credenciales de Shopify. Configura CommerceConnection SHOPIFY o SHOPIFY_SHOP_DOMAIN/SHOPIFY_ACCESS_TOKEN.');
}

export async function getShopifyClient({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const config = await getShopifyConfig({ workspaceId });
	const client = axios.create({
		baseURL: `https://${config.shopDomain}/admin/api/${config.apiVersion}`,
		headers: {
			'X-Shopify-Access-Token': config.accessToken,
			'Content-Type': 'application/json'
		},
		timeout: 30_000
	});

	return { client, config };
}
