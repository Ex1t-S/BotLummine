import { prisma } from '../../lib/prisma.js';
import { normalizeWhatsAppIdentityPhone } from '../../lib/phone-normalization.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';

export const ATTRIBUTION_WINDOW_HOURS = Math.max(
	1,
	Number(process.env.CAMPAIGN_ATTRIBUTION_WINDOW_HOURS || 168) || 168
);

const REAL_CONVERSION_SOURCES = new Set(['ABANDONED_CART', 'PENDING_PAYMENT', 'MARKETING']);

function normalizeString(value = '') {
	return String(value ?? '').trim();
}

function normalizeLower(value = '') {
	return normalizeString(value).toLowerCase();
}

function normalizeName(value = '') {
	return normalizeString(value)
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizePhone(value = '') {
	return normalizeWhatsAppIdentityPhone(value);
}

function toNumber(value) {
	if (value == null) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value.toNumber === 'function') return value.toNumber();
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function addHours(date, hours) {
	return new Date(new Date(date).getTime() + hours * 60 * 60 * 1000);
}

function subtractHours(date, hours) {
	return new Date(new Date(date).getTime() - hours * 60 * 60 * 1000);
}

function getRecipientDispatchAt(recipient = {}) {
	return recipient.sentAt || recipient.deliveredAt || recipient.readAt || null;
}

function getAbandonedCartCheckoutId(externalKey = '') {
	const normalized = normalizeString(externalKey);
	if (!normalized.toLowerCase().startsWith('abandoned_cart:')) return '';
	return normalizeString(normalized.split(':').slice(1).join(':'));
}

function getPendingPaymentOrderRef(externalKey = '', variables = {}) {
	const normalized = normalizeString(externalKey);
	const lower = normalized.toLowerCase();

	if (lower.startsWith('pending_payment:')) {
		return normalizeString(normalized.split(':').slice(1).join(':'));
	}

	return (
		normalizeString(variables?.orderId) ||
		normalizeString(variables?.order_id) ||
		normalizeString(variables?.orderNumber) ||
		normalizeString(variables?.order_number) ||
		normalizeString(variables?.last_order_id) ||
		normalizeString(variables?.last_order_number)
	);
}

export function isPaidLikePaymentStatus(paymentStatus = '') {
	const normalized = normalizeLower(paymentStatus);
	return ['paid', 'partially_paid', 'authorized', 'pagado', 'pago aprobado'].includes(normalized);
}

function isCompletedLikeStatus(status = '') {
	const normalized = normalizeLower(status);
	return ['completed', 'complete', 'fulfilled', 'closed', 'completado', 'finalizado'].includes(normalized);
}

function isPaidOrCompletedOrder(order = {}) {
	return isPaidLikePaymentStatus(order.paymentStatus) || isCompletedLikeStatus(order.status);
}

export function messageSuggestsCompletedPurchase(text = '') {
	const normalized = normalizeLower(text);
	if (!normalized) return false;

	const negativePatterns = [
		/no\s+(realice|realic[e\u00e9]|hice|hizo|hicimos|compre|compr[e\u00e9]|compr[o\u00f3])/i,
		/error.*pagar/i,
		/no\s+pod[i\u00ed]a\s+pagar/i,
		/quise comprar/i,
		/quiero comprar/i,
		/desde el link/i,
	];

	if (negativePatterns.some((pattern) => pattern.test(normalized))) return false;

	const positivePatterns = [
		/ya\s+est[a\u00e1]\s+realizada/i,
		/ya\s+hice\s+(la\s+)?(compra|pedido)/i,
		/yo\s+ya\s+(hice\s+la\s+compra|compr[e\u00e9])/i,
		/ya\s+(compr[e\u00e9]|lo\s+compr[e\u00e9]|finalice\s+la\s+compra|realice\s+el\s+pedido|realice\s+la\s+compra)/i,
		/estoy\s+esperando\s+mi\s+pedido/i,
		/me\s+mandaron\s+por\s+mail\s+el\s+seguimiento/i,
		/me\s+lleg[o\u00f3]\s+el\s+pedido/i,
		/ya\s+me\s+lleg[o\u00f3]/i,
	];

	return positivePatterns.some((pattern) => pattern.test(normalized));
}

function getOrderConvertedAt(order = {}) {
	return order.orderUpdatedAt || order.orderCreatedAt || order.updatedAt || order.createdAt || new Date();
}

function getOrderMatchValues(order = {}) {
	return {
		phone: normalizePhone(order.normalizedPhone || order.contactPhone || ''),
		email: normalizeLower(order.normalizedEmail || order.contactEmail || ''),
		name: normalizeName(order.contactName || ''),
		token: normalizeString(order.token || ''),
		orderId: normalizeString(order.orderId || ''),
		orderNumber: normalizeString(order.orderNumber || ''),
	};
}

function getCartOrderRefs(cart = {}) {
	const raw = cart.rawPayload && typeof cart.rawPayload === 'object' ? cart.rawPayload : {};
	return [
		raw.order_id,
		raw.orderId,
		raw.order_number,
		raw.orderNumber,
		raw.completed_order_id,
		raw.completedOrderId,
		raw.order?.id,
		raw.order?.number,
		raw.completed_order?.id,
		raw.completed_order?.number,
		raw.completedOrder?.id,
		raw.completedOrder?.number,
	]
		.map(normalizeString)
		.filter(Boolean);
}

function getRecipientMatchValues(recipient = {}) {
	const variables = recipient.variables && typeof recipient.variables === 'object' ? recipient.variables : {};
	return {
		phone: normalizePhone(recipient.phone || recipient.waId || variables.phone || variables.wa_id || ''),
		email: normalizeLower(variables.email || variables.contact_email || ''),
		name: normalizeName(recipient.contactName || variables.contact_name || variables.first_name || ''),
	};
}

function buildConversionKey({ source, recipientId, orderId = '', orderNumber = '', checkoutId = '', messageId = '' }) {
	return [
		source,
		recipientId || 'no-recipient',
		orderId || orderNumber || checkoutId || messageId || 'no-resource',
	].join(':');
}

async function upsertConversion(data = {}) {
	if (!data.workspaceId || !data.campaignId || !data.source || !data.conversionKey) return null;

	return prisma.campaignConversion.upsert({
		where: {
			workspaceId_conversionKey: {
				workspaceId: data.workspaceId,
				conversionKey: data.conversionKey,
			},
		},
		update: {
			confidence: data.confidence,
			recipientId: data.recipientId || null,
			orderId: data.orderId || null,
			orderNumber: data.orderNumber || null,
			checkoutId: data.checkoutId || null,
			cartId: data.cartId || null,
			contactName: data.contactName || null,
			phone: data.phone || null,
			email: data.email || null,
			amount: data.amount ?? null,
			currency: data.currency || null,
			paymentStatus: data.paymentStatus || null,
			sentAt: data.sentAt || null,
			convertedAt: data.convertedAt,
			attributionWindowHours: data.attributionWindowHours || ATTRIBUTION_WINDOW_HOURS,
			matchReason: data.matchReason || null,
			rawPayload: data.rawPayload || null,
		},
		create: {
			workspaceId: data.workspaceId,
			campaignId: data.campaignId,
			recipientId: data.recipientId || null,
			conversionKey: data.conversionKey,
			source: data.source,
			confidence: data.confidence,
			orderId: data.orderId || null,
			orderNumber: data.orderNumber || null,
			checkoutId: data.checkoutId || null,
			cartId: data.cartId || null,
			contactName: data.contactName || null,
			phone: data.phone || null,
			email: data.email || null,
			amount: data.amount ?? null,
			currency: data.currency || null,
			paymentStatus: data.paymentStatus || null,
			sentAt: data.sentAt || null,
			convertedAt: data.convertedAt,
			attributionWindowHours: data.attributionWindowHours || ATTRIBUTION_WINDOW_HOURS,
			matchReason: data.matchReason || null,
			rawPayload: data.rawPayload || null,
		},
	});
}

async function getOrderById({ workspaceId, orderId, storeId = null }) {
	return prisma.customerOrder.findFirst({
		where: {
			workspaceId,
			orderId: normalizeString(orderId),
			...(storeId ? { storeId: normalizeString(storeId) } : {}),
		},
	});
}

async function getCandidateRecipientsForOrder(order = {}) {
	const convertedAt = getOrderConvertedAt(order);
	const windowStart = subtractHours(convertedAt, ATTRIBUTION_WINDOW_HOURS);

	return prisma.campaignRecipient.findMany({
		where: {
			workspaceId: order.workspaceId,
			status: { in: ['SENT', 'DELIVERED', 'READ'] },
			OR: [
				{ sentAt: { gte: windowStart, lte: convertedAt } },
				{ deliveredAt: { gte: windowStart, lte: convertedAt } },
				{ readAt: { gte: windowStart, lte: convertedAt } },
			],
		},
		include: {
			campaign: {
				select: {
					id: true,
					audienceSource: true,
				},
			},
		},
		orderBy: [{ sentAt: 'desc' }, { deliveredAt: 'desc' }, { readAt: 'desc' }],
	});
}

function recipientMatchesOrderIdentity(recipient = {}, orderValues = {}) {
	const recipientValues = getRecipientMatchValues(recipient);
	if (recipientValues.phone && orderValues.phone && recipientValues.phone === orderValues.phone) {
		return 'phone';
	}
	if (recipientValues.email && orderValues.email && recipientValues.email === orderValues.email) {
		return 'email';
	}
	if (recipientValues.name && orderValues.name && recipientValues.name === orderValues.name) {
		return 'name_exact';
	}
	return '';
}

function pendingPaymentMatches(recipient = {}, orderValues = {}) {
	const ref = getPendingPaymentOrderRef(recipient.externalKey || '', recipient.variables || {});
	if (!ref) return '';
	if (ref === orderValues.orderId) return 'pending_payment_order_id';
	if (ref === orderValues.orderNumber) return 'pending_payment_order_number';
	return '';
}

async function abandonedCartMatches(recipient = {}, order = {}, orderValues = {}) {
	const checkoutId = getAbandonedCartCheckoutId(recipient.externalKey || '');
	if (!checkoutId) return null;

	const cart = await prisma.abandonedCart.findFirst({
		where: {
			workspaceId: order.workspaceId,
			checkoutId,
		},
	});

	if (!cart) return null;

	const cartCreatedAt = cart.checkoutCreatedAt || cart.createdAt || null;
	const orderAt = getOrderConvertedAt(order);
	if (cartCreatedAt && new Date(orderAt).getTime() < new Date(cartCreatedAt).getTime()) return null;

	const cartOrderRefs = getCartOrderRefs(cart);
	if (
		cartOrderRefs.length &&
		(cartOrderRefs.includes(orderValues.orderId) || cartOrderRefs.includes(orderValues.orderNumber))
	) {
		return { cart, matchReason: 'abandoned_cart_order_ref' };
	}

	if (cart.token && orderValues.token && normalizeString(cart.token) === orderValues.token) {
		return { cart, matchReason: 'abandoned_cart_token' };
	}

	const cartPhone = normalizePhone(cart.contactPhone || '');
	if (cartPhone && orderValues.phone && cartPhone === orderValues.phone) {
		return { cart, matchReason: 'abandoned_cart_phone' };
	}

	const cartEmail = normalizeLower(cart.contactEmail || '');
	if (cartEmail && orderValues.email && cartEmail === orderValues.email) {
		return { cart, matchReason: 'abandoned_cart_email' };
	}

	const cartName = normalizeName(cart.contactName || '');
	if (cartName && orderValues.name && cartName === orderValues.name) {
		return { cart, matchReason: 'abandoned_cart_name_exact' };
	}

	return null;
}

function buildOrderConversionPayload({ source, confidence, recipient, order, matchReason, checkoutId = '', cart = null }) {
	const sentAt = getRecipientDispatchAt(recipient);
	const convertedAt = getOrderConvertedAt(order);
	return {
		workspaceId: order.workspaceId,
		campaignId: recipient.campaignId,
		recipientId: recipient.id,
		conversionKey: buildConversionKey({
			source,
			recipientId: recipient.id,
			orderId: order.orderId,
			orderNumber: order.orderNumber,
			checkoutId,
		}),
		source,
		confidence,
		orderId: order.orderId,
		orderNumber: order.orderNumber,
		checkoutId: checkoutId || null,
		cartId: cart?.id || null,
		contactName: order.contactName || recipient.contactName || null,
		phone: normalizePhone(order.normalizedPhone || order.contactPhone || recipient.phone || recipient.waId || ''),
		email: normalizeLower(order.normalizedEmail || order.contactEmail || ''),
		amount: toNumber(order.totalAmount),
		currency: order.currency || 'ARS',
		paymentStatus: order.paymentStatus || null,
		sentAt,
		convertedAt,
		matchReason,
		rawPayload: {
			orderInternalId: order.id,
			campaignAudienceSource: recipient.campaign?.audienceSource || null,
		},
	};
}

export async function markRecoveredCartsForOrder(order = {}) {
	if (!order?.workspaceId || !isPaidOrCompletedOrder(order)) {
		return { recovered: 0 };
	}

	const orderValues = getOrderMatchValues(order);
	const orderAt = getOrderConvertedAt(order);
	const candidateWhere = {
		workspaceId: order.workspaceId,
		storeId: order.storeId,
		status: { not: 'RECOVERED' },
		checkoutCreatedAt: { lte: orderAt },
	};

	const cartIdentityConditions = [
		orderValues.token ? { token: orderValues.token } : null,
		orderValues.phone ? { contactPhone: orderValues.phone } : null,
		order.contactEmail ? { contactEmail: { equals: order.contactEmail, mode: 'insensitive' } } : null,
	].filter(Boolean);

	const candidates = cartIdentityConditions.length
		? await prisma.abandonedCart.findMany({
				where: {
					...candidateWhere,
					OR: cartIdentityConditions,
				},
		  })
		: [];

	const nameCandidates = orderValues.name
		? await prisma.abandonedCart.findMany({
				where: candidateWhere,
		  })
		: [];

	const byId = new Map();
	for (const cart of [...candidates, ...nameCandidates]) {
		const cartToken = normalizeString(cart.token || '');
		const cartPhone = normalizePhone(cart.contactPhone || '');
		const cartEmail = normalizeLower(cart.contactEmail || '');
		const cartName = normalizeName(cart.contactName || '');
		const cartOrderRefs = getCartOrderRefs(cart);
		const matches =
			(cartOrderRefs.length && (cartOrderRefs.includes(orderValues.orderId) || cartOrderRefs.includes(orderValues.orderNumber))) ||
			(cartToken && orderValues.token && cartToken === orderValues.token) ||
			(cartPhone && orderValues.phone && cartPhone === orderValues.phone) ||
			(cartEmail && orderValues.email && cartEmail === orderValues.email) ||
			(cartName && orderValues.name && cartName === orderValues.name);

		if (matches) byId.set(cart.id, cart);
	}

	const ids = [...byId.keys()];
	if (!ids.length) return { recovered: 0 };

	const result = await prisma.abandonedCart.updateMany({
		where: {
			workspaceId: order.workspaceId,
			id: { in: ids },
		},
		data: {
			status: 'RECOVERED',
			recoveredAt: orderAt,
		},
	});

	return { recovered: result.count || 0 };
}

export async function attributeOrderConversions({ workspaceId = DEFAULT_WORKSPACE_ID, orderId, storeId = null } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const order = await getOrderById({ workspaceId: resolvedWorkspaceId, orderId, storeId });
	if (!order) return { conversions: 0, recoveredCarts: 0 };

	const recovered = await markRecoveredCartsForOrder(order);
	const recipients = await getCandidateRecipientsForOrder(order);
	if (!recipients.length) return { conversions: 0, recoveredCarts: recovered.recovered || 0 };

	const orderValues = getOrderMatchValues(order);
	const paidOrCompleted = isPaidOrCompletedOrder(order);
	const conversions = [];
	let latestMarketing = null;
	let latestMarketingReason = '';

	for (const recipient of recipients) {
		const audienceSource = normalizeLower(recipient.campaign?.audienceSource || '');

		if (paidOrCompleted && audienceSource === 'pending_payment') {
			const matchReason = pendingPaymentMatches(recipient, orderValues);
			if (matchReason) {
				conversions.push(buildOrderConversionPayload({
					source: 'PENDING_PAYMENT',
					confidence: 'HIGH',
					recipient,
					order,
					matchReason,
				}));
			}
			continue;
		}

		if (paidOrCompleted && audienceSource === 'abandoned_carts') {
			const cartMatch = await abandonedCartMatches(recipient, order, orderValues);
			if (cartMatch) {
				conversions.push(buildOrderConversionPayload({
					source: 'ABANDONED_CART',
					confidence: cartMatch.matchReason === 'abandoned_cart_token' ? 'HIGH' : 'MEDIUM',
					recipient,
					order,
					matchReason: cartMatch.matchReason,
					checkoutId: cartMatch.cart.checkoutId,
					cart: cartMatch.cart,
				}));
			}
			continue;
		}

		if (!['abandoned_carts', 'pending_payment'].includes(audienceSource)) {
			const matchReason = recipientMatchesOrderIdentity(recipient, orderValues);
			if (!matchReason) continue;

			const dispatchAt = getRecipientDispatchAt(recipient);
			if (!latestMarketing || new Date(dispatchAt || 0).getTime() > new Date(getRecipientDispatchAt(latestMarketing) || 0).getTime()) {
				latestMarketing = recipient;
				latestMarketingReason = `marketing_${matchReason}`;
			}
		}
	}

	if (latestMarketing) {
		conversions.push(buildOrderConversionPayload({
			source: 'MARKETING',
			confidence: latestMarketingReason === 'marketing_name_exact' ? 'LOW' : 'MEDIUM',
			recipient: latestMarketing,
			order,
			matchReason: latestMarketingReason,
		}));
	}

	let persisted = 0;
	for (const conversion of conversions) {
		await upsertConversion(conversion);
		persisted += 1;
	}

	return { conversions: persisted, recoveredCarts: recovered.recovered || 0 };
}

export async function attributeOrdersByIds({ workspaceId = DEFAULT_WORKSPACE_ID, orderIds = [], storeId = null } = {}) {
	let conversions = 0;
	let recoveredCarts = 0;
	for (const orderId of [...new Set(orderIds.map(normalizeString).filter(Boolean))]) {
		const result = await attributeOrderConversions({ workspaceId, orderId, storeId });
		conversions += result.conversions || 0;
		recoveredCarts += result.recoveredCarts || 0;
	}
	return { conversions, recoveredCarts };
}

export async function filterRecoverableAbandonedCarts(carts = [], workspaceId = DEFAULT_WORKSPACE_ID) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const output = [];

	for (const cart of carts) {
		const createdAt = cart.checkoutCreatedAt || cart.createdAt || null;
		const cartPhone = normalizePhone(cart.contactPhone || '');
		const cartEmail = normalizeLower(cart.contactEmail || '');
		const cartName = normalizeName(cart.contactName || '');
		const cartToken = normalizeString(cart.token || '');
		const cartOrderRefs = getCartOrderRefs(cart);

		const directOrder = cartOrderRefs.length
			? await prisma.customerOrder.findFirst({
					where: {
						workspaceId: resolvedWorkspaceId,
						storeId: cart.storeId || undefined,
						OR: [
							{ orderId: { in: cartOrderRefs } },
							{ orderNumber: { in: cartOrderRefs } },
						],
					},
					orderBy: [{ orderCreatedAt: 'desc' }, { updatedAt: 'desc' }],
			  })
			: null;

		const orderIdentityConditions = [
			cartToken ? { token: cartToken } : null,
			cartPhone ? { normalizedPhone: cartPhone } : null,
			cartEmail ? { normalizedEmail: cartEmail } : null,
		].filter(Boolean);

		const order = orderIdentityConditions.length
			? await prisma.customerOrder.findFirst({
					where: {
						workspaceId: resolvedWorkspaceId,
						storeId: cart.storeId || undefined,
						...(createdAt ? { orderCreatedAt: { gte: createdAt } } : {}),
						OR: orderIdentityConditions,
					},
					orderBy: [{ orderCreatedAt: 'desc' }, { updatedAt: 'desc' }],
			  })
			: null;

		let nameOrder = null;
		if (!order && cartName) {
			const candidates = await prisma.customerOrder.findMany({
				where: {
					workspaceId: resolvedWorkspaceId,
					storeId: cart.storeId || undefined,
					...(createdAt ? { orderCreatedAt: { gte: createdAt } } : {}),
				},
				orderBy: [{ orderCreatedAt: 'desc' }, { updatedAt: 'desc' }],
				take: 50,
			});
			nameOrder = candidates.find((candidate) => normalizeName(candidate.contactName || '') === cartName) || null;
		}

		const matchingOrder = directOrder || order || nameOrder;
		if (matchingOrder && isPaidOrCompletedOrder(matchingOrder)) {
			await prisma.abandonedCart.update({
				where: { id: cart.id },
				data: {
					status: 'RECOVERED',
					recoveredAt: getOrderConvertedAt(matchingOrder),
				},
			});
			continue;
		}

		output.push(cart);
	}

	return output;
}

export async function persistChatConfirmationConversions({
	workspaceId = DEFAULT_WORKSPACE_ID,
	conversationId,
	messageId = null,
	messageBody = '',
	contactName = '',
	phone = '',
	createdAt = new Date(),
} = {}) {
	if (!messageSuggestsCompletedPurchase(messageBody)) {
		return { conversions: 0 };
	}

	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const windowStart = subtractHours(createdAt, ATTRIBUTION_WINDOW_HOURS);
	const recipients = await prisma.campaignRecipient.findMany({
		where: {
			workspaceId: resolvedWorkspaceId,
			conversationId,
			status: { in: ['SENT', 'DELIVERED', 'READ'] },
			OR: [
				{ sentAt: { gte: windowStart, lte: createdAt } },
				{ deliveredAt: { gte: windowStart, lte: createdAt } },
				{ readAt: { gte: windowStart, lte: createdAt } },
			],
		},
		orderBy: [{ sentAt: 'desc' }, { deliveredAt: 'desc' }, { readAt: 'desc' }],
	});

	let persisted = 0;
	for (const recipient of recipients.slice(0, 3)) {
		await upsertConversion({
			workspaceId: resolvedWorkspaceId,
			campaignId: recipient.campaignId,
			recipientId: recipient.id,
			conversionKey: buildConversionKey({
				source: 'CHAT_CONFIRMATION',
				recipientId: recipient.id,
				messageId: messageId || `${conversationId}:${new Date(createdAt).toISOString()}`,
			}),
			source: 'CHAT_CONFIRMATION',
			confidence: 'LOW',
			contactName: contactName || recipient.contactName || null,
			phone: normalizePhone(phone || recipient.phone || recipient.waId || ''),
			sentAt: getRecipientDispatchAt(recipient),
			convertedAt: createdAt,
			matchReason: 'chat_confirmed_purchase',
			rawPayload: { messageBody },
		});
		persisted += 1;
	}

	return { conversions: persisted };
}

export async function getPersistedConversionInsights({ workspaceId = DEFAULT_WORKSPACE_ID, recipientIds = [] } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const ids = [...new Set(recipientIds.map(normalizeString).filter(Boolean))];

	if (!ids.length) {
		return {
			summary: {
				purchasedRecipients: 0,
				chatConfirmedPurchaseRecipients: 0,
				conversionSignalRecipients: 0,
				attributedRevenue: 0,
				attributedCurrency: 'ARS',
				conversionsBySource: {},
			},
			recipientsById: new Map(),
		};
	}

	const conversions = await prisma.campaignConversion.findMany({
		where: {
			workspaceId: resolvedWorkspaceId,
			recipientId: { in: ids },
		},
		orderBy: [{ convertedAt: 'asc' }],
	});

	const recipientsById = new Map();
	const realRecipients = new Set();
	const chatRecipients = new Set();
	const signalRecipients = new Set();
	const conversionsBySource = {};
	let attributedRevenue = 0;
	let attributedCurrency = 'ARS';

	for (const conversion of conversions) {
		conversionsBySource[conversion.source] = (conversionsBySource[conversion.source] || 0) + 1;
		if (conversion.currency) attributedCurrency = conversion.currency;

		if (conversion.recipientId) {
			signalRecipients.add(conversion.recipientId);
			if (conversion.source === 'CHAT_CONFIRMATION') {
				chatRecipients.add(conversion.recipientId);
			}
			if (REAL_CONVERSION_SOURCES.has(conversion.source)) {
				realRecipients.add(conversion.recipientId);
				attributedRevenue += toNumber(conversion.amount) || 0;
			}
		}

		const current = recipientsById.get(conversion.recipientId) || {};
		const isReal = REAL_CONVERSION_SOURCES.has(conversion.source);
		recipientsById.set(conversion.recipientId, {
			...current,
			conversionSignal: true,
			purchaseDetected: current.purchaseDetected || isReal,
			chatConfirmedPurchase: current.chatConfirmedPurchase || conversion.source === 'CHAT_CONFIRMATION',
			purchaseAt: isReal ? conversion.convertedAt : current.purchaseAt || null,
			purchaseOrderId: isReal ? conversion.orderId : current.purchaseOrderId || null,
			purchaseOrderNumber: isReal ? conversion.orderNumber : current.purchaseOrderNumber || null,
			purchasePaymentStatus: isReal ? conversion.paymentStatus : current.purchasePaymentStatus || null,
			purchaseTotalAmount: isReal ? conversion.amount : current.purchaseTotalAmount ?? null,
			purchaseCurrency: conversion.currency || current.purchaseCurrency || 'ARS',
			purchaseDetectionMode: isReal ? conversion.matchReason : current.purchaseDetectionMode || null,
			chatConfirmedPurchaseAt: conversion.source === 'CHAT_CONFIRMATION' ? conversion.convertedAt : current.chatConfirmedPurchaseAt || null,
		});
	}

	return {
		summary: {
			purchasedRecipients: realRecipients.size,
			chatConfirmedPurchaseRecipients: chatRecipients.size,
			conversionSignalRecipients: signalRecipients.size,
			attributedRevenue,
			attributedCurrency,
			conversionsBySource,
		},
		recipientsById,
	};
}
