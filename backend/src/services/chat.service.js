import { prisma } from '../lib/prisma.js';
import { sendWhatsAppText } from './whatsapp.service.js';
import { normalizeThreadPhone } from '../lib/conversation-threads.js';
import { runConversationTurn } from './conversation-turn.service.js';

async function syncHumanHandoff({ conversationId, reason = 'ai_declared_handoff' }) {
	await prisma.conversation.update({
		where: { id: conversationId },
		data: {
			queue: 'HUMAN',
			aiEnabled: false,
			lastMessageAt: new Date()
		}
	});

	await prisma.conversationState.upsert({
		where: { conversationId },
		update: {
			needsHuman: true,
			handoffReason: reason
		},
		create: {
			conversationId,
			needsHuman: true,
			handoffReason: reason,
			interactionCount: 0,
			interestedProducts: [],
			objections: []
		}
	});
}

export async function getOrCreateConversation({
	waId,
	contactName,
	queue = 'AUTO',
	aiEnabled = true
}) {
	const normalizedWaId = normalizeThreadPhone(waId);

	const contact = await prisma.contact.upsert({
		where: { waId: normalizedWaId },
		update: {
			name: contactName || undefined,
			phone: normalizedWaId
		},
		create: {
			waId: normalizedWaId,
			phone: normalizedWaId,
			name: contactName || normalizedWaId
		}
	});

	let conversation = await prisma.conversation.findFirst({
		where: { contactId: contact.id },
		include: { contact: true, state: true }
	});

	if (!conversation) {
		conversation = await prisma.conversation.create({
			data: {
				contactId: contact.id,
				queue,
				aiEnabled,
				lastMessageAt: new Date(),
				state: {
					create: {
						customerName: contactName || normalizedWaId,
						interactionCount: 0,
						interestedProducts: [],
						objections: [],
						needsHuman: queue === 'HUMAN'
					}
				}
			},
			include: { contact: true, state: true }
		});
	}

	if (!conversation.state) {
		conversation = await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				state: {
					create: {
						customerName: contactName || normalizedWaId,
						interactionCount: 0,
						interestedProducts: [],
						objections: [],
						needsHuman: queue === 'HUMAN'
					}
				}
			},
			include: { contact: true, state: true }
		});
	}

	if (conversation.queue !== queue || conversation.aiEnabled !== aiEnabled) {
		conversation = await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				queue,
				aiEnabled
			},
			include: { contact: true, state: true }
		});
	}

	return conversation;
}

export async function sendAndPersistOutbound({
	conversationId,
	waId,
	body,
	aiMeta = null,
	transportMode = 'whatsapp'
}) {
	let waResult = null;

	if (transportMode === 'whatsapp') {
		waResult = await sendWhatsAppText({ to: waId, body });
	} else {
		waResult = {
			ok: true,
			provider: 'ai-lab',
			model: aiMeta?.model || null,
			rawPayload: {
				simulated: true,
				transportMode
			}
		};
	}

	await prisma.message.create({
		data: {
			conversationId,
			senderName: process.env.BUSINESS_NAME || 'Lummine',
			body,
			direction: 'OUTBOUND',
			type: 'text',
			provider: aiMeta?.provider || waResult?.provider || 'whatsapp-cloud-api',
			model: aiMeta?.model || waResult?.model || null,
			tokenPrompt: aiMeta?.usage?.inputTokens ?? null,
			tokenCompletion: aiMeta?.usage?.outputTokens ?? null,
			tokenTotal: aiMeta?.usage?.totalTokens ?? null,
			metaMessageId: transportMode === 'whatsapp' ? waResult?.rawPayload?.messages?.[0]?.id || null : null,
			rawPayload: {
				ai: aiMeta?.raw || null,
				whatsapp: waResult?.rawPayload || waResult?.error || waResult || {}
			}
		}
	});

	await prisma.conversation.update({
		where: { id: conversationId },
		data: { lastMessageAt: new Date() }
	});

	if (transportMode === 'whatsapp' && waResult?.ok === false) {
		console.error('Error enviando WhatsApp:', waResult.error || waResult);
	}

	return waResult;
}

export async function processInboundMessage({
	waId,
	contactName,
	messageBody,
	messageType = 'text',
	attachmentMeta = null,
	rawPayload,
	metaMessageId = null,
	transportMode = 'whatsapp'
}) {
	const normalizedWaId = normalizeThreadPhone(waId);

	const conversation = await getOrCreateConversation({
		waId: normalizedWaId,
		contactName
	});

	if (metaMessageId) {
		const existingMessage = await prisma.message.findUnique({
			where: { metaMessageId }
		});

		if (existingMessage) {
			return { conversation };
		}
	}

	await prisma.message.create({
		data: {
			conversationId: conversation.id,
			metaMessageId,
			senderName: contactName || normalizedWaId,
			direction: 'INBOUND',
			type: messageType || 'text',
			body: messageBody,
			attachmentUrl: attachmentMeta?.attachmentUrl || null,
			attachmentMimeType: attachmentMeta?.attachmentMimeType || null,
			attachmentName: attachmentMeta?.attachmentName || null,
			rawPayload
		}
	});

	await prisma.conversation.update({
		where: { id: conversation.id },
		data: { lastMessageAt: new Date() }
	});

	const freshConversation = await prisma.conversation.findUnique({
		where: { id: conversation.id },
		include: {
			contact: true,
			state: true,
			messages: {
				orderBy: { createdAt: 'asc' }
			}
		}
	});

	if (!freshConversation) {
		return { conversation };
	}

	const turnResult = await runConversationTurn({
		businessName: process.env.BUSINESS_NAME || 'Lummine',
		contactName: freshConversation.contact.name || normalizedWaId,
		customerContext: {
			name: freshConversation.contact.name || normalizedWaId,
			waId: freshConversation.contact.waId
		},
		messageBody,
		messageType,
		attachmentMeta,
		rawPayload,
		currentConversation: {
			id: freshConversation.id,
			queue: freshConversation.queue,
			aiEnabled: freshConversation.aiEnabled,
			lastSummary: freshConversation.lastSummary || ''
		},
		currentState: freshConversation.state || {},
		messages: freshConversation.messages
	});

	await prisma.conversationState.upsert({
		where: { conversationId: freshConversation.id },
		update: turnResult.nextStatePayload,
		create: {
			conversationId: freshConversation.id,
			...turnResult.nextStatePayload
		}
	});

	await prisma.conversation.update({
		where: { id: freshConversation.id },
		data: {
			queue: turnResult.queueDecision.queue,
			aiEnabled: turnResult.queueDecision.aiEnabled,
			lastMessageAt: new Date(),
			lastSummary: turnResult.lastSummary || freshConversation.lastSummary || null,
		}
	});

	let transportResult = null;
	if (turnResult.outbound?.body) {
		transportResult = await sendAndPersistOutbound({
			conversationId: freshConversation.id,
			waId: freshConversation.contact.waId,
			body: turnResult.outbound.body,
			aiMeta: turnResult.outbound.aiMeta,
			transportMode
		});
	}

	if (turnResult.postReplyHandoff) {
		await syncHumanHandoff({
			conversationId: freshConversation.id,
			reason: turnResult.trace?.commercialPlan?.handoffReason || 'ai_declared_handoff'
		});
	}

	const updatedConversation = await prisma.conversation.findUnique({
		where: { id: freshConversation.id },
		include: {
			contact: true,
			state: true,
			messages: {
				orderBy: { createdAt: 'asc' }
			}
		}
	});

	return {
		conversation: updatedConversation || freshConversation,
		trace: turnResult.trace,
		outbound: turnResult.outbound || null,
		transportResult
	};
}
