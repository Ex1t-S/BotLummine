import 'dotenv/config';
import axios from 'axios';
import { prisma } from '../../lib/prisma.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';

function buildHeaders(accessToken) {
	return {
		Authentication: `bearer ${accessToken}`,
		'Content-Type': 'application/json',
		'User-Agent':
		process.env.TIENDANUBE_USER_AGENT ||
			'Multi Brand IA Assistant'
	};
}

function buildBaseUrl(storeId) {
	const apiVersion = process.env.TIENDANUBE_API_VERSION || '2025-03';
	return `https://api.tiendanube.com/${apiVersion}/${storeId}`;
}

function getEnvTiendanubeConfig(workspaceId = DEFAULT_WORKSPACE_ID) {
	const storeId = process.env.TIENDANUBE_STORE_ID || null;
	const accessToken = process.env.TIENDANUBE_ACCESS_TOKEN || null;

	if (normalizeWorkspaceId(workspaceId) !== DEFAULT_WORKSPACE_ID || !storeId || !accessToken) {
		return null;
	}

	return {
		storeId: String(storeId),
		accessToken: String(accessToken),
		workspaceId: DEFAULT_WORKSPACE_ID,
		source: 'env'
	};
}

async function getStoredTiendanubeConfig(workspaceId = DEFAULT_WORKSPACE_ID) {
	const installation = await prisma.storeInstallation.findFirst({
		where: {
			workspaceId: normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID,
			provider: 'TIENDANUBE',
		},
		orderBy: { installedAt: 'desc' }
	});

	if (!installation?.storeId || !installation?.accessToken) {
		return null;
	}

	return {
		storeId: String(installation.storeId),
		accessToken: String(installation.accessToken),
		workspaceId: installation.workspaceId,
		storeName: installation.storeName || null,
		storeUrl: installation.storeUrl || null,
		installedAt: installation.installedAt,
		source: 'database'
	};
}

export async function getTiendanubeConfig({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const stored = await getStoredTiendanubeConfig(resolvedWorkspaceId);
	if (stored) return stored;

	const envConfig = getEnvTiendanubeConfig(resolvedWorkspaceId);
	if (envConfig) return envConfig;

	throw new Error('Faltan credenciales de Tiendanube. Configurá StoreInstallation o TIENDANUBE_STORE_ID/TIENDANUBE_ACCESS_TOKEN en el .env');
}

export function createTiendanubeClient(config = null) {
	const resolved = config || getEnvTiendanubeConfig();

	if (!resolved?.storeId || !resolved?.accessToken) {
		throw new Error('Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN en el .env');
	}

	return axios.create({
		baseURL: buildBaseUrl(resolved.storeId),
		headers: buildHeaders(resolved.accessToken),
		timeout: 15000
	});
}

export async function getTiendanubeClient({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const installation = await getTiendanubeConfig({ workspaceId });

	return {
		client: createTiendanubeClient(installation),
		installation
	};
}
