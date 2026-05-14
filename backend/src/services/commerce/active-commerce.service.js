import { prisma } from '../../lib/prisma.js';
import { decryptSecret } from '../../lib/secret-crypto.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';

function normalizeString(value = '') {
	return String(value || '').trim();
}

function normalizeShopDomain(value = '') {
	return normalizeString(value)
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '')
		.toLowerCase();
}

function normalizeProvider(value = '') {
	const provider = normalizeString(value).toUpperCase();
	return provider === 'SHOPIFY' ? 'SHOPIFY' : provider === 'TIENDANUBE' ? 'TIENDANUBE' : '';
}

function normalizeCommerceConnection(connection = null) {
	if (!connection) return null;
	const provider = normalizeProvider(connection.provider);
	const shopDomain = provider === 'SHOPIFY'
		? normalizeShopDomain(connection.shopDomain || connection.externalStoreId)
		: normalizeString(connection.shopDomain || '');
	const storeId = provider === 'SHOPIFY'
		? shopDomain || normalizeString(connection.externalStoreId)
		: normalizeString(connection.externalStoreId);

	const accessToken = connection.accessToken ? decryptSecret(connection.accessToken) : '';
	const refreshToken = connection.refreshToken ? decryptSecret(connection.refreshToken) : null;

	if (!provider || !storeId || !accessToken) return null;

	return {
		source: 'commerceConnection',
		workspaceId: connection.workspaceId,
		provider,
		storeId,
		externalStoreId: normalizeString(connection.externalStoreId) || storeId,
		shopDomain: shopDomain || null,
		accessToken,
		refreshToken,
		scope: connection.scope || null,
		status: connection.status || 'ACTIVE',
		isPrimary: Boolean(connection.isPrimary),
		storeName: connection.storeName || null,
		storeUrl: connection.storeUrl || (shopDomain ? `https://${shopDomain}` : null),
		rawPayload: connection.rawPayload || null,
		updatedAt: connection.updatedAt || null,
	};
}

function normalizeStoreInstallation(installation = null) {
	const accessToken = installation?.accessToken ? decryptSecret(installation.accessToken) : '';
	if (!installation?.storeId || !accessToken) return null;
	return {
		source: 'storeInstallation',
		workspaceId: installation.workspaceId,
		provider: normalizeProvider(installation.provider) || 'TIENDANUBE',
		storeId: normalizeString(installation.storeId),
		externalStoreId: normalizeString(installation.storeId),
		shopDomain: null,
		accessToken,
		refreshToken: null,
		scope: installation.scope || null,
		status: 'ACTIVE',
		isPrimary: false,
		storeName: installation.storeName || null,
		storeUrl: installation.storeUrl || null,
		rawPayload: null,
		updatedAt: installation.updatedAt || null,
	};
}

export async function resolveActiveCommerceConnection({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;

	const connections = await prisma.commerceConnection.findMany({
		where: {
			workspaceId: resolvedWorkspaceId,
			status: 'ACTIVE',
		},
		orderBy: [
			{ isPrimary: 'desc' },
			{ updatedAt: 'desc' },
			{ installedAt: 'desc' },
		],
	});

	const normalized = connections.map(normalizeCommerceConnection).filter(Boolean);
	if (normalized.length) {
		const primary = normalized.find((connection) => connection.isPrimary) || normalized[0];
		return {
			...primary,
			warning: normalized.filter((connection) => connection.isPrimary).length > 1
				? 'multiple_primary_connections'
				: normalized.length > 1 && !primary.isPrimary
					? 'multiple_active_connections_using_latest'
					: null,
		};
	}

	const installation = await prisma.storeInstallation.findFirst({
		where: {
			workspaceId: resolvedWorkspaceId,
			provider: 'TIENDANUBE',
		},
		orderBy: { updatedAt: 'desc' },
	});
	const normalizedInstallation = normalizeStoreInstallation(installation);
	if (normalizedInstallation) return normalizedInstallation;

	if (resolvedWorkspaceId === DEFAULT_WORKSPACE_ID && process.env.TIENDANUBE_STORE_ID && process.env.TIENDANUBE_ACCESS_TOKEN) {
		return {
			source: 'env',
			workspaceId: resolvedWorkspaceId,
			provider: 'TIENDANUBE',
			storeId: normalizeString(process.env.TIENDANUBE_STORE_ID),
			externalStoreId: normalizeString(process.env.TIENDANUBE_STORE_ID),
			shopDomain: null,
			accessToken: normalizeString(process.env.TIENDANUBE_ACCESS_TOKEN),
			refreshToken: null,
			scope: null,
			status: 'ACTIVE',
			isPrimary: false,
			storeName: null,
			storeUrl: null,
			rawPayload: null,
			updatedAt: null,
		};
	}

	const error = new Error('Conecta una tienda activa antes de sincronizar.');
	error.status = 400;
	error.code = 'NO_ACTIVE_COMMERCE_CONNECTION';
	throw error;
}

export async function markPrimaryCommerceConnection(connectionId, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	if (!connectionId) return null;

	return prisma.$transaction(async (tx) => {
		await tx.commerceConnection.updateMany({
			where: { workspaceId: resolvedWorkspaceId },
			data: { isPrimary: false },
		});
		return tx.commerceConnection.update({
			where: { id: connectionId },
			data: { isPrimary: true },
		});
	});
}
