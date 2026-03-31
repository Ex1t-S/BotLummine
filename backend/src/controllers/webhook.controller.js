import { processInboundMessage } from '../services/chat.service.js';

function extractInboundBody(message) {
	if (!message) return '';

	if (message.type === 'text') {
		return message.text?.body || '';
	}

	if (message.type === 'button') {
		return message.button?.text || '';
	}

	if (message.type === 'interactive') {
		return (
			message.interactive?.button_reply?.title ||
			message.interactive?.list_reply?.title ||
			''
		);
	}

	return '';
}

function extractAttachmentMeta(message) {
	if (!message) return {};

	const mediaTypes = ['image', 'video', 'audio', 'document', 'sticker'];

	for (const type of mediaTypes) {
		if (message[type]) {
			return {
				attachmentType: type,
				attachmentMimeType: message[type]?.mime_type || null,
				attachmentSha256: message[type]?.sha256 || null,
				attachmentId: message[type]?.id || null,
				attachmentName: message[type]?.filename || null,
			};
		}
	}

	return {};
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
		console.log('[WEBHOOK DEBUG] POST /api/webhook/whatsapp hit');
		console.log('[WEBHOOK DEBUG] body:', JSON.stringify(req.body, null, 2));

		res.sendStatus(200);

		const entries = req.body?.entry || [];

		for (const entry of entries) {
			for (const change of entry.changes || []) {
				const value = change.value || {};
				const messages = value.messages || [];
				const contacts = value.contacts || [];

				console.log('[WEBHOOK DEBUG] change field:', change.field);
				console.log('[WEBHOOK DEBUG] messages count:', messages.length);

				for (const message of messages) {
					console.log('[WEBHOOK DEBUG] inbound message', {
						from: message?.from,
						type: message?.type,
						id: message?.id,
						text: message?.text?.body || null,
					});

					const contactInfo = contacts.find((c) => c.wa_id === message.from);
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
								mimeType: attachmentMeta.attachmentMimeType || null,
								name: attachmentMeta.attachmentName || null,
							},
						},
						metaMessageId: message.id || null,
					});
				}
			}
		}
	} catch (error) {
		console.error('Error webhook WhatsApp:', error);
	}
}