import { prisma } from '../lib/prisma.js';
import { syncCustomers } from '../services/customer.service.js';

function ensureCustomerModels() {
	if (!prisma?.customerProfile || !prisma?.customerOrder || !prisma?.customerOrderItem) {
		throw new Error(
			'Los modelos de clientes no están disponibles en Prisma Client. Ejecutá prisma generate y revisá la migración.'
		);
	}
}

function toPositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
	const parsed = Number.parseInt(String(value ?? ''), 10);

	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

	return Math.min(max, Math.max(min, parsed));
}

function toNumberOrNull(value) {
	if (value === '' || value === null || value === undefined) return null;

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBoolean(value) {
	return ['1', 'true', 'yes', 'si', 'on'].includes(
		String(value || '').trim().toLowerCase()
	);
}

function normalizeSearch(value = '') {
	return String(value || '').trim();
}

function normalizeProductSearch(value = '') {
	return String(value || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/gi, ' ')
		.trim();
}

function normalizeStatus(value = '') {
	return String(value || '').trim().toLowerCase() || null;
}

function parseDateQuery(value) {
	if (!value) return null;

	const raw = String(value).trim();
	if (!raw) return null;

	const hasTime = raw.includes('T');
	const date = new Date(hasTime ? raw : `${raw}T00:00:00`);

	return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDay(date) {
	if (!date) return null;

	const copy = new Date(date);
	copy.setHours(23, 59, 59, 999);
	return copy;
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

function formatDate(value) {
	if (!value) return null;

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;

	return new Intl.DateTimeFormat('es-AR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	}).format(date);
}

function getInitials(value = '') {
	return (
		String(value || '')
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part.charAt(0).toUpperCase())
			.join('') || '?'
	);
}

function buildOrderBy(sort = 'last_purchase_desc') {
	switch (sort) {
		case 'name_asc':
			return [
				{ displayName: 'asc' },
				{ email: 'asc' },
				{ createdAt: 'desc' },
			];

		case 'name_desc':
			return [
				{ displayName: 'desc' },
				{ email: 'desc' },
				{ createdAt: 'desc' },
			];

		case 'spent_desc':
			return [
				{ totalSpent: 'desc' },
				{ lastOrderAt: 'desc' },
			];

		case 'spent_asc':
			return [
				{ totalSpent: 'asc' },
				{ lastOrderAt: 'desc' },
			];

		case 'orders_desc':
			return [
				{ orderCount: 'desc' },
				{ totalSpent: 'desc' },
				{ lastOrderAt: 'desc' },
			];

		case 'orders_asc':
			return [
				{ orderCount: 'asc' },
				{ lastOrderAt: 'desc' },
			];

		case 'first_purchase_asc':
			return [
				{ firstOrderAt: 'asc' },
				{ lastOrderAt: 'desc' },
			];

		case 'first_purchase_desc':
			return [
				{ firstOrderAt: 'desc' },
				{ lastOrderAt: 'desc' },
			];

		case 'last_purchase_asc':
			return [{ lastOrderAt: 'asc' }];

		case 'last_purchase_desc':
		default:
			return [{ lastOrderAt: 'desc' }, { updatedAt: 'desc' }];
	}
}

function formatProductSummaryEntry(product) {
	if (!product) return null;

	if (typeof product === 'string') return product;

	const name = product.name || product.productName || product.title || product.label;
	if (!name) return null;

	const variants = Array.isArray(product.variants) ? product.variants.filter(Boolean) : [];
	const quantity = Number(product.totalQuantity || product.quantity || 0);

	const suffix = [];
	if (variants.length) suffix.push(variants.join(' / '));
	if (quantity > 0) suffix.push(`x${quantity}`);

	return [name, suffix.length ? `(${suffix.join(' · ')})` : '']
		.filter(Boolean)
		.join(' ')
		.trim();
}

function formatOrderItemLabel(item) {
	if (!item) return null;

	const name = item.name || 'Producto';
	const variant = item.variantName ? ` · ${item.variantName}` : '';
	const quantity = Number(item.quantity || 0);
	const qty = quantity > 0 ? ` x${quantity}` : '';

	return `${name}${variant}${qty}`.trim();
}

function resolveOrderCount(customer) {
	const rawOrderCount = Number(customer?.orderCount || 0);

	if (rawOrderCount > 0) return rawOrderCount;
	if (customer?.lastOrderId) return 1;

	return 0;
}

function resolveDistinctProductsCount(customer) {
	const rawDistinctProductsCount = Number(customer?.distinctProductsCount || 0);

	if (rawDistinctProductsCount > 0) return rawDistinctProductsCount;

	if (Array.isArray(customer?.productSummary) && customer.productSummary.length > 0) {
		return customer.productSummary.length;
	}

	if (customer?.lastOrderId) return 1;

	return 0;
}

function buildCustomersWhere({
	q = '',
	productQuery = '',
	orderNumber = '',
	minSpent = null,
	minOrders = null,
	hasPhoneOnly = false,
	hasOrders = false,
	dateFrom = null,
	dateTo = null,
	paymentStatus = null,
	shippingStatus = null,
}) {
	const and = [];

	if (q) {
		and.push({
			OR: [
				{ displayName: { contains: q, mode: 'insensitive' } },
				{ email: { contains: q, mode: 'insensitive' } },
				{ phone: { contains: q, mode: 'insensitive' } },
				{ normalizedPhone: { contains: q, mode: 'insensitive' } },
				{ normalizedEmail: { contains: q, mode: 'insensitive' } },
				{ identification: { contains: q, mode: 'insensitive' } },
				{ lastOrderNumber: { contains: q, mode: 'insensitive' } },
				{
					orders: {
						some: {
							OR: [
								{ orderNumber: { contains: q, mode: 'insensitive' } },
								{ contactEmail: { contains: q, mode: 'insensitive' } },
								{ contactPhone: { contains: q, mode: 'insensitive' } },
							],
						},
					},
				},
			],
		});
	}

	if (orderNumber) {
		and.push({
			OR: [
				{ lastOrderNumber: { contains: orderNumber, mode: 'insensitive' } },
				{
					orders: {
						some: {
							orderNumber: { contains: orderNumber, mode: 'insensitive' },
						},
					},
				},
			],
		});
	}

	if (productQuery) {
		and.push({
			orderItems: {
				some: {
					normalizedName: {
						contains: productQuery,
						mode: 'insensitive',
					},
				},
			},
		});
	}

	if (minSpent !== null && minSpent > 0) {
		and.push({
			totalSpent: {
				gte: minSpent,
			},
		});
	}

	if (minOrders !== null && minOrders > 0) {
		if (minOrders <= 1) {
			and.push({
				OR: [
					{ orderCount: { gte: 1 } },
					{ lastOrderId: { not: null } },
				],
			});
		} else {
			and.push({
				orderCount: {
					gte: minOrders,
				},
			});
		}
	}

	if (hasPhoneOnly) {
		and.push({
			OR: [
				{ phone: { not: null } },
				{ normalizedPhone: { not: null } },
			],
		});
	}

	if (hasOrders) {
		and.push({
			OR: [
				{ orderCount: { gt: 0 } },
				{ lastOrderId: { not: null } },
			],
		});
	}

	if (dateFrom || dateTo || paymentStatus || shippingStatus) {
		const orderFilter = {};

		if (dateFrom || dateTo) {
			orderFilter.orderCreatedAt = {};
			if (dateFrom) orderFilter.orderCreatedAt.gte = dateFrom;
			if (dateTo) orderFilter.orderCreatedAt.lte = dateTo;
		}

		if (paymentStatus && paymentStatus !== 'all') {
			orderFilter.paymentStatus = paymentStatus;
		}

		if (shippingStatus && shippingStatus !== 'all') {
			orderFilter.shippingStatus = shippingStatus;
		}

		and.push({
			orders: {
				some: orderFilter,
			},
		});
	}

	return and.length ? { AND: and } : {};
}

function buildOrderSummary(latestOrder) {
	if (!latestOrder) {
		return {
			lastOrderId: null,
			lastOrderNumber: null,
			lastOrderLabel: '-',
			lastOrderDateLabel: '-',
			lastOrderAt: null,
			lastOrderStatusLabel: '-',
			lastOrderProductsPreview: [],
		};
	}

	const statusParts = [latestOrder.paymentStatus, latestOrder.shippingStatus].filter(Boolean);

	return {
		lastOrderId: latestOrder.orderId || null,
		lastOrderNumber: latestOrder.orderNumber || null,
		lastOrderLabel: latestOrder.orderNumber ? `#${latestOrder.orderNumber}` : '-',
		lastOrderDateLabel: formatDate(latestOrder.orderCreatedAt) || '-',
		lastOrderAt: latestOrder.orderCreatedAt || null,
		lastOrderStatusLabel: statusParts.length ? statusParts.join(' · ') : '-',
		lastOrderProductsPreview: Array.isArray(latestOrder.items)
			? latestOrder.items.map(formatOrderItemLabel).filter(Boolean).slice(0, 4)
			: [],
	};
}

function serializeCustomer(customer) {
	const resolvedPhone = customer.phone || customer.normalizedPhone || null;
	const productSummary = Array.isArray(customer.productSummary) ? customer.productSummary : [];
	const topProductsPreview = productSummary
		.map(formatProductSummaryEntry)
		.filter(Boolean)
		.slice(0, 4);

	const latestOrder = Array.isArray(customer.orders) ? customer.orders[0] : null;
	const lastOrder = buildOrderSummary(latestOrder);

	const resolvedOrderCount = resolveOrderCount(customer);
	const resolvedDistinctProductsCount = resolveDistinctProductsCount({
		...customer,
		productSummary,
	});

	return {
		id: customer.id,
		displayName: customer.displayName || null,
		email: customer.email || null,
		phone: resolvedPhone,
		hasPhone: Boolean(resolvedPhone),
		orderCount: resolvedOrderCount,
		paidOrderCount: Number(customer.paidOrderCount || 0),
		distinctProductsCount: resolvedDistinctProductsCount,
		totalUnitsPurchased: Number(customer.totalUnitsPurchased || 0),
		totalSpent: Number(customer.totalSpent || 0),
		totalSpentLabel: formatCurrency(customer.totalSpent || 0, customer.currency || 'ARS'),
		currency: customer.currency || 'ARS',
		firstOrderAt: customer.firstOrderAt || null,
		firstOrderDateLabel: formatDate(customer.firstOrderAt) || '-',
		lastOrderAt: lastOrder.lastOrderAt || customer.lastOrderAt || null,
		lastOrderDateLabel:
			lastOrder.lastOrderDateLabel !== '-'
				? lastOrder.lastOrderDateLabel
				: formatDate(customer.lastOrderAt) || '-',
		lastOrderId: lastOrder.lastOrderId || customer.lastOrderId || null,
		lastOrderNumber: lastOrder.lastOrderNumber || customer.lastOrderNumber || null,
		lastOrderLabel:
			lastOrder.lastOrderLabel !== '-'
				? lastOrder.lastOrderLabel
				: customer.lastOrderNumber
					? `#${customer.lastOrderNumber}`
					: customer.lastOrderId
						? `ID ${customer.lastOrderId}`
						: '-',
		lastOrderStatusLabel:
			lastOrder.lastOrderStatusLabel !== '-'
				? lastOrder.lastOrderStatusLabel
				: [customer.lastPaymentStatus, customer.lastShippingStatus].filter(Boolean).join(' · ') || '-',
		topProductsPreview,
		lastOrderProductsPreview: lastOrder.lastOrderProductsPreview,
		initials: getInitials(customer.displayName || customer.email || resolvedPhone || '?'),
		updatedAt: customer.updatedAt,
		updatedAtLabel: formatDate(customer.updatedAt),
	};
}

export async function getCustomers(req, res, next) {
	try {
		ensureCustomerModels();

		const q = normalizeSearch(req.query?.q);
		const productQuery = normalizeProductSearch(req.query?.productQuery);
		const orderNumber = normalizeSearch(req.query?.orderNumber);
		const page = toPositiveInt(req.query?.page, 1);
		const pageSize = toPositiveInt(req.query?.pageSize, 24, { min: 1, max: 100 });
		const skip = (page - 1) * pageSize;
		const sort = normalizeSearch(req.query?.sort) || 'last_purchase_desc';
		const minSpent = toNumberOrNull(req.query?.minSpent);
		const minOrders = toNumberOrNull(req.query?.minOrders);
		const hasPhoneOnly = normalizeBoolean(req.query?.hasPhoneOnly);
		const hasOrders = normalizeBoolean(req.query?.hasOrders);
		const dateFrom = parseDateQuery(req.query?.dateFrom);
		const dateTo = endOfDay(parseDateQuery(req.query?.dateTo));
		const paymentStatus = normalizeStatus(req.query?.paymentStatus);
		const shippingStatus = normalizeStatus(req.query?.shippingStatus);

		const where = buildCustomersWhere({
			q,
			productQuery,
			orderNumber,
			minSpent,
			minOrders,
			hasPhoneOnly,
			hasOrders,
			dateFrom,
			dateTo,
			paymentStatus,
			shippingStatus,
		});

		const select = {
			id: true,
			displayName: true,
			email: true,
			phone: true,
			normalizedPhone: true,
			totalSpent: true,
			currency: true,
			orderCount: true,
			paidOrderCount: true,
			distinctProductsCount: true,
			totalUnitsPurchased: true,
			firstOrderAt: true,
			lastOrderAt: true,
			lastOrderId: true,
			lastOrderNumber: true,
			lastPaymentStatus: true,
			lastShippingStatus: true,
			productSummary: true,
			updatedAt: true,
			orders: {
				take: 1,
				orderBy: [
					{ orderCreatedAt: 'desc' },
					{ updatedAt: 'desc' },
				],
				select: {
					orderId: true,
					orderNumber: true,
					orderCreatedAt: true,
					paymentStatus: true,
					shippingStatus: true,
					items: {
						take: 5,
						orderBy: [
							{ quantity: 'desc' },
							{ name: 'asc' },
						],
						select: {
							name: true,
							variantName: true,
							quantity: true,
						},
					},
				},
			},
		};

		const [
			totalCustomers,
			repeatBuyers,
			withLastOrder,
			withOrders,
			agg,
			customers,
		] = await Promise.all([
			prisma.customerProfile.count({ where }),
			prisma.customerProfile.count({
				where: {
					...where,
					orderCount: { gt: 1 },
				},
			}),
			prisma.customerProfile.count({
				where: {
					...where,
					lastOrderId: { not: null },
				},
			}),
			prisma.customerProfile.count({
				where: {
					...where,
					OR: [
						{ orderCount: { gt: 0 } },
						{ lastOrderId: { not: null } },
					],
				},
			}),
			prisma.customerProfile.aggregate({
				where,
				_sum: {
					totalSpent: true,
					orderCount: true,
					paidOrderCount: true,
				},
			}),
			prisma.customerProfile.findMany({
				where,
				orderBy: buildOrderBy(sort),
				skip,
				take: pageSize,
				select,
			}),
		]);

		const totalPages = Math.max(1, Math.ceil(totalCustomers / pageSize));
		const showingFrom = totalCustomers === 0 ? 0 : skip + 1;
		const showingTo = Math.min(skip + customers.length, totalCustomers);

		const serializedCustomers = customers.map(serializeCustomer);

		return res.json({
			customers: serializedCustomers,
			stats: {
				totalCustomers,
				repeatBuyers,
				withLastOrder,
				withOrders,
				totalOrders: Number(agg?._sum?.orderCount || 0),
				paidOrders: Number(agg?._sum?.paidOrderCount || 0),
				totalSpent: Number(agg?._sum?.totalSpent || 0),
				currency: customers[0]?.currency || 'ARS',
				showingFrom,
				showingTo,
			},
			pagination: {
				page,
				pageSize,
				totalPages,
				totalItems: totalCustomers,
			},
			filters: {
				q,
				productQuery: normalizeSearch(req.query?.productQuery),
				orderNumber,
				sort,
				minSpent,
				minOrders,
				hasPhoneOnly,
				hasOrders,
				dateFrom: req.query?.dateFrom || '',
				dateTo: req.query?.dateTo || '',
				paymentStatus: paymentStatus || '',
				shippingStatus: shippingStatus || '',
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function postSyncCustomers(req, res) {
	try {
		ensureCustomerModels();

		const q = normalizeSearch(req.body?.q || '');
		const dateFrom = normalizeSearch(req.body?.dateFrom || '');
		const dateTo = normalizeSearch(req.body?.dateTo || '');
		const result = await syncCustomers({ q, dateFrom, dateTo });

		return res.json(result);
	} catch (error) {
		console.error('[CUSTOMERS SYNC ERROR]', error);

		const message = error?.message || 'Error sincronizando clientes';
		const status = message.includes('Ya hay una sincronización de clientes en curso') ? 409 : 500;

		return res.status(status).json({
			message,
		});
	}
}

export async function postRepairCustomers(_req, res) {
	return res.status(501).json({
		ok: false,
		message:
			'La reparación automática de perfiles duplicados no está implementada todavía en esta versión.',
	});
}
