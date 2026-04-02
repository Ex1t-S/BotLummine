import { prisma } from '../lib/prisma.js';
import { syncCustomers } from '../services/customer.service.js';

function ensureCustomerModels() {
	if (!prisma?.customerProfile || !prisma?.customerOrder || !prisma?.customerSyncLog) {
		throw new Error(
			'Los modelos de clientes no están disponibles en Prisma Client. Ejecutá prisma generate y corré la migración nueva antes de probar.'
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

export async function getCustomers(req, res, next) {
	try {
		ensureCustomerModels();

		const q = normalizeSearch(req.query?.q);
		const page = toPositiveInt(req.query?.page, 1);
		const pageSize = 12;
		const skip = (page - 1) * pageSize;

		const where = q
            ? {
                    OR: [
                        { displayName: { contains: q, mode: 'insensitive' } },
                        { email: { contains: q, mode: 'insensitive' } },
                        { phone: { contains: q, mode: 'insensitive' } },
                        { normalizedPhone: { contains: q, mode: 'insensitive' } },
                        { normalizedEmail: { contains: q, mode: 'insensitive' } },
                    ],
                }
            : {};

		const [totalCustomers, allForStats, customers] = await Promise.all([
			prisma.customerProfile.count({ where }),
			prisma.customerProfile.findMany({
				where,
				select: {
					id: true,
					orderCount: true,
					totalSpent: true,
				},
			}),
			prisma.customerProfile.findMany({
				where,
				orderBy: [
					{ lastOrderAt: 'desc' },
					{ updatedAt: 'desc' },
				],
				skip,
				take: pageSize,
			}),
		]);

		const totalPages = Math.max(1, Math.ceil(totalCustomers / pageSize));
		const showingFrom = totalCustomers === 0 ? 0 : skip + 1;
		const showingTo = Math.min(skip + customers.length, totalCustomers);

		const repeatBuyers = allForStats.filter((item) => Number(item.orderCount || 0) > 1).length;
		const totalOrders = allForStats.reduce(
			(acc, item) => acc + Number(item.orderCount || 0),
			0
		);
		const totalSpent = allForStats.reduce(
			(acc, item) => acc + Number(item.totalSpent || 0),
			0
		);

		const serialized = customers.map((customer) => ({
			id: customer.id,
			displayName: customer.displayName || null,
			email: customer.email || null,
			phone: customer.phone || null,
			orderCount: Number(customer.orderCount || 0),
			paidOrderCount: Number(customer.paidOrderCount || 0),
			distinctProductsCount: Number(customer.distinctProductsCount || 0),
			totalUnitsPurchased: Number(customer.totalUnitsPurchased || 0),
			totalSpent: Number(customer.totalSpent || 0),
			totalSpentLabel: formatCurrency(customer.totalSpent || 0, customer.currency || 'ARS'),
			currency: customer.currency || 'ARS',
			firstOrderAt: customer.firstOrderAt,
			lastOrderAt: customer.lastOrderAt,
			lastOrderAtLabel: formatDate(customer.lastOrderAt),
			lastOrderNumber: customer.lastOrderNumber || null,
			lastPaymentStatus: customer.lastPaymentStatus || null,
			lastShippingStatus: customer.lastShippingStatus || null,
			productSummary: Array.isArray(customer.productSummary)
				? customer.productSummary
				: [],
			initials: getInitials(customer.displayName || customer.email || customer.phone || '?'),
		}));

		return res.json({
			customers: serialized,
			stats: {
				totalCustomers,
				repeatBuyers,
				totalOrders,
				totalSpent,
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

		const fullSync = req.body?.fullSync !== false;
		const result = await syncCustomers({ fullSync });

		return res.json(result);
	} catch (error) {
		next(error);
	}
}