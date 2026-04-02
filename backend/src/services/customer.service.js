import { prisma } from '../lib/prisma.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const CUSTOMERS_PER_PAGE = Math.min(
	200,
	Math.max(50, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_PER_PAGE || 200))
);
const FETCH_CONCURRENCY = Math.min(
	8,
	Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_CONCURRENCY || 4))
);
const MAX_PAGES = Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_MAX_PAGES || 500));
const FETCH_RETRIES = Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_RETRIES || 4));
const UPDATE_CHUNK_SIZE = Math.max(10, Number(process.env.TIENDANUBE_CUSTOMERS_UPDATE_CHUNK_SIZE || 80));

const syncState = {
	running: false,
	startedAt: null,
};

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export async function resolveStoreCredentials() {
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
		rawCustomerPayload: customer,
		syncedAt: new Date(),
	};
}

function normalizeComparable(value) {
	if (value === undefined) return null;
	if (value === null) return null;
	if (value instanceof Date) return value.getTime();
	if (typeof value === 'object') return JSON.stringify(value);
	if (typeof value === 'number') return value;
	return String(value);
}

function valuesEqual(left, right) {
	return normalizeComparable(left) === normalizeComparable(right);
}

function pickBestProfile(current, incoming) {
	if (!current) return incoming;

	const currentScore =
		Number(current.orderCount || 0) * 100 +
		(current.lastOrderAt ? 10 : 0) +
		(current.externalCustomerId ? 5 : 0) +
		(current.normalizedEmail ? 2 : 0) +
		(current.normalizedPhone ? 2 : 0);

	const incomingScore =
		Number(incoming.orderCount || 0) * 100 +
		(incoming.lastOrderAt ? 10 : 0) +
		(incoming.externalCustomerId ? 5 : 0) +
		(incoming.normalizedEmail ? 2 : 0) +
		(incoming.normalizedPhone ? 2 : 0);

	if (incomingScore > currentScore) return incoming;
	if (incomingScore < currentScore) return current;

	const currentCreated = current.createdAt ? new Date(current.createdAt).getTime() : Infinity;
	const incomingCreated = incoming.createdAt ? new Date(incoming.createdAt).getTime() : Infinity;
	return incomingCreated < currentCreated ? incoming : current;
}

function mergePayload(base, incoming) {
	if (!base) return incoming;

	return {
		...base,
		externalCustomerId: incoming.externalCustomerId || base.externalCustomerId,
		displayName: incoming.displayName || base.displayName,
		email: incoming.email || base.email,
		normalizedEmail: incoming.normalizedEmail || base.normalizedEmail,
		phone: incoming.phone || base.phone,
		normalizedPhone: incoming.normalizedPhone || base.normalizedPhone,
		identification: incoming.identification || base.identification,
		note: incoming.note || base.note,
		acceptsMarketing:
			typeof incoming.acceptsMarketing === 'boolean'
				? incoming.acceptsMarketing
				: base.acceptsMarketing,
		acceptsMarketingUpdatedAt:
			incoming.acceptsMarketingUpdatedAt || base.acceptsMarketingUpdatedAt,
		defaultAddress: incoming.defaultAddress ?? base.defaultAddress,
		addresses: incoming.addresses ?? base.addresses,
		billingAddress: incoming.billingAddress || base.billingAddress,
		billingNumber: incoming.billingNumber || base.billingNumber,
		billingFloor: incoming.billingFloor || base.billingFloor,
		billingLocality: incoming.billingLocality || base.billingLocality,
		billingZipcode: incoming.billingZipcode || base.billingZipcode,
		billingCity: incoming.billingCity || base.billingCity,
		billingProvince: incoming.billingProvince || base.billingProvince,
		billingCountry: incoming.billingCountry || base.billingCountry,
		billingPhone: incoming.billingPhone || base.billingPhone,
		totalSpent: incoming.totalSpent ?? base.totalSpent,
		currency: incoming.currency || base.currency,
		lastOrderId: incoming.lastOrderId || base.lastOrderId,
		rawCustomerPayload: incoming.rawCustomerPayload || base.rawCustomerPayload,
		syncedAt: incoming.syncedAt || base.syncedAt,
	};
}

function dedupePayloads(payloads = []) {
	const deduped = [];
	const externalMap = new Map();
	const emailMap = new Map();
	const phoneMap = new Map();

	for (const payload of payloads) {
		const byExternal = payload.externalCustomerId
			? externalMap.get(payload.externalCustomerId)
			: null;
		const byEmail = payload.normalizedEmail ? emailMap.get(payload.normalizedEmail) : null;
		const byPhone = payload.normalizedPhone ? phoneMap.get(payload.normalizedPhone) : null;
		const existingIndex = byExternal ?? byEmail ?? byPhone;

		if (existingIndex === undefined || existingIndex === null) {
			const nextIndex = deduped.length;
			deduped.push(payload);

			if (payload.externalCustomerId) externalMap.set(payload.externalCustomerId, nextIndex);
			if (payload.normalizedEmail) emailMap.set(payload.normalizedEmail, nextIndex);
			if (payload.normalizedPhone) phoneMap.set(payload.normalizedPhone, nextIndex);
			continue;
		}

		deduped[existingIndex] = mergePayload(deduped[existingIndex], payload);
		const merged = deduped[existingIndex];
		if (merged.externalCustomerId) externalMap.set(merged.externalCustomerId, existingIndex);
		if (merged.normalizedEmail) emailMap.set(merged.normalizedEmail, existingIndex);
		if (merged.normalizedPhone) phoneMap.set(merged.normalizedPhone, existingIndex);
	}

	return deduped;
}

function buildProfileMaps(existingProfiles = []) {
	const externalMap = new Map();
	const emailMap = new Map();
	const phoneMap = new Map();

	for (const profile of existingProfiles) {
		if (profile.externalCustomerId) {
			externalMap.set(
				profile.externalCustomerId,
				pickBestProfile(externalMap.get(profile.externalCustomerId), profile)
			);
		}

		if (profile.normalizedEmail) {
			emailMap.set(
				profile.normalizedEmail,
				pickBestProfile(emailMap.get(profile.normalizedEmail), profile)
			);
		}

		if (profile.normalizedPhone) {
			phoneMap.set(
				profile.normalizedPhone,
				pickBestProfile(phoneMap.get(profile.normalizedPhone), profile)
			);
		}
	}

	return { externalMap, emailMap, phoneMap };
}

function buildUpdateData(existing, payload) {
	const nextData = {};
	const fields = [
		'externalCustomerId',
		'displayName',
		'email',
		'normalizedEmail',
		'phone',
		'normalizedPhone',
		'identification',
		'note',
		'acceptsMarketing',
		'acceptsMarketingUpdatedAt',
		'defaultAddress',
		'addresses',
		'billingAddress',
		'billingNumber',
		'billingFloor',
		'billingLocality',
		'billingZipcode',
		'billingCity',
		'billingProvince',
		'billingCountry',
		'billingPhone',
		'totalSpent',
		'currency',
		'lastOrderId',
		'rawCustomerPayload',
	];

	for (const field of fields) {
		const incomingValue = payload[field];
		if (incomingValue === undefined) continue;
		if (incomingValue === null) continue;
		if (typeof incomingValue === 'string' && !incomingValue.trim()) continue;
		if (!valuesEqual(existing[field], incomingValue)) {
			nextData[field] = incomingValue;
		}
	}

	if (Object.keys(nextData).length) {
		nextData.syncedAt = new Date();
	}

	return nextData;
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

	for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
		const response = await fetch(url, {
			method: 'GET',
			headers: buildHeaders(accessToken),
		});

		if (response.ok) {
			const data = await response.json();

			if (!Array.isArray(data)) {
				throw new Error('La respuesta de Tiendanube en /customers no fue una lista.');
			}

			return data;
		}

		const text = await response.text();
		const retryAfterHeader = Number(response.headers.get('retry-after') || 0);
		const retryable = response.status === 429 || response.status >= 500;

		if (!retryable || attempt === FETCH_RETRIES) {
			throw new Error(`Tiendanube customers error ${response.status}: ${text}`);
		}

		const backoffMs = retryAfterHeader
			? retryAfterHeader * 1000
			: Math.min(8000, 500 * 2 ** (attempt - 1));
		await sleep(backoffMs);
	}

	return [];
}

async function processCustomerChunk({ storeId, customers }) {
	if (!customers.length) {
		return { created: 0, updated: 0, touched: 0 };
	}

	const payloads = dedupePayloads(customers.map((customer) => buildCustomerProfilePayload(customer, storeId)));
	const externalIds = [...new Set(payloads.map((item) => item.externalCustomerId).filter(Boolean))];
	const emails = [...new Set(payloads.map((item) => item.normalizedEmail).filter(Boolean))];
	const phones = [...new Set(payloads.map((item) => item.normalizedPhone).filter(Boolean))];

	const whereOr = [];
	if (externalIds.length) whereOr.push({ externalCustomerId: { in: externalIds } });
	if (emails.length) whereOr.push({ normalizedEmail: { in: emails } });
	if (phones.length) whereOr.push({ normalizedPhone: { in: phones } });

	const existingProfiles = whereOr.length
		? await prisma.customerProfile.findMany({
				where: {
					storeId,
					OR: whereOr,
				},
				select: {
					id: true,
					externalCustomerId: true,
					normalizedEmail: true,
					normalizedPhone: true,
					displayName: true,
					email: true,
					phone: true,
					identification: true,
					note: true,
					acceptsMarketing: true,
					acceptsMarketingUpdatedAt: true,
					defaultAddress: true,
					addresses: true,
					billingAddress: true,
					billingNumber: true,
					billingFloor: true,
					billingLocality: true,
					billingZipcode: true,
					billingCity: true,
					billingProvince: true,
					billingCountry: true,
					billingPhone: true,
					totalSpent: true,
					currency: true,
					lastOrderId: true,
					rawCustomerPayload: true,
					orderCount: true,
					lastOrderAt: true,
					createdAt: true,
				},
			})
		: [];

	const { externalMap, emailMap, phoneMap } = buildProfileMaps(existingProfiles);
	const updates = [];
	const inserts = [];

	for (const payload of payloads) {
		const existing =
			(payload.externalCustomerId && externalMap.get(payload.externalCustomerId)) ||
			(payload.normalizedEmail && emailMap.get(payload.normalizedEmail)) ||
			(payload.normalizedPhone && phoneMap.get(payload.normalizedPhone)) ||
			null;

		if (!existing) {
			inserts.push({
				...payload,
				orderCount: 0,
				paidOrderCount: 0,
				distinctProductsCount: 0,
				totalUnitsPurchased: 0,
			});
			continue;
		}

		const data = buildUpdateData(existing, payload);
		if (Object.keys(data).length) {
			updates.push({ id: existing.id, data });
		}
	}

	if (inserts.length) {
		await prisma.customerProfile.createMany({
			data: inserts,
		});
	}

	for (let index = 0; index < updates.length; index += UPDATE_CHUNK_SIZE) {
		const chunk = updates.slice(index, index + UPDATE_CHUNK_SIZE);
		await prisma.$transaction(
			chunk.map((item) =>
				prisma.customerProfile.update({
					where: { id: item.id },
					data: item.data,
				})
			)
		);
	}

	return {
		created: inserts.length,
		updated: updates.length,
		touched: inserts.length + updates.length,
	};
}

function buildConcurrentPageList(startPage) {
	return Array.from({ length: FETCH_CONCURRENCY }, (_, index) => startPage + index).filter(
		(page) => page <= MAX_PAGES
	);
}

export function getCustomerSyncState() {
	return { ...syncState };
}

export async function syncCustomers({ q = '' } = {}) {
	if (syncState.running) {
		throw new Error('Ya hay una sincronización de clientes en curso. Esperá a que termine.');
	}

	syncState.running = true;
	syncState.startedAt = new Date();

	try {
		const { storeId, accessToken } = await resolveStoreCredentials();

		let pagesFetched = 0;
		let customersFetched = 0;
		let customersUpserted = 0;
		let nextPage = 1;
		let shouldStop = false;

		while (nextPage <= MAX_PAGES && !shouldStop) {
			const pages = buildConcurrentPageList(nextPage);
			const results = await Promise.all(
				pages.map(async (page) => ({
					page,
					customers: await fetchCustomersPage({ storeId, accessToken, page, q }),
				}))
			);

			results.sort((left, right) => left.page - right.page);

			for (const result of results) {
				const batch = Array.isArray(result.customers) ? result.customers : [];

				if (!batch.length) {
					shouldStop = true;
					continue;
				}

				pagesFetched += 1;
				customersFetched += batch.length;

				const processed = await processCustomerChunk({ storeId, customers: batch });
				customersUpserted += processed.touched;

				if (batch.length < CUSTOMERS_PER_PAGE) {
					shouldStop = true;
				}
			}

			nextPage += FETCH_CONCURRENCY;
		}

		return {
			ok: true,
			storeId,
			pagesFetched,
			customersFetched,
			customersUpserted,
			customersTouched: customersUpserted,
			ordersUpserted: 0,
			pageSize: CUSTOMERS_PER_PAGE,
			concurrency: FETCH_CONCURRENCY,
		};
	} finally {
		syncState.running = false;
		syncState.startedAt = null;
	}
}
