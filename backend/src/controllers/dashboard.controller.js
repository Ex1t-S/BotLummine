import { prisma } from '../lib/prisma.js';
import { getCatalogPage, syncCatalogFromTiendanube } from '../services/catalog.service.js';
import { getQueueMeta } from '../services/inbox-routing.service.js';
import { normalizeThreadPhone } from '../lib/conversation-threads.js';
import { sendAndPersistOutbound } from '../services/chat.service.js';

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
		? parts.map((p) => p[0]?.toUpperCase() || '').join('')
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
async function getLatestMessagesByConversationIds(conversationIds) {
	if (!conversationIds.length) {
		return new Map();
	}

	const messages = await prisma.message.findMany({
		where: {
			conversationId: {
				in: conversationIds,
			},
		},
		select: {
			id: true,
			conversationId: true,
			body: true,
			senderName: true,
			direction: true,
			createdAt: true,
		},
		orderBy: [
			{ conversationId: 'asc' },
			{ createdAt: 'desc' },
		],
	});

	const latestByConversationId = new Map();

	for (const message of messages) {
		if (!latestByConversationId.has(message.conversationId)) {
			latestByConversationId.set(message.conversationId, message);
		}
	}

	return latestByConversationId;
}

function buildContactCard(conversation, lastMessage) {
	const contact = conversation.contact || {};
	const state = conversation.state || {};
	const phone = normalizePhone(contact.phone || contact.waId || '');
	const displayName = contact.name || phone || 'Sin nombre';
	const queueMeta = getQueueMeta(conversation.queue);

	return {
		key: contact.waId || conversation.id,
		conversationId: conversation.id,
		displayName,
		phoneDisplay: phone,
		preview: lastMessage?.body || '',
		lastMessageAt: conversation.lastMessageAt || lastMessage?.createdAt || null,
		lastMessageTime: formatTime(conversation.lastMessageAt || lastMessage?.createdAt || null),
		lastMessageLabel: formatDateTime(conversation.lastMessageAt || lastMessage?.createdAt || null),
		aiEnabled: !!conversation.aiEnabled,
		queue: conversation.queue || 'AUTO',
		queueLabel: queueMeta.label,
		queueBadgeClass: queueMeta.badgeClass,
		needsHuman: !!state.needsHuman,
		handoffReason: state.handoffReason || '',
		avatar: buildAvatar(displayName, phone),
		lastSummary: conversation.lastSummary || '',
	};
}

async function fetchInboxData(selectedConversationId = null, queue = 'AUTO') {
	const where = queue === 'ALL' ? {} : { queue };

	const conversations = await prisma.conversation.findMany({
		where,
		select: {
			id: true,
			queue: true,
			aiEnabled: true,
			lastSummary: true,
			lastMessageAt: true,
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
		},
		orderBy: {
			lastMessageAt: 'desc',
		},
	});

	const conversationIds = conversations.map((item) => item.id);
	const latestMessagesByConversationId = await getLatestMessagesByConversationIds(conversationIds);

	const contacts = conversations.map((conversation) =>
		buildContactCard(
			conversation,
			latestMessagesByConversationId.get(conversation.id) || null
		)
	);

	let selectedContact = null;

	if (selectedConversationId) {
		selectedContact =
			contacts.find((item) => item.conversationId === selectedConversationId) || null;
	}

	if (!selectedContact && contacts.length) {
		selectedContact = contacts[0];
	}

	const [autoCount, humanCount, paymentCount] = await Promise.all([
		prisma.conversation.count({ where: { queue: 'AUTO' } }),
		prisma.conversation.count({ where: { queue: 'HUMAN' } }),
		prisma.conversation.count({ where: { queue: 'PAYMENT_REVIEW' } }),
	]);

	return {
		contacts,
		selectedContact,
		counts: {
			AUTO: autoCount,
			HUMAN: humanCount,
			PAYMENT_REVIEW: paymentCount,
		},
	};
}

async function ensureConversationExists(conversationId) {
	const conversation = await prisma.conversation.findUnique({
		where: { id: conversationId },
		select: {
			id: true,
			queue: true,
			aiEnabled: true,
			lastSummary: true,
			lastMessageAt: true,
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

export async function getInbox(req, res, next) {
	try {
		const currentQueue = String(req.query.queue || 'AUTO').toUpperCase();
		const data = await fetchInboxData(req.query.conversationId || null, currentQueue);

		return res.json({
			ok: true,
			currentQueue,
			...data,
		});
	} catch (error) {
		next(error);
	}
}

export async function getCatalog(req, res, next) {
	try {
		const q = String(req.query.q || '').trim();
		const pageNumber = Math.max(1, Number(req.query.page || 1) || 1);
		const catalog = await getCatalogPage({ q, page: pageNumber, pageSize: 24 });

		return res.json({
			ok: true,
			query: q,
			...catalog,
		});
	} catch (error) {
		next(error);
	}
}

export async function postSyncCatalog(_req, res, next) {
	try {
		await syncCatalogFromTiendanube();

		return res.json({ ok: true });
	} catch (error) {
		next(error);
	}
}

export async function getConversationMessagesJson(req, res, next) {
	try {
		const { conversationId } = req.params;

		const conversation = await prisma.conversation.findUnique({
			where: { id: conversationId },
			select: {
				id: true,
				queue: true,
				aiEnabled: true,
				lastMessageAt: true,
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
					},
				},
				messages: {
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
					},
					orderBy: {
						createdAt: 'asc',
					},
				},
			},
		});

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'Conversation not found',
			});
		}

		return res.json({
			ok: true,
			conversation: {
				id: conversation.id,
				queue: conversation.queue,
				aiEnabled: conversation.aiEnabled,
				lastMessageAt: conversation.lastMessageAt,
				contact: {
					name: conversation.contact?.name || '',
					phone: conversation.contact?.phone || conversation.contact?.waId || '',
				},
				state: {
					handoffReason: conversation.state?.handoffReason || '',
					lastDetectedIntent: conversation.state?.lastDetectedIntent || '',
					lastIntent: conversation.state?.lastIntent || '',
					lastUserGoal: conversation.state?.lastUserGoal || '',
				},
				messages: (conversation.messages || []).map((msg) => ({
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
				})),
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function postConversationMessage(req, res, next) {
	try {
		const { conversationId } = req.params;
		const body = String(req.body?.body || '').trim();

		if (!body) {
			return res.status(400).json({
				ok: false,
				error: 'El mensaje está vacío',
			});
		}

		const conversation = await prisma.conversation.findUnique({
			where: { id: conversationId },
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
			waId,
			body,
			aiMeta: {
				provider: 'manual',
				model: null,
				raw: { source: 'dashboard-manual-reply' },
			},
		});

		if (!result?.ok) {
			return res.status(400).json({
				ok: false,
				error: 'No se pudo enviar el mensaje',
			});
		}

		await prisma.conversation.update({
			where: { id: conversationId },
			data: {
				lastSummary: null
			}
		});

		return res.json({ ok: true });
	} catch (error) {
		next(error);
	}
}

export async function patchConversationQueue(req, res, next) {
	try {
		const { conversationId } = req.params;
		const requestedQueue = String(req.body?.queue || '').toUpperCase();
		const allowedQueues = ['AUTO', 'HUMAN', 'PAYMENT_REVIEW'];

		if (!allowedQueues.includes(requestedQueue)) {
			return res.status(400).json({
				ok: false,
				error: 'Bandeja inválida',
			});
		}

		const conversation = await prisma.conversation.findUnique({
			where: { id: conversationId },
			include: { state: true },
		});

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'Conversación no encontrada',
			});
		}

		const updatedConversation = await prisma.conversation.update({
			where: { id: conversationId },
			data: {
				queue: requestedQueue,
				aiEnabled: requestedQueue === 'AUTO',
			},
		});

		if (conversation.state) {
			await prisma.conversationState.update({
				where: { conversationId },
				data: {
					needsHuman:
						requestedQueue === 'AUTO'
							? false
							: requestedQueue === 'HUMAN',
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
					handoffReason:
						requestedQueue === 'HUMAN' ? 'manual_handoff' : null,
				},
			});
		}

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

		const conversation = await ensureConversationExists(conversationId);

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'Conversación no encontrada',
			});
		}

		await prisma.conversation.update({
			where: { id: conversationId },
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

		const conversation = await ensureConversationExists(conversationId);

		if (!conversation) {
			return res.status(404).json({
				ok: false,
				error: 'Conversación no encontrada',
			});
		}

		await prisma.$transaction([
			prisma.message.deleteMany({
				where: { conversationId },
			}),
			prisma.conversation.update({
				where: { id: conversationId },
				data: {
					lastSummary: null,
					lastMessageAt: null,
				},
			}),
			conversation.state?.id
				? prisma.conversationState.update({
						where: { conversationId },
						data: buildResetStateData(),
					})
				: prisma.conversationState.create({
						data: {
							conversationId,
							...buildResetStateData(),
						},
					}),
		]);

		return res.json({
			ok: true,
			conversationId,
			message: 'Historial eliminado',
		});
	} catch (error) {
		next(error);
	}
}