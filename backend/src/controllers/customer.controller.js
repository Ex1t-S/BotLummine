import { prisma } from '../lib/prisma.js';
import { syncCustomers } from '../services/customer.service.js';

function ensureCustomerModels() {
	if (!prisma?.customerProfile) {
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
				{ updatedAt: 'desc' },
			];

		case 'spent_asc':
			return [
				{ totalSpent: 'asc' },
				{ updatedAt: 'desc' },
			];

		case 'updated_asc':
			return [{ updatedAt: 'asc' }];

		case 'updated_desc':
		default:
			return [{ updatedAt: 'desc' }];
	}
}

function getPrimaryProductLabel(productSummary = []) {
	if (!Array.isArray(productSummary) || !productSummary.length) return '';

	const first = productSummary[0];

	if (typeof first === 'string') return first;
	if (typeof first?.name === 'string') return first.name;
	if (typeof first?.productName === 'string') return first.productName;
	if (typeof first?.title === 'string') return first.title;
	if (typeof first?.label === 'string') return first.label;

	return '';
}

function stringifyProductSummary(productSummary = []) {
	if (!Array.isArray(productSummary) || !productSummary.length) return '';

	return productSummary
		.map((item) => {
			if (!item) return '';
			if (typeof item === 'string') return item;

			return [
				item.name,
				item.productName,
				item.title,
				item.label,
				item.variant,
				item.color,
				item.size,
			]
				.filter(Boolean)
				.join(' ');
		})
		.filter(Boolean)
		.join(' • ');
}

function buildCustomersWhere({
	q = '',
	minSpent = null,
	minOrders = null,
	hasPhoneOnly = false,
	hasOrders = false,
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
			],
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
		and.push({
			orderCount: {
				gte: minOrders,
			},
		});
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
				{ lastOrderId: { not: null } },
				{ orderCount: { gt: 0 } },
			],
		});
	}

	return and.length ? { AND: and } : {};
}

function serializeCustomer(customer) {
	const resolvedPhone = customer.phone || customer.normalizedPhone || null;
	const productSummary = Array.isArray(customer.productSummary)
		? customer.productSummary
		: [];

	return {
		id: customer.id,
		displayName: customer.displayName || null,
		email: customer.email || null,
		phone: resolvedPhone,
		hasPhone: Boolean(resolvedPhone),
		orderCount: Number(customer.orderCount || 0),
		distinctProductsCount: Number(customer.distinctProductsCount || 0),
		totalSpent: Number(customer.totalSpent || 0),
		totalSpentLabel: formatCurrency(customer.totalSpent || 0, customer.currency || 'ARS'),
		currency: customer.currency || 'ARS',
		lastOrderId: customer.lastOrderId || null,
		lastOrderAt: customer.lastOrderAt || null,
		lastOrderAtLabel:
			formatDate(customer.lastOrderAt) ||
			(customer.lastOrderId ? `Orden #${customer.lastOrderId}` : '-'),
		productSummary,
		primaryProductLabel: getPrimaryProductLabel(productSummary),
		initials: getInitials(customer.displayName || customer.email || resolvedPhone || '?'),
		updatedAt: customer.updatedAt,
		updatedAtLabel: formatDate(customer.updatedAt),
	};
}

function buildStats(customers = [], fallbackCurrency = 'ARS', showingFrom = 0, showingTo = 0) {
	return {
		totalCustomers: customers.length,
		repeatBuyers: customers.filter((customer) => Number(customer.orderCount || 0) > 1).length,
		withLastOrder: customers.filter((customer) => Boolean(customer.lastOrderId)).length,
		totalOrders: customers.reduce(
			(total, customer) => total + Number(customer.orderCount || 0),
			0
		),
		totalSpent: customers.reduce(
			(total, customer) => total + Number(customer.totalSpent || 0),
			0
		),
		currency: fallbackCurrency || 'ARS',
		showingFrom,
		showingTo,
	};
}

export async function getCustomers(req, res, next) {
	try {
		ensureCustomerModels();

		const q = normalizeSearch(req.query?.q);
		const page = toPositiveInt(req.query?.page, 1);
		const pageSize = toPositiveInt(req.query?.pageSize, 24, { min: 1, max: 100 });
		const skip = (page - 1) * pageSize;
		const sort = normalizeSearch(req.query?.sort) || 'updated_desc';
		const minSpent = toNumberOrNull(req.query?.minSpent);
		const minOrders = toNumberOrNull(req.query?.minOrders);
		const hasPhoneOnly = normalizeBoolean(req.query?.hasPhoneOnly);
		const hasOrders = normalizeBoolean(req.query?.hasOrders);
		const productQuery = normalizeSearch(req.query?.productQuery).toLowerCase();

		const where = buildCustomersWhere({
			q,
			minSpent,
			minOrders,
			hasPhoneOnly,
			hasOrders,
		});

		const select = {
			id: true,
			displayName: true,
			email: true,
			phone: true,
			normalizedPhone: true,
			totalSpent: true,
			currency: true,
			lastOrderId: true,
			lastOrderAt: true,
			updatedAt: true,
			createdAt: true,
			productSummary: true,
			orderCount: true,
			distinctProductsCount: true,
		};

		if (productQuery) {
			const allCustomers = await prisma.customerProfile.findMany({
				where,
				orderBy: buildOrderBy(sort),
				select,
			});

			const filteredCustomers = allCustomers.filter((customer) =>
				stringifyProductSummary(customer.productSummary).toLowerCase().includes(productQuery)
			);

			const totalCustomers = filteredCustomers.length;
			const totalPages = Math.max(1, Math.ceil(totalCustomers / pageSize));
			const pagedCustomers = filteredCustomers.slice(skip, skip + pageSize);
			const showingFrom = totalCustomers === 0 ? 0 : skip + 1;
			const showingTo = Math.min(skip + pagedCustomers.length, totalCustomers);

			return res.json({
				customers: pagedCustomers.map(serializeCustomer),
				stats: buildStats(
					filteredCustomers,
					filteredCustomers[0]?.currency || 'ARS',
					showingFrom,
					showingTo
				),
				pagination: {
					page,
					pageSize,
					totalPages,
					totalItems: totalCustomers,
				},
				filters: {
					q,
					sort,
					minSpent,
					minOrders,
					hasPhoneOnly,
					hasOrders,
					productQuery: normalizeSearch(req.query?.productQuery),
				},
			});
		}

		const [
			totalCustomers,
			repeatBuyers,
			withLastOrder,
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
			prisma.customerProfile.aggregate({
				where,
				_sum: {
					totalSpent: true,
					orderCount: true,
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

		return res.json({
			customers: customers.map(serializeCustomer),
			stats: {
				totalCustomers,
				repeatBuyers,
				withLastOrder,
				totalOrders: Number(agg?._sum?.orderCount || 0),
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
				sort,
				minSpent,
				minOrders,
				hasPhoneOnly,
				hasOrders,
				productQuery: normalizeSearch(req.query?.productQuery),
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
		const result = await syncCustomers({ q });

		return res.json(result);
	} catch (error) {
		console.error('[CUSTOMERS SYNC ERROR]', error);

		return res.status(500).json({
			message: error.message || 'Error sincronizando clientes',
		});
	}
}

export async function postRepairCustomers(_req, res) {
	return res.json({
		ok: true,
		repairedProfiles: 0,
		mergedProfiles: 0,
		relinkedOrders: 0,
		message:
			'Repair de clientes disponible, pero todavía no se ejecutó ninguna reparación real en esta versión.',
	});
}