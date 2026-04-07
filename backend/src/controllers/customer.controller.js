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
	return ['1', 'true', 'yes', 'si', 'on'].includes(String(value || '').trim().toLowerCase());
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

function parseDateQuery(value, endOfDay = false) {
	if (!value) return null;
	const raw = String(value).trim();
	if (!raw) return null;
	const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
	const date = new Date(`${raw}${suffix}`);
	return Number.isNaN(date.getTime()) ? null : date;
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

function buildOrderBy(sort = 'date_desc') {
	switch (sort) {
		case 'date_asc':
			return [{ orderCreatedAt: 'asc' }, { createdAt: 'asc' }];
		case 'total_desc':
			return [{ totalAmount: 'desc' }, { orderCreatedAt: 'desc' }];
		case 'total_asc':
			return [{ totalAmount: 'asc' }, { orderCreatedAt: 'desc' }];
		case 'name_asc':
			return [{ contactName: 'asc' }, { orderCreatedAt: 'desc' }];
		case 'name_desc':
			return [{ contactName: 'desc' }, { orderCreatedAt: 'desc' }];
		case 'order_number_desc':
			return [{ orderNumber: 'desc' }, { orderCreatedAt: 'desc' }];
		case 'order_number_asc':
			return [{ orderNumber: 'asc' }, { orderCreatedAt: 'desc' }];
		case 'date_desc':
		default:
			return [{ orderCreatedAt: 'desc' }, { createdAt: 'desc' }];
	}
}

function buildOrdersWhere({
	q = '',
	productQuery = '',
	orderNumber = '',
	minSpent = null,
	hasPhoneOnly = false,
	dateFrom = null,
	dateTo = null,
	paymentStatus = null,
	shippingStatus = null,
}) {
	const and = [];

	if (q) {
		and.push({
			OR: [
				{ contactName: { contains: q, mode: 'insensitive' } },
				{ contactEmail: { contains: q, mode: 'insensitive' } },
				{ contactPhone: { contains: q, mode: 'insensitive' } },
				{ normalizedPhone: { contains: q, mode: 'insensitive' } },
				{ orderNumber: { contains: q, mode: 'insensitive' } },
				{ customerProfile: { displayName: { contains: q, mode: 'insensitive' } } },
				{
					items: {
						some: {
							OR: [
								{ name: { contains: q, mode: 'insensitive' } },
								{ sku: { contains: q, mode: 'insensitive' } },
							],
						},
					},
				},
			],
		});
	}

	if (productQuery) {
		and.push({
			items: {
				some: {
					normalizedName: { contains: productQuery },
				},
			},
		});
	}

	if (orderNumber) {
		and.push({
			orderNumber: { contains: orderNumber, mode: 'insensitive' },
		});
	}

	if (minSpent !== null) {
		and.push({ totalAmount: { gte: String(minSpent) } });
	}

	if (hasPhoneOnly) {
		and.push({
			AND: [
				{ contactPhone: { not: null } },
				{ contactPhone: { not: '' } },
			],
		});
	}

	if (dateFrom || dateTo) {
		const orderCreatedAt = {};
		if (dateFrom) orderCreatedAt.gte = dateFrom;
		if (dateTo) orderCreatedAt.lte = dateTo;
		and.push({ orderCreatedAt });
	}

	if (paymentStatus) {
		and.push({ paymentStatus });
	}

	if (shippingStatus) {
		and.push({ shippingStatus });
	}

	return and.length ? { AND: and } : {};
}

function mapOrderRow(order) {
	const items = Array.isArray(order.items) ? order.items : [];
	const totalItems = items.reduce((acc, item) => acc + Number(item.quantity || 0), 0);

	return {
		id: order.id,
		initials: getInitials(order.contactName || order.customerProfile?.displayName || ''),
		orderId: order.orderId,
		orderNumber: order.orderNumber,
		orderLabel: order.orderNumber ? `#${order.orderNumber}` : `ID ${order.orderId}`,
		customerName: order.contactName || order.customerProfile?.displayName || 'Cliente sin nombre',
		email: order.contactEmail || order.customerProfile?.email || null,
		phone: order.contactPhone || order.customerProfile?.phone || null,
		totalAmount: Number(order.totalAmount || 0),
		totalAmountLabel: formatCurrency(order.totalAmount || 0, order.currency || 'ARS'),
		paymentStatus: order.paymentStatus || null,
		shippingStatus: order.shippingStatus || null,
		paymentStatusLabel: order.paymentStatus || '-',
		shippingStatusLabel: order.shippingStatus || '-',
		orderDate: order.orderCreatedAt,
		orderDateLabel: formatDate(order.orderCreatedAt),
		itemsCount: totalItems,
		productCount: items.length,
		productsPreview: items.slice(0, 5).map((item) => ({
			id: item.id,
			name: item.name,
			variantName: item.variantName || null,
			sku: item.sku || null,
			quantity: Number(item.quantity || 0),
		})),
	};
}

export async function getCustomers(req, res, next) {
	try {
		ensureCustomerModels();

		const page = toPositiveInt(req.query.page, 1);
		const pageSize = toPositiveInt(req.query.pageSize, 24, { min: 1, max: 100 });
		const q = normalizeSearch(req.query.q || '');
		const productQuery = normalizeProductSearch(req.query.productQuery || '');
		const orderNumber = normalizeSearch(req.query.orderNumber || '');
		const minSpent = toNumberOrNull(req.query.minSpent);
		const hasPhoneOnly = normalizeBoolean(req.query.hasPhoneOnly);
		const dateFrom = parseDateQuery(req.query.dateFrom, false);
		const dateTo = parseDateQuery(req.query.dateTo, true);
		const paymentStatus = normalizeStatus(req.query.paymentStatus || '');
		const shippingStatus = normalizeStatus(req.query.shippingStatus || '');
		const sort = String(req.query.sort || 'date_desc');
		const skip = (page - 1) * pageSize;

		const where = buildOrdersWhere({
			q,
			productQuery,
			orderNumber,
			minSpent,
			hasPhoneOnly,
			dateFrom,
			dateTo,
			paymentStatus,
			shippingStatus,
		});

		const [orders, totalItems, aggregate, paidCount, phoneCount, uniqueCustomers] = await Promise.all([
			prisma.customerOrder.findMany({
				where,
				include: {
					customerProfile: {
						select: {
							displayName: true,
							email: true,
							phone: true,
						},
					},
					items: {
						orderBy: [{ quantity: 'desc' }, { name: 'asc' }],
						take: 5,
					},
				},
				orderBy: buildOrderBy(sort),
				skip,
				take: pageSize,
			}),
			prisma.customerOrder.count({ where }),
			prisma.customerOrder.aggregate({
				where,
				_sum: { totalAmount: true },
				_avg: { totalAmount: true },
			}),
			prisma.customerOrder.count({ where: { ...where, paymentStatus: 'paid' } }),
			prisma.customerOrder.count({
				where: {
					...where,
					AND: [...(where.AND || []), { contactPhone: { not: null } }, { contactPhone: { not: '' } }],
				},
			}),
			prisma.customerOrder.findMany({
				where,
				distinct: ['customerProfileId'],
				select: { customerProfileId: true },
			}),
		]);

		const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
		const rows = orders.map(mapOrderRow);

		return res.json({
			ok: true,
			rows,
			filters: {
				q,
				productQuery: req.query.productQuery || '',
				orderNumber,
				dateFrom: req.query.dateFrom || '',
				dateTo: req.query.dateTo || '',
				paymentStatus: paymentStatus || '',
				shippingStatus: shippingStatus || '',
				minSpent: req.query.minSpent || '',
				hasPhoneOnly,
				sort,
				page,
				pageSize,
			},
			pagination: {
				page,
				pageSize,
				totalItems,
				totalPages,
			},
			stats: {
				totalOrders: totalItems,
				uniqueCustomers: uniqueCustomers.length,
				paidOrders: paidCount,
				ordersWithPhone: phoneCount,
				totalBilled: Number(aggregate?._sum?.totalAmount || 0),
				avgTicket: Number(aggregate?._avg?.totalAmount || 0),
				currency: 'ARS',
				showingFrom: totalItems ? skip + 1 : 0,
				showingTo: Math.min(skip + pageSize, totalItems),
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function postSyncCustomers(req, res, next) {
	try {
		ensureCustomerModels();

		const q = normalizeSearch(req.body?.q || '');
		const dateFrom = String(req.body?.dateFrom || '').trim();
		const dateTo = String(req.body?.dateTo || '').trim();
		const result = await syncCustomers({ q, dateFrom, dateTo });

		return res.json({
			ok: true,
			...result,
			message: `Sync de pedidos completada: ${result.ordersUpserted} pedidos y ${result.itemsUpserted} items guardados.`,
		});
	} catch (error) {
		next(error);
	}
}

export async function postRepairCustomers(req, res, next) {
	try {
		ensureCustomerModels();
		const countOrders = await prisma.customerOrder.count();
		const countItems = await prisma.customerOrderItem.count();
		const countProfiles = await prisma.customerProfile.count();

		return res.json({
			ok: true,
			message: 'No hizo falta una reparación especial. La vista nueva usa pedidos reales como fuente principal.',
			stats: {
				profiles: countProfiles,
				orders: countOrders,
				items: countItems,
			},
		});
	} catch (error) {
		next(error);
	}
}
