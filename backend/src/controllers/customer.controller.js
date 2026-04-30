import { prisma } from '../lib/prisma.js';
import {
	getCustomerSyncStatus as getCustomerSyncStatusService,
	syncCustomers as syncCustomersService,
} from '../services/customers/customer.service.js';
import { requireRequestWorkspaceId } from '../services/workspaces/workspace-context.service.js';

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
	workspaceId,
	q,
	productQuery,
	orderNumber,
	dateFrom,
	dateTo,
	paymentStatus,
	minSpent,
	hasPhoneOnly,
	excludedPhones = [],
}) {
	const and = [{ workspaceId }];

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

	if (excludedPhones.length > 0) {
		and.push({
			OR: [
				{ normalizedPhone: null },
				{ normalizedPhone: '' },
				{
					normalizedPhone: {
						notIn: excludedPhones,
					},
				},
			],
		});
	}

	return and.length ? { AND: and } : {};
}

function normalizePhone(value = '') {
	return String(value || '').replace(/\D/g, '').trim();
}

async function getPhonesWithSentTemplate({
	workspaceId,
	templateName,
	excludeSentTemplate,
}) {
	const normalizedTemplateName = String(templateName || '').trim();
	const shouldExclude =
		excludeSentTemplate === '1' ||
		excludeSentTemplate === 'true' ||
		excludeSentTemplate === true;

	if (!shouldExclude || !normalizedTemplateName) {
		return [];
	}

	const recipients = await prisma.campaignRecipient.findMany({
		where: {
			workspaceId,
			phone: {
				not: '',
			},
			OR: [
				{ sentAt: { not: null } },
				{ deliveredAt: { not: null } },
				{ readAt: { not: null } },
				{ status: { in: ['SENT', 'DELIVERED', 'READ'] } },
			],
			campaign: {
				templateName: {
					equals: normalizedTemplateName,
					mode: 'insensitive',
				},
			},
		},
		select: {
			phone: true,
			waId: true,
		},
	});

	return Array.from(
		new Set(
			recipients
				.flatMap((recipient) => [recipient.phone, recipient.waId])
				.map(normalizePhone)
				.filter(Boolean)
		)
	);
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
			excludeSentTemplate = '',
			sentTemplateName = '',
			sort = 'purchase_desc',
			page = '1',
			pageSize = '24',
		} = req.query;

		const parsedPage = Math.max(1, Number(page) || 1);
		const parsedPageSize = Math.min(100, Math.max(1, Number(pageSize) || 24));
		const skip = (parsedPage - 1) * parsedPageSize;
		const workspaceId = requireRequestWorkspaceId(req);
		const excludedPhones = await getPhonesWithSentTemplate({
			workspaceId,
			templateName: sentTemplateName,
			excludeSentTemplate,
		});

		const where = buildCustomersWhere({
			workspaceId,
			q,
			productQuery,
			orderNumber,
			dateFrom,
			dateTo,
			paymentStatus,
			minSpent,
			hasPhoneOnly,
			excludedPhones,
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

		const customers = orders.map(mapOrderToCard);

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

		const showingFrom = totalItems > 0 ? skip + 1 : 0;
		const showingTo = Math.min(skip + parsedPageSize, totalItems);

		return res.json({
			ok: true,
			customers,
			stats: {
				totalOrders: totalItems,
				totalCustomers: uniquePhones.size + uniqueFallback.size,
				withPhone: metricsBase.filter((row) => String(row.contactPhone || '').trim()).length,
				excludedByTemplate: excludedPhones.length,
				totalSpent,
				avgTicket: totalItems > 0 ? totalSpent / totalItems : 0,
				currency: 'ARS',
				showingFrom,
				showingTo,
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
			workspaceId: requireRequestWorkspaceId(req),
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
