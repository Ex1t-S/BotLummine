import { prisma } from '../../lib/prisma.js';
import { normalizeThreadPhone } from '../../lib/conversation-threads.js';
import { normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import { requireWorkspaceScope, workspaceOwnedWhere } from '../workspaces/workspace-scope.js';

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

export async function findContactByWaId(waId, { workspaceId } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const normalizedWaId = normalizeContactPhone(waId);
	if (!normalizedWaId) return null;

	return prisma.contact.findFirst({
		where: {
			workspaceId: resolvedWorkspaceId,
			OR: [{ waId: normalizedWaId }, { phone: normalizedWaId }]
		}
	});
}

export async function findOrCreateContactByWaId({ workspaceId, waId, name = null, phone = null } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const normalizedWaId = normalizeContactPhone(waId || phone);
	if (!normalizedWaId) {
		throw new Error('findOrCreateContactByWaId requiere waId o phone válido.');
	}

	const existing = await findContactByWaId(normalizedWaId, { workspaceId: resolvedWorkspaceId });
	if (existing) {
		const nextName = normalizeContactName(name) || existing.name;
		if (nextName !== existing.name) {
			return prisma.contact.update({
				where: workspaceOwnedWhere({ id: existing.id, workspaceId: resolvedWorkspaceId }),
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
