import { prisma } from '../../lib/prisma.js';
import { normalizeThreadPhone } from '../../lib/conversation-threads.js';

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

export async function findContactByWaId(waId) {
	const normalizedWaId = normalizeContactPhone(waId);
	if (!normalizedWaId) return null;

	return prisma.contact.findFirst({
		where: {
			OR: [{ waId: normalizedWaId }, { phone: normalizedWaId }]
		}
	});
}

export async function findOrCreateContactByWaId({ waId, name = null, phone = null } = {}) {
	const normalizedWaId = normalizeContactPhone(waId || phone);
	if (!normalizedWaId) {
		throw new Error('findOrCreateContactByWaId requiere waId o phone válido.');
	}

	const existing = await findContactByWaId(normalizedWaId);
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
			waId: normalizedWaId,
			phone: normalizedWaId,
			name: normalizeContactName(name)
		}
	});
}
