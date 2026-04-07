import { prisma } from '../lib/prisma.js';
import {
	getCustomerSyncStatus as getCustomerSyncStatusService,
	syncCustomers as syncCustomersService,
} from '../services/customer.service.js';

function normalizeText(value = '') {
	return String(value || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

function buildProductTerms(productQuery = '') {
	return String(productQuery || '')
		.split('||')
		.map((item) => item.trim())
		.filter(Boolean);
}

function buildCustomersWhere({
	q,
	productQuery,
	orderNumber,
	dateFrom,
	dateTo,
	minSpent,
	hasPhoneOnly,
}) {
	const where = {};
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

	const terms = buildProductTerms(productQuery);
	if (terms.length > 0) {
		and.push({
			items: {
				some: {
					OR: terms.flatMap((term) => {
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
			if (!Number.isNaN(from.getTime())) {
				createdAt.gte = from;
			}
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

	if (and.length > 0) {
		where.AND = and;
	}

	return where;
}

function buildOrderBy(sort = 'recent_desc') {
	switch (sort) {
		case 'recent_asc':
			return [{ orderCreatedAt: 'asc' }, { id: 'asc' }];
		case 'total_desc':
			return [{ totalAmount: 'desc' }, { orderCreatedAt: 'desc' }];
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
		case 'recent_desc':
		default:
			return [{ orderCreatedAt: 'desc' }, { id: 'desc' }];
	}
}

function mapOrderCard(order) {
	const products = Array.isArray(order.items)
		? order.items.map((item) => ({
				id: item.id,
				name: item.name || item.normalizedName || 'Producto',
				variantName: item.variantName || '',
				sku: item.sku || '',
				quantity: item.quantity || 0,
				unitPrice: item.unitPrice || 0,
				lineTotal: item.lineTotal || 0,
		  }))
		: [];

	return {
		id: order.id,
		orderId: order.orderId,
		orderNumber: order.orderNumber,
		name: order.contactName || 'Sin nombre',
		email: order.contactEmail || '',
		phone: order.contactPhone || '',
		total: order.totalAmount || 0,
		date: order.orderCreatedAt,
		updatedAt: order.updatedAt,
		products,
		productNames: products.map((item) => item.name),
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
			minSpent = '',
			hasPhoneOnly = '',
			sort = 'recent_desc',
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
			minSpent,
			hasPhoneOnly,
		});

		const orderBy = buildOrderBy(sort);

		const [total, rows, metricsBase] = await Promise.all([
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
					id: true,
					totalAmount: true,
					contactPhone: true,
					contactEmail: true,
					contactName: true,
				},
			}),
		]);

		const cards = rows.map(mapOrderCard);

		const uniquePhones = new Set();
		const uniquePeopleFallback = new Set();

		for (const row of metricsBase) {
			const normalizedPhone = String(row.contactPhone || '').trim();
			if (normalizedPhone) {
				uniquePhones.add(normalizedPhone);
			} else {
				uniquePeopleFallback.add(
					`${String(row.contactEmail || '').trim().toLowerCase()}::${String(
						row.contactName || ''
					)
						.trim()
						.toLowerCase()}`
				);
			}
		}

		const totalRevenue = metricsBase.reduce(
			(acc, row) => acc + Number(row.totalAmount || 0),
			0
		);

		const ordersCount = metricsBase.length;
		const ticketAverage = ordersCount > 0 ? totalRevenue / ordersCount : 0;

		return res.json({
			ok: true,
			items: cards,
			pagination: {
				page: parsedPage,
				pageSize: parsedPageSize,
				total,
				totalPages: Math.max(1, Math.ceil(total / parsedPageSize)),
			},
			metrics: {
				orders: ordersCount,
				uniqueCustomers: uniquePhones.size + uniquePeopleFallback.size,
				withPhone: metricsBase.filter((row) => String(row.contactPhone || '').trim()).length,
				ticketAverage,
				revenue: totalRevenue,
			},
		});
	} catch (error) {
		console.error('[CUSTOMERS][GET] error:', error);
		return res.status(500).json({
			ok: false,
			error: 'No se pudo cargar el listado comercial.',
			detail: error?.message || 'Error interno',
		});
	}
}

export async function syncCustomers(req, res) {
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
			error: 'No se pudo iniciar la sincronización.',
			detail: error?.message || 'Error interno',
		});
	}
}

export async function getCustomerSyncStatus(req, res) {
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
			error: 'No se pudo obtener el estado de sincronización.',
			detail: error?.message || 'Error interno',
		});
	}
}