import { prisma } from '../../lib/prisma.js';
import { publishInboxEvent } from '../../lib/inbox-events.js';
import {
	sendWhatsAppText,
	sendWhatsAppMedia,
	sendWhatsAppInteractiveList,
} from '../whatsapp/whatsapp.service.js';
import {
	uploadWhatsAppMedia,
	saveLocalWhatsAppMedia,
} from '../whatsapp/whatsapp-media.service.js';

function resolveMediaMessageType(mimeType = '') {
	const mime = String(mimeType || '').toLowerCase();

	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('video/')) return 'video';
	if (mime.startsWith('audio/')) return 'audio';

	return 'document';
}

function canSendCaption(messageType = '') {
	return ['image', 'video', 'document'].includes(String(messageType || '').toLowerCase());
}

function buildAttachmentBody({ messageType = 'document', caption = '', fileName = '' }) {
	const cleanCaption = String(caption || '').trim();
	const cleanFileName = String(fileName || '').trim();

	if (cleanCaption) return cleanCaption;
	if (messageType === 'image') return cleanFileName ? `[Imagen enviada] ${cleanFileName}` : '[Imagen enviada]';
	if (messageType === 'video') return cleanFileName ? `[Video enviado] ${cleanFileName}` : '[Video enviado]';
	if (messageType === 'audio') return cleanFileName ? `[Audio enviado] ${cleanFileName}` : '[Audio enviado]';

	return cleanFileName ? `[Documento enviado] ${cleanFileName}` : '[Documento enviado]';
}

async function publishOutboundMessageEvent({ conversation, message }) {
	publishInboxEvent({
		scope: 'message',
		action: 'outbound-created',
		conversationId: conversation.id,
		queue: conversation.queue,
		direction: 'OUTBOUND',
		messageId: message.id,
		metaMessageId: message.metaMessageId || null,
		createdAt: message.createdAt.toISOString(),
	});
}

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

	const waId = conversation.contact?.waId || conversation.contact?.phone;

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

	await publishOutboundMessageEvent({
		conversation,
		message: createdMessage,
	});

	return {
		ok: true,
		message: createdMessage,
		sendResult,
	};
}

export async function sendAndPersistOutboundMediaBatch({
	conversationId,
	body = '',
	files = [],
	userId = null,
	provider = 'whatsapp-cloud-api',
	model = null,
	aiMeta = null,
}) {
	const cleanBody = String(body || '').trim();
	const cleanFiles = Array.isArray(files) ? files.filter((file) => file?.path) : [];

	if (!conversationId) {
		throw new Error('Falta conversationId para enviar el mensaje.');
	}

	if (!cleanBody && !cleanFiles.length) {
		throw new Error('El mensaje no puede estar vacÃ­o.');
	}

	if (!cleanFiles.length) {
		return sendAndPersistOutbound({
			conversationId,
			body: cleanBody,
			userId,
			provider,
			model,
			aiMeta,
		});
	}

	const conversation = await prisma.conversation.findUnique({
		where: { id: conversationId },
		include: {
			contact: true,
		},
	});

	if (!conversation) {
		throw new Error('ConversaciÃ³n no encontrada.');
	}

	const waId = conversation.contact?.waId || conversation.contact?.phone;

	if (!waId) {
		throw new Error('La conversaciÃ³n no tiene un waId vÃ¡lido para enviar el mensaje.');
	}

	const createdMessages = [];
	const sendResults = [];
	let pendingCaption = cleanBody;

	for (const file of cleanFiles) {
		const messageType = resolveMediaMessageType(file.mimetype);
		const fileName = String(file.originalname || file.filename || 'archivo').trim();
		const caption = pendingCaption && canSendCaption(messageType) ? pendingCaption : '';

		if (caption) {
			pendingCaption = '';
		}

		const uploadResult = await uploadWhatsAppMedia({
			filePath: file.path,
			fileName,
			mimeType: file.mimetype,
		});

		if (!uploadResult?.ok) {
			throw new Error(
				uploadResult?.error?.message ||
					'No se pudo subir el adjunto a WhatsApp.'
			);
		}

		const sendResult = await sendWhatsAppMedia({
			to: waId,
			mediaId: uploadResult.mediaId,
			mediaType: messageType,
			caption,
			fileName,
		});

		if (!sendResult?.ok) {
			throw new Error(
				sendResult?.error?.message ||
					'No se pudo enviar el adjunto por WhatsApp.'
			);
		}

		const metaMessageId = sendResult?.rawPayload?.messages?.[0]?.id || null;
		const savedMedia = await saveLocalWhatsAppMedia({
			filePath: file.path,
			fileName,
			mimeType: file.mimetype,
			messageType,
			metaMessageId: metaMessageId || uploadResult.mediaId,
		});

		const createdMessage = await prisma.message.create({
			data: {
				conversationId: conversation.id,
				direction: 'OUTBOUND',
				type: messageType,
				body: buildAttachmentBody({
					messageType,
					caption,
					fileName: savedMedia.attachmentName || fileName,
				}),
				senderName: process.env.BUSINESS_NAME || 'Lummine',
				provider: aiMeta?.provider || provider,
				model: aiMeta?.model || model,
				metaMessageId,
				attachmentUrl: savedMedia.attachmentUrl || null,
				attachmentMimeType: savedMedia.attachmentMimeType || file.mimetype || null,
				attachmentName: savedMedia.attachmentName || fileName || null,
				rawPayload: {
					sendResult: sendResult?.rawPayload || null,
					aiMeta: aiMeta?.raw || null,
					userId,
					messageType,
					attachment: {
						id: uploadResult.mediaId || null,
						type: messageType,
						mimeType: savedMedia.attachmentMimeType || file.mimetype || null,
						name: savedMedia.attachmentName || fileName || null,
						url: savedMedia.attachmentUrl || null,
						storageFileName: savedMedia.storedFileName || null,
						size: savedMedia.attachmentSize || file.size || null,
						sha256: savedMedia.attachmentSha256 || null,
					},
				},
			},
		});

		createdMessages.push(createdMessage);
		sendResults.push(sendResult);

		await publishOutboundMessageEvent({
			conversation,
			message: createdMessage,
		});
	}

	if (pendingCaption) {
		const textResult = await sendAndPersistOutbound({
			conversationId,
			body: pendingCaption,
			userId,
			provider,
			model,
			aiMeta,
		});

		if (textResult?.message) {
			createdMessages.push(textResult.message);
		}

		if (textResult?.sendResult) {
			sendResults.push(textResult.sendResult);
		}
	} else {
		await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				lastMessageAt: new Date(),
			},
		});
	}

	return {
		ok: true,
		messages: createdMessages,
		sendResults,
	};
}
