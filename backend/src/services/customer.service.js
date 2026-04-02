import { prisma } from '../lib/prisma.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const CUSTOMERS_PER_PAGE = Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_PER_PAGE || 100);
const MAX_PAGES = Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_MAX_PAGES || 80);

function normalizePhone(value = '') {
	const digits = String(value || '').replace(/\D/g, '');
	return digits || null;
}

function normalizeEmail(value = '') {
	const email = String(value || '').trim().toLowerCase();
	return email || null;
}

function cleanString(value = '') {
	const text = String(value ?? '').trim();
	return text || null;
}

function parseDateOrNull(value) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function toDecimalOrNull(value) {
	if (value === null || value === undefined || value === '') return null;
	return String(value);
}

function buildHeaders(accessToken) {
	return {
		Authentication: `bearer ${accessToken}`,
		'Content-Type': 'application/json; charset=utf-8',
		'User-Agent': process.env.TIENDANUBE_USER_AGENT || 'Lummine IA Assistant',
	};
}

async function resolveStoreCredentials() {
	const installation = await prisma.storeInstallation.findFirst({
		orderBy: { installedAt: 'desc' },
	});

	const storeId = installation?.storeId || process.env.TIENDANUBE_STORE_ID || null;
	const accessToken = installation?.accessToken || process.env.TIENDANUBE_ACCESS_TOKEN || null;

	if (!storeId || !accessToken) {
		throw new Error(
			'Faltan credenciales de Tiendanube. Necesitás StoreInstallation o TIENDANUBE_STORE_ID / TIENDANUBE_ACCESS_TOKEN en el .env.'
		);
	}

	return { storeId, accessToken };
}

function buildCustomerProfilePayload(customer = {}, storeId) {
	return {
		storeId,
		externalCustomerId: customer?.id ? String(customer.id) : null,
		displayName: cleanString(customer?.name),
		email: cleanString(customer?.email),
		normalizedEmail: normalizeEmail(customer?.email),
		phone: cleanString(customer?.phone),
		normalizedPhone: normalizePhone(customer?.phone),
		identification: cleanString(customer?.identification),
		note: cleanString(customer?.note),
		acceptsMarketing:
			typeof customer?.accepts_marketing === 'boolean' ? customer.accepts_marketing : null,
		acceptsMarketingUpdatedAt: parseDateOrNull(customer?.accepts_marketing_updated_at),
		defaultAddress: customer?.default_address ?? null,
		addresses: Array.isArray(customer?.addresses) ? customer.addresses : null,
		billingAddress: cleanString(customer?.billing_address),
		billingNumber: cleanString(customer?.billing_number),
		billingFloor: cleanString(customer?.billing_floor),
		billingLocality: cleanString(customer?.billing_locality),
		billingZipcode: cleanString(customer?.billing_zipcode),
		billingCity: cleanString(customer?.billing_city),
		billingProvince: cleanString(customer?.billing_province),
		billingCountry: cleanString(customer?.billing_country),
		billingPhone: cleanString(customer?.billing_phone),
		totalSpent: toDecimalOrNull(customer?.total_spent),
		currency: cleanString(customer?.total_spent_currency),
		lastOrderId: customer?.last_order_id ? String(customer.last_order_id) : null,
		firstOrderAt: null,
		lastOrderAt: null,
		lastOrderNumber: null,
		lastPaymentStatus: null,
		lastShippingStatus: null,
		productSummary: null,
		rawCustomerPayload: customer,
		rawLastOrderPayload: null,
		syncedAt: new Date(),
	};
}

function pick(existingValue, incomingValue) {
	if (incomingValue === null || incomingValue === undefined) return existingValue;
	if (typeof incomingValue === 'string' && !incomingValue.trim()) return existingValue;
	return incomingValue;
}

async function findExistingProfile({ storeId, externalCustomerId, normalizedEmail, normalizedPhone }) {
	if (externalCustomerId) {
		const byExternal = await prisma.customerProfile.findFirst({
			where: { storeId, externalCustomerId },
		});
		if (byExternal) return byExternal;
	}

	if (normalizedEmail) {
		const byEmail = await prisma.customerProfile.findFirst({
			where: { storeId, normalizedEmail },
		});
		if (byEmail) return byEmail;
	}

	if (normalizedPhone) {
		const byPhone = await prisma.customerProfile.findFirst({
			where: { storeId, normalizedPhone },
		});
		if (byPhone) return byPhone;
	}

	return null;
}

async function upsertCustomerProfile(payload) {
	const existing = await findExistingProfile({
		storeId: payload.storeId,
		externalCustomerId: payload.externalCustomerId,
		normalizedEmail: payload.normalizedEmail,
		normalizedPhone: payload.normalizedPhone,
	});

	if (!existing) {
		return prisma.customerProfile.create({
			data: {
				...payload,
				orderCount: 0,
				paidOrderCount: 0,
				distinctProductsCount: 0,
				totalUnitsPurchased: 0,
			},
		});
	}

	return prisma.customerProfile.update({
		where: { id: existing.id },
		data: {
			externalCustomerId: pick(existing.externalCustomerId, payload.externalCustomerId),
			displayName: pick(existing.displayName, payload.displayName),
			email: pick(existing.email, payload.email),
			normalizedEmail: pick(existing.normalizedEmail, payload.normalizedEmail),
			phone: pick(existing.phone, payload.phone),
			normalizedPhone: pick(existing.normalizedPhone, payload.normalizedPhone),
			identification: pick(existing.identification, payload.identification),
			note: pick(existing.note, payload.note),
			acceptsMarketing:
				typeof payload.acceptsMarketing === 'boolean'
					? payload.acceptsMarketing
					: existing.acceptsMarketing,
			acceptsMarketingUpdatedAt: pick(
				existing.acceptsMarketingUpdatedAt,
				payload.acceptsMarketingUpdatedAt
			),
			defaultAddress: pick(existing.defaultAddress, payload.defaultAddress),
			addresses: pick(existing.addresses, payload.addresses),
			billingAddress: pick(existing.billingAddress, payload.billingAddress),
			billingNumber: pick(existing.billingNumber, payload.billingNumber),
			billingFloor: pick(existing.billingFloor, payload.billingFloor),
			billingLocality: pick(existing.billingLocality, payload.billingLocality),
			billingZipcode: pick(existing.billingZipcode, payload.billingZipcode),
			billingCity: pick(existing.billingCity, payload.billingCity),
			billingProvince: pick(existing.billingProvince, payload.billingProvince),
			billingCountry: pick(existing.billingCountry, payload.billingCountry),
			billingPhone: pick(existing.billingPhone, payload.billingPhone),
			totalSpent: payload.totalSpent ?? existing.totalSpent,
			currency: pick(existing.currency, payload.currency),
			lastOrderId: pick(existing.lastOrderId, payload.lastOrderId),
			rawCustomerPayload: payload.rawCustomerPayload,
			syncedAt: new Date(),
		},
	});
}

async function fetchCustomersPage({ storeId, accessToken, page, q = '' }) {
	const fields = [
		'id',
		'name',
		'email',
		'phone',
		'identification',
		'note',
		'default_address',
		'addresses',
		'billing_address',
		'billing_number',
		'billing_floor',
		'billing_locality',
		'billing_zipcode',
		'billing_city',
		'billing_province',
		'billing_country',
		'billing_phone',
		'total_spent',
		'total_spent_currency',
		'last_order_id',
		'accepts_marketing',
		'accepts_marketing_updated_at',
		'created_at',
		'updated_at',
	].join(',');

	const params = new URLSearchParams({
		page: String(page),
		per_page: String(CUSTOMERS_PER_PAGE),
		fields,
	});

	if (q) {
		params.set('q', q);
	}

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/customers?${params.toString()}`;

	const response = await fetch(url, {
		method: 'GET',
		headers: buildHeaders(accessToken),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Tiendanube customers error ${response.status}: ${text}`);
	}

	const data = await response.json();

	if (!Array.isArray(data)) {
		throw new Error('La respuesta de Tiendanube en /customers no fue una lista.');
	}

	return data;
}

export async function syncCustomers({ q = '' } = {}) {
	const { storeId, accessToken } = await resolveStoreCredentials();

	let pagesFetched = 0;
	let customersFetched = 0;
	let customersUpserted = 0;

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const customers = await fetchCustomersPage({
			storeId,
			accessToken,
			page,
			q,
		});

		if (!customers.length) {
			break;
		}

		pagesFetched += 1;
		customersFetched += customers.length;

		for (const customer of customers) {
			const payload = buildCustomerProfilePayload(customer, storeId);
			await upsertCustomerProfile(payload);
			customersUpserted += 1;
		}

		if (customers.length < CUSTOMERS_PER_PAGE) {
			break;
		}
	}

	return {
		ok: true,
		storeId,
		pagesFetched,
		customersFetched,
		customersUpserted,
		customersTouched: customersUpserted,
		ordersUpserted: 0,
	};
}
