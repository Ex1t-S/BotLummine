import { randomUUID } from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { publishInboxEvent } from '../../lib/inbox-events.js';
import { logger, maskPhone } from '../../lib/logger.js';
import { normalizeWhatsAppIdentityPhone } from '../../lib/phone-normalization.js';
import { sendWhatsAppTemplate } from '../whatsapp/whatsapp.service.js';
import { renderTemplatePreviewFromComponents, getTemplateOrThrow } from '../whatsapp/whatsapp-template.service.js';
import {
	DEFAULT_WORKSPACE_ID,
	getWorkspaceRuntimeConfig,
	normalizeWorkspaceId,
} from '../workspaces/workspace-context.service.js';
import {
	WORKSPACE_FEATURE_FLAGS,
	isWorkspaceFeatureEnabled,
} from '../workspaces/workspace-feature-flags.service.js';
import {
	filterRecoverableAbandonedCarts,
	getPersistedConversionInsights,
} from './campaign-attribution.service.js';

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

const CAMPAIGN_ANY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CAMPAIGN_SAME_SOURCE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function isOpenHumanConversation(conversation = null) {
	if (!conversation) return false;
	return Boolean(
		conversation.queue === 'HUMAN' ||
		conversation.queue === 'PAYMENT_REVIEW' ||
		conversation.state?.needsHuman === true ||
		conversation.state?.handoffReason
	);
}

function isComplaintLikeSummary(value = '') {
	return /(reclamo|devolucion|cambio|cancel|seguimiento|tracking|demora|no llega|fallado|vino mal|asesora|humano|comprobante)/i.test(
		String(value || '')
	);
}

async function buildCampaignSuppressionMap({
	workspaceId = DEFAULT_WORKSPACE_ID,
	phones = [],
	audienceSource = 'manual',
} = {}) {
	const normalizedPhones = [...new Set(phones.map(normalizeCampaignPhone).filter(Boolean))];
	const result = new Map();
	if (!normalizedPhones.length) return result;

	const [contacts, recentAnyRecipients, recentSameSourceRecipients] = await Promise.all([
		prisma.contact.findMany({
			where: {
				workspaceId,
				waId: { in: normalizedPhones },
			},
			select: {
				waId: true,
				conversations: {
					select: {
						queue: true,
						aiEnabled: true,
						lastSummary: true,
						lastMessageAt: true,
						state: {
							select: {
								needsHuman: true,
								handoffReason: true,
								updatedAt: true,
							}
						}
					},
					orderBy: { updatedAt: 'desc' },
					take: 1,
				}
			}
		}),
		prisma.campaignRecipient.findMany({
			where: {
				workspaceId,
				phone: { in: normalizedPhones },
				status: { in: ['SENT', 'DELIVERED', 'READ'] },
				sentAt: { gte: new Date(Date.now() - CAMPAIGN_ANY_COOLDOWN_MS) },
			},
			select: { phone: true, sentAt: true },
		}),
		prisma.campaignRecipient.findMany({
			where: {
				workspaceId,
				phone: { in: normalizedPhones },
				status: { in: ['SENT', 'DELIVERED', 'READ'] },
				sentAt: { gte: new Date(Date.now() - CAMPAIGN_SAME_SOURCE_COOLDOWN_MS) },
				campaign: {
					audienceSource: normalizeAudienceSource(audienceSource || 'manual'),
				},
			},
			select: { phone: true, sentAt: true },
		}),
	]);

	for (const contact of contacts) {
		const phone = normalizeCampaignPhone(contact.waId || '');
		const conversation = contact.conversations?.[0] || null;
		if (isOpenHumanConversation(conversation)) {
			result.set(phone, 'human_or_handoff_open');
			continue;
		}
		if (
			conversation?.lastMessageAt &&
			Date.now() - new Date(conversation.lastMessageAt).getTime() < CAMPAIGN_ANY_COOLDOWN_MS &&
			isComplaintLikeSummary(conversation.lastSummary || '')
		) {
			result.set(phone, 'recent_support_context');
		}
	}

	for (const recipient of recentAnyRecipients) {
		const phone = normalizeCampaignPhone(recipient.phone || '');
		if (!result.has(phone)) result.set(phone, 'campaign_cooldown_24h');
	}

	for (const recipient of recentSameSourceRecipients) {
		const phone = normalizeCampaignPhone(recipient.phone || '');
		if (!result.has(phone)) result.set(phone, 'campaign_source_cooldown_7d');
	}

	return result;
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
	const checkoutIds = Array.isArray(input.checkoutIds)
		? [...new Set(input.checkoutIds.map((value) => normalizeString(value)).filter(Boolean))].slice(0, 500)
		: [];

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
		productQuery: normalizeString(input.productQuery || ''),
		checkoutIds,
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

function getPrimaryOrderProductName(order = {}) {
	return getCartProductName(safeArray(order.products)[0] || {});
}

function cartMatchesProductQuery(cart = {}, productQuery = '') {
	const needle = normalizeString(productQuery).toLowerCase();
	if (!needle) return true;

	return getCartProducts(cart).some((product) =>
		getCartProductName(product).toLowerCase().includes(needle)
	);
}

function normalizeVariableMappingEntries(input = {}) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return [];

	return Object.entries(input)
		.map(([key, value]) => {
			const templateKey = normalizeString(key);
			if (!templateKey) return null;

			if (value && typeof value === 'object' && !Array.isArray(value)) {
				return [
					templateKey,
					{
						source: normalizeString(value.source),
						fixedValue: String(value.fixedValue ?? ''),
					}
				];
			}

			return [
				templateKey,
				{
					source: normalizeString(value),
					fixedValue: '',
				}
			];
		})
		.filter((entry) => entry?.[0] && entry?.[1]?.source);
}

function normalizeManualVariables(input = {}) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

	return Object.fromEntries(
		Object.entries(input)
			.map(([key, value]) => [normalizeString(key), String(value ?? '').trim()])
			.filter(([key]) => key)
	);
}

function applyVariableMapping(baseVariables = {}, variableMapping = {}, manualVariables = {}) {
	const variables = { ...baseVariables };
	const manual = normalizeManualVariables(manualVariables);

	for (const [templateKey, config] of normalizeVariableMappingEntries(variableMapping)) {
		const source = normalizeString(config.source);

		if (source === 'fixed') {
			variables[templateKey] = String(config.fixedValue ?? '');
			continue;
		}

		if (source === '__manual__') {
			variables[templateKey] = manual[templateKey] ?? '';
			continue;
		}

		if (source === 'empty') {
			variables[templateKey] = '';
			continue;
		}

		variables[templateKey] = baseVariables[source] ?? '';
	}

	return variables;
}

export function buildAbandonedCartVariables(
	cart = {},
	contact = null,
	lastOrder = null,
	variableMapping = {},
	manualVariables = {}
) {
	const normalizedPhone = normalizeCampaignPhone(cart.contactPhone || '');
	const contactName = normalizeString(cart.contactName || contact?.name || '', normalizedPhone);
	const firstName = contactName.split(/\s+/).filter(Boolean)[0] || contactName || 'Hola';
	const checkoutUrl = normalizeString(cart.abandonedCheckoutUrl || '');
	const primaryProductName = getPrimaryCartProductName(cart);
	const totalFormatted = formatCurrency(cart.totalAmount, cart.currency || 'ARS');
	const checkoutId = normalizeString(cart.checkoutId || '');

	const lastOrderId = normalizeString(lastOrder?.orderId || '');
	const lastOrderNumber = normalizeString(lastOrder?.orderNumber || '');

	const variables = {
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

	return applyVariableMapping(variables, variableMapping, manualVariables);
}

function buildPendingPaymentVariables(order = {}, contact = null, variableMapping = {}, manualVariables = {}) {
	const normalizedPhone = normalizeCampaignPhone(order.normalizedPhone || order.contactPhone || '');
	const contactName = normalizeString(order.contactName || contact?.name || '', normalizedPhone);
	const firstName = contactName.split(/\s+/).filter(Boolean)[0] || contactName || 'Hola';
	const primaryProductName = getPrimaryOrderProductName(order);
	const totalFormatted = formatCurrency(order.totalAmount, order.currency || 'ARS');
	const orderId = normalizeString(order.orderId || '');
	const orderNumber = normalizeString(order.orderNumber || orderId);
	const paymentLink = normalizeString(order.gatewayLink || '');

	const variables = {
		'1': firstName,
		'2': orderNumber,
		'3': totalFormatted,
		'4': paymentLink,
		'5': primaryProductName,

		contact_name: contactName,
		first_name: firstName,
		wa_id: normalizedPhone,
		phone: normalizedPhone,

		order_id: orderId,
		order_number: orderNumber,
		last_order_id: orderId,
		last_order_number: orderNumber,

		payment_status: normalizeString(order.paymentStatus || ''),
		payment_link: paymentLink,
		gateway_link: paymentLink,
		gateway_name: normalizeString(order.gatewayName || order.gateway || ''),

		product_name: primaryProductName,
		first_product_name: primaryProductName,

		total_amount: totalFormatted,
		total_raw: order.totalAmount != null ? String(order.totalAmount) : '',
	};

	return applyVariableMapping(variables, variableMapping, manualVariables);
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

async function getPhonesAlreadySentTemplate({
	workspaceId = DEFAULT_WORKSPACE_ID,
	templateName = '',
	templateNames = []
} = {}) {
	const normalizedTemplateNames = Array.from(
		new Set(
			[
				...safeArray(templateNames).map((name) => normalizeString(name)),
				...(Array.isArray(templateNames)
					? []
					: String(templateNames || '')
							.split('||')
							.map((name) => normalizeString(name))),
				normalizeString(templateName)
			].filter(Boolean)
		)
	);

	if (!normalizedTemplateNames.length) {
		return new Set();
	}

	const recipients = await prisma.campaignRecipient.findMany({
		where: {
			workspaceId,
			phone: {
				not: ''
			},
			OR: [
				{ sentAt: { not: null } },
				{ deliveredAt: { not: null } },
				{ readAt: { not: null } },
				{ status: { in: ['SENT', 'DELIVERED', 'READ'] } }
			],
			campaign: {
				OR: normalizedTemplateNames.map((name) => ({
					templateName: {
						equals: name,
						mode: 'insensitive'
					}
				}))
			}
		},
		select: {
			phone: true,
			waId: true
		}
	});

	return new Set(
		recipients
			.flatMap((recipient) => [recipient.phone, recipient.waId])
			.map((phone) => normalizeCampaignPhone(phone || ''))
			.filter(Boolean)
	);
}

async function resolveRecipientsFromContacts(contactIds = [], workspaceId = DEFAULT_WORKSPACE_ID) {
	if (!Array.isArray(contactIds) || !contactIds.length) {
		return [];
	}

	const contacts = await prisma.contact.findMany({
		where: {
			workspaceId,
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

async function resolveRecipientsFromAllContacts(workspaceId = DEFAULT_WORKSPACE_ID) {
	const contacts = await prisma.contact.findMany({
		where: { workspaceId },
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

async function resolveLatestOrdersByPhones(normalizedPhones = [], workspaceId = DEFAULT_WORKSPACE_ID) {
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
			workspaceId,
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
	const workspaceId = normalizeWorkspaceId(input.workspaceId) || DEFAULT_WORKSPACE_ID;
	const filters = normalizeAbandonedCartFilters(input.audienceFilters || input.filters || input || {});
	const rawFilters = input.audienceFilters || input.filters || input || {};
	const variableMapping = rawFilters.variableMapping || input.variableMapping || {};
	const manualVariables = rawFilters.manualVariables || input.manualVariables || {};
	const since = new Date();
	since.setDate(since.getDate() - filters.daysBack);

	const where = {
		workspaceId,
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

	if (filters.checkoutIds.length) {
		where.checkoutId = { in: filters.checkoutIds };
	}

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
	const recoverableCarts = await filterRecoverableAbandonedCarts(rawCarts, workspaceId);

	const latestByPhone = new Map();

	for (const cart of recoverableCarts) {
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
				workspaceId,
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

	const latestOrderByPhone = await resolveLatestOrdersByPhones(normalizedPhones, workspaceId);

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
		const variables = buildAbandonedCartVariables(
			cart,
			contact,
			lastOrder,
			variableMapping,
			manualVariables
		);

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

async function resolveRecipientsFromPendingPayments(input = {}) {
	const workspaceId = normalizeWorkspaceId(input.workspaceId) || DEFAULT_WORKSPACE_ID;
	const filters = normalizeAbandonedCartFilters(input.audienceFilters || input.filters || input || {});
	const rawFilters = input.audienceFilters || input.filters || input || {};
	const selectedOrderKeys = safeArray(rawFilters.orderKeys || rawFilters.orderIds || rawFilters.orderNumbers)
		.map((value) => normalizeString(value))
		.filter(Boolean);
	const variableMapping = rawFilters.variableMapping || {};
	const manualVariables = rawFilters.manualVariables || {};
	const since = new Date();
	since.setDate(since.getDate() - filters.daysBack);
	const pendingStatuses = ['pending', 'pending_confirmation', 'unpaid', 'pago pendiente', 'pago en espera'];

	const where = {
		workspaceId,
		normalizedPhone: {
			not: null
		},
		OR: pendingStatuses.map((paymentStatus) => ({
			paymentStatus: {
				equals: paymentStatus,
				mode: 'insensitive'
			}
		}))
	};

	if (selectedOrderKeys.length) {
		where.AND = [
			{
				OR: [
					{ id: { in: selectedOrderKeys } },
					{ orderId: { in: selectedOrderKeys } },
					{ orderNumber: { in: selectedOrderKeys } }
				]
			}
		];
	} else {
		where.orderCreatedAt = {
			gte: since
		};
	}

	if (typeof filters.minTotal === 'number' && Number.isFinite(filters.minTotal)) {
		where.totalAmount = {
			gte: filters.minTotal
		};
	}

	const rawOrders = await prisma.customerOrder.findMany({
		where,
		orderBy: [
			{ orderCreatedAt: 'desc' },
			{ orderUpdatedAt: 'desc' },
			{ createdAt: 'desc' }
		],
		take: Math.min(filters.limit * 4, 1000)
	});

	const latestByPhone = new Map();

	for (const order of rawOrders) {
		const normalizedPhone = normalizeCampaignPhone(order.normalizedPhone || order.contactPhone || '');
		if (!normalizedPhone) continue;
		if (!cartMatchesProductQuery(order, filters.productQuery)) continue;

		const previous = latestByPhone.get(normalizedPhone);
		const orderTs = new Date(order.orderCreatedAt || order.orderUpdatedAt || order.createdAt || 0).getTime();
		const prevTs = previous
			? new Date(previous.orderCreatedAt || previous.orderUpdatedAt || previous.createdAt || 0).getTime()
			: -1;

		if (!previous || orderTs > prevTs) {
			latestByPhone.set(normalizedPhone, order);
		}
	}

	const orders = [...latestByPhone.values()].slice(0, filters.limit);
	const normalizedPhones = orders
		.map((order) => normalizeCampaignPhone(order.normalizedPhone || order.contactPhone || ''))
		.filter(Boolean);

	let contacts = [];
	if (normalizedPhones.length) {
		contacts = await prisma.contact.findMany({
			where: {
				workspaceId,
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

	return orders.map((order) => {
		const normalizedPhone = normalizeCampaignPhone(order.normalizedPhone || order.contactPhone || '');
		const contact = contactByPhone.get(normalizedPhone) || null;
		const variables = buildPendingPaymentVariables(order, contact, variableMapping, manualVariables);

		return {
			contactId: contact?.id || null,
			contactName: variables.contact_name,
			phone: normalizedPhone,
			waId: normalizedPhone,
			variables,
			externalKey: `pending_payment:${normalizeString(order.orderId || order.orderNumber || '')}`,
			isOptedOut: contact ? contact.marketingOptIn === false || Boolean(contact.marketingOptedOutAt) : false,
			optOutReason: contact?.marketingOptOutReason || null
		};
	});
}

async function resolveCampaignRecipients(input = {}) {
	const workspaceId = normalizeWorkspaceId(input.workspaceId) || DEFAULT_WORKSPACE_ID;
	const audienceSource = normalizeAudienceSource(input.audienceSource || 'manual');

	if (audienceSource === 'abandoned_carts') {
		return resolveRecipientsFromAbandonedCarts(input);
	}

	if (audienceSource === 'pending_payment') {
		return resolveRecipientsFromPendingPayments(input);
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

	const recipientsFromIds = await resolveRecipientsFromContacts(safeArray(input.contactIds), workspaceId);
	const recipientsFromAllContacts = input.includeAllContacts ? await resolveRecipientsFromAllContacts(workspaceId) : [];

	return dedupeRecipients([
		...manualRecipients,
		...recipientsFromIds,
		...recipientsFromAllContacts
	]);
}

export async function previewAbandonedCartAudience({
	workspaceId = DEFAULT_WORKSPACE_ID,
	templateId = null,
	filters = {},
	variableMapping = null,
	manualVariables = null
} = {}) {
	const recipients = await resolveRecipientsFromAbandonedCarts({
		workspaceId,
		audienceSource: 'abandoned_carts',
		audienceFilters: {
			...(filters || {}),
			...(variableMapping ? { variableMapping } : {}),
			...(manualVariables ? { manualVariables } : {}),
		}
	});

	let template = null;
	let baseComponents = [];

	if (templateId) {
		template = await getTemplateOrThrow(templateId, { workspaceId });
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

export async function previewCampaignAudience({
	workspaceId = DEFAULT_WORKSPACE_ID,
	templateId = null,
	audienceSource = 'abandoned_carts',
	audienceFilters = {}
} = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedAudienceSource = normalizeAudienceSource(audienceSource || 'abandoned_carts');
	const recipients = await resolveCampaignRecipients({
		workspaceId: resolvedWorkspaceId,
		audienceSource: normalizedAudienceSource,
		audienceFilters
	});

	let template = null;
	let baseComponents = [];

	if (templateId) {
		template = await getTemplateOrThrow(templateId, { workspaceId: resolvedWorkspaceId });
		baseComponents = safeArray(template?.rawPayload?.components);
	}

	const previewRecipients = recipients.map((recipient) => {
		const variables = buildRecipientVariables(recipient);
		const personalized = baseComponents.length
			? renderTemplatePreviewFromComponents(baseComponents, variables)
			: { previewText: '', components: [] };

		return {
			phone: recipient.phone,
			contactName: recipient.contactName,
			externalKey: recipient.externalKey,
			reason: normalizedAudienceSource === 'pending_payment' ? 'Pago pendiente' : 'Carrito abandonado',
			variables,
			renderedPreviewText: personalized.previewText || '',
			primaryProductName:
				variables?.product_name ||
				variables?.first_product_name ||
				'',
			checkoutUrl:
				variables?.checkout_url ||
				variables?.abandoned_checkout_url ||
				'',
			totalAmount: variables?.total_amount || '',
			isOptedOut: Boolean(recipient.isOptedOut)
		};
	});

	const usable = previewRecipients.filter((recipient) => !recipient.isOptedOut);

	return {
		template,
		audienceSource: normalizedAudienceSource,
		filters: audienceFilters || {},
		total: previewRecipients.length,
		usableTotal: usable.length,
		optedOutTotal: previewRecipients.length - usable.length,
		recipients: previewRecipients.slice(0, 25)
	};
}

async function ensureCampaignConversation({ workspaceId = DEFAULT_WORKSPACE_ID, phone, contactId = null, contactName = null }) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedPhone = normalizeCampaignPhone(phone);

	if (!normalizedPhone) {
		return {
			contactId: null,
			conversationId: null
		};
	}

	let contact = null;

	if (contactId) {
		contact = await prisma.contact.findFirst({
			where: { id: contactId, workspaceId: resolvedWorkspaceId }
		});
	}

	if (!contact) {
		contact = await prisma.contact.upsert({
			where: {
				workspaceId_waId: {
					workspaceId: resolvedWorkspaceId,
					waId: normalizedPhone
				}
			},
			update: {
				name: contactName || undefined,
				phone: normalizedPhone
			},
			create: {
				workspaceId: resolvedWorkspaceId,
				waId: normalizedPhone,
				phone: normalizedPhone,
				name: contactName || normalizedPhone
			}
		});
	}

	let conversation = await prisma.conversation.findFirst({
		where: { workspaceId: resolvedWorkspaceId, contactId: contact.id }
	});

	if (!conversation) {
		conversation = await prisma.conversation.create({
			data: {
				contactId: contact.id,
				workspaceId: resolvedWorkspaceId,
				queue: 'AUTO',
				aiEnabled: true,
				state: {
					create: {
						customerName: contact.name || normalizedPhone,
						interactionCount: 0,
						interestedProducts: [],
						objections: [],
						needsHuman: false,
						handoffReason: null,
					}
				}
			}
		});
	}

	if (conversation.queue !== 'PAYMENT_REVIEW') {
		await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				queue: 'AUTO',
				aiEnabled: true,
			}
		});

		await prisma.conversationState.upsert({
			where: { conversationId: conversation.id },
			update: {
				customerName: contact.name || normalizedPhone,
				needsHuman: false,
				handoffReason: null,
			},
			create: {
				conversationId: conversation.id,
				customerName: contact.name || normalizedPhone,
				interactionCount: 0,
				interestedProducts: [],
				objections: [],
				needsHuman: false,
				handoffReason: null,
			}
		});
	}

	return {
		contactId: contact.id,
		conversationId: conversation.id,
		queue: conversation.queue === 'PAYMENT_REVIEW' ? 'PAYMENT_REVIEW' : 'AUTO',
	};
}

async function applyCampaignConversationContext({ campaign, recipient, conversationId }) {
	if (!conversationId) return null;
	if (normalizeAudienceSource(campaign.audienceSource || '') !== 'abandoned_carts') {
		return null;
	}

	const primaryProductName = normalizeString(
		recipient?.variables?.product_name || recipient?.variables?.first_product_name || ''
	);
	const checkoutUrl = normalizeString(
		recipient?.variables?.checkout_url || recipient?.variables?.abandoned_checkout_url || ''
	);
	const totalAmount = normalizeString(recipient?.variables?.total_amount || '');

	const commercialSummary = [
		'Ultimo contacto: campaña de carrito abandonado.',
		primaryProductName ? `Producto del carrito: ${primaryProductName}.` : null,
		totalAmount ? `Total mostrado: ${totalAmount}.` : null,
		checkoutUrl ? `Checkout pendiente: ${checkoutUrl}.` : null,
	]
		.filter(Boolean)
		.join(' ');

	return prisma.conversationState.upsert({
		where: { conversationId },
		update: {
			lastUserGoal: 'retomar_compra_carrito',
			currentProductFocus: primaryProductName || null,
			currentProductFamily: null,
			requestedOfferType: null,
			categoryLocked: false,
			menuActive: false,
			menuPath: null,
			menuLastSelection: null,
			needsHuman: false,
			handoffReason: null,
			commercialSummary: commercialSummary || null
		},
		create: {
			conversationId,
			customerName: recipient?.contactName || recipient?.phone || null,
			interactionCount: 0,
			interestedProducts: [],
			objections: [],
			lastUserGoal: 'retomar_compra_carrito',
			currentProductFocus: primaryProductName || null,
			currentProductFamily: null,
			requestedOfferType: null,
			categoryLocked: false,
			menuActive: false,
			menuPath: null,
			menuLastSelection: null,
			needsHuman: false,
			handoffReason: null,
			commercialSummary: commercialSummary || null
		}
	});
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
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
		select: { id: true, workspaceId: true, status: true, totalRecipients: true }
	});

	if (!campaign) {
		return null;
	}

	const scopedWhere = {
		workspaceId: campaign.workspaceId,
		campaignId
	};

	const [pending, accepted, delivered, read, failed, skipped] = await Promise.all([
		prisma.campaignRecipient.count({ where: { ...scopedWhere, status: 'PENDING' } }),
		prisma.campaignRecipient.count({ where: { ...scopedWhere, status: { in: ['SENT', 'DELIVERED', 'READ'] } } }),
		prisma.campaignRecipient.count({ where: { ...scopedWhere, status: { in: ['DELIVERED', 'READ'] } } }),
		prisma.campaignRecipient.count({ where: { ...scopedWhere, status: 'READ' } }),
		prisma.campaignRecipient.count({ where: { ...scopedWhere, status: 'FAILED' } }),
		prisma.campaignRecipient.count({ where: { ...scopedWhere, status: 'SKIPPED' } }),
	]);

	const nextStatus = buildCampaignFinalStatus({
		pending,
		accepted,
		failed,
		skipped,
		currentStatus: campaign.status
	});

	await prisma.campaign.updateMany({
		where: { id: campaignId, workspaceId: campaign.workspaceId },
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

	return prisma.campaign.findFirst({
		where: { id: campaignId, workspaceId: campaign.workspaceId }
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
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId },
		select: { workspaceId: true },
	});

	if (!campaign?.workspaceId) return false;

	const updated = await prisma.campaign.updateMany({
		where: {
			id: campaignId,
			workspaceId: campaign.workspaceId,
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

function classifyCampaignFailure(recipient = {}) {
	const message = normalizeString(recipient.errorMessage || '');
	const normalizedMessage = message.toLowerCase();
	const code = normalizeString(recipient.errorCode || '');
	const phone = normalizeString(recipient.phone || recipient.waId || '');
	const normalizedPhone = normalizeCampaignPhone(phone);
	const phoneDigits = phone.replace(/\D+/g, '').replace(/^00/, '');
	const hasInvalidPhoneShape = !normalizedPhone || (phoneDigits.startsWith('54') && normalizedPhone !== phoneDigits);

	if (
		hasInvalidPhoneShape ||
		code === '100' ||
		['131026', '131030', '131047', '131051'].includes(code) ||
		/phone|recipient|numero|valid|undeliverable|not a whatsapp/i.test(message)
	) {
		return {
			key: 'phone_or_recipient',
			label: 'Telefono o destinatario',
			action: 'Revisar normalizacion, 9 despues de 54 y alta del numero en WhatsApp.',
			phoneIssue: hasInvalidPhoneShape,
			normalizedPhone: normalizedPhone || null,
		};
	}

	if (code === '131048' || /spam rate|rate limit/i.test(message)) {
		return {
			key: 'provider_rate_limit',
			label: 'Limite de envio',
			action: 'Pausar reintentos masivos y retomar con menor cadencia.',
			phoneIssue: false,
			normalizedPhone: normalizedPhone || null,
		};
	}

	if (['130472', '131049'].includes(code) || /ecosystem|experiment/i.test(normalizedMessage)) {
		return {
			key: 'provider_delivery_policy',
			label: 'Entrega limitada por Meta',
			action: 'Evitar reintentar de inmediato; revisar cadencia, audiencia y tipo de plantilla.',
			phoneIssue: false,
			normalizedPhone: normalizedPhone || null,
		};
	}

	if (code === '190' || /token|oauth|permission|access/i.test(normalizedMessage)) {
		return {
			key: 'provider_auth',
			label: 'Credenciales Meta',
			action: 'Revisar token, permisos y canal WhatsApp del workspace.',
			phoneIssue: false,
			normalizedPhone: normalizedPhone || null,
		};
	}

	if (/template|parameter|component|variable/i.test(normalizedMessage)) {
		return {
			key: 'template_payload',
			label: 'Template o variables',
			action: 'Revisar variables renderizadas y estado de la plantilla.',
			phoneIssue: false,
			normalizedPhone: normalizedPhone || null,
		};
	}

	return {
		key: 'provider_other',
		label: 'Proveedor',
		action: 'Revisar el mensaje de Meta y logs del envio.',
		phoneIssue: false,
		normalizedPhone: normalizedPhone || null,
	};
}

function incrementMapCounter(map, key, seed = {}) {
	const current = map.get(key) || { ...seed, count: 0 };
	current.count += 1;
	map.set(key, current);
	return current;
}

function buildCampaignFailureDiagnostics(recipients = []) {
	const failedRecipients = safeArray(recipients).filter((recipient) => recipient.status === 'FAILED');
	const byReason = new Map();
	const byProviderCode = new Map();
	const examples = [];
	let possiblePhoneNormalization = 0;

	for (const recipient of failedRecipients) {
		const classification = classifyCampaignFailure(recipient);
		const reasonBucket = incrementMapCounter(byReason, classification.key, {
			key: classification.key,
			label: classification.label,
			action: classification.action,
		});
		if (classification.phoneIssue) {
			possiblePhoneNormalization += 1;
			reasonBucket.phoneIssueCount = Number(reasonBucket.phoneIssueCount || 0) + 1;
		}

		const providerCode = normalizeString(recipient.errorCode || 'sin_codigo');
		incrementMapCounter(byProviderCode, providerCode, {
			code: providerCode,
			subcode: normalizeString(recipient.errorSubcode || ''),
			message: normalizeString(recipient.errorMessage || ''),
		});

		if (examples.length < 8) {
			examples.push({
				id: recipient.id,
				contactName: recipient.contactName || null,
				phone: recipient.phone || recipient.waId || null,
				normalizedPhone: classification.normalizedPhone,
				errorCode: recipient.errorCode || null,
				errorSubcode: recipient.errorSubcode || null,
				errorMessage: recipient.errorMessage || null,
				reasonKey: classification.key,
				reasonLabel: classification.label,
				failedAt: recipient.failedAt || null,
			});
		}
	}

	return {
		totalFailed: failedRecipients.length,
		possiblePhoneNormalization,
		byReason: [...byReason.values()].sort((a, b) => b.count - a.count),
		byProviderCode: [...byProviderCode.values()].sort((a, b) => b.count - a.count),
		examples,
	};
}

async function buildCampaignOperationalControls(campaign = {}) {
	const [campaignDispatchEnabled, whatsappOutboundEnabled] = await Promise.all([
		isWorkspaceFeatureEnabled(campaign.workspaceId, WORKSPACE_FEATURE_FLAGS.CAMPAIGN_DISPATCH),
		isWorkspaceFeatureEnabled(campaign.workspaceId, WORKSPACE_FEATURE_FLAGS.WHATSAPP_OUTBOUND),
	]);
	const blockedReasons = [];
	const status = normalizeString(campaign.status || '').toUpperCase();
	const pending = Number(campaign.pendingRecipients || 0);
	const failed = Number(campaign.failedRecipients || 0);
	const skipped = Number(campaign.skippedRecipients || 0);

	if (!campaignDispatchEnabled) blockedReasons.push('campaign_dispatch_paused');
	if (!whatsappOutboundEnabled) blockedReasons.push('whatsapp_outbound_paused');
	if (!pending && !failed && !['DRAFT', 'CANCELED', 'FAILED', 'PARTIAL'].includes(status)) {
		blockedReasons.push('no_pending_or_failed_recipients');
	}

	const riskLevel =
		blockedReasons.length || failed > 0
			? 'warning'
			: skipped > 0
				? 'notice'
				: 'clear';

	return {
		campaignDispatchEnabled,
		whatsappOutboundEnabled,
		blockedReasons,
		riskLevel,
		canLaunch: campaignDispatchEnabled && whatsappOutboundEnabled && pending > 0 && !['RUNNING', 'QUEUED'].includes(status),
		canRetryFailed: campaignDispatchEnabled && whatsappOutboundEnabled && failed > 0 && !['RUNNING', 'QUEUED'].includes(status),
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

export function ensureApprovedTemplate(template) {
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

function isNamedTemplateParameterFormat(template = {}) {
	return toUpper(
		template?.parameterFormat ||
			template?.rawPayload?.parameter_format ||
			''
	) === 'NAMED';
}

function isNumericPlaceholder(value = '') {
	return /^\d+$/.test(normalizeString(value));
}

function buildBodyParametersFromText(text = '', variables = {}, { namedParameters = false } = {}) {
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

		const parameter = {
			type: 'text',
			text: String(value ?? '')
		};

		if (namedParameters && rawKey && !isNumericPlaceholder(rawKey)) {
			parameter.parameter_name = rawKey;
		}

		return parameter;
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

		const params = buildBodyParametersFromText(headerText, variables, {
			namedParameters: isNamedTemplateParameterFormat(template)
		});

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

function buildBodyComponentForSend(bodyComponent = {}, variables = {}, template = {}) {
	const text = normalizeString(bodyComponent?.text || '');
	const parameters = buildBodyParametersFromText(text, variables, {
		namedParameters: isNamedTemplateParameterFormat(template)
	});

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
		const parameters = buildBodyParametersFromText(urlTemplate, variables, {
			namedParameters: isNamedTemplateParameterFormat(template)
		});

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

export function buildSendComponentsFromTemplate({
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

	const bodySendComponent = buildBodyComponentForSend(templateBody || {}, variables, template);

	if (bodySendComponent) {
		sendComponents.push(bodySendComponent);
	}

	const buttonSendComponents = buildButtonComponentsForSend(template, variables);
	if (buttonSendComponents.length) {
		sendComponents.push(...buttonSendComponents);
	}

	return sendComponents;
}

export async function listCampaigns({ workspaceId = DEFAULT_WORKSPACE_ID, limit = 50 } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const campaigns = await prisma.campaign.findMany({
		where: { workspaceId: resolvedWorkspaceId },
		orderBy: [{ createdAt: 'desc' }],
		take: Math.max(1, Math.min(Number(limit) || 50, 1000)),
		include: {
			recipients: {
				orderBy: [{ createdAt: 'desc' }],
				take: 15
			}
		}
	});

	const analyticsByCampaignId = await Promise.all(
		campaigns.map(async (campaign) => {
			const recipients = await prisma.campaignRecipient.findMany({
				where: { workspaceId: resolvedWorkspaceId, campaignId: campaign.id },
				select: {
					id: true,
					campaignId: true,
					phone: true,
					waId: true,
					externalKey: true,
					conversationId: true,
					status: true,
					sentAt: true,
					deliveredAt: true,
					readAt: true
				}
			});

			const insights = await buildCampaignRecipientInsights(recipients, resolvedWorkspaceId);
			return [campaign.id, insights.summary];
		})
	);

	const analyticsMap = new Map(analyticsByCampaignId);

	return campaigns.map((campaign) => ({
		...campaign,
		analytics: analyticsMap.get(campaign.id) || null
	}));
}

function getRecipientDispatchAt(recipient = {}) {
	return recipient.sentAt || recipient.deliveredAt || recipient.readAt || null;
}

function getFirstValidDate(...values) {
	for (const value of values) {
		if (!value) continue;
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) return date;
	}

	return null;
}

function getOrderConversionAt(order = {}) {
	if (!order) return null;
	return getFirstValidDate(order.orderCreatedAt, order.createdAt);
}

function getAbandonedCartCheckoutId(externalKey = '') {
	const normalized = normalizeString(externalKey || '');
	if (!normalized.toLowerCase().startsWith('abandoned_cart:')) {
		return '';
	}

	return normalizeString(normalized.split(':').slice(1).join(':'));
}

function isPaidLikePaymentStatus(paymentStatus = '') {
	const normalized = normalizeString(paymentStatus || '').toLowerCase();
	return ['paid', 'partially_paid', 'authorized', 'pagado', 'pago aprobado'].includes(normalized);
}

function isCompletedLikeStatus(status = '') {
	const normalized = normalizeString(status || '').toLowerCase();
	return ['completed', 'complete', 'fulfilled', 'closed', 'completado', 'finalizado'].includes(normalized);
}

function isPaidOrCompletedOrder(order = {}) {
	return isPaidLikePaymentStatus(order.paymentStatus) || isCompletedLikeStatus(order.status);
}

function messageSuggestsCompletedPurchase(text = '') {
	const normalized = normalizeString(text || '').toLowerCase();
	if (!normalized) return false;

	const negativePatterns = [
		/no\s+(realice|realic[eé]|hice|hizo|hicimos|compre|compr[eé]|compr[oó])/i,
		/error.*pagar/i,
		/no\s+pod[íi]a\s+pagar/i,
		/quise comprar/i,
		/quiero comprar/i,
		/desde el link/i,
	];

	if (negativePatterns.some((pattern) => pattern.test(normalized))) {
		return false;
	}

	const positivePatterns = [
		/ya\s+est[aá]\s+realizada/i,
		/ya\s+hice\s+la\s+compra/i,
		/yo\s+ya\s+hice\s+la\s+compra/i,
		/yo\s+ya\s+compr[eé]/i,
		/ya\s+compr[eé]/i,
		/estoy\s+esperando\s+mi\s+pedido/i,
		/me\s+mandaron\s+por\s+mail\s+el\s+seguimiento/i,
		/me\s+lleg[oó]\s+el\s+pedido/i,
		/ya\s+me\s+lleg[oó]/i,
		/ya\s+lo\s+compr[eé]/i,
	];

	return positivePatterns.some((pattern) => pattern.test(normalized));
}

async function buildCampaignRecipientInsights(recipients = [], workspaceId = DEFAULT_WORKSPACE_ID) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedRecipients = safeArray(recipients);
	const recipientsWithDispatch = normalizedRecipients.filter((recipient) => Boolean(getRecipientDispatchAt(recipient)));

	const emptySummary = {
		totalRecipients: normalizedRecipients.length,
		repliedRecipients: 0,
		effectiveReadRecipients: 0,
		purchasedRecipients: 0,
		chatConfirmedPurchaseRecipients: 0,
		conversionSignalRecipients: 0,
		replyRate: 0,
		effectiveReadRate: 0,
		purchaseRate: 0,
		chatConfirmedPurchaseRate: 0,
		conversionSignalRate: 0,
		purchaseAttributionModel: 'order_after_campaign_send',
	};

	if (!recipientsWithDispatch.length) {
		return {
			summary: emptySummary,
			recipientsById: new Map(),
		};
	}

	const earliestDispatchAt = recipientsWithDispatch.reduce((earliest, recipient) => {
		const dispatchAt = getRecipientDispatchAt(recipient);
		if (!dispatchAt) return earliest;
		if (!earliest) return dispatchAt;
		return dispatchAt < earliest ? dispatchAt : earliest;
	}, null);

	const conversationIds = [...new Set(
		recipientsWithDispatch.map((recipient) => recipient.conversationId).filter(Boolean)
	)];
	const normalizedPhones = [...new Set(
		recipientsWithDispatch
			.map((recipient) => normalizeCampaignPhone(recipient.phone || recipient.waId || ''))
			.filter(Boolean)
	)];
	const checkoutIds = [...new Set(
		recipientsWithDispatch
			.map((recipient) => getAbandonedCartCheckoutId(recipient.externalKey || ''))
			.filter(Boolean)
	)];

	const [inboundMessages, orders, abandonedCarts] = await Promise.all([
		conversationIds.length
			? prisma.message.findMany({
					where: {
						workspaceId: resolvedWorkspaceId,
						conversationId: { in: conversationIds },
						direction: 'INBOUND',
						createdAt: earliestDispatchAt ? { gte: earliestDispatchAt } : undefined,
					},
					orderBy: [{ createdAt: 'asc' }],
					select: {
						conversationId: true,
						createdAt: true,
						body: true,
					},
			  })
			: Promise.resolve([]),
		normalizedPhones.length
			? prisma.customerOrder.findMany({
					where: {
						workspaceId: resolvedWorkspaceId,
						normalizedPhone: { in: normalizedPhones },
						...(earliestDispatchAt ? { orderCreatedAt: { gte: earliestDispatchAt } } : {}),
					},
					orderBy: [{ orderCreatedAt: 'asc' }, { createdAt: 'asc' }],
					select: {
						normalizedPhone: true,
						token: true,
						orderId: true,
						orderNumber: true,
						orderCreatedAt: true,
						orderUpdatedAt: true,
						updatedAt: true,
						createdAt: true,
						totalAmount: true,
						currency: true,
						paymentStatus: true,
						status: true,
					},
			  })
			: Promise.resolve([]),
		checkoutIds.length
			? prisma.abandonedCart.findMany({
					where: {
						workspaceId: resolvedWorkspaceId,
						checkoutId: { in: checkoutIds },
					},
					select: {
						checkoutId: true,
						token: true,
						recoveredAt: true,
						status: true,
						updatedAt: true,
					},
			  })
			: Promise.resolve([]),
	]);

	const inboundByConversation = new Map();
	for (const message of inboundMessages) {
		const bucket = inboundByConversation.get(message.conversationId) || [];
		bucket.push(message);
		inboundByConversation.set(message.conversationId, bucket);
	}

	const ordersByPhone = new Map();
	const ordersByToken = new Map();
	for (const order of orders) {
		const phone = normalizeCampaignPhone(order.normalizedPhone || '');
		if (!phone) continue;
		const bucket = ordersByPhone.get(phone) || [];
		bucket.push(order);
		ordersByPhone.set(phone, bucket);

		const token = normalizeString(order.token || '');
		if (token) {
			const tokenBucket = ordersByToken.get(token) || [];
			tokenBucket.push(order);
			ordersByToken.set(token, tokenBucket);
		}
	}

	const abandonedCartByCheckoutId = new Map(
		abandonedCarts.map((cart) => [normalizeString(cart.checkoutId || ''), cart])
	);

	const recipientsById = new Map();
	let repliedRecipients = 0;
	let effectiveReadRecipients = 0;
	let purchasedRecipients = 0;
	let chatConfirmedPurchaseRecipients = 0;
	let conversionSignalRecipients = 0;

	for (const recipient of normalizedRecipients) {
		const dispatchAt = getRecipientDispatchAt(recipient);
		const normalizedPhone = normalizeCampaignPhone(recipient.phone || recipient.waId || '');
		const checkoutId = getAbandonedCartCheckoutId(recipient.externalKey || '');
		const abandonedCart = checkoutId ? abandonedCartByCheckoutId.get(checkoutId) || null : null;
		const abandonedCartToken = normalizeString(abandonedCart?.token || '');
		const conversationMessages = recipient.conversationId
			? inboundByConversation.get(recipient.conversationId) || []
			: [];
		const firstReply = dispatchAt
			? conversationMessages.find((message) => new Date(message.createdAt).getTime() >= new Date(dispatchAt).getTime()) || null
			: null;
		const purchaseChatMessage = dispatchAt
			? conversationMessages.find((message) => {
					if (new Date(message.createdAt).getTime() < new Date(dispatchAt).getTime()) return false;
					return messageSuggestsCompletedPurchase(message.body || '');
			  }) || null
			: null;
		const matchingOrderByCart = dispatchAt && abandonedCartToken
			? (ordersByToken.get(abandonedCartToken) || []).find((order) => {
					const effectiveOrderTimestamp = getOrderConversionAt(order);
					if (!effectiveOrderTimestamp) return false;
					return (
						isPaidOrCompletedOrder(order) &&
						new Date(effectiveOrderTimestamp).getTime() >= new Date(dispatchAt).getTime()
					);
			  }) || null
			: null;
		const purchaseOrder = matchingOrderByCart || (
			dispatchAt && normalizedPhone
				? (ordersByPhone.get(normalizedPhone) || []).find((order) => {
						const effectiveOrderTimestamp = getOrderConversionAt(order);
						if (!effectiveOrderTimestamp) return false;
						return (
							isPaidOrCompletedOrder(order) &&
							new Date(effectiveOrderTimestamp).getTime() >= new Date(dispatchAt).getTime()
						);
				  }) || null
				: null
		);
		const hasReply = Boolean(firstReply);
		const effectiveRead = Boolean(recipient.readAt || hasReply);
		const purchaseDetected = Boolean(purchaseOrder);
		const chatConfirmedPurchase = Boolean(purchaseChatMessage);
		const conversionSignal = Boolean(purchaseDetected || chatConfirmedPurchase);

		if (hasReply) repliedRecipients += 1;
		if (effectiveRead) effectiveReadRecipients += 1;
		if (purchaseDetected) purchasedRecipients += 1;
		if (chatConfirmedPurchase) chatConfirmedPurchaseRecipients += 1;
		if (conversionSignal) conversionSignalRecipients += 1;

		recipientsById.set(recipient.id, {
			hasReply,
			firstReplyAt: firstReply?.createdAt || null,
			firstReplyBody: normalizeString(firstReply?.body || '') || null,
			effectiveRead,
			purchaseDetected,
			chatConfirmedPurchase,
			chatConfirmedPurchaseAt: purchaseChatMessage?.createdAt || null,
			chatConfirmedPurchaseBody: normalizeString(purchaseChatMessage?.body || '') || null,
			conversionSignal,
			purchaseAt: getOrderConversionAt(purchaseOrder),
			purchaseOrderId: normalizeString(purchaseOrder?.orderId || '') || null,
			purchaseOrderNumber: normalizeString(purchaseOrder?.orderNumber || '') || null,
			purchasePaymentStatus: normalizeString(purchaseOrder?.paymentStatus || '') || null,
			purchaseStatus: normalizeString(purchaseOrder?.status || '') || null,
			purchaseTotalAmount: purchaseOrder?.totalAmount ?? null,
			purchaseCurrency: normalizeString(purchaseOrder?.currency || 'ARS') || 'ARS',
			purchaseDetectionMode: matchingOrderByCart ? 'abandoned_cart_token_paid_after_campaign' : (purchaseOrder ? 'phone_order_after_campaign' : null),
		});
	}

	const base = recipientsWithDispatch.length || 0;
	const persistedInsights = await getPersistedConversionInsights({
		workspaceId: resolvedWorkspaceId,
		recipientIds: normalizedRecipients.map((recipient) => recipient.id),
	});
	const persistedSummary = persistedInsights.summary || {};
	const persistedById = persistedInsights.recipientsById || new Map();
	const finalPurchasedRecipients = Math.max(purchasedRecipients, persistedSummary.purchasedRecipients || 0);
	const finalChatConfirmedRecipients = Math.max(chatConfirmedPurchaseRecipients, persistedSummary.chatConfirmedPurchaseRecipients || 0);
	const finalConversionSignalRecipients = Math.max(conversionSignalRecipients, persistedSummary.conversionSignalRecipients || 0);
	const finalConversionsBySource = {
		...(persistedSummary.conversionsBySource || {}),
	};
	if (finalChatConfirmedRecipients > 0) {
		finalConversionsBySource.APP = Math.max(
			Number(finalConversionsBySource.APP || 0),
			finalChatConfirmedRecipients
		);
		delete finalConversionsBySource.CHAT_CONFIRMATION;
	}

	for (const [recipientId, persisted] of persistedById.entries()) {
		recipientsById.set(recipientId, {
			...(recipientsById.get(recipientId) || {}),
			...persisted,
		});
	}

	const mergedRecipientInsights = [...recipientsById.values()];
	const mergedPurchasedRecipients = mergedRecipientInsights.filter((insight) => insight.purchaseDetected).length;
	const mergedChatConfirmedRecipients = mergedRecipientInsights.filter((insight) => insight.chatConfirmedPurchase).length;
	const mergedConversionSignalRecipients = mergedRecipientInsights.filter((insight) => insight.conversionSignal).length;

	return {
		summary: {
			...emptySummary,
			repliedRecipients,
			effectiveReadRecipients,
			purchasedRecipients: Math.max(finalPurchasedRecipients, mergedPurchasedRecipients),
			chatConfirmedPurchaseRecipients: Math.max(finalChatConfirmedRecipients, mergedChatConfirmedRecipients),
			conversionSignalRecipients: Math.max(finalConversionSignalRecipients, mergedConversionSignalRecipients),
			replyRate: base > 0 ? repliedRecipients / base : 0,
			effectiveReadRate: base > 0 ? effectiveReadRecipients / base : 0,
			purchaseRate: base > 0 ? Math.max(finalPurchasedRecipients, mergedPurchasedRecipients) / base : 0,
			chatConfirmedPurchaseRate: base > 0 ? Math.max(finalChatConfirmedRecipients, mergedChatConfirmedRecipients) / base : 0,
			conversionSignalRate: base > 0 ? Math.max(finalConversionSignalRecipients, mergedConversionSignalRecipients) / base : 0,
			attributedRevenue: persistedSummary.attributedRevenue || 0,
			attributedCurrency: persistedSummary.attributedCurrency || 'ARS',
			conversionsBySource: finalConversionsBySource,
			purchaseAttributionModel: 'prefer_same_abandoned_cart_token_paid_after_campaign_else_phone_order_after_campaign',
		},
		recipientsById,
	};
}

export async function getCampaignDetail(campaignId, { workspaceId = DEFAULT_WORKSPACE_ID, page = 1, pageSize = 50 } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const campaign = await prisma.campaign.findFirst({
		where: { id: campaignId, workspaceId: resolvedWorkspaceId }
	});

	if (!campaign) {
		throw new Error('No se encontró la campaña.');
	}

	const currentPage = Math.max(1, Number(page) || 1);
	const currentPageSize = Math.max(1, Math.min(Number(pageSize) || 50, 1000));

	const [template, totalRecipients, recipients, allRecipientsForInsights] = await Promise.all([
		campaign.templateLocalId
			? prisma.whatsAppTemplate.findFirst({
					where: {
						workspaceId: resolvedWorkspaceId,
						id: campaign.templateLocalId
					}
			  })
			: null,
		prisma.campaignRecipient.count({ where: { workspaceId: resolvedWorkspaceId, campaignId } }),
		prisma.campaignRecipient.findMany({
			where: { workspaceId: resolvedWorkspaceId, campaignId },
			orderBy: [{ createdAt: 'asc' }],
			skip: (currentPage - 1) * currentPageSize,
			take: currentPageSize
		}),
		prisma.campaignRecipient.findMany({
			where: { workspaceId: resolvedWorkspaceId, campaignId },
			select: {
				id: true,
				campaignId: true,
				phone: true,
				waId: true,
				externalKey: true,
				conversationId: true,
				status: true,
				errorCode: true,
				errorSubcode: true,
				errorMessage: true,
				sentAt: true,
				deliveredAt: true,
				readAt: true,
				failedAt: true,
				createdAt: true,
				updatedAt: true
			}
		})
	]);

	const [insights, operationalControls] = await Promise.all([
		buildCampaignRecipientInsights(allRecipientsForInsights, resolvedWorkspaceId),
		buildCampaignOperationalControls(campaign),
	]);
	const failureDiagnostics = buildCampaignFailureDiagnostics(allRecipientsForInsights);
	const enrichedRecipients = recipients.map((recipient) => ({
		...recipient,
		...(insights.recipientsById.get(recipient.id) || {})
	}));

	return {
		campaign,
		template,
		recipients: enrichedRecipients,
		analytics: insights.summary,
		diagnostics: {
			failures: failureDiagnostics,
			controls: operationalControls,
		},
		pagination: {
			page: currentPage,
			pageSize: currentPageSize,
			total: totalRecipients,
			totalPages: Math.max(1, Math.ceil(totalRecipients / currentPageSize))
		}
	};
}

export async function createCampaignDraft({
	workspaceId = DEFAULT_WORKSPACE_ID,
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
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const template = templateId
		? await getTemplateOrThrow(templateId, { workspaceId: resolvedWorkspaceId })
		: await prisma.whatsAppTemplate.findFirst({
				where: {
					workspaceId: resolvedWorkspaceId,
					name: normalizeString(templateName).toLowerCase(),
					language: normalizeString(languageCode, 'es_AR'),
					deletedAt: null
				}
		  });

	if (!template) {
		throw new Error('No se encontró la plantilla seleccionada.');
	}

	const normalizedAudienceSource = normalizeAudienceSource(audienceSource || 'manual');
	const excludeSentTemplate =
		audienceFilters?.excludeSentTemplate === true ||
		audienceFilters?.excludeSentTemplate === 'true' ||
		audienceFilters?.excludeSentTemplate === '1';
	const alreadySentTemplatePhones = excludeSentTemplate
		? await getPhonesAlreadySentTemplate({
				workspaceId: resolvedWorkspaceId,
				templateName: audienceFilters?.sentTemplateName || template.name,
				templateNames: audienceFilters?.sentTemplateNames || []
		  })
		: new Set();

	const resolvedRecipients = await resolveCampaignRecipients({
		workspaceId: resolvedWorkspaceId,
		recipients,
		contactIds,
		includeAllContacts,
		audienceSource: normalizedAudienceSource,
		audienceFilters
	});
	const suppressionByPhone = await buildCampaignSuppressionMap({
		workspaceId: resolvedWorkspaceId,
		phones: resolvedRecipients.map((recipient) => recipient.phone || recipient.waId || ''),
		audienceSource: normalizedAudienceSource,
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

		if (alreadySentTemplatePhones.has(normalizedPhone)) {
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

		const suppressionReason = suppressionByPhone.get(normalizedPhone) || null;
		const shouldSkipRecipient =
			Boolean(suppressionReason) ||
			(normalizedAudienceSource !== 'manual' && recipient.isOptedOut);

		recipientRows.push({
			workspaceId: resolvedWorkspaceId,
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
				? normalizeString(suppressionReason || recipient.optOutReason, 'opted_out')
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
			workspaceId: resolvedWorkspaceId,
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

export async function launchCampaign(campaignId, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const [campaignDispatchEnabled, whatsappOutboundEnabled] = await Promise.all([
		isWorkspaceFeatureEnabled(resolvedWorkspaceId, WORKSPACE_FEATURE_FLAGS.CAMPAIGN_DISPATCH),
		isWorkspaceFeatureEnabled(resolvedWorkspaceId, WORKSPACE_FEATURE_FLAGS.WHATSAPP_OUTBOUND),
	]);

	if (!campaignDispatchEnabled) {
		throw new Error('El envio de campanas esta pausado para este workspace.');
	}
	if (!whatsappOutboundEnabled) {
		throw new Error('Los envios salientes de WhatsApp estan pausados para este workspace.');
	}

	const campaign = await prisma.campaign.findFirst({
		where: { id: campaignId, workspaceId: resolvedWorkspaceId }
	});

	if (!campaign) {
		throw new Error('No se encontró la campaña.');
	}

	if (campaign.status === 'CANCELED') {
		throw new Error('La campaña está cancelada y no se puede lanzar.');
	}

	const template = campaign.templateLocalId
		? await getTemplateOrThrow(campaign.templateLocalId, { workspaceId: resolvedWorkspaceId })
		: null;

	ensureApprovedTemplate(template);

	const pendingCount = await prisma.campaignRecipient.count({
		where: {
			workspaceId: resolvedWorkspaceId,
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

export async function cancelCampaign(campaignId, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const existing = await prisma.campaign.findFirst({
		where: { id: campaignId, workspaceId: resolvedWorkspaceId },
		select: { id: true },
	});
	if (!existing) {
		throw new Error('No se encontrÃ³ la campaÃ±a.');
	}
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

export async function deleteCampaign(campaignId, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const campaign = await prisma.campaign.findFirst({
		where: { id: campaignId, workspaceId: resolvedWorkspaceId },
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
			where: { workspaceId: resolvedWorkspaceId, campaignId }
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

export async function retryFailedCampaignRecipients(campaignId, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const [campaignDispatchEnabled, whatsappOutboundEnabled] = await Promise.all([
		isWorkspaceFeatureEnabled(resolvedWorkspaceId, WORKSPACE_FEATURE_FLAGS.CAMPAIGN_DISPATCH),
		isWorkspaceFeatureEnabled(resolvedWorkspaceId, WORKSPACE_FEATURE_FLAGS.WHATSAPP_OUTBOUND),
	]);

	if (!campaignDispatchEnabled) {
		throw new Error('El envio de campanas esta pausado para este workspace.');
	}
	if (!whatsappOutboundEnabled) {
		throw new Error('Los envios salientes de WhatsApp estan pausados para este workspace.');
	}

	await prisma.campaignRecipient.updateMany({
		where: {
			workspaceId: resolvedWorkspaceId,
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
		const campaignDispatchEnabled = await isWorkspaceFeatureEnabled(
			candidate.workspaceId,
			WORKSPACE_FEATURE_FLAGS.CAMPAIGN_DISPATCH
		);

		if (!campaignDispatchEnabled) {
			logger.warn('campaign.dispatch_skipped_by_feature_flag', {
				workspaceId: candidate.workspaceId,
				campaignId: candidate.id,
			});
			continue;
		}

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
		workspaceId: campaign.workspaceId,
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

	await applyCampaignConversationContext({
		campaign,
		recipient: {
			...recipient,
			contactId: ensured.contactId || recipient.contactId
		},
		conversationId: ensured.conversationId
	});

	const workspaceConfig = await getWorkspaceRuntimeConfig(campaign.workspaceId);
	const createdMessage = await prisma.message.create({
		data: {
			workspaceId: campaign.workspaceId,
			conversationId: ensured.conversationId,
			metaMessageId: sendResult?.rawPayload?.messages?.[0]?.id || null,
			senderName: workspaceConfig.ai.businessName || 'Marca',
			direction: 'OUTBOUND',
			type: 'template',
			body: recipient.renderedPreviewText || `[Plantilla ${campaign.templateName}]`,
			provider: 'whatsapp-cloud-api',
			model: campaign.templateName,
			rawPayload: {
				...(sendResult?.rawPayload || {}),
				campaignMeta: {
					campaignId: campaign.id,
					audienceSource: campaign.audienceSource || 'manual',
				}
			}
		}
	});

	await prisma.conversation.updateMany({
		where: {
			id: ensured.conversationId,
			workspaceId: campaign.workspaceId,
			OR: [
				{ lastMessageAt: null },
				{ lastMessageAt: { lt: createdMessage.createdAt } },
			],
		},
		data: {
			lastMessageAt: createdMessage.createdAt,
		},
	});

	publishInboxEvent({
		workspaceId: campaign.workspaceId,
		scope: 'message',
		action: 'campaign-outbound-created',
		conversationId: ensured.conversationId,
		queue: ensured.queue || 'AUTO',
		direction: 'OUTBOUND',
		messageId: createdMessage.id,
		metaMessageId: createdMessage.metaMessageId || null,
		createdAt: createdMessage.createdAt.toISOString(),
	});

	return createdMessage;
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
			workspaceId: recipient.workspaceId || DEFAULT_WORKSPACE_ID,
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
		? await getTemplateOrThrow(campaign.templateLocalId, { workspaceId: campaign.workspaceId })
		: null;

	ensureApprovedTemplate(template);

	if (recipient.status !== 'PENDING') {
		return recipient;
	}

	const suppressionByPhone = await buildCampaignSuppressionMap({
		workspaceId: campaign.workspaceId,
		phones: [recipient.phone || recipient.waId || ''],
		audienceSource: campaign.audienceSource || 'manual',
	});
	const suppressionReason = suppressionByPhone.get(normalizeCampaignPhone(recipient.phone || recipient.waId || ''));
	if (suppressionReason) {
		logger.info('campaign.recipient_send_skipped', {
			workspaceId: campaign.workspaceId,
			campaignId: campaign.id,
			recipientId: recipient.id,
			phone: maskPhone(recipient.phone || ''),
			reason: suppressionReason,
		});

		return prisma.campaignRecipient.update({
			where: { id: recipient.id },
			data: {
				status: 'SKIPPED',
				errorMessage: suppressionReason,
			},
		});
	}

	const componentsToSend = buildSendComponentsFromTemplate({
		template,
		renderedComponents: Array.isArray(recipient.renderedComponents)
			? recipient.renderedComponents
			: safeArray(campaign.defaultComponents),
		variables: recipient.variables || {}
	});

	logger.info('campaign.recipient_send_started', {
		workspaceId: campaign.workspaceId,
		campaignId: campaign.id,
		audienceSource: campaign.audienceSource || 'manual',
		recipientId: recipient.id,
		contactId: recipient.contactId || null,
		phone: maskPhone(recipient.phone || ''),
		templateName: campaign.templateName,
		templateLanguage: campaign.templateLanguage,
		componentsCount: componentsToSend.length,
	});

	const sendResult = await sendWhatsAppTemplate({
		workspaceId: campaign.workspaceId,
		to: recipient.phone,
		templateName: campaign.templateName,
		languageCode: campaign.templateLanguage,
		components: componentsToSend
	});

	if (!sendResult?.ok) {
		const providerError = extractCampaignProviderError(sendResult);

		logger.warn('campaign.recipient_send_failed', {
			workspaceId: campaign.workspaceId,
			campaignId: campaign.id,
			recipientId: recipient.id,
			phone: maskPhone(recipient.phone || ''),
			providerCode: providerError.code,
			providerSubcode: providerError.subcode,
			providerMessage: providerError.message,
		});

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
			logger.error('campaign.dispatch_failed', {
				workspaceId: campaign.workspaceId,
				campaignId,
				recipientId: recipient.id,
				phone: maskPhone(recipient.phone || ''),
				error,
			});

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
				logger.error('campaign.dispatch_failed', {
					workspaceId: campaign.workspaceId,
					campaignId,
					recipientId: recipient.id,
					phone: maskPhone(recipient.phone || ''),
					error,
				});

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

const CAMPAIGN_DELIVERY_STATUS_RANK = {
	PENDING: 0,
	SENT: 1,
	DELIVERED: 2,
	READ: 3,
	FAILED: 4,
	SKIPPED: 4
};

function getCampaignDeliveryStatusRank(status = '') {
	return CAMPAIGN_DELIVERY_STATUS_RANK[toUpper(status, 'PENDING')] ?? 0;
}

function shouldApplyCampaignDeliveryStatus(currentStatus = '', nextStatus = '') {
	const currentRank = getCampaignDeliveryStatusRank(currentStatus);
	const nextRank = getCampaignDeliveryStatusRank(nextStatus);

	if (nextStatus === 'FAILED') {
		return currentStatus !== 'READ';
	}

	return nextRank >= currentRank;
}

export async function applyCampaignMessageStatusWebhook(statusPayload = {}, { workspaceId = null } = {}) {
	const waMessageId = normalizeString(statusPayload?.id || statusPayload?.message_id || '');

	if (!waMessageId) {
		return null;
	}

	const recipient = await prisma.campaignRecipient.findFirst({
		where: {
			...(workspaceId ? { workspaceId } : {}),
			waMessageId
		}
	});

	if (!recipient) {
		logger.debug('campaign.status_unmatched', {
			waMessageId,
			status: statusPayload?.status || null,
			workspaceId: workspaceId || null
		});
		return null;
	}

	const nextStatus = normalizeString(statusPayload?.status || '').toLowerCase();
	const timestamp = toDateFromUnixTimestamp(statusPayload?.timestamp);
	const error = safeArray(statusPayload?.errors)[0] || null;
	const normalizedNextStatus = toUpper(nextStatus);

	const updateData = {
		rawPayload: statusPayload,
		pricingCategory: statusPayload?.pricing?.category || recipient.pricingCategory,
		conversationCategory: statusPayload?.conversation?.origin?.type || recipient.conversationCategory,
		billable: typeof statusPayload?.pricing?.billable === 'boolean'
			? statusPayload.pricing.billable
			: recipient.billable
	};

	if (nextStatus === 'sent') {
		if (shouldApplyCampaignDeliveryStatus(recipient.status, 'SENT')) {
			updateData.status = 'SENT';
		}
		updateData.sentAt = timestamp;
	}
	if (nextStatus === 'delivered') {
		if (shouldApplyCampaignDeliveryStatus(recipient.status, 'DELIVERED')) {
			updateData.status = 'DELIVERED';
		}
		updateData.deliveredAt = timestamp;
	}
	if (nextStatus === 'read') {
		if (shouldApplyCampaignDeliveryStatus(recipient.status, 'READ')) {
			updateData.status = 'READ';
		}
		updateData.readAt = timestamp;
	}
	if (nextStatus === 'failed') {
		if (shouldApplyCampaignDeliveryStatus(recipient.status, 'FAILED')) {
			updateData.status = 'FAILED';
		}
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

	if (!['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(normalizedNextStatus)) {
		logger.debug('campaign.status_ignored', {
			waMessageId,
			status: statusPayload?.status || null,
			workspaceId: workspaceId || null
		});
	}

	await prisma.campaignRecipient.update({
		where: { id: recipient.id },
		data: updateData
	});

	await refreshCampaignCounters(recipient.campaignId);

	return recipient.campaignId;
}
