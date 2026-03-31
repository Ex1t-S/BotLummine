import { processInboundMessage } from '../services/chat.service.js';
import {
	applyCampaignMessageStatusWebhook
} from '../services/whatsapp-campaign.service.js';
import {
	applyTemplateStatusWebhook,
	applyTemplateQualityWebhook,
	applyTemplateCategoryWebhook,
	applyTemplateComponentsWebhook
} from '../services/whatsapp-template.service.js';

function extractInboundBody(message = {}) {
	if (message.type === 'text') return message.text?.body || '';
	if (message.type === 'button') return message.button?.text || '';
	if (message.type === 'interactive') {
		return (
			message.interactive?.button_reply?.title ||
			message.interactive?.list_reply?.title ||
			''
		);
	}
	if (message.type === 'image') return message.image?.caption || '[Imagen recibida]';
	if (message.type === 'document') {
		return (
			message.document?.caption ||
			`[Documento recibido${message.document?.filename ? `: ${message.document.filename}` : ''}]`
		);
	}
	if (message.type === 'audio') return '[Audio recibido]';
	if (message.type === 'video') return message.video?.caption || '[Video recibido]';

	return '';
}

function extractAttachmentMeta(message = {}) {
	const mediaTypes = ['image', 'video', 'audio', 'document', 'sticker'];

	for (const type of mediaTypes) {
		if (message[type]) {
			return {
				attachmentType: type,
				attachmentMimeType: message[type]?.mime_type || null,
				attachmentSha256: message[type]?.sha256 || null,
				attachmentId: message[type]?.id || null,
				attachmentName: message[type]?.filename || null
			};
		}
	}

	return {};
}

async function processInboundMessages(req, value = {}) {
	const messages = Array.isArray(value.messages) ? value.messages : [];
	const contacts = Array.isArray(value.contacts) ? value.contacts : [];

	for (const message of messages) {
		const contactInfo = contacts.find((contact) => contact.wa_id === message.from);
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
					name: attachmentMeta.attachmentName || null
				}
			},
			metaMessageId: message.id || null
		});
	}
}

async function processOutboundStatuses(value = {}) {
	const statuses = Array.isArray(value.statuses) ? value.statuses : [];

	for (const status of statuses) {
		await applyCampaignMessageStatusWebhook(status);
	}
}

async function processTemplateWebhook(change = {}) {
	const field = String(change?.field || '').trim();
	const value = change?.value || {};

	if (field === 'message_template_status_update') {
		await applyTemplateStatusWebhook(value);
	}

	if (field === 'message_template_quality_update') {
		await applyTemplateQualityWebhook(value);
	}

	if (field === 'template_category_update') {
		await applyTemplateCategoryWebhook(value);
	}

	if (field === 'message_template_components_update') {
		await applyTemplateComponentsWebhook(value);
	}
}

export function verifyWhatsappWebhook(req, res) {
	const mode = req.query['hub.mode'];
	const token = req.query['hub.verify_token'];
	const challenge = req.query['hub.challenge'];

	console.log('[WEBHOOK DEBUG] verify request', {
		mode,
		hasChallenge: Boolean(challenge),
		tokenMatches: token === process.env.WHATSAPP_VERIFY_TOKEN
	});

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

		const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];

		for (const entry of entries) {
			for (const change of entry.changes || []) {
				const value = change.value || {};

				if (change.field === 'messages') {
					await processInboundMessages(req, value);
					await processOutboundStatuses(value);
					continue;
				}

				await processTemplateWebhook(change);
			}
		}
	} catch (error) {
		console.error('Error webhook WhatsApp:', error);
	}
}
