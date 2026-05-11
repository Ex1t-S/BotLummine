import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { logger, maskPhone } from '../lib/logger.js';
import { processInboundMessage } from '../services/conversation/chat.service.js';
import { saveInboundWhatsAppMedia } from '../services/whatsapp/whatsapp-media.service.js';
import { applyCampaignMessageStatusWebhook } from '../services/campaigns/whatsapp-campaign.service.js';
import { syncCatalogFromShopify } from '../services/catalog/catalog.service.js';
import {
	applyTemplateStatusWebhook,
	applyTemplateQualityWebhook,
	applyTemplateCategoryWebhook,
	applyTemplateComponentsWebhook
} from '../services/whatsapp/whatsapp-template.service.js';
import {
	fetchTiendanubeOrderById,
	fetchShopifyOrderById,
	upsertShopifyOrder,
	upsertTiendanubeOrder,
	resolveStoreCredentials
} from '../services/customers/customer.service.js';
import { attributeOrderConversions } from '../services/campaigns/campaign-attribution.service.js';
import {
	DEFAULT_WORKSPACE_ID,
	resolveWorkspaceIdFromPhoneNumberId
} from '../services/workspaces/workspace-context.service.js';

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
		logger.warn('webhook.media_download_failed', {
			messageId: message.id || null,
			from: maskPhone(message.from || ''),
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

	if (!workspaceId) {
		if (messages.length) {
			logger.warn('webhook.whatsapp_unresolved_channel', {
				requestId: req.requestId || null,
				eventType: 'messages',
				reason: phoneNumberId ? 'unknown_or_inactive_phone_number_id' : 'missing_phone_number_id',
				phoneNumberId: phoneNumberId || null,
				messages: messages.length,
				statuses: 0,
			});
		}
		return;
	}

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

async function processOutboundStatuses(req, value = {}) {
	const statuses = Array.isArray(value.statuses) ? value.statuses : [];
	const phoneNumberId = value?.metadata?.phone_number_id || value?.metadata?.phoneNumberId || '';
	const workspaceId = await resolveWorkspaceIdFromPhoneNumberId(phoneNumberId);

	if (!workspaceId) {
		if (statuses.length) {
			logger.warn('webhook.whatsapp_unresolved_channel', {
				requestId: req.requestId || null,
				eventType: 'statuses',
				reason: phoneNumberId ? 'unknown_or_inactive_phone_number_id' : 'missing_phone_number_id',
				phoneNumberId: phoneNumberId || null,
				messages: 0,
				statuses: statuses.length,
			});
		}
		return;
	}

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

function getShopifyWebhookSecret() {
	return String(
		process.env.SHOPIFY_CLIENT_SECRET ||
		process.env.SHOPIFY_API_SECRET ||
		''
	).trim();
}

function verifyShopifyWebhook(rawBodyBuffer, signatureHeader) {
	const secret = getShopifyWebhookSecret();
	if (!secret || !signatureHeader) return false;
	const expected = crypto
		.createHmac('sha256', secret)
		.update(rawBodyBuffer)
		.digest('base64');
	return timingSafeEquals(String(signatureHeader), expected);
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
			workspaceId: DEFAULT_WORKSPACE_ID,
			source: 'env'
		};
	}

	throw new Error(`No se encontraron credenciales para la tienda ${normalizedStoreId}.`);
}

export function verifyWhatsappWebhook(req, res) {
	const mode = req.query['hub.mode'];
	const token = req.query['hub.verify_token'];
	const challenge = req.query['hub.challenge'];

	logger.info('webhook.whatsapp_verify', {
		requestId: req.requestId || null,
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
		res.sendStatus(200);

		const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
		const changesCount = entries.reduce((total, entry) => total + (entry.changes?.length || 0), 0);

		logger.info('webhook.whatsapp_received', {
			requestId: req.requestId || null,
			entries: entries.length,
			changes: changesCount,
		});

		for (const entry of entries) {
			for (const change of entry.changes || []) {
				const value = change.value || {};

				if (change.field === 'messages') {
					await processInboundMessages(req, value);
					await processOutboundStatuses(req, value);
					continue;
				}

				if (Array.isArray(value.statuses) && value.statuses.length) {
					await processOutboundStatuses(req, value);
				}

				await processTemplateWebhook(change);
			}
		}
	} catch (error) {
		logger.error('webhook.whatsapp_failed', {
			requestId: req.requestId || null,
			error,
		});
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
		const attribution = await attributeOrderConversions({
			workspaceId: credentials.workspaceId,
			storeId: credentials.storeId,
			orderId: resourceId
		}).catch((error) => {
			logger.warn('webhook.tiendanube_attribution_failed', {
				requestId: req.requestId || null,
				storeId: credentials.storeId,
				orderId: resourceId,
				error,
			});
			return { conversions: 0, recoveredCarts: 0 };
		});

		return res.status(200).json({
			ok: true,
			event,
			storeId: credentials.storeId,
			orderId: resourceId,
			source: credentials.source,
			ordersUpserted: saved.ordersUpserted,
			itemsUpserted: saved.itemsUpserted,
			conversionsAttributed: attribution.conversions || 0,
			recoveredCarts: attribution.recoveredCarts || 0
		});
	} catch (error) {
		logger.error('webhook.tiendanube_failed', {
			requestId: req.requestId || null,
			error,
		});
		return res.status(500).json({
			ok: false,
			error: process.env.NODE_ENV === 'production'
				? 'No se pudo procesar el webhook de Tiendanube.'
				: error?.message || 'No se pudo procesar el webhook de Tiendanube.',
			requestId: req.requestId || null,
		});
	}
}

export async function receiveShopifyWebhook(req, res) {
	try {
		const rawBodyBuffer = Buffer.isBuffer(req.body)
			? req.body
			: Buffer.from(req.body || '');
		const signatureHeader = req.headers['x-shopify-hmac-sha256'];
		if (!verifyShopifyWebhook(rawBodyBuffer, signatureHeader)) {
			return res.status(401).json({
				ok: false,
				error: 'Firma de webhook Shopify invalida.'
			});
		}

		const shopDomain = String(req.headers['x-shopify-shop-domain'] || '').trim().toLowerCase();
		const topic = String(req.headers['x-shopify-topic'] || '').trim().toLowerCase();
		let payload = {};
		try {
			payload = JSON.parse(rawBodyBuffer.toString('utf8') || '{}');
		} catch (error) {
			return res.status(400).json({
				ok: false,
				error: `Webhook Shopify invalido: ${error.message}`
			});
		}

		if (!shopDomain || !topic) {
			return res.status(400).json({
				ok: false,
				error: 'Webhook Shopify incompleto. Se esperaba shop domain y topic.'
			});
		}

		if (['customers/data_request', 'customers/redact', 'shop/redact'].includes(topic)) {
			logger.info('webhook.shopify_privacy_received', {
				requestId: req.requestId || null,
				shopDomain,
				topic,
			});
			return res.json({ ok: true, topic, shopDomain, privacy: true });
		}

		const connection = await prisma.commerceConnection.findUnique({
			where: {
				provider_externalStoreId: {
					provider: 'SHOPIFY',
					externalStoreId: shopDomain
				}
			},
			select: { workspaceId: true, externalStoreId: true }
		});
		if (!connection?.workspaceId) {
			return res.status(404).json({
				ok: false,
				error: `No se encontro conexion Shopify para ${shopDomain}.`
			});
		}

		if (topic === 'app/uninstalled') {
			await prisma.commerceConnection.update({
				where: {
					provider_externalStoreId: {
						provider: 'SHOPIFY',
						externalStoreId: shopDomain
					}
				},
				data: { status: 'DISABLED' }
			});
			return res.json({ ok: true, topic, shopDomain, disabled: true });
		}

		if (topic === 'products/delete') {
			const productId = String(payload?.id || '').trim();
			if (productId) {
				await prisma.catalogProduct.deleteMany({
					where: {
						workspaceId: connection.workspaceId,
						provider: 'SHOPIFY',
						storeId: shopDomain,
						productId
					}
				});
			}
			return res.json({ ok: true, topic, shopDomain, productId, deleted: Boolean(productId) });
		}

		if (['products/create', 'products/update'].includes(topic)) {
			await syncCatalogFromShopify({ workspaceId: connection.workspaceId });
			return res.json({ ok: true, topic, shopDomain, catalogSynced: true });
		}

		if (['customers/create', 'customers/update'].includes(topic)) {
			logger.info('webhook.shopify_customer_received', {
				requestId: req.requestId || null,
				shopDomain,
				topic,
				customerId: payload?.id || null,
			});
			return res.json({ ok: true, topic, shopDomain, customerAccepted: true });
		}

		const orderTopics = [
			'orders/create',
			'orders/updated',
			'orders/paid',
			'orders/cancelled',
			'orders/fulfilled',
			'refunds/create',
			'fulfillments/create',
			'fulfillment_events/create'
		];
		if (!orderTopics.includes(topic)) {
			return res.json({ ok: true, ignored: true, topic });
		}

		const orderId = String(payload?.order_id || payload?.id || '').trim();
		if (!orderId) {
			return res.status(400).json({
				ok: false,
				error: 'Webhook Shopify de orden sin id u order_id.'
			});
		}

		const order = await fetchShopifyOrderById({
			workspaceId: connection.workspaceId,
			orderId
		}).catch(() => payload);
		const saved = await upsertShopifyOrder(order, shopDomain, {
			workspaceId: connection.workspaceId
		});
		const attribution = await attributeOrderConversions({
			workspaceId: connection.workspaceId,
			storeId: shopDomain,
			orderId
		}).catch((error) => {
			logger.warn('webhook.shopify_attribution_failed', {
				requestId: req.requestId || null,
				shopDomain,
				orderId,
				error,
			});
			return { conversions: 0, recoveredCarts: 0 };
		});

		return res.json({
			ok: true,
			topic,
			shopDomain,
			orderId,
			ordersUpserted: saved.ordersUpserted,
			itemsUpserted: saved.itemsUpserted,
			conversionsAttributed: attribution.conversions || 0,
			recoveredCarts: attribution.recoveredCarts || 0
		});
	} catch (error) {
		logger.error('webhook.shopify_failed', {
			requestId: req.requestId || null,
			error,
		});
		return res.status(500).json({
			ok: false,
			error: process.env.NODE_ENV === 'production'
				? 'No se pudo procesar el webhook de Shopify.'
				: error?.message || 'No se pudo procesar el webhook de Shopify.',
			requestId: req.requestId || null,
		});
	}
}
