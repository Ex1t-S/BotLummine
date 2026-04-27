import { prisma } from '../lib/prisma.js';
import {
	getCustomerSyncStatus as getCustomerSyncStatusService,
	syncCustomers as syncCustomersService,
} from '../services/customers/customer.service.js';

function normalizeText(value = '') {
	return String(value || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

function formatCurrency(value, currency = 'ARS') {
	const amount = Number(value || 0);
	try {
		return new Intl.NumberFormat('es-AR', {
			style: 'currency',
			currency: currency || 'ARS',
			maximumFractionDigits: 0,
		}).format(amount);
	} catch {
		return `$${amount.toLocaleString('es-AR')}`;
	}
}

function formatDateLabel(value) {
	if (!value) return '-';
	try {
		return new Intl.DateTimeFormat('es-AR', {
			dateStyle: 'short',
		}).format(new Date(value));
	} catch {
		return '-';
	}
}

function getInitials(name = '') {
	const words = String(name || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2);

	if (!words.length) return '?';
	return words.map((word) => word[0]?.toUpperCase() || '').join('');
}

function normalizeMarketingPhone(value = '') {
	return String(value || '').replace(/\D/g, '').trim();
}

function isDispatchedCampaignRecipient(recipient = {}) {
	const status = String(recipient.status || '').toUpperCase();
	return ['SENT', 'DELIVERED', 'READ'].includes(status) || Boolean(recipient.sentAt || recipient.deliveredAt || recipient.readAt);
}

async function buildMarketingHistoryByPhone({
	phones = [],
	templateId = '',
	templateName = '',
} = {}) {
	const normalizedPhones = [...new Set(
		phones.map(normalizeMarketingPhone).filter(Boolean)
	)];
	const cleanTemplateId = String(templateId || '').trim();
	const cleanTemplateName = String(templateName || '').trim();

	if (!normalizedPhones.length || (!cleanTemplateId && !cleanTemplateName)) {
		return new Map();
	}
	const phoneChunks = [];
	for (let index = 0; index < normalizedPhones.length; index += 4000) {
		phoneChunks.push(normalizedPhones.slice(index, index + 4000));
	}

	const campaignClauses = [];
	if (cleanTemplateId) {
		campaignClauses.push({ templateLocalId: cleanTemplateId });
	}
	if (cleanTemplateName) {
		campaignClauses.push({ templateName: cleanTemplateName });
	}

	const historyByPhone = new Map();

	for (const phoneChunk of phoneChunks) {
		const rows = await prisma.campaignRecipient.findMany({
			where: {
				AND: [
					{
						OR: [
							{ phone: { in: phoneChunk } },
							{ waId: { in: phoneChunk } },
						],
					},
					{
						OR: [
							{ status: { in: ['SENT', 'DELIVERED', 'READ'] } },
							{ sentAt: { not: null } },
							{ deliveredAt: { not: null } },
							{ readAt: { not: null } },
						],
					},
					{
						campaign: {
							is: campaignClauses.length === 1
								? campaignClauses[0]
								: { OR: campaignClauses },
						},
					},
				],
			},
			orderBy: [
				{ sentAt: 'desc' },
				{ createdAt: 'desc' },
			],
			select: {
				phone: true,
				waId: true,
				status: true,
				sentAt: true,
				deliveredAt: true,
				readAt: true,
				createdAt: true,
				campaign: {
					select: {
						id: true,
						name: true,
						templateLocalId: true,
						templateName: true,
					},
				},
			},
		});

		for (const row of rows) {
			if (!isDispatchedCampaignRecipient(row)) continue;

			const keys = [
				normalizeMarketingPhone(row.phone || ''),
				normalizeMarketingPhone(row.waId || ''),
			].filter(Boolean);

			for (const key of keys) {
				if (historyByPhone.has(key)) continue;

				historyByPhone.set(key, {
					sentForTemplate: true,
					lastCampaignId: row.campaign?.id || null,
					lastCampaignName: row.campaign?.name || '',
					templateName: row.campaign?.templateName || cleanTemplateName,
					status: row.status || '',
					lastSentAt: row.readAt || row.deliveredAt || row.sentAt || row.createdAt || null,
				});
			}
		}
	}

	return historyByPhone;
}

function buildProductTerms(productQuery = '') {
	return String(productQuery || '')
		.split('||')
		.map((item) => item.trim())
		.filter(Boolean);
}

function buildPaymentStatusVariants(paymentStatus = '') {
	const raw = String(paymentStatus || '').trim().toLowerCase();

	if (!raw || raw === 'all') return [];

	const map = {
		pending: ['pending', 'pending_confirmation', 'pago pendiente', 'pago en espera', 'unpaid'],
		authorized: ['authorized', 'pago autorizado'],
		paid: ['paid', 'pago aprobado'],
		partially_paid: ['partially_paid', 'pago parcialmente aprobado'],
		abandoned: ['abandoned', 'pago abandonado'],
		refunded: ['refunded', 'pago reembolsado'],
		partially_refunded: ['partially_refunded', 'pago parcialmente reembolsado'],
		voided: ['voided', 'pago anulado'],
		cancelled: ['cancelled', 'pago cancelado'],
	};

	return map[raw] || [raw];
}

function getPaymentStatusMeta(paymentStatus = '') {
	const raw = String(paymentStatus || '').trim().toLowerCase();

	const map = {
		pending: { label: 'Pendiente', tone: 'warning' },
		pending_confirmation: { label: 'Pendiente', tone: 'warning' },
		authorized: { label: 'Autorizado', tone: 'info' },
		paid: { label: 'Pagado', tone: 'success' },
		partially_paid: { label: 'Parcialmente pagado', tone: 'info' },
		abandoned: { label: 'Abandonado', tone: 'danger' },
		refunded: { label: 'Reembolsado', tone: 'neutral' },
		partially_refunded: { label: 'Parcialmente reembolsado', tone: 'neutral' },
		voided: { label: 'Anulado', tone: 'neutral' },
		cancelled: { label: 'Cancelado', tone: 'danger' },
	};

	return map[raw] || { label: raw ? raw.replace(/_/g, ' ') : 'Sin dato', tone: 'neutral' };
}

function buildCustomersWhere({
	q,
	productQuery,
	orderNumber,
	dateFrom,
	dateTo,
	paymentStatus,
	minSpent,
	hasPhoneOnly,
}) {
	const and = [];

	const search = String(q || '').trim();
	if (search) {
		and.push({
			OR: [
				{ contactName: { contains: search, mode: 'insensitive' } },
				{ contactEmail: { contains: search, mode: 'insensitive' } },
				{ contactPhone: { contains: search, mode: 'insensitive' } },
				{ orderNumber: { contains: search, mode: 'insensitive' } },
				{
					items: {
						some: {
							OR: [
								{ name: { contains: search, mode: 'insensitive' } },
								{ normalizedName: { contains: normalizeText(search) } },
								{ sku: { contains: search, mode: 'insensitive' } },
								{ variantName: { contains: search, mode: 'insensitive' } },
							],
						},
					},
				},
			],
		});
	}

	const productTerms = buildProductTerms(productQuery);
	if (productTerms.length > 0) {
		and.push({
			items: {
				some: {
					OR: productTerms.flatMap((term) => {
						const normalized = normalizeText(term);
						return [
							{ name: { contains: term, mode: 'insensitive' } },
							{ normalizedName: { contains: normalized } },
							{ variantName: { contains: term, mode: 'insensitive' } },
							{ sku: { contains: term, mode: 'insensitive' } },
						];
					}),
				},
			},
		});
	}

	const orderNumberValue = String(orderNumber || '').trim();
	if (orderNumberValue) {
		and.push({
			orderNumber: { contains: orderNumberValue, mode: 'insensitive' },
		});
	}

	if (dateFrom || dateTo) {
		const createdAt = {};
		if (dateFrom) {
			const from = new Date(dateFrom);
			if (!Number.isNaN(from.getTime())) createdAt.gte = from;
		}
		if (dateTo) {
			const to = new Date(dateTo);
			if (!Number.isNaN(to.getTime())) {
				to.setHours(23, 59, 59, 999);
				createdAt.lte = to;
			}
		}
		if (Object.keys(createdAt).length > 0) {
			and.push({ orderCreatedAt: createdAt });
		}
	}

	const paymentStatusVariants = buildPaymentStatusVariants(paymentStatus);
	if (paymentStatusVariants.length > 0) {
		and.push({
			OR: paymentStatusVariants.map((value) => ({
				paymentStatus: { equals: value, mode: 'insensitive' },
			})),
		});
	}

	if (minSpent !== undefined && minSpent !== null && String(minSpent).trim() !== '') {
		const parsed = Number(minSpent);
		if (!Number.isNaN(parsed) && parsed > 0) {
			and.push({
				totalAmount: { gte: parsed },
			});
		}
	}

	if (hasPhoneOnly === '1' || hasPhoneOnly === 'true' || hasPhoneOnly === true) {
		and.push({
			contactPhone: {
				not: '',
			},
		});
		and.push({
			NOT: {
				contactPhone: null,
			},
		});
	}

	return and.length ? { AND: and } : {};
}

function buildOrderBy(sort = 'purchase_desc') {
	switch (String(sort || 'purchase_desc')) {
		case 'purchase_asc':
		case 'recent_asc':
			return [{ orderCreatedAt: 'asc' }, { id: 'asc' }];
		case 'spent_desc':
		case 'total_desc':
			return [{ totalAmount: 'desc' }, { orderCreatedAt: 'desc' }];
		case 'spent_asc':
		case 'total_asc':
			return [{ totalAmount: 'asc' }, { orderCreatedAt: 'desc' }];
		case 'name_asc':
			return [{ contactName: 'asc' }, { orderCreatedAt: 'desc' }];
		case 'name_desc':
			return [{ contactName: 'desc' }, { orderCreatedAt: 'desc' }];
		case 'order_desc':
			return [{ orderNumber: 'desc' }];
		case 'order_asc':
			return [{ orderNumber: 'asc' }];
		case 'purchase_desc':
		case 'recent_desc':
		default:
			return [{ orderCreatedAt: 'desc' }, { id: 'desc' }];
	}
}

function mapOrderToCard(order) {
	const items = Array.isArray(order.items) ? order.items : [];
	const totalUnitsPurchased = items.reduce(
		(acc, item) => acc + Number(item.quantity || 0),
		0
	);

	const productNames = [];
	const seen = new Set();

	for (const item of items) {
		const base = item.name || item.normalizedName || 'Producto';
		const label = item.variantName ? `${base} (${item.variantName})` : base;
		if (!seen.has(label)) {
			seen.add(label);
			productNames.push(label);
		}
	}

	const paymentMeta = getPaymentStatusMeta(order.paymentStatus);

	return {
		id: order.id,
		displayName: order.contactName || 'Cliente sin nombre',
		initials: getInitials(order.contactName),
		phone: order.contactPhone || '',
		email: order.contactEmail || '',

		lastOrderId: order.orderId || '',
		lastOrderNumber: order.orderNumber || '',

		lastOrderLabel: order.orderNumber ? `#${order.orderNumber}` : '-',
		totalSpentLabel: formatCurrency(order.totalAmount || 0, order.currency || 'ARS'),
		lastOrderDateLabel: formatDateLabel(order.orderCreatedAt),
		totalUnitsPurchased,
		productsPreview: productNames.slice(0, 6),
		updatedAt: order.orderUpdatedAt || order.updatedAt || order.orderCreatedAt || null,
		paymentStatus: order.paymentStatus || '',
		paymentStatusLabel: paymentMeta.label,
		paymentStatusTone: paymentMeta.tone,
		orderNumber: order.orderNumber || '',
		rawTotal: Number(order.totalAmount || 0),
		rawDate: order.orderCreatedAt || null,
	};
}


export async function getCustomers(req, res) {
	try {
		const {
			q = '',
			productQuery = '',
			orderNumber = '',
			dateFrom = '',
			dateTo = '',
			paymentStatus = '',
			minSpent = '',
			hasPhoneOnly = '',
			marketingTemplateId = '',
			marketingTemplateName = '',
			sort = 'purchase_desc',
			page = '1',
			pageSize = '24',
		} = req.query;

		const parsedPage = Math.max(1, Number(page) || 1);
		const parsedPageSize = Math.min(100, Math.max(1, Number(pageSize) || 24));
		const skip = (parsedPage - 1) * parsedPageSize;

		const where = buildCustomersWhere({
			q,
			productQuery,
			orderNumber,
			dateFrom,
			dateTo,
			paymentStatus,
			minSpent,
			hasPhoneOnly,
		});

		const orderBy = buildOrderBy(sort);

		const [totalItems, orders, metricsBase] = await Promise.all([
			prisma.customerOrder.count({ where }),
			prisma.customerOrder.findMany({
				where,
				orderBy,
				skip,
				take: parsedPageSize,
				include: {
					items: {
						orderBy: [{ lineTotal: 'desc' }, { quantity: 'desc' }, { name: 'asc' }],
					},
				},
			}),
			prisma.customerOrder.findMany({
				where,
				select: {
					totalAmount: true,
					contactPhone: true,
					contactEmail: true,
					contactName: true,
				},
			}),
		]);

		const uniquePhones = new Set();
		const uniqueFallback = new Set();

		for (const row of metricsBase) {
			const phone = String(row.contactPhone || '').trim();
			if (phone) {
				uniquePhones.add(phone);
			} else {
				uniqueFallback.add(
					`${String(row.contactEmail || '').trim().toLowerCase()}::${String(
						row.contactName || ''
					)
						.trim()
						.toLowerCase()}`
				);
			}
		}

		const totalSpent = metricsBase.reduce(
			(acc, row) => acc + Number(row.totalAmount || 0),
			0
		);
		const marketingHistoryByPhone = await buildMarketingHistoryByPhone({
			phones: metricsBase.map((row) => row.contactPhone || ''),
			templateId: marketingTemplateId,
			templateName: marketingTemplateName,
		});
		const customers = orders.map((order) => {
			const card = mapOrderToCard(order);
			const phoneKey = normalizeMarketingPhone(card.phone || '');
			const marketing = marketingHistoryByPhone.get(phoneKey) || null;

			return {
				...card,
				marketing: marketing || {
					sentForTemplate: false,
					lastCampaignId: null,
					lastCampaignName: '',
					templateName: marketingTemplateName || '',
					status: '',
					lastSentAt: null,
				},
			};
		});

		const showingFrom = totalItems > 0 ? skip + 1 : 0;
		const showingTo = Math.min(skip + parsedPageSize, totalItems);
		const advertisedPhonesCount = [...uniquePhones].filter((phone) =>
			marketingHistoryByPhone.has(normalizeMarketingPhone(phone))
		).length;

		return res.json({
			ok: true,
			customers,
			stats: {
				totalOrders: totalItems,
				totalCustomers: uniquePhones.size + uniqueFallback.size,
				withPhone: metricsBase.filter((row) => String(row.contactPhone || '').trim()).length,
				totalSpent,
				avgTicket: totalItems > 0 ? totalSpent / totalItems : 0,
				currency: 'ARS',
				showingFrom,
				showingTo,
				marketing: {
					templateId: marketingTemplateId || null,
					templateName: marketingTemplateName || null,
					advertisedCustomers: advertisedPhonesCount,
					notAdvertisedCustomers: Math.max(0, uniquePhones.size - advertisedPhonesCount),
				},
			},
			pagination: {
				page: parsedPage,
				pageSize: parsedPageSize,
				totalItems,
				totalPages: Math.max(1, Math.ceil(totalItems / parsedPageSize)),
			},
		});
	} catch (error) {
		console.error('[CUSTOMERS][GET] error:', error);
		return res.status(500).json({
			ok: false,
			message: 'No se pudo cargar el listado comercial.',
			detail: error?.message || 'Error interno',
		});
	}
}

export async function postSyncCustomers(req, res) {
	try {
		const result = await syncCustomersService({
			force: req.body?.force === true,
		});

		return res.json({
			ok: true,
			...result,
		});
	} catch (error) {
		console.error('[CUSTOMERS][SYNC] error:', error);
		return res.status(500).json({
			ok: false,
			message: 'No se pudo iniciar la sincronización.',
			detail: error?.message || 'Error interno',
		});
	}
}

export async function getCustomersSyncStatus(req, res) {
	try {
		const status = getCustomerSyncStatusService();
		return res.json({
			ok: true,
			...status,
		});
	} catch (error) {
		console.error('[CUSTOMERS][SYNC_STATUS] error:', error);
		return res.status(500).json({
			ok: false,
			message: 'No se pudo obtener el estado de sincronización.',
			detail: error?.message || 'Error interno',
		});
	}
}

export async function postFullSyncCustomers(req, res) {
	return postSyncCustomers(req, res);
}

export async function postRepairCustomers(req, res) {
	return res.json({
		ok: true,
		message: 'Repair deshabilitado en esta versión.',
	});
}
