import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from './workspace-context.service.js';

export const WORKSPACE_FEATURE_FLAGS = Object.freeze({
	AI_AUTO_REPLIES: 'ai_auto_replies',
	CAMPAIGN_DISPATCH: 'campaign_dispatch',
	AUTOMATION_DISPATCH: 'automation_dispatch',
	WHATSAPP_OUTBOUND: 'whatsapp_outbound',
});

export const WORKSPACE_FEATURE_FLAG_DEFINITIONS = Object.freeze([
	{
		key: WORKSPACE_FEATURE_FLAGS.AI_AUTO_REPLIES,
		label: 'IA automatica',
		description: 'Permite respuestas generadas por IA en conversaciones AUTO.',
	},
	{
		key: WORKSPACE_FEATURE_FLAGS.CAMPAIGN_DISPATCH,
		label: 'Campanas',
		description: 'Permite lanzar y despachar campanas de WhatsApp.',
	},
	{
		key: WORKSPACE_FEATURE_FLAGS.AUTOMATION_DISPATCH,
		label: 'Automatizaciones',
		description: 'Permite carritos abandonados, pagos pendientes y avisos de envio automaticos.',
	},
	{
		key: WORKSPACE_FEATURE_FLAGS.WHATSAPP_OUTBOUND,
		label: 'Salientes WhatsApp',
		description: 'Permite enviar mensajes salientes por WhatsApp Cloud API.',
	},
]);

const VALID_KEYS = new Set(WORKSPACE_FEATURE_FLAG_DEFINITIONS.map((item) => item.key));

function normalizeFlagKey(key = '') {
	return String(key || '').trim().toLowerCase();
}

export function assertWorkspaceFeatureFlagKey(key = '') {
	const normalized = normalizeFlagKey(key);

	if (!VALID_KEYS.has(normalized)) {
		const error = new Error('Feature flag invalido.');
		error.status = 400;
		throw error;
	}

	return normalized;
}

function normalizeReason(value = '') {
	const normalized = String(value || '').trim();
	return normalized ? normalized.slice(0, 500) : null;
}

function buildDefaultFlag(definition, workspaceId) {
	return {
		id: null,
		workspaceId,
		key: definition.key,
		label: definition.label,
		description: definition.description,
		enabled: true,
		reason: null,
		updatedById: null,
		createdAt: null,
		updatedAt: null,
	};
}

export async function listWorkspaceFeatureFlags(workspaceId = DEFAULT_WORKSPACE_ID) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const rows = await prisma.workspaceFeatureFlag.findMany({
		where: { workspaceId: resolvedWorkspaceId },
	});
	const byKey = new Map(rows.map((row) => [row.key, row]));

	return WORKSPACE_FEATURE_FLAG_DEFINITIONS.map((definition) => ({
		...buildDefaultFlag(definition, resolvedWorkspaceId),
		...(byKey.get(definition.key) || {}),
		label: definition.label,
		description: definition.description,
	}));
}

export async function isWorkspaceFeatureEnabled(workspaceId, key) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedKey = assertWorkspaceFeatureFlagKey(key);

	try {
		const row = await prisma.workspaceFeatureFlag.findUnique({
			where: {
				workspaceId_key: {
					workspaceId: resolvedWorkspaceId,
					key: normalizedKey,
				},
			},
			select: { enabled: true },
		});

		return row?.enabled !== false;
	} catch (error) {
		logger.error('workspace_feature_flag.lookup_failed', {
			workspaceId: resolvedWorkspaceId,
			key: normalizedKey,
			error,
		});
		return true;
	}
}

export async function setWorkspaceFeatureFlag({
	workspaceId = DEFAULT_WORKSPACE_ID,
	key,
	enabled,
	reason = '',
	updatedById = null,
} = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedKey = assertWorkspaceFeatureFlagKey(key);
	const normalizedEnabled = Boolean(enabled);

	return prisma.workspaceFeatureFlag.upsert({
		where: {
			workspaceId_key: {
				workspaceId: resolvedWorkspaceId,
				key: normalizedKey,
			},
		},
		update: {
			enabled: normalizedEnabled,
			reason: normalizeReason(reason),
			updatedById: updatedById || null,
		},
		create: {
			workspaceId: resolvedWorkspaceId,
			key: normalizedKey,
			enabled: normalizedEnabled,
			reason: normalizeReason(reason),
			updatedById: updatedById || null,
		},
	});
}
