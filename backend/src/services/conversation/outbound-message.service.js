import { prisma } from '../../lib/prisma.js';
import { publishInboxEvent } from '../../lib/inbox-events.js';
import {
	sendWhatsAppText,
	sendWhatsAppInteractiveList,
} from '../whatsapp/whatsapp.service.js';

export async function sendAndPersistOutbound({
	conversationId,
	body,
	userId = null,
	provider = 'whatsapp-cloud-api',
	model = null,
	replyMessageId = null,
	aiMeta = null,
	messageType = 'text',
	interactivePayload = null,
}) {
	const cleanBody = String(body || '').trim();

	if (!conversationId) {
		throw new Error('Falta conversationId para enviar el mensaje.');
	}

	if (!cleanBody) {
		throw new Error('El mensaje no puede estar vacío.');
	}

	const conversation = await prisma.conversation.findUnique({
		where: { id: conversationId },
		include: {
			contact: true,
		},
	});

	if (!conversation) {
		throw new Error('Conversación no encontrada.');
	}

	const waId = conversation.contact?.waId;

	console.log('[OUTBOUND DEBUG] sendAndPersistOutbound', {
		conversationId,
		waId,
		contactName: conversation.contact?.name || null,
		messageType,
		bodyPreview: cleanBody.slice(0, 160),
		replyMessageId,
	});

	if (!waId) {
		throw new Error('La conversación no tiene un waId válido para enviar el mensaje.');
	}

	let sendResult = null;

	if (messageType === 'interactive') {
		sendResult = await sendWhatsAppInteractiveList({
			to: waId,
			body: cleanBody,
			headerText: interactivePayload?.headerText || null,
			footerText: interactivePayload?.footerText || null,
			buttonText: interactivePayload?.buttonText || 'Ver opciones',
			sections: interactivePayload?.sections || [],
		});

		if (!sendResult?.ok && interactivePayload?.fallbackText) {
			sendResult = await sendWhatsAppText({
				to: waId,
				body: interactivePayload.fallbackText,
			});
		}
	} else {
		sendResult = await sendWhatsAppText({
			to: waId,
			body: cleanBody,
		});
	}

	console.log('[OUTBOUND DEBUG] send result', sendResult);

	if (!sendResult?.ok) {
		throw new Error(
			sendResult?.error?.message ||
			'No se pudo enviar el mensaje por WhatsApp.'
		);
	}

	const createdMessage = await prisma.message.create({
		data: {
			conversationId: conversation.id,
			direction: 'OUTBOUND',
			type: messageType,
			body:
				messageType === 'interactive' && interactivePayload?.fallbackText
					? interactivePayload.fallbackText
					: cleanBody,
			senderName: process.env.BUSINESS_NAME || 'Lummine',
			provider: aiMeta?.provider || provider,
			model: aiMeta?.model || model,
			metaMessageId:
				sendResult?.rawPayload?.messages?.[0]?.id ||
				replyMessageId ||
				null,
			rawPayload: aiMeta
				? {
					sendResult: sendResult?.rawPayload || null,
					aiMeta: aiMeta?.raw || null,
					userId,
					messageType,
					interactivePayload,
				}
				: sendResult?.rawPayload || null,
		},
	});

	await prisma.conversation.update({
		where: { id: conversation.id },
		data: {
			lastMessageAt: new Date(),
		},
	});

	publishInboxEvent({
		scope: 'message',
		action: 'outbound-created',
		conversationId: conversation.id,
		queue: conversation.queue,
		direction: 'OUTBOUND',
		messageId: createdMessage.id,
		metaMessageId: createdMessage.metaMessageId || null,
		createdAt: createdMessage.createdAt.toISOString(),
	});

	return {
		message: createdMessage,
		sendResult,
	};
}
