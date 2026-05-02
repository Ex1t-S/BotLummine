import { prisma } from '../lib/prisma.js';
import { getCatalogPage, syncCatalogFromProvider } from '../services/catalog/catalog.service.js';
import { getQueueMeta } from '../services/conversation/inbox-routing.service.js';
import { normalizeThreadPhone } from '../lib/conversation-threads.js';
import { sendAndPersistOutbound } from '../services/conversation/outbound-message.service.js';
import { publishInboxEvent, subscribeInboxEvents } from '../lib/inbox-events.js';
import {
	getEnboxSyncStatus,
	syncEnboxShipments,
} from '../services/enbox/enbox-sync.service.js';
import {
	isPlatformAdmin,
	requireRequestWorkspaceId,
} from '../services/workspaces/workspace-context.service.js';

const AI_LAB_CONTACT_PREFIX = '__AI_LAB__::';

const VISIBLE_INBOX_CONTACT_WHERE = {
	NOT: {
		contact: {
			name: {
				startsWith: AI_LAB_CONTACT_PREFIX,
			},
		},
	},
};

function formatTime(value) {
	if (!value) return '';

	try {
		return new Date(value).toLocaleTimeString('es-AR', {
			hour: '2-digit',
			minute: '2-digit',
		});
	} catch {
		return '';
	}
}

function formatDateTime(value) {
	if (!value) return '';

	try {
		return new Date(value).toLocaleString('es-AR');
	} catch {
		return '';
	}
}

function buildAvatar(name = '', phone = '') {
	const base = (name || phone || '?').trim();
	const parts = base.split(/\s+/).filter(Boolean).slice(0, 2);
	const initials = parts.length
		? parts.map((part) => part[0]?.toUpperCase() || '').join('')
		: '?';

	const palette = [
		'linear-gradient(135deg,#22c55e,#16a34a)',
		'linear-gradient(135deg,#06b6d4,#2563eb)',
		'linear-gradient(135deg,#f97316,#ef4444)',
		'linear-gradient(135deg,#a855f7,#ec4899)',
		'linear-gradient(135deg,#eab308,#84cc16)',
	];

	const index =
		Math.abs(
			base.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
		) % palette.length;

	return {
		initials,
		style: `background:${palette[index]};`,
	};
}

function normalizePhone(value = '') {
	return String(value || '').replace(/\D/g, '');
}

function subtractDays(days = 0) {
	return new Date(Date.now() - Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000);
}

function normalizeCount(value = 0) {
	return Math.max(0, Number(value || 0) || 0);
}

function emptyOperationMetrics() {
	return {
		auto: 0,
		human: 0,
		paymentReview: 0,
		unreadConversations: 0,
		unreadMessages: 0,
		activeConversations30d: 0,
		messages30dInbound: 0,
		messages30dOutbound: 0,
		activeCampaigns: 0,
		failedCampaigns: 0,
		abandonedCartsNew: 0,
		abandonedCartsRecovered: 0,
		catalogProducts: 0,
	};
}

function addMetrics(target, source = {}) {
	for (const key of Object.keys(target)) {
		target[key] += normalizeCount(source[key]);
	}
	return target;
}

function getWorkspaceDisplayName(workspace = {}) {
	return workspace?.aiConfig?.businessName || workspace?.name || workspace?.slug || 'Marca';
}

function getLatestByWorkspace(rows = [], dateField = 'createdAt') {
	const byWorkspace = new Map();

	for (const row of rows) {
		if (!row?.workspaceId || byWorkspace.has(row.workspaceId)) continue;
		byWorkspace.set(row.workspaceId, {
			status: row.status || null,
			message: row.message || null,
			startedAt: row.startedAt || row[dateField] || null,
			finishedAt: row.finishedAt || null,
		});
	}

	return byWorkspace;
}

function buildOperationIssues({ workspace, metrics, channel, latestCatalogSync, latestCustomerSync }) {
	const issues = [];

	if (workspace?.status && workspace.status !== 'ACTIVE') {
		issues.push({
			type: 'workspace',
			severity: 'warning',
			label: 'Workspace inactivo',
			action: 'Revisar estado',
			href: '/admin',
		});
	}

	if (!channel) {
		issues.push({
			type: 'whatsapp',
			severity: 'critical',
			label: 'WhatsApp sin canal activo',
			action: 'Configurar WhatsApp',
			href: '/admin',
		});
	}

	if (metrics.paymentReview > 0) {
		issues.push({
			type: 'payment',
			severity: 'warning',
			label: `${metrics.paymentReview} comprobantes pendientes`,
			action: 'Revisar comprobantes',
			href: '/inbox/comprobantes',
		});
	}

	if (metrics.unreadMessages > 0) {
		issues.push({
			type: 'unread',
			severity: 'info',
			label: `${metrics.unreadMessages} mensajes no leidos`,
			action: 'Ver inbox',
			href: '/inbox/todos?read=UNREAD',
		});
	}

	if (!latestCatalogSync) {
		issues.push({
			type: 'catalog',
			severity: 'info',
			label: 'Catalogo sin sync registrada',
			action: 'Actualizar catalogo',
			href: '/catalog',
		});
	} else if (latestCatalogSync.status === 'ERROR') {
		issues.push({
			type: 'catalog',
			severity: 'warning',
			label: 'Ultima sync de catalogo con error',
			action: 'Revisar catalogo',
			href: '/catalog',
		});
	}

	if (latestCustomerSync?.status === 'ERROR') {
		issues.push({
			type: 'customers',
			severity: 'warning',
			label: 'Ultima sync de clientes con error',
			action: 'Revisar clientes',
			href: '/customers',
		});
	}

	return issues;
}

function buildResetStateData() {
	return {
		customerName: null,
		lastIntent: null,
		lastDetectedIntent: null,
		lastUserGoal: null,
		lastOrderNumber: null,
		lastOrderId: null,
		preferredTone: null,
		customerMood: null,
		urgencyLevel: null,
		frequentSize: null,
		paymentPreference: null,
		deliveryPreference: null,
		interestedProducts: [],
		objections: [],
		needsHuman: false,
		handoffReason: null,
		interactionCount: 0,
		notes: null,
	};
}
function normalizeConversationIdentity(contact = {}) {
	return normalizeThreadPhone(contact?.waId || contact?.phone || '');
}

function getConversationSortValue(conversation = {}) {
	return new Date(
		conversation.lastMessageAt ||
		conversation.updatedAt ||
		conversation.createdAt ||
		0
	).getTime();
}

function sortConversationsForMerge(conversations = []) {
	return [...conversations].sort((a, b) => {
		const archivedDiff =
			Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt));

		if (archivedDiff !== 0) {
			return archivedDiff;
		}

		return getConversationSortValue(b) - getConversationSortValue(a);
	});
}

function getQueuePriority(queue = 'AUTO') {
	const priorities = {
		AUTO: 1,
		HUMAN: 2,
		PAYMENT_REVIEW: 3,
	};

	return priorities[String(queue || '').toUpperCase()] || 0;
}

function pickMergedQueue(conversations = []) {
	return [...conversations].sort(
		(a, b) => getQueuePriority(b.queue) - getQueuePriority(a.queue)
	)[0]?.queue || 'AUTO';
}

function firstMeaningfulValue(values = []) {
	for (const value of values) {
		if (Array.isArray(value)) {
			if (value.length) return value;
			continue;
		}

		if (value instanceof Date) return value;
		if (value === 0 || value === false) return value;

		if (String(value ?? '').trim()) {
			return value;
		}
	}

	return null;
}

function pickLatestDate(values = []) {
	return values
		.filter(Boolean)
		.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
}

function mergeJsonArrays(values = []) {
	const merged = [];
	const seen = new Set();

	for (const list of values) {
		if (!Array.isArray(list)) continue;

		for (const entry of list) {
			const key =
				typeof entry === 'string'
					? `string:${entry}`
					: JSON.stringify(entry);

			if (seen.has(key)) continue;

			seen.add(key);
			merged.push(entry);
		}
	}

	return merged;
}

function pickPreferredContactName(values = [], fallback = '') {
	const candidates = values
		.map((value) => String(value || '').trim())
		.filter(Boolean);

	const withLetters = candidates.filter((value) => /[A-Za-zÀ-ÿ]/.test(value));
	const pool = withLetters.length ? withLetters : candidates;

	return pool.sort((a, b) => b.length - a.length)[0] || fallback || null;
}

function buildMergedConversationState(primaryState = null, extraStates = []) {
	const states = [primaryState, ...extraStates].filter(Boolean);

	if (!states.length) return null;

	return {
		customerName: firstMeaningfulValue(states.map((item) => item.customerName)),
		lastIntent: firstMeaningfulValue(states.map((item) => item.lastIntent)),
		lastDetectedIntent: firstMeaningfulValue(
			states.map((item) => item.lastDetectedIntent)
		),
		lastUserGoal: firstMeaningfulValue(states.map((item) => item.lastUserGoal)),
		lastOrderNumber: firstMeaningfulValue(
			states.map((item) => item.lastOrderNumber)
		),
		lastOrderId: firstMeaningfulValue(states.map((item) => item.lastOrderId)),
		preferredTone: firstMeaningfulValue(
			states.map((item) => item.preferredTone)
		),
		customerMood: firstMeaningfulValue(states.map((item) => item.customerMood)),
		urgencyLevel: firstMeaningfulValue(states.map((item) => item.urgencyLevel)),
		frequentSize: firstMeaningfulValue(states.map((item) => item.frequentSize)),
		paymentPreference: firstMeaningfulValue(
			states.map((item) => item.paymentPreference)
		),
		deliveryPreference: firstMeaningfulValue(
			states.map((item) => item.deliveryPreference)
		),
		interestedProducts: mergeJsonArrays(
			states.map((item) => item.interestedProducts)
		),
		objections: mergeJsonArrays(states.map((item) => item.objections)),
		needsHuman: states.some((item) => Boolean(item.needsHuman)),
		handoffReason: firstMeaningfulValue(states.map((item) => item.handoffReason)),
		interactionCount: states.reduce(
			(acc, item) => acc + Number(item.interactionCount || 0),
			0
		),
		notes: firstMeaningfulValue(states.map((item) => item.notes)),
		currentProductFocus: firstMeaningfulValue(
			states.map((item) => item.currentProductFocus)
		),
		salesStage: firstMeaningfulValue(states.map((item) => item.salesStage)),
		shownOffers: mergeJsonArrays(states.map((item) => item.shownOffers)),
		shownPrices: mergeJsonArrays(states.map((item) => item.shownPrices)),
		sharedLinks: mergeJsonArrays(states.map((item) => item.sharedLinks)),
		lastRecommendedProduct: firstMeaningfulValue(
			states.map((item) => item.lastRecommendedProduct)
		),
		lastRecommendedOffer: firstMeaningfulValue(
			states.map((item) => item.lastRecommendedOffer)
		),
		buyingIntentLevel: firstMeaningfulValue(
			states.map((item) => item.buyingIntentLevel)
		),
		frictionLevel: firstMeaningfulValue(
			states.map((item) => item.frictionLevel)
		),
		commercialSummary: firstMeaningfulValue(
			states.map((item) => item.commercialSummary)
		),
	};
}

async function deduplicateInboxContacts(workspaceId) {
	const conversations = await prisma.conversation.findMany({
		where: {
			workspaceId,
			...VISIBLE_INBOX_CONTACT_WHERE,
		},
		select: {
			id: true,
			queue: true,
			aiEnabled: true,
			lastSummary: true,
			lastMessageAt: true,
			lastInboundMessageAt: true,
			lastReadAt: true,
			unreadCount: true,
			archivedAt: true,
			createdAt: true,
			updatedAt: true,
			contact: {
				select: {
					id: true,
					name: true,
					phone: true,
					waId: true,
				},
			},
			state: {
				select: {
					id: true,
					customerName: true,
					lastIntent: true,
					lastDetectedIntent: true,
					lastUserGoal: true,
					lastOrderNumber: true,
					lastOrderId: true,
					preferredTone: true,
					customerMood: true,
					urgencyLevel: true,
					frequentSize: true,
					paymentPreference: true,
					deliveryPreference: true,
					interestedProducts: true,
					objections: true,
					needsHuman: true,
					handoffReason: true,
					interactionCount: true,
					notes: true,
					currentProductFocus: true,
					salesStage: true,
					shownOffers: true,
					shownPrices: true,
					sharedLinks: true,
					lastRecommendedProduct: true,
					lastRecommendedOffer: true,
					buyingIntentLevel: true,
					frictionLevel: true,
					commercialSummary: true,
				},
			},
		},
	});

	const groups = new Map();

	for (const conversation of conversations) {
		const identity = normalizeConversationIdentity(conversation.contact);

		if (!identity) continue;

		if (!groups.has(identity)) {
			groups.set(identity, []);
		}

		groups.get(identity).push(conversation);
	}

	let mergedGroups = 0;
	let removedConversations = 0;
	let removedContacts = 0;
	let movedMessages = 0;

	for (const group of groups.values()) {
		if (group.length < 2) continue;

		const sorted = sortConversationsForMerge(group);
		const primary = sorted[0];
		const duplicates = sorted.slice(1);

		if (!duplicates.length) continue;

		const mergedState = buildMergedConversationState(
			primary.state,
			duplicates.map((item) => item.state)
		);

		const mergedQueue = pickMergedQueue(sorted);
		const mergedAiEnabled =
			mergedQueue === 'AUTO' ? sorted.some((item) => item.aiEnabled) : false;

		const mergedLastMessageAt = pickLatestDate(
			sorted.map((item) => item.lastMessageAt)
		);
		const mergedLastInboundMessageAt = pickLatestDate(
			sorted.map((item) => item.lastInboundMessageAt)
		);
		const mergedLastReadAt = pickLatestDate(
			sorted.map((item) => item.lastReadAt)
		);
		const mergedUnreadCount =
			mergedLastInboundMessageAt &&
			mergedLastReadAt &&
			new Date(mergedLastReadAt).getTime() >=
				new Date(mergedLastInboundMessageAt).getTime()
				? 0
				: sorted.reduce(
						(acc, item) => acc + Math.max(0, Number(item.unreadCount || 0)),
						0
				  );

		const mergedLastSummary = firstMeaningfulValue(
			sorted.map((item) => item.lastSummary)
		);

		const mergedWaId =
			normalizeConversationIdentity(primary.contact) ||
			normalizeConversationIdentity(duplicates[0]?.contact) ||
			primary.contact?.waId ||
			primary.contact?.phone ||
			'';

		const mergedContactName = pickPreferredContactName(
			sorted.map((item) => item.contact?.name),
			primary.contact?.name || mergedWaId
		);

		const mergedArchivedAt = sorted.some((item) => !item.archivedAt)
			? null
			: firstMeaningfulValue(sorted.map((item) => item.archivedAt));

		await prisma.$transaction(async (tx) => {
			for (const duplicate of duplicates) {
				const moveResult = await tx.message.updateMany({
					where: { conversationId: duplicate.id },
					data: { conversationId: primary.id },
				});

				movedMessages += moveResult.count;

				await tx.conversationState.deleteMany({
					where: { conversationId: duplicate.id },
				});

				await tx.conversation.delete({
					where: { id: duplicate.id },
				});

				await tx.contact.delete({
					where: { id: duplicate.contact.id },
				});

				removedConversations += 1;
				removedContacts += 1;
			}

			await tx.contact.update({
				where: { id: primary.contact.id },
				data: {
					name: mergedContactName || undefined,
					phone: mergedWaId || primary.contact?.phone || undefined,
					waId: mergedWaId || primary.contact?.waId,
				},
			});

			await tx.conversation.update({
				where: { id: primary.id },
				data: {
					queue: mergedQueue,
					aiEnabled: mergedAiEnabled,
					lastSummary: mergedLastSummary || undefined,
					lastMessageAt: mergedLastMessageAt || undefined,
					lastInboundMessageAt: mergedLastInboundMessageAt || undefined,
					lastReadAt: mergedLastReadAt || null,
					unreadCount: mergedUnreadCount,
					archivedAt: mergedArchivedAt || null,
				},
			});

			if (mergedState) {
				if (primary.state?.id) {
					await tx.conversationState.update({
						where: { conversationId: primary.id },
						data: mergedState,
					});
				} else {
					await tx.conversationState.create({
						data: {
							conversationId: primary.id,
							...buildResetStateData(),
							...mergedState,
						},
					});
				}
			}
		});

		mergedGroups += 1;
	}

	return {
		mergedGroups,
		removedConversations,
		removedContacts,
		movedMessages,
	};
}
function buildMessagePreview(message) {
	if (!message) return '';

	const attachmentName = String(message.attachmentName || '').trim();
	const body = String(message.body || '').trim();
	const type = String(message.type || '').toLowerCase();

	if (type === 'audio') {
		return attachmentName ? `🎧 ${attachmentName}` : '🎧 Audio';
	}

	if (type === 'image') {
		return attachmentName ? `🖼️ ${attachmentName}` : '🖼️ Imagen';
	}

	if (type === 'video') {
		return attachmentName ? `🎬 ${attachmentName}` : '🎬 Video';
	}

	if (type === 'document') {
		return attachmentName ? `📄 ${attachmentName}` : '📄 Documento';
	}

	if (type === 'sticker') {
		return '😊 Sticker';
	}

	return body || 'Sin mensajes';
}

function buildContactCard(conversation, lastMessage) {
	const contact = conversation.contact || {};
	const state = conversation.state || {};
	const phone = normalizePhone(contact.phone || contact.waId || '');
	const displayName = contact.name || phone || 'Sin nombre';
	const queueMeta = getQueueMeta(conversation.queue);
	const unreadCount = Math.max(0, Number(conversation.unreadCount || 0));

	return {
		key: contact.waId || conversation.id,
		conversationId: conversation.id,
		displayName,
		phoneDisplay: phone,
		preview: buildMessagePreview(lastMessage),
		lastMessageAt: conversation.lastMessageAt || lastMessage?.createdAt || null,
		lastMessageTime: formatTime(conversation.lastMessageAt || lastMessage?.createdAt || null),
		lastMessageLabel: formatDateTime(conversation.lastMessageAt || lastMessage?.createdAt || null),
		lastMessageDirection: lastMessage?.direction || null,
		lastMessageSenderName: lastMessage?.senderName || '',
		lastMessageType: lastMessage?.type || 'text',
		awaitingCustomerReply: lastMessage?.direction === 'OUTBOUND',
		aiEnabled: !!conversation.aiEnabled,
		queue: conversation.queue || 'AUTO',
		queueLabel: queueMeta.label,
		queueBadgeClass: queueMeta.badgeClass,
		needsHuman: !!state.needsHuman,
		handoffReason: state.handoffReason || '',
		unreadCount,
		hasUnread: unreadCount > 0,
		lastReadAt: conversation.lastReadAt || null,
		lastInboundMessageAt: conversation.lastInboundMessageAt || null,
		avatar: buildAvatar(displayName, phone),
		lastSummary: conversation.lastSummary || '',
	};
}

async function fetchInboxData({
	selectedConversationId = null,
	queue = 'AUTO',
	archived = false,
	workspaceId,
	limit = 60,
	offset = 0,
	q = '',
	readFilter = 'ALL',
	attentionFilter = 'ALL',
} = {}) {
	const safeLimit = Math.min(100, Math.max(20, Number(limit) || 60));
	const safeOffset = Math.max(0, Number(offset) || 0);
	const searchTerm = String(q || '').trim();
	const normalizedSearchPhone = normalizePhone(searchTerm);

	const where = {
		workspaceId,
		...(archived ? { archivedAt: { not: null } } : { archivedAt: null }),
		...(queue === 'ALL' ? {} : { queue }),
		...(readFilter === 'UNREAD'
			? { unreadCount: { gt: 0 } }
			: readFilter === 'READ'
				? { unreadCount: 0 }
				: {}),
		...(attentionFilter === 'NEEDS_HUMAN'
			? {
					state: {
						is: {
							needsHuman: true,
						},
					},
			  }
			: attentionFilter === 'AI_ACTIVE'
				? { aiEnabled: true }
				: {}),
		...(searchTerm
			? {
					OR: [
						{ contact: { name: { contains: searchTerm, mode: 'insensitive' } } },
						{ contact: { phone: { contains: normalizedSearchPhone || searchTerm } } },
						{ contact: { waId: { contains: normalizedSearchPhone || searchTerm } } },
						{ lastSummary: { contains: searchTerm, mode: 'insensitive' } },
					],
			  }
			: {}),
		...VISIBLE_INBOX_CONTACT_WHERE,
	};

	const conversations = await prisma.conversation.findMany({
		where,
		select: {
			id: true,
			queue: true,
			aiEnabled: true,
			lastSummary: true,
			lastMessageAt: true,
			lastInboundMessageAt: true,
			lastReadAt: true,
			unreadCount: true,
			contact: {
				select: {
					name: true,
					phone: true,
					waId: true,
				},
			},
			state: {
				select: {
					needsHuman: true,
					handoffReason: true,
				},
			},
			messages: {
				select: {
					id: true,
					body: true,
					senderName: true,
					direction: true,
					createdAt: true,
					type: true,
					attachmentName: true,
				},
				orderBy: {
					createdAt: 'desc',
				},
				take: 1,
			},
		},
		orderBy: {
			lastMessageAt: 'desc',
		},
		skip: safeOffset,
		take: safeLimit + 1,
	});

	const pageConversations = conversations.slice(0, safeLimit);
	const contacts = pageConversations.map((conversation) =>
		buildContactCard(conversation, conversation.messages?.[0] || null)
	);

	let selectedContact = null;

	if (selectedConversationId) {
		selectedContact =
			contacts.find((item) => item.conversationId === selectedConversationId) || null;
	}

	if (!selectedContact && contacts.length) {
		selectedContact = contacts[0];
	}

	const countsWhere = {
		workspaceId,
		archivedAt: null,
		...VISIBLE_INBOX_CONTACT_WHERE,
	};

	const [allCount, autoCount, humanCount, paymentCount] = await Promise.all([
		prisma.conversation.count({
			where: countsWhere,
		}),
		prisma.conversation.count({
			where: { ...countsWhere, queue: 'AUTO' },
		}),
		prisma.conversation.count({
			where: { ...countsWhere, queue: 'HUMAN' },
		}),
		prisma.conversation.count({
			where: { ...countsWhere, queue: 'PAYMENT_REVIEW' },
		}),
	]);

	return {
		contacts,
		selectedContact,
		hasMore: conversations.length > safeLimit,
		nextOffset: conversations.length > safeLimit ? safeOffset + contacts.length : null,
		counts: {
			ALL: allCount,
			AUTO: autoCount,
			HUMAN: humanCount,
			PAYMENT_REVIEW: paymentCount,
		},
	};
}

async function ensureConversationExists(conversationId, workspaceId) {
	const conversation = await prisma.conversation.findFirst({
		where: { id: conversationId, workspaceId },
		select: {
			id: true,
			queue: true,
			aiEnabled: true,
			lastSummary: true,
			lastMessageAt: true,
			lastInboundMessageAt: true,
			lastReadAt: true,
			unreadCount: true,
			contact: {
				select: {
					id: true,
					name: true,
					phone: true,
					waId: true,
				},
			},
			state: {
				select: {
					id: true,
					conversationId: true,
					handoffReason: true,
					lastDetectedIntent: true,
					lastIntent: true,
					lastUserGoal: true,
				},
			},
		},
	});

	return conversation;
}

async function markConversationAsRead(conversationId, workspaceId) {
	const now = new Date();

	await prisma.conversation.updateMany({
		where: { id: conversationId, workspaceId },
		data: {
			unreadCount: 0,
			lastReadAt: now,
		},
	});

	const updatedConversation = await prisma.conversation.findFirst({
		where: { id: conversationId, workspaceId },
		select: {
			id: true,
			queue: true,
			lastReadAt: true,
			unreadCount: true,
		},
	});

	publishInboxEvent({
		workspaceId,
		scope: 'conversation',
		action: 'read',
		conversationId: updatedConversation.id,
		queue: updatedConversation.queue,
		unreadCount: updatedConversation.unreadCount,
		lastReadAt: updatedConversation.lastReadAt?.toISOString() || null,
	});

	return updatedConversation;
}

async function markConversationAsUnread(conversationId, workspaceId) {
	await prisma.conversation.updateMany({
		where: { id: conversationId, workspaceId },
		data: {
			unreadCount: 1,
			lastReadAt: null,
		},
	});

	const updatedConversation = await prisma.conversation.findFirst({
		where: { id: conversationId, workspaceId },
		select: {
			id: true,
			queue: true,
			lastReadAt: true,
			unreadCount: true,
		},
	});

	publishInboxEvent({
		workspaceId,
		scope: 'conversation',
		action: 'unread',
		conversationId: updatedConversation.id,
		queue: updatedConversation.queue,
		unreadCount: updatedConversation.unreadCount,
		lastReadAt: null,
	});

	return updatedConversation;
}
export async function getInbox(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const currentQueue = String(req.query.queue || 'AUTO').toUpperCase();
		const archived = String(req.query.archived || 'false') === 'true';
		const limit = Number(req.query.limit || 60);
		const offset = Number(req.query.offset || 0);
		const readFilter = String(req.query.read || 'ALL').toUpperCase();
		const attentionFilter = String(req.query.attention || 'ALL').toUpperCase();

		const data = await fetchInboxData({
			selectedConversationId: req.query.conversationId || null,
			queue: currentQueue,
			archived,
			workspaceId,
			limit,
			offset,
			q: req.query.q || '',
			readFilter,
			attentionFilter,
		});

		return res.json({
			ok: true,
			currentQueue,
			archived,
			limit,
			offset,
			...data,
		});
	} catch (error) {
		next(error);
	}
}

export async function getOperationSummary(req, res, next) {
	try {
		const platformAdmin = isPlatformAdmin(req.user);
		const workspaceWhere = platformAdmin ? undefined : { id: requireRequestWorkspaceId(req) };
		const activitySince = subtractDays(30);

		const workspaces = await prisma.workspace.findMany({
			where: workspaceWhere,
			select: {
				id: true,
				name: true,
				slug: true,
				status: true,
				aiConfig: {
					select: {
						businessName: true,
					},
				},
				branding: {
					select: {
						logoUrl: true,
						primaryColor: true,
					},
				},
			},
			orderBy: { createdAt: 'desc' },
		});

		const workspaceIds = workspaces.map((workspace) => workspace.id);
		const scopedWhere = workspaceIds.length ? { workspaceId: { in: workspaceIds } } : { workspaceId: '__none__' };
		const metricsByWorkspace = new Map(
			workspaceIds.map((workspaceId) => [workspaceId, emptyOperationMetrics()])
		);

		const [
			queueRows,
			unreadRows,
			activeConversationRows,
			messageRows,
			campaignRows,
			cartRows,
			catalogProductRows,
			activeChannels,
			catalogSyncRows,
			customerSyncRows,
		] = await Promise.all([
			prisma.conversation.groupBy({
				by: ['workspaceId', 'queue'],
				where: { ...scopedWhere, ...VISIBLE_INBOX_CONTACT_WHERE, archivedAt: null },
				_count: { _all: true },
			}),
			prisma.conversation.groupBy({
				by: ['workspaceId'],
				where: {
					...scopedWhere,
					...VISIBLE_INBOX_CONTACT_WHERE,
					archivedAt: null,
					unreadCount: { gt: 0 },
				},
				_count: { _all: true },
				_sum: { unreadCount: true },
			}),
			prisma.conversation.groupBy({
				by: ['workspaceId'],
				where: {
					...scopedWhere,
					...VISIBLE_INBOX_CONTACT_WHERE,
					lastMessageAt: { gte: activitySince },
				},
				_count: { _all: true },
			}),
			prisma.message.groupBy({
				by: ['workspaceId', 'direction'],
				where: { ...scopedWhere, createdAt: { gte: activitySince } },
				_count: { _all: true },
			}),
			prisma.campaign.groupBy({
				by: ['workspaceId', 'status'],
				where: scopedWhere,
				_count: { _all: true },
			}),
			prisma.abandonedCart.groupBy({
				by: ['workspaceId', 'status'],
				where: scopedWhere,
				_count: { _all: true },
			}),
			prisma.catalogProduct.groupBy({
				by: ['workspaceId'],
				where: scopedWhere,
				_count: { _all: true },
			}),
			prisma.whatsAppChannel.findMany({
				where: { ...scopedWhere, status: 'ACTIVE' },
				select: {
					id: true,
					workspaceId: true,
					name: true,
					wabaId: true,
					phoneNumberId: true,
					displayPhoneNumber: true,
					status: true,
					updatedAt: true,
				},
				orderBy: { updatedAt: 'desc' },
			}),
			prisma.catalogSyncLog.findMany({
				where: scopedWhere,
				select: {
					workspaceId: true,
					status: true,
					message: true,
					startedAt: true,
					finishedAt: true,
					createdAt: true,
				},
				orderBy: { startedAt: 'desc' },
				take: Math.max(workspaceIds.length * 3, 20),
			}),
			prisma.customerSyncLog.findMany({
				where: scopedWhere,
				select: {
					workspaceId: true,
					status: true,
					message: true,
					startedAt: true,
					finishedAt: true,
					createdAt: true,
				},
				orderBy: { startedAt: 'desc' },
				take: Math.max(workspaceIds.length * 3, 20),
			}),
		]);

		for (const row of queueRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			const count = row._count?._all || 0;
			if (row.queue === 'HUMAN') metrics.human += count;
			else if (row.queue === 'PAYMENT_REVIEW') metrics.paymentReview += count;
			else metrics.auto += count;
		}

		for (const row of unreadRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			metrics.unreadConversations = row._count?._all || 0;
			metrics.unreadMessages = row._sum?.unreadCount || 0;
		}

		for (const row of activeConversationRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			metrics.activeConversations30d = row._count?._all || 0;
		}

		for (const row of messageRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			const count = row._count?._all || 0;
			if (row.direction === 'INBOUND') metrics.messages30dInbound += count;
			if (row.direction === 'OUTBOUND') metrics.messages30dOutbound += count;
		}

		for (const row of campaignRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			const count = row._count?._all || 0;
			if (['QUEUED', 'RUNNING'].includes(row.status)) metrics.activeCampaigns += count;
			if (['FAILED', 'PARTIAL'].includes(row.status)) metrics.failedCampaigns += count;
		}

		for (const row of cartRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			const count = row._count?._all || 0;
			if (row.status === 'NEW') metrics.abandonedCartsNew += count;
			if (row.status === 'RECOVERED') metrics.abandonedCartsRecovered += count;
		}

		for (const row of catalogProductRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			metrics.catalogProducts = row._count?._all || 0;
		}

		const channelByWorkspace = new Map();
		for (const channel of activeChannels) {
			if (!channelByWorkspace.has(channel.workspaceId)) {
				channelByWorkspace.set(channel.workspaceId, channel);
			}
		}

		const latestCatalogSyncByWorkspace = getLatestByWorkspace(catalogSyncRows);
		const latestCustomerSyncByWorkspace = getLatestByWorkspace(customerSyncRows);

		const workspacesPayload = workspaces.map((workspace) => {
			const metrics = metricsByWorkspace.get(workspace.id) || emptyOperationMetrics();
			const channel = channelByWorkspace.get(workspace.id) || null;
			const latestCatalogSync = latestCatalogSyncByWorkspace.get(workspace.id) || null;
			const latestCustomerSync = latestCustomerSyncByWorkspace.get(workspace.id) || null;

			return {
				workspace: {
					id: workspace.id,
					name: workspace.name,
					slug: workspace.slug,
					status: workspace.status,
					displayName: getWorkspaceDisplayName(workspace),
					branding: workspace.branding || null,
				},
				metrics,
				channel,
				health: {
					hasActiveWhatsapp: Boolean(channel),
					latestCatalogSync,
					latestCustomerSync,
				},
				issues: buildOperationIssues({
					workspace,
					metrics,
					channel,
					latestCatalogSync,
					latestCustomerSync,
				}),
			};
		});

		const totals = workspacesPayload.reduce(
			(acc, item) => addMetrics(acc, item.metrics),
			emptyOperationMetrics()
		);
		const openIssuesCount = workspacesPayload.reduce(
			(acc, item) => acc + item.issues.length,
			0
		);

		return res.json({
			ok: true,
			role: platformAdmin ? 'PLATFORM_ADMIN' : req.user?.role || 'AGENT',
			activityWindowDays: 30,
			totals,
			openIssuesCount,
			workspaces: platformAdmin
				? workspacesPayload
				: workspacesPayload.slice(0, 1),
		});
	} catch (error) {
		next(error);
	}
}

export async function getInboxStream(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		res.setHeader('Content-Type', 'text/event-stream');
		res.setHeader('Cache-Control', 'no-cache, no-transform');
		res.setHeader('Connection', 'keep-alive');
		res.setHeader('X-Accel-Buffering', 'no');

		if (typeof res.flushHeaders === 'function') {
			res.flushHeaders();
		}

		res.write(`event: connected\n`);
		res.write(`data: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);

		const unsubscribe = subscribeInboxEvents((payload) => {
			try {
				if (payload?.workspaceId && payload.workspaceId !== workspaceId) {
					return;
				}

				res.write(`event: inbox:update\n`);
				res.write(`data: ${JSON.stringify(payload)}\n\n`);
			} catch (error) {
				console.error('[SSE][INBOX] write error:', error?.message || error);
			}
		});

		const keepAlive = setInterval(() => {
			try {
				res.write(`event: ping\n`);
				res.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`);
			} catch (error) {
				console.error('[SSE][INBOX] ping error:', error?.message || error);
			}
		}, 25000);

		req.on('close', () => {
			clearInterval(keepAlive);
			unsubscribe();
			res.end();
		});
	} catch (error) {
		next(error);
	}
}

export async function getCatalog(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const q = String(req.query.q || '').trim();
		const pageNumber = Math.max(1, Number(req.query.page || 1) || 1);
		const catalog = await getCatalogPage({
			q,
			page: pageNumber,
			pageSize: 24,
			workspaceId,
		});

		return res.json({
			ok: true,
			query: q,
			...catalog,
		});
	} catch (error) {
		next(error);
	}
}

export async function postSyncCatalog(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const provider = String(req.body?.provider || req.query?.provider || 'TIENDANUBE').toUpperCase();
		await syncCatalogFromProvider({ workspaceId, provider });

		return res.json({
			ok: true,
			provider,
		});
	} catch (error) {
		next(error);
	}
}

export async function getConversationMessagesJson(req, res, next) {
	try {
		const { conversationId } = req.params;
		const workspaceId = requireRequestWorkspaceId(req);
		const limit = Math.min(120, Math.max(20, Number(req.query.limit || 80) || 80));
		const before = req.query.before ? new Date(String(req.query.before)) : null;
		const hasValidBefore = before instanceof Date && Number.isFinite(before.getTime());

		const conversation = await prisma.conversation.findFirst({
			where: { id: conversationId, workspaceId },
			select: {
				id: true,
				queue: true,
				aiEnabled: true,
				lastMessageAt: true,
				lastInboundMessageAt: true,
				lastReadAt: true,
				unreadCount: true,
				contact: {
					select: {
						name: true,
						phone: true,
						waId: true,
					},
				},
				state: {
					select: {
						handoffReason: true,
						lastDetectedIntent: true,
						lastIntent: true,
						lastUserGoal: true,
						currentProductFocus: true,
						currentProductFamily: true,
						requestedOfferType: true,
						frequentSize: true,
						paymentPreference: true,
						deliveryPreference: true,
						salesStage: true,
						buyingIntentLevel: true,
						frictionLevel: true,
						needsHuman: true,
						commercialSummary: true,
						interestedProducts: true,
						objections: true,
						lastRecommendedProduct: true,
						lastRecommendedOffer: true,
						menuActive: true,
						menuPath: true,
					},
				},
				messages: {
					where: hasValidBefore
						? {
								createdAt: {
									lt: before,
								},
						  }
						: undefined,
					select: {
						id: true,
						direction: true,
						body: true,
						type: true,
						createdAt: true,
						senderName: true,
						tokenTotal: true,
						attachmentName: true,
						attachmentMimeType: true,
						attachmentUrl: true,
						rawPayload: true,
					},
					orderBy: {
						createdAt: 'desc',
					},
					take: limit + 1,
				},
			},
		});

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'Conversation not found',
			});
		}

		const hasMoreMessages = (conversation.messages || []).length > limit;
		const pageMessages = (conversation.messages || []).slice(0, limit).reverse();
		const nextBefore = hasMoreMessages
			? pageMessages[0]?.createdAt?.toISOString?.() || null
			: null;

		return res.json({
			ok: true,
			conversation: {
				id: conversation.id,
				queue: conversation.queue,
				aiEnabled: conversation.aiEnabled,
				lastMessageAt: conversation.lastMessageAt,
				lastInboundMessageAt: conversation.lastInboundMessageAt,
				lastReadAt: conversation.lastReadAt,
				unreadCount: conversation.unreadCount || 0,
				hasUnread: Number(conversation.unreadCount || 0) > 0,
				contact: {
					name: conversation.contact?.name || '',
					phone: conversation.contact?.phone || conversation.contact?.waId || '',
				},
				state: {
					handoffReason: conversation.state?.handoffReason || '',
					lastDetectedIntent: conversation.state?.lastDetectedIntent || '',
					lastIntent: conversation.state?.lastIntent || '',
					lastUserGoal: conversation.state?.lastUserGoal || '',
					currentProductFocus: conversation.state?.currentProductFocus || '',
					currentProductFamily: conversation.state?.currentProductFamily || '',
					requestedOfferType: conversation.state?.requestedOfferType || '',
					frequentSize: conversation.state?.frequentSize || '',
					paymentPreference: conversation.state?.paymentPreference || '',
					deliveryPreference: conversation.state?.deliveryPreference || '',
					salesStage: conversation.state?.salesStage || '',
					buyingIntentLevel: conversation.state?.buyingIntentLevel || '',
					frictionLevel: conversation.state?.frictionLevel || '',
					needsHuman: Boolean(conversation.state?.needsHuman),
					commercialSummary: conversation.state?.commercialSummary || '',
					interestedProducts: Array.isArray(conversation.state?.interestedProducts)
						? conversation.state.interestedProducts
						: [],
					objections: Array.isArray(conversation.state?.objections)
						? conversation.state.objections
						: [],
					lastRecommendedProduct: conversation.state?.lastRecommendedProduct || '',
					lastRecommendedOffer: conversation.state?.lastRecommendedOffer || '',
					menuActive: Boolean(conversation.state?.menuActive),
					menuPath: conversation.state?.menuPath || '',
				},
				messages: pageMessages.map((msg) => ({
					id: msg.id,
					direction: msg.direction,
					body: msg.body,
					type: msg.type,
					createdAt: msg.createdAt,
					createdAtLabel: formatDateTime(msg.createdAt),
					senderName: msg.senderName || '',
					tokenTotal: msg.tokenTotal ?? null,
					attachmentName: msg.attachmentName || null,
					attachmentMimeType: msg.attachmentMimeType || null,
					attachmentUrl: msg.attachmentUrl || null,
					rawPayload: msg.rawPayload || null,
				})),
				messagesPage: {
					limit,
					hasMore: hasMoreMessages,
					nextBefore,
				},
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function getEnboxSyncStatusJson(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const status = getEnboxSyncStatus();
		const [latestLog, latestShipments] = await Promise.all([
			prisma.enboxSyncLog.findMany({
				where: { workspaceId },
				orderBy: { startedAt: 'desc' },
				take: 10,
			}),
			prisma.enboxShipment.findMany({
				where: { workspaceId },
				orderBy: { updatedAt: 'desc' },
				take: 20,
				select: {
					didEnvio: true,
					orderNumber: true,
					shipmentNumber: true,
					trackingUrl: true,
					shippingStatus: true,
					updatedAt: true,
				},
			}),
		]);

		return res.json({
			ok: true,
			status,
			latestLog,
			latestShipments,
		});
	} catch (error) {
		next(error);
	}
}

export async function postRunEnboxSync(req, res, next) {
	try {
		const mode = String(req.body?.mode || 'incremental').toLowerCase() === 'backfill'
			? 'backfill'
			: 'incremental';

		const workspaceId = requireRequestWorkspaceId(req);
		const result = await syncEnboxShipments({ mode, workspaceId });

		return res.json({
			ok: true,
			...result,
		});
	} catch (error) {
		next(error);
	}
}

export async function patchConversationRead(req, res, next) {
	try {
		const { conversationId } = req.params;
		const workspaceId = requireRequestWorkspaceId(req);
		const conversation = await ensureConversationExists(conversationId, workspaceId);

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'ConversaciÃ³n no encontrada',
			});
		}

		const updatedConversation = await markConversationAsRead(conversationId, workspaceId);

		return res.json({
			ok: true,
			conversationId: updatedConversation.id,
			unreadCount: updatedConversation.unreadCount,
			lastReadAt: updatedConversation.lastReadAt,
		});
	} catch (error) {
		next(error);
	}
}

export async function patchConversationUnread(req, res, next) {
	try {
		const { conversationId } = req.params;
		const workspaceId = requireRequestWorkspaceId(req);
		const conversation = await ensureConversationExists(conversationId, workspaceId);

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'ConversaciÃƒÂ³n no encontrada',
			});
		}

		const updatedConversation = await markConversationAsUnread(conversationId, workspaceId);

		return res.json({
			ok: true,
			conversationId: updatedConversation.id,
			unreadCount: updatedConversation.unreadCount,
			lastReadAt: updatedConversation.lastReadAt,
		});
	} catch (error) {
		next(error);
	}
}

export async function postConversationMessage(req, res, next) {
	try {
		const { conversationId } = req.params;
		const workspaceId = requireRequestWorkspaceId(req);
		const body = String(req.body?.body || '').trim();

		if (!body) {
			return res.status(400).json({
				ok: false,
				error: 'El mensaje está vacío',
			});
		}

		const conversation = await prisma.conversation.findFirst({
			where: { id: conversationId, workspaceId },
			include: { contact: true },
		});

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'Conversación no encontrada',
			});
		}

		const waId = normalizeThreadPhone(
			conversation.contact?.phone || conversation.contact?.waId || ''
		);

		if (!waId) {
			return res.status(400).json({
				ok: false,
				error: 'La conversación no tiene un número válido',
			});
		}

		const result = await sendAndPersistOutbound({
			conversationId: conversation.id,
			workspaceId,
			waId,
			body,
			aiMeta: {
				provider: 'manual',
				model: null,
				raw: {
					source: 'dashboard-manual-reply',
				},
			},
		});

		if (!result?.ok) {
			return res.status(400).json({
				ok: false,
				error: 'No se pudo enviar el mensaje',
			});
		}

		await prisma.conversation.updateMany({
			where: { id: conversationId, workspaceId },
			data: {
				lastSummary: null,
			},
		});

		return res.json({
			ok: true,
		});
	} catch (error) {
		next(error);
	}
}

export async function patchConversationQueue(req, res, next) {
	try {
		const { conversationId } = req.params;
		const workspaceId = requireRequestWorkspaceId(req);
		const requestedQueue = String(req.body?.queue || '').toUpperCase();
		const allowedQueues = ['AUTO', 'HUMAN', 'PAYMENT_REVIEW'];

		if (!allowedQueues.includes(requestedQueue)) {
			return res.status(400).json({
				ok: false,
				error: 'Bandeja inválida',
			});
		}

		const conversation = await prisma.conversation.findFirst({
			where: { id: conversationId, workspaceId },
			include: { state: true },
		});

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'Conversación no encontrada',
			});
		}

		await prisma.conversation.updateMany({
			where: { id: conversationId, workspaceId },
			data: {
				queue: requestedQueue,
				aiEnabled: requestedQueue === 'AUTO',
			},
		});
		const updatedConversation = await prisma.conversation.findFirst({
			where: { id: conversationId, workspaceId },
		});

		if (conversation.state) {
			await prisma.conversationState.update({
				where: { conversationId },
				data: {
					needsHuman: requestedQueue === 'AUTO' ? false : requestedQueue === 'HUMAN',
					handoffReason:
						requestedQueue === 'AUTO'
							? null
							: requestedQueue === 'HUMAN'
								? 'manual_handoff'
								: conversation.state.handoffReason,
				},
			});
		} else {
			await prisma.conversationState.create({
				data: {
					conversationId,
					needsHuman: requestedQueue === 'HUMAN',
					handoffReason: requestedQueue === 'HUMAN' ? 'manual_handoff' : null,
				},
			});
		}
		publishInboxEvent({
			workspaceId,
			scope: 'conversation',
			action: 'queue-updated',
			conversationId: updatedConversation.id,
			queue: updatedConversation.queue,
		});
		return res.json({
			ok: true,
			conversationId: updatedConversation.id,
			queue: updatedConversation.queue,
			aiEnabled: updatedConversation.aiEnabled,
		});
	} catch (error) {
		next(error);
	}
}

export async function patchConversationResetContext(req, res, next) {
	try {
		const { conversationId } = req.params;
		const workspaceId = requireRequestWorkspaceId(req);
		const conversation = await ensureConversationExists(conversationId, workspaceId);

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'Conversación no encontrada',
			});
		}

		await prisma.conversation.updateMany({
			where: { id: conversationId, workspaceId },
			data: {
				lastSummary: null,
			},
		});

		if (conversation.state?.id) {
			await prisma.conversationState.update({
				where: { conversationId },
				data: buildResetStateData(),
			});
		} else {
			await prisma.conversationState.create({
				data: {
					conversationId,
					...buildResetStateData(),
				},
			});
		}
		publishInboxEvent({
				workspaceId,
				scope: 'conversation',
				action: 'context-reset',
				conversationId,
		});
		return res.json({
			ok: true,
			conversationId,
			message: 'Contexto reiniciado',
		});
	} catch (error) {
		next(error);
	}
}

export async function deleteConversationHistory(req, res, next) {
	try {
		const { conversationId } = req.params;
		const workspaceId = requireRequestWorkspaceId(req);
		const conversation = await ensureConversationExists(conversationId, workspaceId);

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'Conversación no encontrada',
			});
		}

		const transaction = [
			prisma.message.deleteMany({
				where: { conversationId, workspaceId },
			}),
			prisma.conversation.updateMany({
				where: { id: conversationId, workspaceId },
				data: {
					lastSummary: null,
					lastMessageAt: null,
					lastInboundMessageAt: null,
					lastReadAt: null,
					unreadCount: 0,
				},
			}),
		];

		if (conversation.state?.id) {
			transaction.push(
				prisma.conversationState.update({
					where: { conversationId },
					data: buildResetStateData(),
				})
			);
		} else {
			transaction.push(
				prisma.conversationState.create({
					data: {
						conversationId,
						...buildResetStateData(),
					},
				})
			);
		}

		await prisma.$transaction(transaction);
		publishInboxEvent({
			workspaceId,
			scope: 'conversation',
			action: 'history-cleared',
			conversationId,
		});
		return res.json({
			ok: true,
			conversationId,
			message: 'Historial eliminado',
		});
	} catch (error) {
		next(error);
	}
}
export async function patchConversationArchive(req, res, next) {
	try {
		const { conversationId } = req.params;
		const workspaceId = requireRequestWorkspaceId(req);
		const archived = req.body?.archived !== false;
		const conversation = await ensureConversationExists(conversationId, workspaceId);

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'Conversación no encontrada',
			});
		}

		await prisma.conversation.updateMany({
			where: { id: conversationId, workspaceId },
			data: {
				archivedAt: archived ? new Date() : null,
			},
		});
		const updatedConversation = await prisma.conversation.findFirst({
			where: { id: conversationId, workspaceId },
			select: { archivedAt: true },
		});
		publishInboxEvent({
			workspaceId,
			scope: 'conversation',
			action: archived ? 'archived' : 'unarchived',
			conversationId,
		});
		return res.json({
			ok: true,
			conversationId,
			archivedAt: updatedConversation.archivedAt,
		});
	} catch (error) {
		next(error);
	}
}

export async function postDeduplicateInboxContacts(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const result = await deduplicateInboxContacts(workspaceId);

		return res.json({
			ok: true,
			...result,
		});
	} catch (error) {
		next(error);
	}
}
