export function normalizeThreadPhone(value = '') {
	let digits = String(value || '').replace(/\D/g, '');

	if (!digits) return '';

	if (digits.startsWith('54911') && digits.length === 13) {
		return `541115${digits.slice(5)}`;
	}

	if (digits.startsWith('549') && digits.length === 13) {
		const national = digits.slice(3);
		return `54${national.slice(0, 4)}15${national.slice(4)}`;
	}

	if (digits.startsWith('54') && !digits.startsWith('549') && digits.length === 12) {
		const national = digits.slice(2);
		return `54${national.slice(0, 4)}15${national.slice(4)}`;
	}

	return digits;
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

export function getThreadKeyFromContact(contact = {}) {
	const phone = normalizeThreadPhone(contact.phone || contact.waId || '');
	if (phone) return `phone:${phone}`;

	const normalizedName = normalizeName(contact.name || 'sin nombre');
	return `name:${normalizedName}`;
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

			const preview = conversation.messages?.[0]?.body || 'Sin mensajes todavía';
			const avatar = getAvatarMeta(displayName, key);

			groups.set(key, {
				key,
				displayName,
				phoneDisplay,
				avatar,
				preview,
				aiEnabled: conversation.aiEnabled,
				latestConversationId: conversation.id,
				lastSummary: conversation.lastSummary || '',
				lastMessageAt: conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt,
				conversations: []
			});
		}

		const thread = groups.get(key);
 groups.get(key);
		thread.conversations.push(conversation);
		thread.aiEnabled = thread.aiEnabled || conversation.aiEnabled;

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
			conversationIds: thread.conversations.map((item) => item.id),
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