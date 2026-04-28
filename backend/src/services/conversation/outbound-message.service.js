import { prisma } from '../../lib/prisma.js';
import { publishInboxEvent } from '../../lib/inbox-events.js';
import {
	sendWhatsAppText,
	sendWhatsAppInteractiveList,
} from '../whatsapp/whatsapp.service.js';
import { getWorkspaceRuntimeConfig } from '../workspaces/workspace-context.service.js';

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
	deliveryMode = 'live',
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
	const workspaceId = conversation.workspaceId;
	const workspaceConfig = await getWorkspaceRuntimeConfig(workspaceId);

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

	if (deliveryMode === 'lab') {
		sendResult = {
			ok: true,
			provider: 'ai-lab-simulator',
			model: null,
			rawPayload: {
				deliveryMode: 'lab',
				messageType,
				interactivePayload,
				messages: [
					{
						id: `lab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
					}
				]
			}
		};
	} else if (messageType === 'interactive') {
		sendResult = await sendWhatsAppInteractiveList({
			workspaceId,
			to: waId,
			body: cleanBody,
			headerText: interactivePayload?.headerText || null,
			footerText: interactivePayload?.footerText || null,
			buttonText: interactivePayload?.buttonText || 'Ver opciones',
			sections: interactivePayload?.sections || [],
		});

		if (!sendResult?.ok && interactivePayload?.fallbackText) {
			sendResult = await sendWhatsAppText({
				workspaceId,
				to: waId,
				body: interactivePayload.fallbackText,
			});
		}
	} else {
		sendResult = await sendWhatsAppText({
			workspaceId,
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
			workspaceId,
			direction: 'OUTBOUND',
			type: messageType,
			body:
				messageType === 'interactive' && interactivePayload?.fallbackText
					? interactivePayload.fallbackText
					: cleanBody,
			senderName: workspaceConfig.ai.businessName || 'Marca',
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
			deliveryMode,
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
		workspaceId,
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
