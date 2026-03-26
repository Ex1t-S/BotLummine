import { processInboundMessage } from '../services/chat.service.js';

function extractInboundBody(message = {}) {
	if (message.type === 'text') {
		return message.text?.body || '';
	}

	if (message.type === 'image') {
		return message.image?.caption || '[Imagen recibida]';
	}

	if (message.type === 'document') {
		return message.document?.caption || `[Documento recibido${message.document?.filename ? `: ${message.document.filename}` : ''}]`;
	}

	if (message.type === 'audio') {
		return '[Audio recibido]';
	}

	if (message.type === 'video') {
		return message.video?.caption || '[Video recibido]';
	}

	return `[Mensaje ${message.type || 'desconocido'} recibido]`;
}

function extractAttachmentMeta(message = {}) {
	if (message.type === 'image') {
		return {
			attachmentUrl: null,
			attachmentMimeType: message.image?.mime_type || 'image/*',
			attachmentName: null
		};
	}

	if (message.type === 'document') {
		return {
			attachmentUrl: null,
			attachmentMimeType: message.document?.mime_type || null,
			attachmentName: message.document?.filename || null
		};
	}

	if (message.type === 'video') {
		return {
			attachmentUrl: null,
			attachmentMimeType: message.video?.mime_type || 'video/*',
			attachmentName: null
		};
	}

	if (message.type === 'audio') {
		return {
			attachmentUrl: null,
			attachmentMimeType: message.audio?.mime_type || 'audio/*',
			attachmentName: null
		};
	}

	return {
		attachmentUrl: null,
		attachmentMimeType: null,
		attachmentName: null
	};
}

export function verifyWhatsappWebhook(req, res) {
	const mode = req.query['hub.mode'];
	const token = req.query['hub.verify_token'];
	const challenge = req.query['hub.challenge'];

	if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
		return res.status(200).send(challenge);
	}

	return res.sendStatus(403);
}

export async function receiveWhatsappWebhook(req, res) {
	try {
		res.sendStatus(200);

		const entries = req.body?.entry || [];

		for (const entry of entries) {
			for (const change of entry.changes || []) {
				const value = change.value || {};

				for (const message of value.messages || []) {
					const contactInfo = (value.contacts || []).find((c) => c.wa_id === message.from);
					const attachmentMeta = extractAttachmentMeta(message);

					await processInboundMessage({
						waId: message.from,
						contactName: contactInfo?.profile?.name || message.from,
						messageBody: extractInboundBody(message),
						messageType: message.type || 'text',
						attachmentMeta,
						rawPayload: {
							webhook: req.body,
							message,
							attachment: {
								mimeType: attachmentMeta.attachmentMimeType,
								name: attachmentMeta.attachmentName
							}
						},
						metaMessageId: message.id || null
					});
				}
			}
		}
	} catch (error) {
		console.error('Error webhook WhatsApp:', error);
	}
}