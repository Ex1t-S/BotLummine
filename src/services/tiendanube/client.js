import 'dotenv/config';
import axios from 'axios';
import { prisma } from '../../lib/prisma.js';

function buildHeaders(accessToken) {
	return {
		Authentication: `bearer ${accessToken}`,
		'Content-Type': 'application/json',
		'User-Agent':
			process.env.TIENDANUBE_USER_AGENT ||
			'Lummine IA Assistant (soporte@lummine.com)'
	};
}

function buildBaseUrl(storeId) {
	const apiVersion = process.env.TIENDANUBE_API_VERSION || '2025-03';
	return `https://api.tiendanube.com/${apiVersion}/${storeId}`;
}

function getEnvTiendanubeConfig() {
	const storeId = process.env.TIENDANUBE_STORE_ID || null;
	const accessToken = process.env.TIENDANUBE_ACCESS_TOKEN || null;

	if (!storeId || !accessToken) {
		return null;
	}

	return {
		storeId: String(storeId),
		accessToken: String(accessToken),
		source: 'env'
	};
}

async function getStoredTiendanubeConfig() {
	const installation = await prisma.storeInstallation.findFirst({
		orderBy: { installedAt: 'desc' }
	});

	if (!installation?.storeId || !installation?.accessToken) {
		return null;
	}

	return {
		storeId: String(installation.storeId),
		accessToken: String(installation.accessToken),
		storeName: installation.storeName || null,
		storeUrl: installation.storeUrl || null,
		installedAt: installation.installedAt,
		source: 'database'
	};
}

export async function getTiendanubeConfig() {
	const stored = await getStoredTiendanubeConfig();
	if (stored) return stored;

	const envConfig = getEnvTiendanubeConfig();
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

export async function getTiendanubeClient() {
	const installation = await getTiendanubeConfig();

	return {
		client: createTiendanubeClient(installation),
		installation
	};
}