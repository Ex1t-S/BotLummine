import { prisma } from '../lib/prisma.js';
import { syncCustomers } from '../services/customer.service.js';

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

export async function getCustomers(req, res, next) {
	try {
		ensureCustomerModels();

		const q = normalizeSearch(req.query?.q);
		const page = toPositiveInt(req.query?.page, 1);
		const pageSize = 12;
		const skip = (page - 1) * pageSize;
		const sort = normalizeSearch(req.query?.sort) || 'updated_desc';

		const where = q
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
			: {};

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
					updatedAt: true,
					createdAt: true,
					productSummary: true,
					orderCount: true,
					distinctProductsCount: true,
				},
			}),
		]);

		const totalPages = Math.max(1, Math.ceil(totalCustomers / pageSize));
		const showingFrom = totalCustomers === 0 ? 0 : skip + 1;
		const showingTo = Math.min(skip + customers.length, totalCustomers);

		const serialized = customers.map((customer) => ({
			id: customer.id,
			displayName: customer.displayName || null,
			email: customer.email || null,
			phone: customer.phone || null,
			orderCount: Number(customer.orderCount || 0),
			distinctProductsCount: Number(customer.distinctProductsCount || 0),
			totalSpent: Number(customer.totalSpent || 0),
			totalSpentLabel: formatCurrency(customer.totalSpent || 0, customer.currency || 'ARS'),
			currency: customer.currency || 'ARS',
			lastOrderId: customer.lastOrderId || null,
			lastOrderAt: null,
			lastOrderAtLabel: customer.lastOrderId ? `Orden #${customer.lastOrderId}` : '-',
			productSummary: Array.isArray(customer.productSummary) ? customer.productSummary : [],
			initials: getInitials(customer.displayName || customer.email || customer.phone || '?'),
			updatedAt: customer.updatedAt,
			updatedAtLabel: formatDate(customer.updatedAt),
		}));

		return res.json({
			customers: serialized,
			stats: {
				totalCustomers,
				repeatBuyers: 0,
				withLastOrder,
				totalOrders: 0,
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
		message: 'Repair de clientes disponible, pero todavía no se ejecutó ninguna reparación real en esta versión.',
	});
}