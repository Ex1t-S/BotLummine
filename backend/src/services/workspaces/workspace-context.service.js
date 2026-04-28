import { prisma } from '../../lib/prisma.js';

export const DEFAULT_WORKSPACE_ID = 'workspace_lummine';
export const DEFAULT_WORKSPACE_SLUG = 'lummine';

export function normalizeWorkspaceId(value = '') {
	return String(value || '').trim();
}

export function isPlatformAdmin(user = null) {
	return String(user?.role || '').trim().toUpperCase() === 'PLATFORM_ADMIN';
}

export function resolveRequestWorkspaceId(req, { allowDefaultForPlatformAdmin = true } = {}) {
	const userWorkspaceId = normalizeWorkspaceId(req?.user?.workspaceId);
	if (userWorkspaceId) return userWorkspaceId;

	if (isPlatformAdmin(req?.user)) {
		const explicit =
			normalizeWorkspaceId(req?.params?.workspaceId) ||
			normalizeWorkspaceId(req?.query?.workspaceId) ||
			normalizeWorkspaceId(req?.headers?.['x-workspace-id']) ||
			normalizeWorkspaceId(req?.body?.workspaceId);

		if (explicit) return explicit;
		if (allowDefaultForPlatformAdmin) return DEFAULT_WORKSPACE_ID;
	}

	return '';
}

export function requireRequestWorkspaceId(req, options = {}) {
	const workspaceId = resolveRequestWorkspaceId(req, options);

	if (!workspaceId) {
		const error = new Error('No se pudo resolver el workspace de la solicitud.');
		error.status = 400;
		throw error;
	}

	return workspaceId;
}

export function ensureWorkspaceAccess(req, workspaceId) {
	const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
	if (!normalizedWorkspaceId) return false;
	if (isPlatformAdmin(req?.user)) return true;
	return normalizeWorkspaceId(req?.user?.workspaceId) === normalizedWorkspaceId;
}

export async function getWorkspaceOrThrow(workspaceId) {
	const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
	const workspace = await prisma.workspace.findUnique({
		where: { id: normalizedWorkspaceId },
		include: {
			branding: true,
			aiConfig: true,
		},
	});

	if (!workspace) {
		const error = new Error('Workspace no encontrado.');
		error.status = 404;
		throw error;
	}

	return workspace;
}

export async function ensureDefaultWorkspace() {
	const workspace = await prisma.workspace.upsert({
		where: { slug: DEFAULT_WORKSPACE_SLUG },
		update: {},
		create: {
			id: DEFAULT_WORKSPACE_ID,
			name: 'Lummine',
			slug: DEFAULT_WORKSPACE_SLUG,
			status: 'ACTIVE',
			aiConfig: {
				create: {
					businessName: process.env.BUSINESS_NAME || 'Lummine',
					agentName: process.env.BUSINESS_AGENT_NAME || 'Sofi',
					tone: 'humana, directa y comercial',
					systemPrompt:
						process.env.SYSTEM_PROMPT ||
						'Responde como asesora humana de ventas por WhatsApp. Sona natural, directa y comercial.',
					businessContext: process.env.BUSINESS_CONTEXT || '',
				},
			},
			branding: {
				create: {},
			},
		},
		include: {
			branding: true,
			aiConfig: true,
		},
	});

	await prisma.workspaceAiConfig.upsert({
		where: { workspaceId: workspace.id },
		update: {},
		create: {
			workspaceId: workspace.id,
			businessName: process.env.BUSINESS_NAME || workspace.name || 'Lummine',
			agentName: process.env.BUSINESS_AGENT_NAME || 'Sofi',
			tone: 'humana, directa y comercial',
			systemPrompt:
				process.env.SYSTEM_PROMPT ||
				'Responde como asesora humana de ventas por WhatsApp. Sona natural, directa y comercial.',
			businessContext: process.env.BUSINESS_CONTEXT || '',
		},
	});

	await prisma.workspaceBranding.upsert({
		where: { workspaceId: workspace.id },
		update: {},
		create: { workspaceId: workspace.id },
	});

	return workspace;
}

export async function getWorkspaceRuntimeConfig(workspaceId) {
	const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const workspace = await prisma.workspace.findUnique({
		where: { id: normalizedWorkspaceId },
		include: {
			branding: true,
			aiConfig: true,
		},
	});

	const aiConfig = workspace?.aiConfig || {};

	return {
		workspaceId: normalizedWorkspaceId,
		workspaceName: workspace?.name || process.env.BUSINESS_NAME || 'Lummine',
		branding: workspace?.branding || null,
		ai: {
			businessName:
				aiConfig.businessName ||
				workspace?.name ||
				process.env.BUSINESS_NAME ||
				'Lummine',
			agentName: aiConfig.agentName || process.env.BUSINESS_AGENT_NAME || 'Sofi',
			tone: aiConfig.tone || 'humana, directa y comercial',
			systemPrompt:
				aiConfig.systemPrompt ||
				process.env.SYSTEM_PROMPT ||
				'Responde como asesora humana de ventas por WhatsApp. Sona natural, directa y comercial.',
			businessContext: aiConfig.businessContext || process.env.BUSINESS_CONTEXT || '',
			paymentConfig: aiConfig.paymentConfig || null,
			policyConfig: aiConfig.policyConfig || null,
			catalogConfig: aiConfig.catalogConfig || null,
		},
	};
}

export async function getWhatsAppChannelForWorkspace(workspaceId) {
	const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const channel = await prisma.whatsAppChannel.findFirst({
		where: {
			workspaceId: normalizedWorkspaceId,
			status: 'ACTIVE',
		},
		orderBy: { updatedAt: 'desc' },
	});

	if (channel?.phoneNumberId && channel?.accessToken) {
		return {
			source: 'database',
			workspaceId: normalizedWorkspaceId,
			graphVersion: channel.graphVersion || process.env.WHATSAPP_GRAPH_VERSION || 'v25.0',
			wabaId: channel.wabaId,
			phoneNumberId: channel.phoneNumberId,
			displayPhoneNumber: channel.displayPhoneNumber || null,
			accessToken: channel.accessToken,
			verifyToken: channel.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || '',
		};
	}

	if (
		normalizedWorkspaceId === DEFAULT_WORKSPACE_ID &&
		process.env.WHATSAPP_PHONE_NUMBER_ID &&
		process.env.WHATSAPP_ACCESS_TOKEN
	) {
		return {
			source: 'env',
			workspaceId: normalizedWorkspaceId,
			graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v25.0',
			wabaId:
				process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
				process.env.WHATSAPP_WABA_ID ||
				'',
			phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
			displayPhoneNumber: null,
			accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
			verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
		};
	}

	return null;
}

export async function resolveWorkspaceIdFromPhoneNumberId(phoneNumberId = '') {
	const normalizedPhoneNumberId = normalizeWorkspaceId(phoneNumberId);
	if (!normalizedPhoneNumberId) return DEFAULT_WORKSPACE_ID;

	const channel = await prisma.whatsAppChannel.findUnique({
		where: { phoneNumberId: normalizedPhoneNumberId },
		select: { workspaceId: true },
	});

	if (channel?.workspaceId) return channel.workspaceId;

	if (
		process.env.WHATSAPP_PHONE_NUMBER_ID &&
		String(process.env.WHATSAPP_PHONE_NUMBER_ID).trim() === normalizedPhoneNumberId
	) {
		return DEFAULT_WORKSPACE_ID;
	}

	return DEFAULT_WORKSPACE_ID;
}

export function getWorkspacePublicPayload(workspace = {}) {
	return {
		id: workspace.id,
		name: workspace.name,
		slug: workspace.slug,
		status: workspace.status,
		branding: workspace.branding
			? {
					logoUrl: workspace.branding.logoUrl || null,
					primaryColor: workspace.branding.primaryColor || null,
					secondaryColor: workspace.branding.secondaryColor || null,
					accentColor: workspace.branding.accentColor || null,
			  }
			: null,
		aiConfig: workspace.aiConfig
			? {
					businessName: workspace.aiConfig.businessName,
					agentName: workspace.aiConfig.agentName,
					tone: workspace.aiConfig.tone,
					systemPrompt: workspace.aiConfig.systemPrompt || '',
					businessContext: workspace.aiConfig.businessContext || '',
					paymentConfig: workspace.aiConfig.paymentConfig || null,
					policyConfig: workspace.aiConfig.policyConfig || null,
					catalogConfig: workspace.aiConfig.catalogConfig || null,
			  }
			: null,
		commerceConnections: Array.isArray(workspace.commerceConnections)
			? workspace.commerceConnections
			: [],
		storeInstallations: Array.isArray(workspace.storeInstallations)
			? workspace.storeInstallations
			: [],
		whatsappChannels: Array.isArray(workspace.whatsappChannels)
			? workspace.whatsappChannels
			: [],
		createdAt: workspace.createdAt,
		updatedAt: workspace.updatedAt,
	};
}
