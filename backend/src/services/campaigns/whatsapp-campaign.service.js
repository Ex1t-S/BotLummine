import { randomUUID } from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { normalizeWhatsAppIdentityPhone } from '../../lib/phone-normalization.js';
import { sendWhatsAppTemplate } from '../whatsapp/whatsapp.service.js';
import { renderTemplatePreviewFromComponents, getTemplateOrThrow } from '../whatsapp/whatsapp-template.service.js';

function normalizeString(value, fallback = '') {
	const normalized = String(value ?? '').trim();
	return normalized || fallback;
}

function safeArray(value) {
	return Array.isArray(value) ? value : [];
}

function normalizeCampaignPhone(value = '') {
	return normalizeWhatsAppIdentityPhone(value);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function toUpper(value, fallback = '') {
	return normalizeString(value, fallback).toUpperCase();
}

function normalizeAudienceSource(value, fallback = 'manual') {
	return normalizeString(value, fallback).toLowerCase();
}

function formatCurrency(value, currency = 'ARS') {
	try {
		return new Intl.NumberFormat('es-AR', {
			style: 'currency',
			currency: currency || 'ARS',
			maximumFractionDigits: 0
		}).format(Number(value || 0));
	} catch {
		return `${value || 0} ${currency || 'ARS'}`;
	}
}

function normalizeAbandonedCartFilters(input = {}) {
	const daysBack = Math.max(1, Math.min(Number(input.daysBack || 7) || 7, 90));
	const limit = Math.max(1, Math.min(Number(input.limit || 50) || 50, 500));
	const rawStatus = normalizeString(input.status || 'NEW').toUpperCase();
	const status = ['NEW', 'CONTACTED', 'ALL'].includes(rawStatus) ? rawStatus : 'NEW';

	let minTotal = null;
	if (input.minTotal !== '' && input.minTotal !== null && input.minTotal !== undefined) {
		const parsed = Number(input.minTotal);
		minTotal = Number.isFinite(parsed) ? parsed : null;
	}

	return {
		daysBack,
		limit,
		status,
		minTotal,
		productQuery: normalizeString(input.productQuery || '')
	};
}

function getCartProducts(cart = {}) {
	return safeArray(cart.products);
}

function getCartProductName(product = {}) {
	return normalizeString(
		product?.name ||
		product?.title ||
		product?.productName ||
		product?.variantName ||
		product?.sku ||
		'Producto'
	);
}

function getPrimaryCartProductName(cart = {}) {
	return getCartProductName(getCartProducts(cart)[0] || {});
}

function cartMatchesProductQuery(cart = {}, productQuery = '') {
	const needle = normalizeString(productQuery).toLowerCase();
	if (!needle) return true;

	return getCartProducts(cart).some((product) =>
		getCartProductName(product).toLowerCase().includes(needle)
	);
}

function buildAbandonedCartVariables(cart = {}, contact = null, lastOrder = null) {
	const normalizedPhone = normalizeCampaignPhone(cart.contactPhone || '');
	const contactName = normalizeString(cart.contactName || contact?.name || '', normalizedPhone);
	const firstName = contactName.split(/\s+/).filter(Boolean)[0] || contactName || 'Hola';
	const checkoutUrl = normalizeString(cart.abandonedCheckoutUrl || '');
	const primaryProductName = getPrimaryCartProductName(cart);
	const totalFormatted = formatCurrency(cart.totalAmount, cart.currency || 'ARS');
	const checkoutId = normalizeString(cart.checkoutId || '');

	const lastOrderId = normalizeString(lastOrder?.orderId || '');
	const lastOrderNumber = normalizeString(lastOrder?.orderNumber || '');

	return {
		'1': firstName,
		'2': checkoutUrl,
		'3': primaryProductName,
		'4': totalFormatted,
		'5': checkoutId,

		contact_name: contactName,
		first_name: firstName,
		wa_id: normalizedPhone,
		phone: normalizedPhone,

		checkout_url: checkoutUrl,
		abandoned_checkout_url: checkoutUrl,

		product_name: primaryProductName,
		first_product_name: primaryProductName,

		total_amount: totalFormatted,
		total_raw: cart.totalAmount != null ? String(cart.totalAmount) : '',

		checkout_id: checkoutId,
		cart_status: normalizeString(cart.status || ''),

		last_order_id: lastOrderId,
		last_order_number: lastOrderNumber
	};
}

function dedupeRecipients(recipients = []) {
	const seen = new Map();

	for (const recipient of recipients) {
		const normalizedPhone = normalizeCampaignPhone(recipient.phone || recipient.waId || '');

		if (!normalizedPhone) {
			continue;
		}

		const previous = seen.get(normalizedPhone) || {};

		seen.set(normalizedPhone, {
			...previous,
			...recipient,
			phone: normalizedPhone,
			waId: normalizedPhone
		});
	}

	return [...seen.values()];
}

async function resolveRecipientsFromContacts(contactIds = []) {
	if (!Array.isArray(contactIds) || !contactIds.length) {
		return [];
	}

	const contacts = await prisma.contact.findMany({
		where: {
			id: {
				in: contactIds
			}
		},
		select: {
			id: true,
			name: true,
			phone: true,
			waId: true,
			marketingOptIn: true,
			marketingOptedOutAt: true,
			marketingOptOutReason: true
		}
	});

	return contacts.map((contact) => ({
		contactId: contact.id,
		contactName: contact.name || contact.phone || contact.waId || '',
		phone: contact.phone || contact.waId || '',
		waId: contact.waId || contact.phone || '',
		isOptedOut: contact.marketingOptIn === false || Boolean(contact.marketingOptedOutAt),
		optOutReason: contact.marketingOptOutReason || 'opted_out'
	}));
}

async function resolveRecipientsFromAllContacts() {
	const contacts = await prisma.contact.findMany({
		select: {
			id: true,
			name: true,
			phone: true,
			waId: true,
			marketingOptIn: true,
			marketingOptedOutAt: true,
			marketingOptOutReason: true
		},
		orderBy: {
			updatedAt: 'desc'
		}
	});

	return contacts.map((contact) => ({
		contactId: contact.id,
		contactName: contact.name || contact.phone || contact.waId || '',
		phone: contact.phone || contact.waId || '',
		waId: contact.waId || contact.phone || '',
		isOptedOut: contact.marketingOptIn === false || Boolean(contact.marketingOptedOutAt),
		optOutReason: contact.marketingOptOutReason || 'opted_out'
	}));
}

async function resolveLatestOrdersByPhones(normalizedPhones = []) {
	const uniquePhones = [...new Set(
		safeArray(normalizedPhones)
			.map((phone) => normalizeCampaignPhone(phone))
			.filter(Boolean)
	)];

	if (!uniquePhones.length) {
		return new Map();
	}

	const orders = await prisma.customerOrder.findMany({
		where: {
			normalizedPhone: {
				in: uniquePhones
			}
		},
		select: {
			id: true,
			orderId: true,
			orderNumber: true,
			normalizedPhone: true,
			orderCreatedAt: true,
			orderUpdatedAt: true,
			createdAt: true
		},
		orderBy: [
			{ orderCreatedAt: 'desc' },
			{ orderUpdatedAt: 'desc' },
			{ createdAt: 'desc' }
		]
	});

	const latestByPhone = new Map();

	for (const order of orders) {
		const phone = normalizeCampaignPhone(order.normalizedPhone || '');
		if (!phone || latestByPhone.has(phone)) {
			continue;
		}

		latestByPhone.set(phone, order);
	}

	return latestByPhone;
}

async function resolveRecipientsFromAbandonedCarts(input = {}) {
	const filters = normalizeAbandonedCartFilters(input.audienceFilters || input.filters || input || {});
	const since = new Date();
	since.setDate(since.getDate() - filters.daysBack);

	const where = {
		contactPhone: {
			not: null
		},
		abandonedCheckoutUrl: {
			not: null
		},
		checkoutCreatedAt: {
			gte: since
		}
	};

	if (filters.status !== 'ALL') {
		where.status = filters.status;
	}

	if (typeof filters.minTotal === 'number' && Number.isFinite(filters.minTotal)) {
		where.totalAmount = {
			gte: filters.minTotal
		};
	}

	const rawCarts = await prisma.abandonedCart.findMany({
		where,
		orderBy: [
			{ checkoutCreatedAt: 'desc' },
			{ updatedAt: 'desc' }
		],
		take: Math.min(filters.limit * 4, 1000)
	});

	const latestByPhone = new Map();

	for (const cart of rawCarts) {
		const normalizedPhone = normalizeCampaignPhone(cart.contactPhone || '');
		const checkoutUrl = normalizeString(cart.abandonedCheckoutUrl || '');

		if (!normalizedPhone || !checkoutUrl) {
			continue;
		}

		if (!cartMatchesProductQuery(cart, filters.productQuery)) {
			continue;
		}

		const previous = latestByPhone.get(normalizedPhone);
		const cartTs = new Date(
			cart.checkoutCreatedAt || cart.updatedAt || cart.createdAt || 0
		).getTime();
		const prevTs = previous
			? new Date(previous.checkoutCreatedAt || previous.updatedAt || previous.createdAt || 0).getTime()
			: -1;

		if (!previous || cartTs > prevTs) {
			latestByPhone.set(normalizedPhone, cart);
		}
	}

	const carts = [...latestByPhone.values()].slice(0, filters.limit);
	const normalizedPhones = carts
		.map((cart) => normalizeCampaignPhone(cart.contactPhone || ''))
		.filter(Boolean);

	let contacts = [];
	if (normalizedPhones.length) {
		contacts = await prisma.contact.findMany({
			where: {
				OR: [
					{ waId: { in: normalizedPhones } },
					{ phone: { in: normalizedPhones } }
				]
			},
			select: {
				id: true,
				name: true,
				phone: true,
				waId: true,
				marketingOptIn: true,
				marketingOptedOutAt: true,
				marketingOptOutReason: true
			}
		});
	}

	const latestOrderByPhone = await resolveLatestOrdersByPhones(normalizedPhones);

	const contactByPhone = new Map();
	for (const contact of contacts) {
		const keys = [
			normalizeCampaignPhone(contact.waId || ''),
			normalizeCampaignPhone(contact.phone || '')
		].filter(Boolean);

		for (const key of keys) {
			if (!contactByPhone.has(key)) {
				contactByPhone.set(key, contact);
			}
		}
	}

	return carts.map((cart) => {
		const normalizedPhone = normalizeCampaignPhone(cart.contactPhone || '');
		const contact = contactByPhone.get(normalizedPhone) || null;
		const lastOrder = latestOrderByPhone.get(normalizedPhone) || null;
		const variables = buildAbandonedCartVariables(cart, contact, lastOrder);

		return {
			contactId: contact?.id || null,
			contactName: variables.contact_name,
			phone: normalizedPhone,
			waId: normalizedPhone,
			variables,
			externalKey: `abandoned_cart:${normalizeString(cart.checkoutId || '')}`,
			isOptedOut: contact ? contact.marketingOptIn === false || Boolean(contact.marketingOptedOutAt) : false,
			optOutReason: contact?.marketingOptOutReason || null
		};
	});
}

async function resolveCampaignRecipients(input = {}) {
	const audienceSource = normalizeAudienceSource(input.audienceSource || 'manual');

	if (audienceSource === 'abandoned_carts') {
		return resolveRecipientsFromAbandonedCarts(input);
	}

	const manualRecipients = safeArray(input.recipients).map((recipient) => ({
		contactId: recipient.contactId || null,
		contactName: recipient.contactName || recipient.name || '',
		phone: recipient.phone || recipient.waId || '',
		waId: recipient.waId || recipient.phone || '',
		variables: recipient.variables || {},
		externalKey: recipient.externalKey || null,
		isOptedOut: Boolean(recipient.isOptedOut),
		optOutReason: recipient.optOutReason || null
	}));

	const recipientsFromIds = await resolveRecipientsFromContacts(safeArray(input.contactIds));
	const recipientsFromAllContacts = input.includeAllContacts ? await resolveRecipientsFromAllContacts() : [];

	return dedupeRecipients([
		...manualRecipients,
		...recipientsFromIds,
		...recipientsFromAllContacts
	]);
}

export async function previewAbandonedCartAudience({
	templateId = null,
	filters = {}
} = {}) {
	const recipients = await resolveRecipientsFromAbandonedCarts({
		audienceSource: 'abandoned_carts',
		audienceFilters: filters
	});

	let template = null;
	let baseComponents = [];

	if (templateId) {
		template = await getTemplateOrThrow(templateId);
		baseComponents = safeArray(template?.rawPayload?.components);
	}

	const previewRecipients = recipients.map((recipient) => {
		const personalized = baseComponents.length
			? renderTemplatePreviewFromComponents(baseComponents, buildRecipientVariables(recipient))
			: { previewText: '', components: [] };

		return {
			phone: recipient.phone,
			contactName: recipient.contactName,
			externalKey: recipient.externalKey,
			variables: recipient.variables,
			renderedPreviewText: personalized.previewText || '',
			primaryProductName:
				recipient.variables?.product_name ||
				recipient.variables?.first_product_name ||
				'',
			checkoutUrl:
				recipient.variables?.checkout_url ||
				recipient.variables?.abandoned_checkout_url ||
				'',
			totalAmount: recipient.variables?.total_amount || '',
			isOptedOut: Boolean(recipient.isOptedOut)
		};
	});

	return {
		template,
		total: previewRecipients.length,
		recipients: previewRecipients
	};
}

async function ensureCampaignConversation({ phone, contactId = null, contactName = null }) {
	const normalizedPhone = normalizeCampaignPhone(phone);

	if (!normalizedPhone) {
		return {
			contactId: null,
			conversationId: null
		};
	}

	let contact = null;

	if (contactId) {
		contact = await prisma.contact.findUnique({
			where: { id: contactId }
		});
	}

	if (!contact) {
		contact = await prisma.contact.upsert({
			where: { waId: normalizedPhone },
			update: {
				name: contactName || undefined,
				phone: normalizedPhone
			},
			create: {
				waId: normalizedPhone,
				phone: normalizedPhone,
				name: contactName || normalizedPhone
			}
		});
	}

	let conversation = await prisma.conversation.findUnique({
		where: { contactId: contact.id }
	});

	if (!conversation) {
		conversation = await prisma.conversation.create({
			data: {
				contactId: contact.id,
				queue: 'AUTO',
				aiEnabled: true,
				state: {
					create: {
						customerName: contact.name || normalizedPhone,
						interactionCount: 0,
						interestedProducts: [],
						objections: []
					}
				}
			}
		});
	}

	return {
		contactId: contact.id,
		conversationId: conversation.id
	};
}

function buildCampaignFinalStatus({ pending, accepted, failed, skipped, currentStatus }) {
	if (currentStatus === 'CANCELED') {
		return 'CANCELED';
	}
	if (currentStatus === 'FAILED' && pending > 0) {
		return 'FAILED';
	}
	if (pending > 0) {
		return 'RUNNING';
	}
	if (accepted === 0 && failed > 0) {
		return 'FAILED';
	}
	if (failed > 0 || skipped > 0) {
		return 'PARTIAL';
	}
	return 'FINISHED';
}

async function refreshCampaignCounters(campaignId) {
	const [pending, accepted, delivered, read, failed, skipped, campaign] = await Promise.all([
		prisma.campaignRecipient.count({ where: { campaignId, status: 'PENDING' } }),
		prisma.campaignRecipient.count({ where: { campaignId, status: { in: ['SENT', 'DELIVERED', 'READ'] } } }),
		prisma.campaignRecipient.count({ where: { campaignId, status: { in: ['DELIVERED', 'READ'] } } }),
		prisma.campaignRecipient.count({ where: { campaignId, status: 'READ' } }),
		prisma.campaignRecipient.count({ where: { campaignId, status: 'FAILED' } }),
		prisma.campaignRecipient.count({ where: { campaignId, status: 'SKIPPED' } }),
		prisma.campaign.findUnique({
			where: { id: campaignId },
			select: { id: true, status: true, totalRecipients: true }
		})
	]);

	if (!campaign) {
		return null;
	}

	const nextStatus = buildCampaignFinalStatus({
		pending,
		accepted,
		failed,
		skipped,
		currentStatus: campaign.status
	});

	return prisma.campaign.update({
		where: { id: campaignId },
		data: {
			pendingRecipients: pending,
			sentRecipients: accepted,
			deliveredRecipients: delivered,
			readRecipients: read,
			failedRecipients: failed,
			skippedRecipients: skipped,
			status: nextStatus,
			finishedAt: pending === 0 ? new Date() : null
		}
	});
}

function normalizeCampaignDelayMs() {
	return Math.max(0, Number(process.env.CAMPAIGN_SEND_DELAY_MS || 350) || 350);
}

function normalizeCampaignBatchSize() {
	return Math.max(1, Math.min(Number(process.env.CAMPAIGN_DISPATCH_BATCH_SIZE || 25) || 25, 200));
}

function normalizeCampaignLockMs() {
	return Math.max(60_000, Number(process.env.CAMPAIGN_DISPATCH_LOCK_MS || 300_000) || 300_000);
}

async function refreshCampaignDispatchLock(campaignId, lockId) {
	const updated = await prisma.campaign.updateMany({
		where: {
			id: campaignId,
			dispatchLockId: lockId
		},
		data: {
			dispatchLockedAt: new Date(),
			status: 'RUNNING'
		}
	});

	return updated.count === 1;
}

function extractCampaignProviderError(sendResult = {}) {
	const providerError = sendResult?.error?.error || sendResult?.error || {};

	return {
		code: normalizeString(providerError?.code || ''),
		subcode: normalizeString(providerError?.error_subcode || ''),
		message: normalizeString(
			providerError?.message ||
			sendResult?.error?.message ||
			'No se pudo enviar la plantilla.'
		),
		raw: sendResult?.error || null
	};
}

function isFatalCampaignProviderError(sendResult = {}) {
	const providerError = extractCampaignProviderError(sendResult);
	return providerError.code === '190';
}

class CampaignDispatchFatalError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = 'CampaignDispatchFatalError';
		this.recipientHandled = Boolean(options.recipientHandled);
		this.providerError = options.providerError || null;
	}
}

function ensureApprovedTemplate(template) {
	if (!template) {
		throw new Error('No se encontró la plantilla de la campaña.');
	}
	if (normalizeString(template.status).toUpperCase() !== 'APPROVED') {
		throw new Error('Sólo se pueden lanzar campañas con plantillas APPROVED.');
	}
}

function buildRecipientVariables(recipient = {}) {
	const contactName = normalizeString(recipient.contactName || '');
	const firstName = contactName.split(/\s+/).filter(Boolean)[0] || '';

	return {
		contact_name: contactName,
		first_name: firstName,
		wa_id: normalizeString(recipient.waId || recipient.phone || ''),
		phone: normalizeString(recipient.phone || ''),
		...(recipient.variables || {})
	};
}

function buildBodyParametersFromText(text = '', variables = {}) {
	const matches = [...String(text || '').matchAll(/{{\s*([^}]+?)\s*}}/g)];

	return matches.map((match, index) => {
		const rawKey = normalizeString(match?.[1] || '');
		const fallbackKey = String(index + 1);

		let value = '';

		if (Object.prototype.hasOwnProperty.call(variables, rawKey)) {
			value = variables[rawKey];
		} else if (Object.prototype.hasOwnProperty.call(variables, fallbackKey)) {
			value = variables[fallbackKey];
		}

		return {
			type: 'text',
			text: String(value ?? '')
		};
	});
}

function buildHeaderComponentForSend(headerComponent = {}, template = {}, variables = {}) {
	const format = toUpper(
		headerComponent?.format ||
		template?.headerFormat ||
		template?.rawPayload?.components?.find((component) => toUpper(component?.type) === 'HEADER')?.format
	);

	if (!format) {
		return null;
	}

	if (format === 'TEXT') {
		const headerText =
			headerComponent?.text ||
			template?.rawPayload?.components?.find((component) => toUpper(component?.type) === 'HEADER')?.text ||
			'';

		const params = buildBodyParametersFromText(headerText, variables);

		if (!params.length) {
			return null;
		}

		return {
			type: 'header',
			parameters: params
		};
	}

	if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
		const mediaField =
			format === 'VIDEO' ? 'video' : format === 'DOCUMENT' ? 'document' : 'image';
		const mediaVariablePrefix = mediaField;

		const mediaId =
			normalizeString(
				variables[`header_${mediaVariablePrefix}_id`] ||
				variables[`${mediaVariablePrefix}_id`] ||
				template?.rawPayload?.headerMedia?.mediaId ||
				headerComponent?.[mediaField]?.id ||
				''
			) || null;

		const mediaLink =
			normalizeString(
				variables[`header_${mediaVariablePrefix}_link`] ||
				variables[`${mediaVariablePrefix}_link`] ||
				template?.rawPayload?.headerMedia?.previewUrl ||
				headerComponent?.[mediaField]?.link ||
				template?.rawPayload?.components?.find((component) => toUpper(component?.type) === 'HEADER')?.[mediaField]?.link ||
				''
			) || null;

		if (mediaId) {
			return {
				type: 'header',
				parameters: [
					{
						type: mediaField,
						[mediaField]: {
							id: mediaId
						}
					}
				]
			};
		}

		if (mediaLink) {
			return {
				type: 'header',
				parameters: [
					{
						type: mediaField,
						[mediaField]: {
							link: mediaLink
						}
					}
				]
			};
		}

		throw new Error(
			`La plantilla ${template?.name || 'seleccionada'} requiere HEADER ${format} y no tiene ${mediaField}.id ni ${mediaField}.link para enviar.`
		);
	}

	return null;
}

function buildBodyComponentForSend(bodyComponent = {}, variables = {}) {
	const text = normalizeString(bodyComponent?.text || '');
	const parameters = buildBodyParametersFromText(text, variables);

	if (!parameters.length) {
		return null;
	}

	return {
		type: 'body',
		parameters
	};
}

function buildButtonComponentsForSend(template = {}, variables = {}) {
	const buttonsComponent = safeArray(template?.rawPayload?.components).find(
		(component) => toUpper(component?.type) === 'BUTTONS'
	);

	if (!buttonsComponent) {
		return [];
	}

	return safeArray(buttonsComponent.buttons).flatMap((button, index) => {
		const buttonType = toUpper(button?.type);

		if (buttonType !== 'URL') {
			return [];
		}

		const urlTemplate = normalizeString(button?.url || '');
		const parameters = buildBodyParametersFromText(urlTemplate, variables);

		if (!parameters.length) {
			return [];
		}

		return [
			{
				type: 'button',
				sub_type: 'url',
				index: String(index),
				parameters
			}
		];
	});
}

function buildSendComponentsFromTemplate({
	template,
	renderedComponents = [],
	variables = {}
}) {
	const templateComponents = safeArray(template?.rawPayload?.components);
	const rendered = Array.isArray(renderedComponents) ? renderedComponents : [];

	const templateHeader = templateComponents.find((component) => toUpper(component?.type) === 'HEADER');
	const templateBody = templateComponents.find((component) => toUpper(component?.type) === 'BODY');

	const renderedHeader = rendered.find((component) => toUpper(component?.type) === 'HEADER');

	const sendComponents = [];

	const headerSendComponent = buildHeaderComponentForSend(
		renderedHeader || templateHeader || {},
		template,
		variables
	);

	if (headerSendComponent) {
		sendComponents.push(headerSendComponent);
	}

	const bodySendComponent = buildBodyComponentForSend(templateBody || {}, variables);

	if (bodySendComponent) {
		sendComponents.push(bodySendComponent);
	}

	const buttonSendComponents = buildButtonComponentsForSend(template, variables);
	if (buttonSendComponents.length) {
		sendComponents.push(...buttonSendComponents);
	}

	return sendComponents;
}

export async function listCampaigns({ limit = 50 } = {}) {
	return prisma.campaign.findMany({
		orderBy: [{ createdAt: 'desc' }],
		take: Math.max(1, Math.min(Number(limit) || 50, 1000)),
		include: {
			recipients: {
				orderBy: [{ createdAt: 'desc' }],
				take: 15
			}
		}
	});
}

export async function getCampaignDetail(campaignId, { page = 1, pageSize = 50 } = {}) {
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId }
	});

	if (!campaign) {
		throw new Error('No se encontró la campaña.');
	}

	const currentPage = Math.max(1, Number(page) || 1);
	const currentPageSize = Math.max(1, Math.min(Number(pageSize) || 50, 1000));

	const [template, totalRecipients, recipients] = await Promise.all([
		campaign.templateLocalId
			? prisma.whatsAppTemplate.findUnique({ where: { id: campaign.templateLocalId } })
			: null,
		prisma.campaignRecipient.count({ where: { campaignId } }),
		prisma.campaignRecipient.findMany({
			where: { campaignId },
			orderBy: [{ createdAt: 'asc' }],
			skip: (currentPage - 1) * currentPageSize,
			take: currentPageSize
		})
	]);

	return {
		campaign,
		template,
		recipients,
		pagination: {
			page: currentPage,
			pageSize: currentPageSize,
			total: totalRecipients,
			totalPages: Math.max(1, Math.ceil(totalRecipients / currentPageSize))
		}
	};
}

export async function createCampaignDraft({
	name,
	templateId,
	templateName,
	languageCode,
	sendComponents = [],
	recipients = [],
	contactIds = [],
	includeAllContacts = false,
	audienceSource = null,
	audienceFilters = null,
	notes = null,
	launchedByUserId = null
}) {
	const template = templateId
		? await getTemplateOrThrow(templateId)
		: await prisma.whatsAppTemplate.findFirst({
				where: {
					name: normalizeString(templateName).toLowerCase(),
					language: normalizeString(languageCode, 'es_AR'),
					deletedAt: null
				}
		  });

	if (!template) {
		throw new Error('No se encontró la plantilla seleccionada.');
	}

	const normalizedAudienceSource = normalizeAudienceSource(audienceSource || 'manual');

	const resolvedRecipients = await resolveCampaignRecipients({
		recipients,
		contactIds,
		includeAllContacts,
		audienceSource: normalizedAudienceSource,
		audienceFilters
	});

	if (!resolvedRecipients.length) {
		throw new Error('No hay destinatarios válidos para crear la campaña.');
	}

	const normalizedComponents = safeArray(sendComponents);
	const previewBase = renderTemplatePreviewFromComponents(
		normalizedComponents.length ? normalizedComponents : safeArray(template?.rawPayload?.components),
		{}
	);

	const recipientRows = [];

	for (const recipient of resolvedRecipients) {
		const normalizedPhone = normalizeCampaignPhone(recipient.phone || recipient.waId || '');

		if (!normalizedPhone) {
			continue;
		}

		const variables = buildRecipientVariables({
			...recipient,
			phone: normalizedPhone,
			waId: normalizedPhone
		});

		const personalized = renderTemplatePreviewFromComponents(
			normalizedComponents.length ? normalizedComponents : safeArray(template?.rawPayload?.components),
			variables
		);

		const shouldSkipRecipient =
			normalizedAudienceSource !== 'manual' && recipient.isOptedOut;

		recipientRows.push({
			phone: normalizedPhone,
			waId: normalizedPhone,
			contactId: recipient.contactId || null,
			contactName: normalizeString(recipient.contactName || '') || normalizedPhone,
			externalKey: recipient.externalKey || null,
			variables,
			renderedComponents: personalized.components,
			renderedPreviewText: personalized.previewText,
			status: shouldSkipRecipient ? 'SKIPPED' : 'PENDING',
			errorMessage: shouldSkipRecipient
				? normalizeString(recipient.optOutReason, 'opted_out')
				: null
		});
	}

	if (!recipientRows.length) {
		throw new Error('Después de normalizar los contactos no quedó ningún destinatario usable.');
	}

	const pendingRecipients = recipientRows.filter((recipient) => recipient.status === 'PENDING').length;
	const skippedRecipients = recipientRows.filter((recipient) => recipient.status === 'SKIPPED').length;

	const campaign = await prisma.campaign.create({
		data: {
			name: normalizeString(name, `Campaña ${template.name}`),
			templateLocalId: template.id,
			templateMetaId: template.metaTemplateId,
			templateName: template.name,
			templateLanguage: template.language,
			templateCategory: template.category,
			audienceSource: normalizedAudienceSource,
			notes: notes || null,
			launchedByUserId,
			totalRecipients: recipientRows.length,
			pendingRecipients,
			skippedRecipients,
			defaultComponents: normalizedComponents.length
				? normalizedComponents
				: safeArray(template?.rawPayload?.components),
			previewText: previewBase.previewText,
			status: 'DRAFT',
			recipients: {
				create: recipientRows
			}
		},
		include: {
			recipients: true
		}
	});

	return {
		campaign
	};
}

export async function launchCampaign(campaignId) {
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId }
	});

	if (!campaign) {
		throw new Error('No se encontró la campaña.');
	}

	if (campaign.status === 'CANCELED') {
		throw new Error('La campaña está cancelada y no se puede lanzar.');
	}

	const template = campaign.templateLocalId
		? await getTemplateOrThrow(campaign.templateLocalId)
		: null;

	ensureApprovedTemplate(template);

	const pendingCount = await prisma.campaignRecipient.count({
		where: {
			campaignId,
			status: 'PENDING'
		}
	});

	if (!pendingCount) {
		throw new Error('La campaña no tiene destinatarios pendientes.');
	}

	const updated = await prisma.campaign.update({
		where: { id: campaignId },
		data: {
			status: 'QUEUED',
			lastError: null,
			finishedAt: null
		}
	});

	return {
		campaign: updated,
		pendingCount
	};
}

export async function cancelCampaign(campaignId) {
	return prisma.campaign.update({
		where: { id: campaignId },
		data: {
			status: 'CANCELED',
			dispatchLockedAt: null,
			dispatchLockId: null,
			finishedAt: new Date()
		}
	});
}

export async function deleteCampaign(campaignId) {
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
		select: {
			id: true,
			name: true,
			status: true
		}
	});

	if (!campaign) {
		throw new Error('No se encontró la campaña.');
	}

	if (['RUNNING', 'QUEUED'].includes(String(campaign.status || '').toUpperCase())) {
		throw new Error('No se puede eliminar una campaña en ejecución o en cola.');
	}

	await prisma.$transaction([
		prisma.campaignRecipient.deleteMany({
			where: { campaignId }
		}),
		prisma.campaign.delete({
			where: { id: campaignId }
		})
	]);

	return {
		deleted: true,
		campaignId: campaign.id,
		name: campaign.name
	};
}

export async function retryFailedCampaignRecipients(campaignId) {
	await prisma.campaignRecipient.updateMany({
		where: {
			campaignId,
			status: {
				in: ['FAILED', 'SKIPPED', 'PENDING']
			}
		},
		data: {
			status: 'PENDING',
			errorCode: null,
			errorSubcode: null,
			errorMessage: null,
			failedAt: null
		}
	});

	const updated = await prisma.campaign.update({
		where: { id: campaignId },
		data: {
			status: 'QUEUED',
			lastError: null,
			finishedAt: null
		}
	});

	await refreshCampaignCounters(campaignId);

	return {
		campaign: updated
	};
}

export async function claimNextCampaignForDispatch() {
	const lockExpiresBefore = new Date(Date.now() - normalizeCampaignLockMs());
	const candidates = await prisma.campaign.findMany({
		where: {
			status: {
				in: ['QUEUED', 'RUNNING']
			},
			OR: [
				{ dispatchLockedAt: null },
				{ dispatchLockedAt: { lt: lockExpiresBefore } }
			]
		},
		orderBy: [{ createdAt: 'asc' }],
		take: 10
	});

	for (const candidate of candidates) {
		const lockId = randomUUID();
		const claimed = await prisma.campaign.updateMany({
			where: {
				id: candidate.id,
				status: {
					in: ['QUEUED', 'RUNNING']
				},
				OR: [
					{ dispatchLockedAt: null },
					{ dispatchLockedAt: { lt: lockExpiresBefore } }
				]
			},
			data: {
				dispatchLockedAt: new Date(),
				dispatchLockId: lockId,
				status: 'RUNNING',
				startedAt: candidate.startedAt || new Date()
			}
		});

		if (claimed.count === 1) {
			return {
				campaignId: candidate.id,
				lockId
			};
		}
	}

	return null;
}

async function persistCampaignOutboundMessage({
	campaign,
	recipient,
	sendResult
}) {
	const ensured = await ensureCampaignConversation({
		phone: recipient.phone,
		contactId: recipient.contactId,
		contactName: recipient.contactName
	});

	await prisma.campaignRecipient.update({
		where: {
			id: recipient.id
		},
		data: {
			contactId: ensured.contactId || recipient.contactId,
			conversationId: ensured.conversationId || recipient.conversationId
		}
	});

	if (!ensured.conversationId) {
		return null;
	}

	return prisma.message.create({
		data: {
			conversationId: ensured.conversationId,
			metaMessageId: sendResult?.rawPayload?.messages?.[0]?.id || null,
			senderName: process.env.BUSINESS_NAME || 'Lummine',
			direction: 'OUTBOUND',
			type: 'template',
			body: recipient.renderedPreviewText || `[Plantilla ${campaign.templateName}]`,
			provider: 'whatsapp-cloud-api',
			model: campaign.templateName,
			rawPayload: sendResult?.rawPayload || null
		}
	});
}

async function markAbandonedCartAsContactedFromRecipient(recipient = {}) {
	const externalKey = normalizeString(recipient.externalKey || '');

	if (!externalKey.toLowerCase().startsWith('abandoned_cart:')) {
		return null;
	}

	const checkoutId = normalizeString(externalKey.split(':').slice(1).join(':'));

	if (!checkoutId) {
		return null;
	}

	return prisma.abandonedCart.updateMany({
		where: {
			checkoutId
		},
		data: {
			status: 'CONTACTED',
			contactedAt: new Date(),
			lastMessageSentAt: new Date()
		}
	});
}

async function dispatchSingleRecipient(campaign, recipient) {
	const template = campaign.templateLocalId
		? await getTemplateOrThrow(campaign.templateLocalId)
		: null;

	ensureApprovedTemplate(template);

	if (recipient.status !== 'PENDING') {
		return recipient;
	}

	const componentsToSend = buildSendComponentsFromTemplate({
		template,
		renderedComponents: Array.isArray(recipient.renderedComponents)
			? recipient.renderedComponents
			: safeArray(campaign.defaultComponents),
		variables: recipient.variables || {}
	});

	console.log('[CAMPAIGN][SEND] original phone:', recipient.phone);
	console.log('[CAMPAIGN][SEND] normalized phone:', normalizeCampaignPhone(recipient.phone || ''));
	console.log('[CAMPAIGN][SEND] campaign:', campaign.id, campaign.name, campaign.audienceSource || 'manual');
	console.log('[CAMPAIGN][SEND] recipient:', recipient.id, recipient.contactId || 'no-contact', recipient.externalKey || 'no-external-key');
	console.log('[CAMPAIGN][SEND] template:', campaign.templateName, campaign.templateLanguage);
	console.log('[CAMPAIGN][SEND] components:', JSON.stringify(componentsToSend, null, 2));

	const sendResult = await sendWhatsAppTemplate({
		to: recipient.phone,
		templateName: campaign.templateName,
		languageCode: campaign.templateLanguage,
		components: componentsToSend
	});

	if (!sendResult?.ok) {
		const providerError = extractCampaignProviderError(sendResult);

		console.log('[CAMPAIGN][SEND][ERROR] phone:', recipient.phone);
		console.log('[CAMPAIGN][SEND][ERROR] campaign:', campaign.id, recipient.id);
		console.log('[CAMPAIGN][SEND][ERROR] provider:', providerError.code, providerError.subcode, providerError.message);
		console.log('[CAMPAIGN][SEND][ERROR] raw:', JSON.stringify(sendResult?.error || {}, null, 2));

		const failedRecipient = await prisma.campaignRecipient.update({
			where: { id: recipient.id },
			data: {
				status: 'FAILED',
				errorCode: providerError.code,
				errorSubcode: providerError.subcode,
				errorMessage: providerError.message,
				failedAt: new Date(),
				rawPayload: providerError.raw
			}
		});

		if (isFatalCampaignProviderError(sendResult)) {
			throw new CampaignDispatchFatalError(providerError.message, {
				recipientHandled: true,
				providerError
			});
		}

		return failedRecipient;
	}

	const updatedRecipient = await prisma.campaignRecipient.update({
		where: { id: recipient.id },
		data: {
			status: 'SENT',
			waMessageId: sendResult?.rawPayload?.messages?.[0]?.id || null,
			sentAt: new Date(),
			rawPayload: sendResult?.rawPayload || null
		}
	});

	await persistCampaignOutboundMessage({
		campaign,
		recipient: {
			...recipient,
			...updatedRecipient
		},
		sendResult
	});

	if (normalizeAudienceSource(campaign.audienceSource || '') === 'abandoned_carts') {
		await markAbandonedCartAsContactedFromRecipient({
			...recipient,
			...updatedRecipient
		});
	}

	return updatedRecipient;
}

export async function dispatchCampaignBatch(campaignId, lockId) {
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId }
	});

	if (!campaign) {
		return {
			ok: false,
			message: 'La campaña no existe.'
		};
	}

	if (campaign.status === 'CANCELED') {
		return {
			ok: true,
			message: 'La campaña ya estaba cancelada.'
		};
	}

	const recipients = await prisma.campaignRecipient.findMany({
		where: {
			campaignId,
			status: 'PENDING'
		},
		orderBy: [{ createdAt: 'asc' }],
		take: normalizeCampaignBatchSize()
	});

	if (!recipients.length) {
		const refreshed = await refreshCampaignCounters(campaignId);

		await prisma.campaign.updateMany({
			where: {
				id: campaignId,
				dispatchLockId: lockId
			},
			data: {
				dispatchLockedAt: null,
				dispatchLockId: null,
				status: refreshed?.status || campaign.status
			}
		});

		return {
			ok: true,
			campaignId,
			processedCount: 0,
			message: 'No había destinatarios pendientes.'
		};
	}

	const delayMs = normalizeCampaignDelayMs();

	for (const recipient of recipients) {
		try {
			await dispatchSingleRecipient(campaign, recipient);
		} catch (error) {
			console.log('[CAMPAIGN][DISPATCH][EXCEPTION]', error.message);

			if (!error?.recipientHandled) {
				await prisma.campaignRecipient.update({
					where: { id: recipient.id },
					data: {
						status: 'FAILED',
						errorMessage: error.message,
						failedAt: new Date()
					}
				});
			}

			const isFatal = error instanceof CampaignDispatchFatalError;

			await prisma.campaign.update({
				where: { id: campaignId },
				data: {
					lastError: error.message,
					...(isFatal ? { status: 'FAILED' } : {})
				}
			});

			if (isFatal) {
				break;
			}
		}

		if (delayMs > 0) {
			await sleep(delayMs);
		}
	}

	const refreshed = await refreshCampaignCounters(campaignId);

	await prisma.campaign.updateMany({
		where: {
			id: campaignId,
			dispatchLockId: lockId
		},
		data: {
			dispatchLockedAt: null,
			dispatchLockId: null,
			status: refreshed?.status || campaign.status
		}
	});

	return {
		ok: true,
		campaignId,
		processedCount: recipients.length,
		status: refreshed?.status || campaign.status
	};
}

async function dispatchClaimedCampaign(campaignId, lockId) {
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId }
	});

	if (!campaign) {
		return {
			ok: false,
			message: 'La campaÃ±a no existe.'
		};
	}

	if (campaign.status === 'CANCELED') {
		await prisma.campaign.updateMany({
			where: {
				id: campaignId,
				dispatchLockId: lockId
			},
			data: {
				dispatchLockedAt: null,
				dispatchLockId: null,
				finishedAt: new Date()
			}
		});

		return {
			ok: true,
			campaignId,
			processedCount: 0,
			message: 'La campaÃ±a ya estaba cancelada.'
		};
	}

	const delayMs = normalizeCampaignDelayMs();
	const batchSize = normalizeCampaignBatchSize();
	let processedCount = 0;
	let sawFatalProviderError = false;

	while (true) {
		const lockStillOwned = await refreshCampaignDispatchLock(campaignId, lockId);

		if (!lockStillOwned) {
			return {
				ok: false,
				campaignId,
				processedCount,
				message: 'Se perdiÃ³ el lock de despacho de la campaÃ±a.'
			};
		}

		const recipients = await prisma.campaignRecipient.findMany({
			where: {
				campaignId,
				status: 'PENDING'
			},
			orderBy: [{ createdAt: 'asc' }],
			take: batchSize
		});

		if (!recipients.length) {
			break;
		}

		for (const recipient of recipients) {
			try {
				await dispatchSingleRecipient(campaign, recipient);
			} catch (error) {
				console.log('[CAMPAIGN][DISPATCH][EXCEPTION]', error.message);

				if (!error?.recipientHandled) {
					await prisma.campaignRecipient.update({
						where: { id: recipient.id },
						data: {
							status: 'FAILED',
							errorMessage: error.message,
							failedAt: new Date()
						}
					});
				}

				const isFatal = error instanceof CampaignDispatchFatalError;

				await prisma.campaign.update({
					where: { id: campaignId },
					data: {
						lastError: error.message,
						...(isFatal ? { status: 'FAILED' } : {})
					}
				});

				if (isFatal) {
					sawFatalProviderError = true;
				}
			}

			processedCount += 1;

			if (sawFatalProviderError) {
				break;
			}

			if (delayMs > 0) {
				await sleep(delayMs);
			}
		}

		if (sawFatalProviderError) {
			break;
		}
	}

	const refreshed = await refreshCampaignCounters(campaignId);

	await prisma.campaign.updateMany({
		where: {
			id: campaignId,
			dispatchLockId: lockId
		},
		data: {
			dispatchLockedAt: null,
			dispatchLockId: null,
			status: refreshed?.status || campaign.status
		}
	});

	return {
		ok: true,
		campaignId,
		processedCount,
		status: refreshed?.status || campaign.status,
		...(processedCount === 0 ? { message: 'No habÃ­a destinatarios pendientes.' } : {})
	};
}

export async function runCampaignDispatchTick() {
	const claimed = await claimNextCampaignForDispatch();

	if (!claimed) {
		return {
			ok: true,
			processed: false,
			message: 'No hay campañas pendientes para despachar.'
		};
	}

	const result = await dispatchClaimedCampaign(claimed.campaignId, claimed.lockId);

	return {
		ok: true,
		processed: true,
		...result
	};
}

function toDateFromUnixTimestamp(value) {
	const seconds = Number(value || 0);

	if (!seconds) {
		return new Date();
	}

	return new Date(seconds * 1000);
}

export async function applyCampaignMessageStatusWebhook(statusPayload = {}) {
	const waMessageId = normalizeString(statusPayload?.id || statusPayload?.message_id || '');

	if (!waMessageId) {
		return null;
	}

	const recipient = await prisma.campaignRecipient.findFirst({
		where: {
			waMessageId
		}
	});

	if (!recipient) {
		return null;
	}

	const nextStatus = normalizeString(statusPayload?.status || '').toLowerCase();
	const timestamp = toDateFromUnixTimestamp(statusPayload?.timestamp);
	const error = safeArray(statusPayload?.errors)[0] || null;

	const updateData = {
		rawPayload: statusPayload,
		pricingCategory: statusPayload?.pricing?.category || recipient.pricingCategory,
		conversationCategory: statusPayload?.conversation?.origin?.type || recipient.conversationCategory,
		billable: typeof statusPayload?.pricing?.billable === 'boolean'
			? statusPayload.pricing.billable
			: recipient.billable
	};

	if (nextStatus === 'sent') {
		updateData.status = 'SENT';
		updateData.sentAt = timestamp;
	}
	if (nextStatus === 'delivered') {
		updateData.status = 'DELIVERED';
		updateData.deliveredAt = timestamp;
	}
	if (nextStatus === 'read') {
		updateData.status = 'READ';
		updateData.readAt = timestamp;
	}
	if (nextStatus === 'failed') {
		updateData.status = 'FAILED';
		updateData.failedAt = timestamp;
		updateData.errorCode = normalizeString(error?.code || '');
		updateData.errorSubcode = normalizeString(error?.error_subcode || '');
		updateData.errorMessage = normalizeString(
			error?.title ||
			error?.message ||
			error?.details ||
			'Error de entrega'
		);
	}

	await prisma.campaignRecipient.update({
		where: { id: recipient.id },
		data: updateData
	});

	await refreshCampaignCounters(recipient.campaignId);

	return recipient.campaignId;
}
