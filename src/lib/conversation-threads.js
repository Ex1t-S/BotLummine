function normalizeDigits(value = '') {
	return String(value || '').replace(/\D/g, '');
}

function normalizeName(value = '') {
	return String(value || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9\s]/g, '')
		.replace(/\s+/g, ' ');
}

function normalizeArgentinaWaId(digits = '') {
	let d = normalizeDigits(digits);

	if (!d) return '';

	if (!d.startsWith('54')) {
		return d;
	}

	// Ya viene en formato WhatsApp correcto: 549...
	if (d.startsWith('549')) {
		return d;
	}

	// Caso típico argentino local guardado como 54 + area + 15 + number
	// Ej: 54292315562286 -> 5492923562286
	if (d.startsWith('54') && d.includes('15')) {
		const afterCountry = d.slice(2);
		const idx15 = afterCountry.indexOf('15');

		if (idx15 > 0) {
			const area = afterCountry.slice(0, idx15);
			const subscriber = afterCountry.slice(idx15 + 2);

			if (area && subscriber) {
				return `549${area}${subscriber}`;
			}
		}
	}

	return d;
}

export function normalizeThreadPhone(value = '') {
	return normalizeArgentinaWaId(value);
}

export function getThreadKeyFromContact(contact = {}) {
	if (contact.id) return `contact:${contact.id}`;

	const waId = normalizeThreadPhone(contact.waId || contact.phone || '');
	if (waId) return `wa:${waId}`;

	return `name:${normalizeName(contact.name || 'sin nombre')}`;
}

function getTimeValue(conversation) {
	return new Date(conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt).getTime();
}

function hashCode(value = '') {
	return [...String(value)].reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

export function getAvatarMeta(name = '', seed = '') {
	const safe = String(name || 'Cliente').trim();
	const parts = safe.split(/\s+/).filter(Boolean);
	const initials = parts.slice(0, 2).map((item) => item[0]?.toUpperCase() || '').join('') || 'CL';
	const hue = hashCode(`${safe}-${seed}`) % 360;

	return {
		initials,
		style: `background: linear-gradient(135deg, hsl(${hue} 72% 56%), hsl(${(hue + 48) % 360} 72% 42%));`
	};
}

export function buildConversationThreads(conversations = []) {
	const sorted = [...conversations].sort((a, b) => getTimeValue(b) - getTimeValue(a));
	const groups = new Map();

	for (const conversation of sorted) {
		const key = getThreadKeyFromContact(conversation.contact || {});

		if (!groups.has(key)) {
			const displayName =
				conversation.contact?.name ||
				normalizeThreadPhone(conversation.contact?.waId || '') ||
				'Cliente';

			const phoneDisplay =
				normalizeThreadPhone(conversation.contact?.phone || conversation.contact?.waId || '') ||
				conversation.contact?.waId ||
				'';

			const preview =
				[...(conversation.messages || [])]
					.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
					?.body || 'Sin mensajes todavía';

			groups.set(key, {
				key,
				displayName,
				phoneDisplay,
				avatar: getAvatarMeta(displayName, key),
				preview,
				aiEnabled: conversation.aiEnabled,
				latestConversationId: conversation.id,
				lastSummary: conversation.lastSummary || '',
				lastMessageAt: conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt,
				conversations: []
			});
		}

		const thread = groups.get(key);
		thread.conversations.push(conversation);
		thread.aiEnabled = thread.aiEnabled || conversation.aiEnabled;

		const threadTime = new Date(thread.lastMessageAt).getTime();
		const conversationTime = getTimeValue(conversation);

		if (conversationTime >= threadTime) {
			thread.latestConversationId = conversation.id;
			thread.preview =
				[...(conversation.messages || [])]
					.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
					?.body || thread.preview;
			thread.lastMessageAt = conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt;
		}

		if (!thread.lastSummary && conversation.lastSummary) {
			thread.lastSummary = conversation.lastSummary;
		}
	}

	const threads = [...groups.values()].map((thread) => {
		const messages = thread.conversations
			.flatMap((conversation) =>
				(conversation.messages || []).map((message) => ({
					...message,
					_conversationId: conversation.id,
					_contactName: conversation.contact?.name || null
				}))
			)
			.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

		return {
			...thread,
			conversationIds: [...new Set(thread.conversations.map((item) => item.id))],
			messages
		};
	});

	return threads.sort(
		(a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
	);
}

export function findThreadByConversationId(threads = [], conversationId = '') {
	return threads.find((thread) => thread.conversationIds.includes(conversationId)) || null;
}