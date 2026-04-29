import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { processInboundMessage } from '../services/conversation/chat.service.js';
import { saveInboundWhatsAppMedia } from '../services/whatsapp/whatsapp-media.service.js';
import { applyCampaignMessageStatusWebhook } from '../services/campaigns/whatsapp-campaign.service.js';
import {
	applyTemplateStatusWebhook,
	applyTemplateQualityWebhook,
	applyTemplateCategoryWebhook,
	applyTemplateComponentsWebhook
} from '../services/whatsapp/whatsapp-template.service.js';
import {
	fetchTiendanubeOrderById,
	upsertTiendanubeOrder,
	resolveStoreCredentials
} from '../services/customers/customer.service.js';
import { resolveWorkspaceIdFromPhoneNumberId } from '../services/workspaces/workspace-context.service.js';

function extractInboundBody(message = {}) {
	if (message.type === 'text') return message.text?.body || '';
	if (message.type === 'button') return message.button?.text || message.button?.payload || '';

	if (message.type === 'interactive') {
		return (
			message.interactive?.button_reply?.title ||
			message.interactive?.list_reply?.title ||
			message.interactive?.button_reply?.id ||
			message.interactive?.list_reply?.id ||
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
	if (message.type === 'sticker') return '[Sticker recibido]';

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

async function enrichInboundAttachmentMeta(message = {}, attachmentMeta = {}, workspaceId = null) {
	if (!attachmentMeta?.attachmentId) {
		return attachmentMeta;
	}

	try {
		const savedMedia = await saveInboundWhatsAppMedia({
			workspaceId,
			attachmentId: attachmentMeta.attachmentId,
			attachmentMimeType: attachmentMeta.attachmentMimeType || '',
			attachmentName: attachmentMeta.attachmentName || '',
			messageType: attachmentMeta.attachmentType || message.type || 'media',
			waId: message.from || '',
			metaMessageId: message.id || ''
		});

		if (!savedMedia) {
			return attachmentMeta;
		}

		return {
			...attachmentMeta,
			attachmentUrl: savedMedia.attachmentUrl || null,
			attachmentMimeType: savedMedia.attachmentMimeType || attachmentMeta.attachmentMimeType || null,
			attachmentName: attachmentMeta.attachmentName || savedMedia.attachmentName || null,
			attachmentStoredFileName: savedMedia.storedFileName || null,
			attachmentSize: savedMedia.attachmentSize || null,
			attachmentSha256: attachmentMeta.attachmentSha256 || savedMedia.attachmentSha256 || null
		};
	} catch (error) {
		console.error('[WEBHOOK][MEDIA][DOWNLOAD ERROR]', {
			messageId: message.id || null,
			from: message.from || null,
			attachmentId: attachmentMeta?.attachmentId || null,
			error: error?.message || error
		});

		return {
			...attachmentMeta,
			attachmentDownloadError: error?.message || 'No se pudo descargar el media entrante.'
		};
	}
}

async function processInboundMessages(req, value = {}) {
	const messages = Array.isArray(value.messages) ? value.messages : [];
	const contacts = Array.isArray(value.contacts) ? value.contacts : [];
	const phoneNumberId = value?.metadata?.phone_number_id || value?.metadata?.phoneNumberId || '';
	const workspaceId = await resolveWorkspaceIdFromPhoneNumberId(phoneNumberId);

	for (const message of messages) {
		const contactInfo = contacts.find((contact) => contact.wa_id === message.from);
		const baseAttachmentMeta = extractAttachmentMeta(message);
		const attachmentMeta = await enrichInboundAttachmentMeta(message, baseAttachmentMeta, workspaceId);

		await processInboundMessage({
			workspaceId,
			waId: message.from,
			contactName: contactInfo?.profile?.name || message.from,
			messageBody: extractInboundBody(message),
			messageType: message.type || 'text',
			attachmentMeta,
			rawPayload: {
				webhook: req.body,
				message,
				attachment: {
					id: attachmentMeta.attachmentId || null,
					type: attachmentMeta.attachmentType || null,
					mimeType: attachmentMeta.attachmentMimeType || null,
					name: attachmentMeta.attachmentName || null,
					url: attachmentMeta.attachmentUrl || null,
					storageFileName: attachmentMeta.attachmentStoredFileName || null,
					size: attachmentMeta.attachmentSize || null,
					downloadError: attachmentMeta.attachmentDownloadError || null
				}
			},
			metaMessageId: message.id || null
		});
	}
}

async function processOutboundStatuses(value = {}) {
	const statuses = Array.isArray(value.statuses) ? value.statuses : [];
	const phoneNumberId = value?.metadata?.phone_number_id || value?.metadata?.phoneNumberId || '';
	const workspaceId = await resolveWorkspaceIdFromPhoneNumberId(phoneNumberId);

	for (const status of statuses) {
		await applyCampaignMessageStatusWebhook(status, { workspaceId });
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

function getTiendanubeAppSecret() {
	return String(
		process.env.TIENDANUBE_APP_SECRET ||
		process.env.TIENDANUBE_CLIENT_SECRET ||
		''
	).trim();
}

function timingSafeEquals(a = '', b = '') {
	const left = Buffer.from(String(a), 'utf8');
	const right = Buffer.from(String(b), 'utf8');

	if (left.length !== right.length) {
		return false;
	}

	return crypto.timingSafeEqual(left, right);
}

function isSupportedTiendanubeOrderEvent(event = '') {
	const normalized = String(event || '').trim().toLowerCase();
	return [
		'order/created',
		'order/updated',
		'order/paid',
		'order/pending',
		'order/voided',
		'order/cancelled',
		'order/edited',
		'order/packed',
		'order/fulfilled',
		'order/unpacked'
	].includes(normalized);
}

async function resolveWebhookStoreCredentials(storeId) {
	const normalizedStoreId = String(storeId || '').trim();
	if (!normalizedStoreId) {
		return resolveStoreCredentials();
	}

	const installation = await prisma.storeInstallation.findFirst({
		where: { storeId: normalizedStoreId },
		orderBy: { updatedAt: 'desc' },
		select: { storeId: true, accessToken: true, workspaceId: true },
	});

	if (installation?.storeId && installation?.accessToken) {
		return {
			storeId: installation.storeId,
			accessToken: installation.accessToken,
			workspaceId: installation.workspaceId,
			source: 'storeInstallation'
		};
	}

	const envStoreId = String(process.env.TIENDANUBE_STORE_ID || '').trim();
	const envAccessToken = String(process.env.TIENDANUBE_ACCESS_TOKEN || '').trim();

	if (envStoreId && envAccessToken && envStoreId === normalizedStoreId) {
		return {
			storeId: envStoreId,
			accessToken: envAccessToken,
			workspaceId: 'workspace_lummine',
			source: 'env'
		};
	}

	throw new Error(`No se encontraron credenciales para la tienda ${normalizedStoreId}.`);
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

				if (Array.isArray(value.statuses) && value.statuses.length) {
					await processOutboundStatuses(value);
				}

				await processTemplateWebhook(change);
			}
		}
	} catch (error) {
		console.error('Error webhook WhatsApp:', error);
	}
}

export async function receiveTiendanubeOrderWebhook(req, res) {
	try {
		const appSecret = getTiendanubeAppSecret();

		if (!appSecret) {
			return res.status(500).json({
				ok: false,
				error: 'Falta TIENDANUBE_APP_SECRET o TIENDANUBE_CLIENT_SECRET.'
			});
		}

		const rawBodyBuffer = Buffer.isBuffer(req.body)
			? req.body
			: Buffer.from(req.body || '');

		const rawBody = rawBodyBuffer.toString('utf8');
		const signatureHeader =
			req.headers['x-linkedstore-hmac-sha256'] ||
			req.headers['http_x_linkedstore_hmac_sha256'];

		const expectedSignature = crypto
			.createHmac('sha256', appSecret)
			.update(rawBodyBuffer)
			.digest('hex');

		if (!signatureHeader || !timingSafeEquals(String(signatureHeader), expectedSignature)) {
			return res.status(401).json({
				ok: false,
				error: 'Firma de webhook Tiendanube inválida.'
			});
		}

		let payload = {};
		try {
			payload = rawBody ? JSON.parse(rawBody) : {};
		} catch (error) {
			return res.status(400).json({
				ok: false,
				error: `Webhook Tiendanube inválido: ${error.message}`
			});
		}

		const event = String(payload?.event || '').trim().toLowerCase();
		const resourceId = String(payload?.id || '').trim();
		const storeId = String(payload?.store_id || '').trim();

		if (!event || !resourceId || !storeId) {
			return res.status(400).json({
				ok: false,
				error: 'Webhook Tiendanube incompleto. Se esperaba event, id y store_id.'
			});
		}

		if (!isSupportedTiendanubeOrderEvent(event)) {
			return res.status(200).json({
				ok: true,
				ignored: true,
				reason: 'Evento no manejado'
			});
		}

		const credentials = await resolveWebhookStoreCredentials(storeId);
		const order = await fetchTiendanubeOrderById({
			storeId: credentials.storeId,
			accessToken: credentials.accessToken,
			orderId: resourceId
		});

		const saved = await upsertTiendanubeOrder(order, credentials.storeId, {
			workspaceId: credentials.workspaceId,
		});

		return res.status(200).json({
			ok: true,
			event,
			storeId: credentials.storeId,
			orderId: resourceId,
			source: credentials.source,
			ordersUpserted: saved.ordersUpserted,
			itemsUpserted: saved.itemsUpserted
		});
	} catch (error) {
		console.error('[TIENDANUBE][WEBHOOK][ERROR]', error);
		return res.status(500).json({
			ok: false,
			error: error?.message || 'No se pudo procesar el webhook de Tiendanube.'
		});
	}
}
