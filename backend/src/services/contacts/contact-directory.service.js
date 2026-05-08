import { prisma } from '../../lib/prisma.js';
import { normalizeThreadPhone } from '../../lib/conversation-threads.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';

function cleanString(value) {
	const text = String(value ?? '').trim();
	return text || null;
}

export function normalizeContactPhone(value) {
	const text = cleanString(value);
	return text ? normalizeThreadPhone(text) : null;
}

export function normalizeContactName(value) {
	return cleanString(value);
}

export async function findContactByWaId(waId, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const normalizedWaId = normalizeContactPhone(waId);
	if (!normalizedWaId) return null;
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;

	return prisma.contact.findFirst({
		where: {
			workspaceId: resolvedWorkspaceId,
			OR: [{ waId: normalizedWaId }, { phone: normalizedWaId }]
		}
	});
}

export async function findOrCreateContactByWaId({ workspaceId = DEFAULT_WORKSPACE_ID, waId, name = null, phone = null } = {}) {
	const normalizedWaId = normalizeContactPhone(waId || phone);
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	if (!normalizedWaId) {
		throw new Error('findOrCreateContactByWaId requiere waId o phone válido.');
	}

	const existing = await findContactByWaId(normalizedWaId, { workspaceId: resolvedWorkspaceId });
	if (existing) {
		const nextName = normalizeContactName(name) || existing.name;
		if (nextName !== existing.name) {
			return prisma.contact.update({
				where: { id: existing.id },
				data: { name: nextName }
			});
		}
		return existing;
	}

	return prisma.contact.create({
		data: {
			workspaceId: resolvedWorkspaceId,
			waId: normalizedWaId,
			phone: normalizedWaId,
			name: normalizeContactName(name)
		}
	});
}
