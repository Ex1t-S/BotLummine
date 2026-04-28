import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_WORKSPACE_ID = process.env.DEFAULT_WORKSPACE_ID || 'workspace_lummine';
const DEFAULT_WORKSPACE_SLUG = process.env.DEFAULT_WORKSPACE_SLUG || 'lummine';

function clean(value = '') {
	const text = String(value || '').trim();
	return text || null;
}

function boolString(value, fallback = false) {
	if (value == null || value === '') return fallback;
	return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function numberString(value, fallback = null) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

async function upsertWorkspace() {
	const name = clean(process.env.BUSINESS_NAME) || 'Lummine';
	const workspace = await prisma.workspace.upsert({
		where: { id: DEFAULT_WORKSPACE_ID },
		update: {
			name,
			slug: DEFAULT_WORKSPACE_SLUG,
			status: 'ACTIVE'
		},
		create: {
			id: DEFAULT_WORKSPACE_ID,
			name,
			slug: DEFAULT_WORKSPACE_SLUG,
			status: 'ACTIVE'
		}
	});

	await prisma.workspaceBranding.upsert({
		where: { workspaceId: workspace.id },
		update: {},
		create: { workspaceId: workspace.id }
	});

	return workspace;
}

async function upsertAiConfig(workspaceId) {
	const transfer = {
		alias: clean(process.env.TRANSFER_ALIAS),
		cbu: clean(process.env.TRANSFER_CBU),
		holder: clean(process.env.TRANSFER_HOLDER),
		bank: clean(process.env.TRANSFER_BANK),
		extra: clean(process.env.TRANSFER_EXTRA)
	};

	const paymentConfig = {
		transfer,
		discounts: {
			transferPercent: 15
		}
	};

	const catalogConfig = {
		urls: {
			bodys: clean(process.env.CATALOG_URL_BODYS),
			bombachasModeladoras: clean(process.env.CATALOG_URL_BOMBACHAS_MODELADORAS),
			calzasLinfaticas: clean(process.env.CATALOG_URL_CALZAS_LINFATICAS),
			fajas: clean(process.env.CATALOG_URL_FAJAS),
			shortsFaja: clean(process.env.CATALOG_URL_SHORTS_FAJA)
		}
	};

	return prisma.workspaceAiConfig.upsert({
		where: { workspaceId },
		update: {
			businessName: clean(process.env.BUSINESS_NAME) || 'Lummine',
			agentName: clean(process.env.BUSINESS_AGENT_NAME) || 'Sofi',
			tone: clean(process.env.BRAND_TONE) || 'humana, directa y comercial',
			systemPrompt: clean(process.env.SYSTEM_PROMPT),
			businessContext: clean(process.env.BUSINESS_CONTEXT),
			paymentConfig,
			catalogConfig
		},
		create: {
			workspaceId,
			businessName: clean(process.env.BUSINESS_NAME) || 'Lummine',
			agentName: clean(process.env.BUSINESS_AGENT_NAME) || 'Sofi',
			tone: clean(process.env.BRAND_TONE) || 'humana, directa y comercial',
			systemPrompt: clean(process.env.SYSTEM_PROMPT),
			businessContext: clean(process.env.BUSINESS_CONTEXT),
			paymentConfig,
			catalogConfig
		}
	});
}

async function upsertTiendanube(workspaceId) {
	const storeId = clean(process.env.TIENDANUBE_STORE_ID);
	const accessToken = clean(process.env.TIENDANUBE_ACCESS_TOKEN);
	if (!storeId || !accessToken) return false;

	await prisma.storeInstallation.upsert({
		where: { storeId },
		update: {
			workspaceId,
			provider: 'TIENDANUBE',
			accessToken,
			scope: clean(process.env.TIENDANUBE_APP_SCOPES)
		},
		create: {
			workspaceId,
			provider: 'TIENDANUBE',
			storeId,
			accessToken,
			scope: clean(process.env.TIENDANUBE_APP_SCOPES)
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
			externalStoreId: storeId,
			accessToken,
			scope: clean(process.env.TIENDANUBE_APP_SCOPES),
			status: 'ACTIVE',
			rawPayload: {
				source: 'env-import'
			}
		},
		create: {
			workspaceId,
			provider: 'TIENDANUBE',
			externalStoreId: storeId,
			accessToken,
			scope: clean(process.env.TIENDANUBE_APP_SCOPES),
			status: 'ACTIVE',
			rawPayload: {
				source: 'env-import'
			}
		}
	});

	return true;
}

async function upsertWhatsApp(workspaceId) {
	const phoneNumberId = clean(process.env.WHATSAPP_PHONE_NUMBER_ID);
	const accessToken = clean(process.env.WHATSAPP_ACCESS_TOKEN);
	const wabaId = clean(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || process.env.WHATSAPP_WABA_ID);
	if (!phoneNumberId || !accessToken || !wabaId) return false;

	await prisma.whatsAppChannel.upsert({
		where: { phoneNumberId },
		update: {
			workspaceId,
			name: 'Canal principal',
			wabaId,
			accessToken,
			verifyToken: clean(process.env.WHATSAPP_VERIFY_TOKEN),
			graphVersion: clean(process.env.WHATSAPP_GRAPH_VERSION),
			status: 'ACTIVE'
		},
		create: {
			workspaceId,
			name: 'Canal principal',
			wabaId,
			phoneNumberId,
			accessToken,
			verifyToken: clean(process.env.WHATSAPP_VERIFY_TOKEN),
			graphVersion: clean(process.env.WHATSAPP_GRAPH_VERSION),
			status: 'ACTIVE'
		}
	});

	return true;
}

async function upsertEnbox(workspaceId) {
	const username = clean(process.env.ENBOX_USERNAME);
	const password = clean(process.env.ENBOX_PASSWORD);
	if (!username || !password) return false;

	await prisma.logisticsConnection.upsert({
		where: {
			workspaceId_provider: {
				workspaceId,
				provider: 'ENBOX'
			}
		},
		update: {
			username,
			password,
			status: 'ACTIVE',
			config: {
				panelBaseUrl: clean(process.env.ENBOX_PANEL_BASE_URL),
				publicBaseUrl: clean(process.env.ENBOX_PUBLIC_BASE_URL),
				publicTrackingSalt: clean(process.env.ENBOX_PUBLIC_TRACKING_SALT),
				targetClientId: clean(process.env.ENBOX_TARGET_CLIENT_ID),
				discoverySeedDid: numberString(process.env.ENBOX_DISCOVERY_SEED_DID),
				syncEnabled: boolString(process.env.ENBOX_SYNC_ENABLED, true)
			}
		},
		create: {
			workspaceId,
			provider: 'ENBOX',
			username,
			password,
			status: 'ACTIVE',
			config: {
				panelBaseUrl: clean(process.env.ENBOX_PANEL_BASE_URL),
				publicBaseUrl: clean(process.env.ENBOX_PUBLIC_BASE_URL),
				publicTrackingSalt: clean(process.env.ENBOX_PUBLIC_TRACKING_SALT),
				targetClientId: clean(process.env.ENBOX_TARGET_CLIENT_ID),
				discoverySeedDid: numberString(process.env.ENBOX_DISCOVERY_SEED_DID),
				syncEnabled: boolString(process.env.ENBOX_SYNC_ENABLED, true)
			}
		}
	});

	return true;
}

async function main() {
	const workspace = await upsertWorkspace();
	await upsertAiConfig(workspace.id);

	const results = {
		tiendanube: await upsertTiendanube(workspace.id),
		whatsapp: await upsertWhatsApp(workspace.id),
		enbox: await upsertEnbox(workspace.id)
	};

	console.log(JSON.stringify({
		ok: true,
		workspaceId: workspace.id,
		imported: results
	}, null, 2));
}

main()
	.catch((error) => {
		console.error(error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
