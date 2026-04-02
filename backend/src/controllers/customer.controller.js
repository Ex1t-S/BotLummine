import { prisma } from '../lib/prisma.js';
import { resolveStoreCredentials, syncCustomers } from '../services/customer.service.js';

function ensureCustomerModels() {
	if (!prisma?.customerProfile) {
		throw new Error(
			'Los modelos de clientes no están disponibles en Prisma Client. Ejecutá prisma generate y revisá la migración.'
		);
	}
}

function toPositiveInt(value, fallback) {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
}

function normalizeSearch(value = '') {
	return String(value || '').trim();
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

function buildOrderBy(sort = 'updated_desc') {
	switch (sort) {
		case 'name_asc':
			return [{ displayName: 'asc' }, { email: 'asc' }, { createdAt: 'desc' }];

		case 'name_desc':
			return [{ displayName: 'desc' }, { email: 'desc' }, { createdAt: 'desc' }];

		case 'spent_desc':
			return [{ totalSpent: 'desc' }, { updatedAt: 'desc' }];

		case 'spent_asc':
			return [{ totalSpent: 'asc' }, { updatedAt: 'desc' }];

		case 'updated_asc':
			return [{ updatedAt: 'asc' }];

		case 'updated_desc':
		default:
			return [{ updatedAt: 'desc' }];
	}
}

function extractProductSummary(products) {
	if (!Array.isArray(products)) return [];

	return products
		.map((item) => {
			const name =
				item?.name || item?.product_name || item?.variant_name || item?.title || item?.sku || null;
			const quantity = Number(item?.quantity || item?.qty || 0);

			if (!name) return null;
			return quantity > 1 ? `${name} x${quantity}` : String(name);
		})
		.filter(Boolean)
		.slice(0, 4);
}

function getLatestOrderData(customer) {
	const latestOrder = Array.isArray(customer.orders) ? customer.orders[0] : null;
	const rawLastOrderProducts = customer.rawLastOrderPayload?.products;
	const summaryFromProfile = Array.isArray(customer.productSummary) ? customer.productSummary : [];

	const orderId = latestOrder?.orderId || customer.lastOrderId || null;
	const orderNumber = latestOrder?.orderNumber || customer.lastOrderNumber || orderId || null;
	const orderDate = latestOrder?.orderCreatedAt || customer.lastOrderAt || null;
	const productsFromOrder = extractProductSummary(latestOrder?.products);
	const productsFromRawOrder = extractProductSummary(rawLastOrderProducts);
	const orderProducts = productsFromOrder.length
		? productsFromOrder
		: productsFromRawOrder.length
			? productsFromRawOrder
			: summaryFromProfile;

	return {
		orderId,
		orderNumber,
		orderDate,
		orderProducts: Array.isArray(orderProducts) ? orderProducts.slice(0, 4) : [],
	};
}

export async function getCustomers(req, res, next) {
	try {
		ensureCustomerModels();

		const { storeId } = await resolveStoreCredentials();
		const q = normalizeSearch(req.query?.q);
		const page = toPositiveInt(req.query?.page, 1);
		const pageSize = Math.min(48, Math.max(12, toPositiveInt(req.query?.pageSize, 24)));
		const skip = (page - 1) * pageSize;
		const sort = normalizeSearch(req.query?.sort) || 'updated_desc';

		const where = {
			storeId,
			...(q
				? {
					OR: [
						{ displayName: { contains: q, mode: 'insensitive' } },
						{ email: { contains: q, mode: 'insensitive' } },
						{ phone: { contains: q, mode: 'insensitive' } },
						{ normalizedPhone: { contains: q, mode: 'insensitive' } },
						{ normalizedEmail: { contains: q, mode: 'insensitive' } },
						{ identification: { contains: q, mode: 'insensitive' } },
					],
				}
				: {}),
		};

		const [totalCustomers, withLastOrder, moneyAgg, customers] = await Promise.all([
			prisma.customerProfile.count({ where }),
			prisma.customerProfile.count({
				where: {
					...where,
					lastOrderId: { not: null },
				},
			}),
			prisma.customerProfile.aggregate({
				where,
				_sum: {
					totalSpent: true,
				},
			}),
			prisma.customerProfile.findMany({
				where,
				orderBy: buildOrderBy(sort),
				skip,
				take: pageSize,
				select: {
					id: true,
					displayName: true,
					email: true,
					phone: true,
					totalSpent: true,
					currency: true,
					lastOrderId: true,
					lastOrderNumber: true,
					lastOrderAt: true,
					updatedAt: true,
					createdAt: true,
					productSummary: true,
					rawLastOrderPayload: true,
					orderCount: true,
					orders: {
						orderBy: [{ orderCreatedAt: 'desc' }, { createdAt: 'desc' }],
						take: 1,
						select: {
							orderId: true,
							orderNumber: true,
							orderCreatedAt: true,
							products: true,
						},
					},
				},
			}),
		]);

		const totalPages = Math.max(1, Math.ceil(totalCustomers / pageSize));
		const showingFrom = totalCustomers === 0 ? 0 : skip + 1;
		const showingTo = Math.min(skip + customers.length, totalCustomers);

		const serialized = customers.map((customer) => {
			const latestOrder = getLatestOrderData(customer);
			const orderLabel = latestOrder.orderNumber ? `Orden #${latestOrder.orderNumber}` : '-';
			const orderDateLabel = formatDate(latestOrder.orderDate);

			return {
				id: customer.id,
				displayName: customer.displayName || null,
				email: customer.email || null,
				phone: customer.phone || null,
				orderCount: Number(customer.orderCount || 0),
				totalSpent: Number(customer.totalSpent || 0),
				totalSpentLabel: formatCurrency(customer.totalSpent || 0, customer.currency || 'ARS'),
				currency: customer.currency || 'ARS',
				lastOrderId: latestOrder.orderId,
				lastOrderNumber: latestOrder.orderNumber,
				lastOrderLabel: orderLabel,
				lastOrderDate: latestOrder.orderDate,
				lastOrderDateLabel: orderDateLabel,
				productsPreview: latestOrder.orderProducts,
				productsCount: latestOrder.orderProducts.length,
				initials: getInitials(customer.displayName || customer.email || customer.phone || '?'),
				updatedAt: customer.updatedAt,
				updatedAtLabel: formatDate(customer.updatedAt),
			};
		});

		return res.json({
			customers: serialized,
			stats: {
				totalCustomers,
				withLastOrder,
				totalSpent: Number(moneyAgg?._sum?.totalSpent || 0),
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
		});
	} catch (error) {
		next(error);
	}
}

export async function postSyncCustomers(req, res, next) {
	try {
		ensureCustomerModels();

		const q = normalizeSearch(req.body?.q || '');
		const result = await syncCustomers({ q });

		return res.json(result);
	} catch (error) {
		console.error('[CUSTOMERS SYNC ERROR]', error);

		return res.status(500).json({
			message: error.message || 'Error sincronizando clientes',
		});
	}
}
