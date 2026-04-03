
import { prisma } from '../lib/prisma.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';

const CUSTOMERS_PER_PAGE = Math.min(
	200,
	Math.max(50, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_PER_PAGE || 200))
);
const ORDERS_PER_PAGE = Math.min(
	200,
	Math.max(50, Number(process.env.TIENDANUBE_ORDERS_SYNC_PER_PAGE || 200))
);
const TIENDANUBE_QUERY_RESULT_LIMIT = 10000;
const ORDER_QUERY_PAGE_LIMIT = Math.max(1, Math.floor(TIENDANUBE_QUERY_RESULT_LIMIT / ORDERS_PER_PAGE));

const FETCH_CONCURRENCY = Math.min(
	6,
	Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_CONCURRENCY || 3))
);
const MAX_PAGES = Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_MAX_PAGES || 500));
const FETCH_RETRIES = Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_RETRIES || 4));
const UPDATE_CHUNK_SIZE = Math.max(10, Number(process.env.TIENDANUBE_CUSTOMERS_UPDATE_CHUNK_SIZE || 50));

const SYNC_STALE_MS = Math.max(60_000, Number(process.env.CUSTOMERS_SYNC_STALE_MS || 45 * 60 * 1000));

const syncState = {
	running: false,
	startedAt: null,
	finishedAt: null,
	lastHeartbeatAt: null,
	syncId: null,
	query: '',
	dateFrom: null,
	dateTo: null,
	lastResult: null,
	lastError: null,
};

function buildSyncStateSnapshot() {
	const now = Date.now();
	const startedMs = syncState.startedAt ? new Date(syncState.startedAt).getTime() : null;
	const heartbeatMs = syncState.lastHeartbeatAt ? new Date(syncState.lastHeartbeatAt).getTime() : null;
	const durationMs = startedMs ? Math.max(0, now - startedMs) : 0;
	const idleMs = heartbeatMs ? Math.max(0, now - heartbeatMs) : null;
	const isStale = Boolean(syncState.running && idleMs !== null && idleMs > SYNC_STALE_MS);

	return {
		running: Boolean(syncState.running),
		startedAt: syncState.startedAt,
		finishedAt: syncState.finishedAt,
		lastHeartbeatAt: syncState.lastHeartbeatAt,
		syncId: syncState.syncId,
		query: syncState.query,
		dateFrom: syncState.dateFrom,
		dateTo: syncState.dateTo,
		durationMs,
		idleMs,
		isStale,
		lastResult: syncState.lastResult,
		lastError: syncState.lastError,
	};
}

function touchSyncHeartbeat() {
	syncState.lastHeartbeatAt = new Date();
}

function clearSyncState() {
	syncState.running = false;
	syncState.startedAt = null;
	syncState.lastHeartbeatAt = null;
	syncState.syncId = null;
	syncState.query = '';
	syncState.dateFrom = null;
	syncState.dateTo = null;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanString(value = '') {
	const normalized = String(value ?? '').trim();
	return normalized || null;
}

function normalizePhone(value = '') {
	const digits = String(value || '').replace(/\D/g, '');
	return digits || null;
}

function normalizeEmail(value = '') {
	const email = String(value || '').trim().toLowerCase();
	return email || null;
}

function normalizeProductText(value = '') {
	return String(value || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/gi, ' ')
		.trim();
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

function toPositiveInt(value, fallback = 0) {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
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

function valuesEqual(left, right) {
	if (left === undefined || left === null) return right === undefined || right === null;
	if (right === undefined || right === null) return false;
	if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
	if (typeof left === 'object' || typeof right === 'object') {
		return JSON.stringify(left) === JSON.stringify(right);
	}
	return String(left) === String(right);
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

function buildConcurrentPageList(startPage) {
	return Array.from({ length: FETCH_CONCURRENCY }, (_, index) => startPage + index).filter(
		(page) => page <= MAX_PAGES
	);
}


function toIsoStringOrEmpty(value) {
	if (!value) return '';
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function buildDefaultOrderRange() {
	const start = new Date('2015-01-01T00:00:00.000Z');
	const end = new Date();
	return { start, end };
}

function splitDateRange(start, end) {
	const startMs = new Date(start).getTime();
	const endMs = new Date(end).getTime();

	if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
		return null;
	}

	const midMs = Math.floor((startMs + endMs) / 2);

	if (midMs <= startMs || midMs >= endMs) {
		return null;
	}

	return [
		{
			start: new Date(startMs),
			end: new Date(midMs),
		},
		{
			start: new Date(midMs + 1),
			end: new Date(endMs),
		},
	];
}


async function fetchTiendanubeList({
	storeId,
	accessToken,
	resource,
	page,
	perPage,
	fields,
	q = '',
	dateFrom = '',
	dateTo = '',
}) {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(perPage),
		fields,
	});

	if (q) params.set('q', q);
	if (dateFrom) params.set('created_at_min', dateFrom);
	if (dateTo) params.set('created_at_max', dateTo);

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/${resource}?${params.toString()}`;

	for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
		const response = await fetch(url, {
			method: 'GET',
			headers: buildHeaders(accessToken),
		});

		if (response.ok) {
			const data = await response.json();

			if (!Array.isArray(data)) {
				throw new Error(`La respuesta de Tiendanube en /${resource} no fue una lista.`);
			}

			return data;
		}

		const text = await response.text();
		const retryAfterHeader = Number(response.headers.get('retry-after') || 0);
		const retryable = response.status === 429 || response.status >= 500;

		if (!retryable || attempt === FETCH_RETRIES) {
			throw new Error(`Tiendanube ${resource} error ${response.status}: ${text}`);
		}

		const backoffMs = retryAfterHeader
			? retryAfterHeader * 1000
			: Math.min(8000, 500 * 2 ** (attempt - 1));

		await sleep(backoffMs);
	}

	return [];
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

	return fetchTiendanubeList({
		storeId,
		accessToken,
		resource: 'customers',
		page,
		perPage: CUSTOMERS_PER_PAGE,
		fields,
		q,
	});
}

async function fetchOrdersPage({
	storeId,
	accessToken,
	page,
	q = '',
	dateFrom = '',
	dateTo = '',
}) {
	const fields = [
		'id',
		'number',
		'token',
		'contact_email',
		'contact_phone',
		'contact_identification',
		'status',
		'payment_status',
		'shipping_status',
		'subtotal',
		'total',
		'currency',
		'gateway',
		'gateway_id',
		'gateway_name',
		'gateway_link',
		'created_at',
		'updated_at',
		'customer',
		'products',
	].join(',');

	return fetchTiendanubeList({
		storeId,
		accessToken,
		resource: 'orders',
		page,
		perPage: ORDERS_PER_PAGE,
		fields,
		q,
		dateFrom,
		dateTo,
	});
}

async function loadStoreProfiles(storeId) {
	const profiles = await prisma.customerProfile.findMany({
		where: { storeId },
		select: {
			id: true,
			storeId: true,
			externalCustomerId: true,
			displayName: true,
			email: true,
			normalizedEmail: true,
			phone: true,
			normalizedPhone: true,
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
			orderCount: true,
			paidOrderCount: true,
			distinctProductsCount: true,
			totalUnitsPurchased: true,
			totalSpent: true,
			currency: true,
			firstOrderAt: true,
			lastOrderAt: true,
			lastOrderId: true,
			lastOrderNumber: true,
			lastPaymentStatus: true,
			lastShippingStatus: true,
			productSummary: true,
			rawCustomerPayload: true,
			rawLastOrderPayload: true,
			syncedAt: true,
			createdAt: true,
			updatedAt: true,
		},
	});

	const byId = new Map();
	const byExternal = new Map();
	const byEmail = new Map();
	const byPhone = new Map();

	for (const profile of profiles) {
		byId.set(profile.id, profile);

		if (profile.externalCustomerId) {
			byExternal.set(
				profile.externalCustomerId,
				pickBestProfile(byExternal.get(profile.externalCustomerId), profile)
			);
		}

		if (profile.normalizedEmail) {
			byEmail.set(
				profile.normalizedEmail,
				pickBestProfile(byEmail.get(profile.normalizedEmail), profile)
			);
		}

		if (profile.normalizedPhone) {
			byPhone.set(
				profile.normalizedPhone,
				pickBestProfile(byPhone.get(profile.normalizedPhone), profile)
			);
		}
	}

	return { profiles, byId, byExternal, byEmail, byPhone };
}

function rememberProfile(cache, profile) {
	if (!profile?.id) return;

	cache.byId.set(profile.id, profile);
	if (profile.externalCustomerId) {
		cache.byExternal.set(
			profile.externalCustomerId,
			pickBestProfile(cache.byExternal.get(profile.externalCustomerId), profile)
		);
	}
	if (profile.normalizedEmail) {
		cache.byEmail.set(
			profile.normalizedEmail,
			pickBestProfile(cache.byEmail.get(profile.normalizedEmail), profile)
		);
	}
	if (profile.normalizedPhone) {
		cache.byPhone.set(
			profile.normalizedPhone,
			pickBestProfile(cache.byPhone.get(profile.normalizedPhone), profile)
		);
	}
}

function resolveProfileFromIdentity(cache, payload = {}) {
	return (
		(payload.externalCustomerId && cache.byExternal.get(payload.externalCustomerId)) ||
		(payload.normalizedEmail && cache.byEmail.get(payload.normalizedEmail)) ||
		(payload.normalizedPhone && cache.byPhone.get(payload.normalizedPhone)) ||
		null
	);
}

async function upsertCustomerProfilesFromBatch({ storeId, customers, cache }) {
	if (!customers.length) {
		return { created: 0, updated: 0 };
	}

	const updates = [];
	let created = 0;

	for (const customer of customers) {
		const payload = buildCustomerProfilePayload(customer, storeId);
		const existing = resolveProfileFromIdentity(cache, payload);

		if (!existing) {
			const createdProfile = await prisma.customerProfile.create({
				data: {
					...payload,
					orderCount: 0,
					paidOrderCount: 0,
					distinctProductsCount: 0,
					totalUnitsPurchased: 0,
				},
			});

			rememberProfile(cache, createdProfile);
			created += 1;
			continue;
		}

		const nextData = buildUpdateData(existing, payload);

		if (!Object.keys(nextData).length) {
			continue;
		}

		updates.push({ id: existing.id, data: nextData });
	}

	for (let index = 0; index < updates.length; index += UPDATE_CHUNK_SIZE) {
		const chunk = updates.slice(index, index + UPDATE_CHUNK_SIZE);

		const updatedProfiles = await prisma.$transaction(
			chunk.map((item) =>
				prisma.customerProfile.update({
					where: { id: item.id },
					data: item.data,
				})
			)
		);

		for (const profile of updatedProfiles) {
			rememberProfile(cache, profile);
		}
	}

	return { created, updated: updates.length };
}

function buildOrderPayload(order = {}) {
	const customer = order?.customer ?? {};
	const normalizedEmail = normalizeEmail(order?.contact_email || customer?.email);
	const normalizedPhone = normalizePhone(order?.contact_phone || customer?.phone);

	return {
		orderId: order?.id ? String(order.id) : null,
		orderNumber: order?.number ? String(order.number) : null,
		token: cleanString(order?.token),
		externalCustomerId: customer?.id ? String(customer.id) : null,
		displayName: cleanString(customer?.name || order?.name),
		contactName: cleanString(customer?.name || order?.name),
		contactEmail: cleanString(order?.contact_email || customer?.email),
		normalizedEmail,
		contactPhone: cleanString(order?.contact_phone || customer?.phone),
		normalizedPhone,
		contactIdentification: cleanString(order?.contact_identification || customer?.identification),
		status: cleanString(order?.status),
		paymentStatus: cleanString(order?.payment_status),
		shippingStatus: cleanString(order?.shipping_status),
		subtotal: toDecimalOrNull(order?.subtotal),
		totalAmount: toDecimalOrNull(order?.total),
		currency: cleanString(order?.currency),
		gateway: cleanString(order?.gateway),
		gatewayId: cleanString(order?.gateway_id),
		gatewayName: cleanString(order?.gateway_name),
		gatewayLink: cleanString(order?.gateway_link),
		orderCreatedAt: parseDateOrNull(order?.created_at),
		orderUpdatedAt: parseDateOrNull(order?.updated_at),
		products: Array.isArray(order?.products) ? order.products : [],
		rawPayload: order,
	};
}

function ensureProfileFromOrderPayload(cache, storeId, payload) {
	const existing = resolveProfileFromIdentity(cache, payload);
	if (existing) return existing;

	return prisma.customerProfile.create({
		data: {
			storeId,
			externalCustomerId: payload.externalCustomerId || null,
			displayName: payload.displayName || payload.contactName || null,
			email: payload.contactEmail || null,
			normalizedEmail: payload.normalizedEmail || null,
			phone: payload.contactPhone || null,
			normalizedPhone: payload.normalizedPhone || null,
			identification: payload.contactIdentification || null,
			orderCount: 0,
			paidOrderCount: 0,
			distinctProductsCount: 0,
			totalUnitsPurchased: 0,
			currency: payload.currency || 'ARS',
			syncedAt: new Date(),
		},
	});
}

function buildItemRows({ orderRecordId, profileId, storeId, orderPayload }) {
	const products = Array.isArray(orderPayload.products) ? orderPayload.products : [];

	return products.map((item, index) => {
		const quantity = Math.max(1, toPositiveInt(item?.quantity, 1));
		const unitPrice = toDecimalOrNull(item?.price);
		const lineTotalValue =
			item?.price !== undefined && item?.price !== null && item?.quantity !== undefined
				? String(Number(item.price || 0) * quantity)
				: null;

		const variantValues = Array.isArray(item?.variant_values) ? item.variant_values : [];
		const variantPieces = variantValues
			.map((entry) => cleanString(entry?.value || entry?.name || entry))
			.filter(Boolean);

		const variantName = variantPieces.join(' / ') || cleanString(item?.variant_name) || null;
		const name = cleanString(item?.name) || `Producto ${index + 1}`;
		const normalizedName = normalizeProductText([name, variantName].filter(Boolean).join(' '));

		return {
			customerOrderId: orderRecordId,
			customerProfileId: profileId,
			storeId,
			orderId: orderPayload.orderId,
			orderNumber: orderPayload.orderNumber,
			productId: item?.product_id ? String(item.product_id) : null,
			variantId: item?.variant_id ? String(item.variant_id) : null,
			lineItemId: item?.id ? String(item.id) : null,
			sku: cleanString(item?.sku),
			barcode: cleanString(item?.barcode),
			name,
			normalizedName: normalizedName || normalizeProductText(name),
			variantName,
			quantity,
			unitPrice,
			lineTotal: lineTotalValue,
			imageUrl: cleanString(item?.image?.src),
			rawPayload: item,
			orderCreatedAt: orderPayload.orderCreatedAt,
		};
	});
}

function createMetricsEntry(profile) {
	return {
		profileId: profile.id,
		currency: profile.currency || 'ARS',
		apiTotalSpent: Number(profile.totalSpent || 0),
		orderCount: 0,
		paidOrderCount: 0,
		totalUnitsPurchased: 0,
		totalSpentFromOrders: 0,
		firstOrderAt: null,
		lastOrderAt: null,
		lastOrderId: null,
		lastOrderNumber: null,
		lastPaymentStatus: null,
		lastShippingStatus: null,
		rawLastOrderPayload: null,
		productMap: new Map(),
	};
}

function touchMetrics(metrics, orderPayload, itemRows = []) {
	metrics.currency = orderPayload.currency || metrics.currency || 'ARS';
	metrics.orderCount += 1;

	if (orderPayload.paymentStatus === 'paid') {
		metrics.paidOrderCount += 1;
		metrics.totalSpentFromOrders += Number(orderPayload.totalAmount || 0);
	}

	const orderCreatedAt = orderPayload.orderCreatedAt || orderPayload.orderUpdatedAt || null;

	if (orderCreatedAt) {
		if (!metrics.firstOrderAt || orderCreatedAt < metrics.firstOrderAt) {
			metrics.firstOrderAt = orderCreatedAt;
		}

		if (!metrics.lastOrderAt || orderCreatedAt > metrics.lastOrderAt) {
			metrics.lastOrderAt = orderCreatedAt;
			metrics.lastOrderId = orderPayload.orderId;
			metrics.lastOrderNumber = orderPayload.orderNumber;
			metrics.lastPaymentStatus = orderPayload.paymentStatus;
			metrics.lastShippingStatus = orderPayload.shippingStatus;
			metrics.rawLastOrderPayload = orderPayload.rawPayload;
		}
	}

	for (const item of itemRows) {
		metrics.totalUnitsPurchased += Number(item.quantity || 0);

		const productKey = item.productId || item.normalizedName || item.name;
		const existing = metrics.productMap.get(productKey) || {
			productId: item.productId || null,
			name: item.name,
			variantNames: new Set(),
			totalQuantity: 0,
			ordersCount: 0,
			lastOrderAt: null,
		};

		existing.totalQuantity += Number(item.quantity || 0);
		existing.ordersCount += 1;
		if (item.variantName) existing.variantNames.add(item.variantName);
		if (!existing.lastOrderAt || (item.orderCreatedAt && item.orderCreatedAt > existing.lastOrderAt)) {
			existing.lastOrderAt = item.orderCreatedAt || existing.lastOrderAt;
		}

		metrics.productMap.set(productKey, existing);
	}
}

function buildProductSummary(metrics) {
	return [...metrics.productMap.values()]
		.sort((left, right) => {
			if (right.totalQuantity !== left.totalQuantity) {
				return right.totalQuantity - left.totalQuantity;
			}
			if (right.ordersCount !== left.ordersCount) {
				return right.ordersCount - left.ordersCount;
			}
			const leftTime = left.lastOrderAt ? new Date(left.lastOrderAt).getTime() : 0;
			const rightTime = right.lastOrderAt ? new Date(right.lastOrderAt).getTime() : 0;
			return rightTime - leftTime;
		})
		.slice(0, 8)
		.map((entry) => ({
			productId: entry.productId,
			name: entry.name,
			totalQuantity: entry.totalQuantity,
			ordersCount: entry.ordersCount,
			lastOrderAt: entry.lastOrderAt || null,
			variants: [...entry.variantNames].slice(0, 3),
		}));
}

async function upsertOrderAndItems({ storeId, profile, orderPayload }) {
	const orderRecord = await prisma.customerOrder.upsert({
		where: {
			storeId_orderId: {
				storeId,
				orderId: orderPayload.orderId,
			},
		},
		update: {
			customerProfileId: profile.id,
			orderNumber: orderPayload.orderNumber,
			token: orderPayload.token,
			contactName: orderPayload.contactName,
			contactEmail: orderPayload.contactEmail,
			normalizedEmail: orderPayload.normalizedEmail,
			contactPhone: orderPayload.contactPhone,
			normalizedPhone: orderPayload.normalizedPhone,
			contactIdentification: orderPayload.contactIdentification,
			status: orderPayload.status,
			paymentStatus: orderPayload.paymentStatus,
			shippingStatus: orderPayload.shippingStatus,
			subtotal: orderPayload.subtotal,
			totalAmount: orderPayload.totalAmount,
			currency: orderPayload.currency,
			gateway: orderPayload.gateway,
			gatewayId: orderPayload.gatewayId,
			gatewayName: orderPayload.gatewayName,
			gatewayLink: orderPayload.gatewayLink,
			products: orderPayload.products,
			rawPayload: orderPayload.rawPayload,
			orderCreatedAt: orderPayload.orderCreatedAt,
			orderUpdatedAt: orderPayload.orderUpdatedAt,
		},
		create: {
			customerProfileId: profile.id,
			storeId,
			orderId: orderPayload.orderId,
			orderNumber: orderPayload.orderNumber,
			token: orderPayload.token,
			contactName: orderPayload.contactName,
			contactEmail: orderPayload.contactEmail,
			normalizedEmail: orderPayload.normalizedEmail,
			contactPhone: orderPayload.contactPhone,
			normalizedPhone: orderPayload.normalizedPhone,
			contactIdentification: orderPayload.contactIdentification,
			status: orderPayload.status,
			paymentStatus: orderPayload.paymentStatus,
			shippingStatus: orderPayload.shippingStatus,
			subtotal: orderPayload.subtotal,
			totalAmount: orderPayload.totalAmount,
			currency: orderPayload.currency,
			gateway: orderPayload.gateway,
			gatewayId: orderPayload.gatewayId,
			gatewayName: orderPayload.gatewayName,
			gatewayLink: orderPayload.gatewayLink,
			products: orderPayload.products,
			rawPayload: orderPayload.rawPayload,
			orderCreatedAt: orderPayload.orderCreatedAt,
			orderUpdatedAt: orderPayload.orderUpdatedAt,
		},
	});

	const itemRows = buildItemRows({
		orderRecordId: orderRecord.id,
		profileId: profile.id,
		storeId,
		orderPayload,
	});

	await prisma.$transaction(async (tx) => {
		await tx.customerOrderItem.deleteMany({
			where: { customerOrderId: orderRecord.id },
		});

		if (itemRows.length) {
			await tx.customerOrderItem.createMany({
				data: itemRows,
			});
		}
	});

	return {
		orderRecord,
		itemRows,
	};
}

async function refreshProfileMetrics({ storeId, cache, metricsByProfileId }) {
	const updates = [];

	for (const profile of cache.byId.values()) {
		const metrics = metricsByProfileId.get(profile.id) || createMetricsEntry(profile);
		const distinctProductsCount = metrics.productMap.size;
		const productSummary = buildProductSummary(metrics);

		const resolvedTotalSpent = Math.max(
			Number(profile.totalSpent || 0),
			Number(metrics.totalSpentFromOrders || 0)
		);

		updates.push({
			id: profile.id,
			data: {
				orderCount: metrics.orderCount,
				paidOrderCount: metrics.paidOrderCount,
				distinctProductsCount,
				totalUnitsPurchased: metrics.totalUnitsPurchased,
				totalSpent: toDecimalOrNull(resolvedTotalSpent),
				currency: metrics.currency || profile.currency || 'ARS',
				firstOrderAt: metrics.firstOrderAt,
				lastOrderAt: metrics.lastOrderAt,
				lastOrderId: metrics.lastOrderId,
				lastOrderNumber: metrics.lastOrderNumber,
				lastPaymentStatus: metrics.lastPaymentStatus,
				lastShippingStatus: metrics.lastShippingStatus,
				productSummary,
				rawLastOrderPayload: metrics.rawLastOrderPayload,
				syncedAt: new Date(),
			},
		});
	}

	for (let index = 0; index < updates.length; index += UPDATE_CHUNK_SIZE) {
		const chunk = updates.slice(index, index + UPDATE_CHUNK_SIZE);

		const refreshed = await prisma.$transaction(
			chunk.map((item) =>
				prisma.customerProfile.update({
					where: { id: item.id },
					data: item.data,
				})
			)
		);

		for (const profile of refreshed) {
			rememberProfile(cache, profile);
		}
	}
}

async function syncCustomersBaseProfiles({ storeId, accessToken, q, cache }) {
	let pagesFetched = 0;
	let customersFetched = 0;
	let customersTouched = 0;
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

			const processed = await upsertCustomerProfilesFromBatch({
				storeId,
				customers: batch,
				cache,
			});

			customersTouched += processed.created + processed.updated;

			if (batch.length < CUSTOMERS_PER_PAGE) {
				shouldStop = true;
			}
		}

		nextPage += FETCH_CONCURRENCY;
	}

	return {
		pagesFetched,
		customersFetched,
		customersTouched,
	};
}

async function syncOrderWindow({
	storeId,
	accessToken,
	q,
	startDate,
	endDate,
	cache,
	metricsByProfileId,
}) {
	let pagesFetched = 0;
	let ordersFetched = 0;
	let ordersUpserted = 0;
	let nextPage = 1;
	let shouldStop = false;
	let hitQueryLimit = false;

	const dateFrom = toIsoStringOrEmpty(startDate);
	const dateTo = toIsoStringOrEmpty(endDate);

	while (nextPage <= MAX_PAGES && !shouldStop) {
		const pages = buildConcurrentPageList(nextPage).filter(
			(page) => page <= ORDER_QUERY_PAGE_LIMIT
		);

		if (!pages.length) {
			hitQueryLimit = true;
			break;
		}

		const results = await Promise.all(
			pages.map(async (page) => ({
				page,
				orders: await fetchOrdersPage({
					storeId,
					accessToken,
					page,
					q,
					dateFrom,
					dateTo,
				}),
			}))
		);

		results.sort((left, right) => left.page - right.page);

		for (const result of results) {
			const batch = Array.isArray(result.orders) ? result.orders : [];

			if (!batch.length) {
				shouldStop = true;
				continue;
			}

			pagesFetched += 1;
			ordersFetched += batch.length;

			for (const rawOrder of batch) {
				const orderPayload = buildOrderPayload(rawOrder);

				if (!orderPayload.orderId) {
					continue;
				}

				let profile = resolveProfileFromIdentity(cache, orderPayload);

				if (!profile) {
					profile = await ensureProfileFromOrderPayload(cache, storeId, orderPayload);
					rememberProfile(cache, profile);
				}

				const profilePatch = {};
				if (!profile.externalCustomerId && orderPayload.externalCustomerId) {
					profilePatch.externalCustomerId = orderPayload.externalCustomerId;
				}
				if (!profile.displayName && orderPayload.displayName) {
					profilePatch.displayName = orderPayload.displayName;
				}
				if (!profile.email && orderPayload.contactEmail) {
					profilePatch.email = orderPayload.contactEmail;
					profilePatch.normalizedEmail = orderPayload.normalizedEmail;
				}
				if (!profile.phone && orderPayload.contactPhone) {
					profilePatch.phone = orderPayload.contactPhone;
					profilePatch.normalizedPhone = orderPayload.normalizedPhone;
				}
				if (!profile.identification && orderPayload.contactIdentification) {
					profilePatch.identification = orderPayload.contactIdentification;
				}

				if (Object.keys(profilePatch).length) {
					profile = await prisma.customerProfile.update({
						where: { id: profile.id },
						data: profilePatch,
					});
					rememberProfile(cache, profile);
				}

				const { itemRows } = await upsertOrderAndItems({
					storeId,
					profile,
					orderPayload,
				});

				ordersUpserted += 1;

				const metrics =
					metricsByProfileId.get(profile.id) || createMetricsEntry(profile);

				touchMetrics(metrics, orderPayload, itemRows);
				metricsByProfileId.set(profile.id, metrics);
			}

			if (batch.length < ORDERS_PER_PAGE) {
				shouldStop = true;
			}
		}

		if (!shouldStop && pages[pages.length - 1] >= ORDER_QUERY_PAGE_LIMIT) {
			hitQueryLimit = true;
			break;
		}

		nextPage += FETCH_CONCURRENCY;
	}

	return {
		pagesFetched,
		ordersFetched,
		ordersUpserted,
		hitQueryLimit,
	};
}

async function syncOrdersByDateRange({
	storeId,
	accessToken,
	q,
	startDate,
	endDate,
	cache,
	metricsByProfileId,
}) {
	const result = await syncOrderWindow({
		storeId,
		accessToken,
		q,
		startDate,
		endDate,
		cache,
		metricsByProfileId,
	});

	if (!result.hitQueryLimit) {
		return result;
	}

	const ranges = splitDateRange(startDate, endDate);

	if (!ranges) {
		return result;
	}

	const left = await syncOrdersByDateRange({
		storeId,
		accessToken,
		q,
		startDate: ranges[0].start,
		endDate: ranges[0].end,
		cache,
		metricsByProfileId,
	});

	const right = await syncOrdersByDateRange({
		storeId,
		accessToken,
		q,
		startDate: ranges[1].start,
		endDate: ranges[1].end,
		cache,
		metricsByProfileId,
	});

	return {
		pagesFetched: left.pagesFetched + right.pagesFetched,
		ordersFetched: left.ordersFetched + right.ordersFetched,
		ordersUpserted: left.ordersUpserted + right.ordersUpserted,
		hitQueryLimit: false,
	};
}

async function syncOrdersAndMetrics({
	storeId,
	accessToken,
	q,
	dateFrom,
	dateTo,
	cache,
}) {
	const metricsByProfileId = new Map();
	const defaultRange = buildDefaultOrderRange();
	const startDate = dateFrom ? new Date(dateFrom) : defaultRange.start;
	const endDate = dateTo ? new Date(dateTo) : defaultRange.end;

	const result = await syncOrdersByDateRange({
		storeId,
		accessToken,
		q,
		startDate,
		endDate,
		cache,
		metricsByProfileId,
	});

	await refreshProfileMetrics({
		storeId,
		cache,
		metricsByProfileId,
	});

	return {
		pagesFetched: result.pagesFetched,
		ordersFetched: result.ordersFetched,
		ordersUpserted: result.ordersUpserted,
	};
}

export function getCustomerSyncState() {
	return buildSyncStateSnapshot();
}

export function resetCustomerSyncState() {
	clearSyncState();
	syncState.finishedAt = new Date();
	syncState.lastError = null;
	syncState.lastResult = null;
	return getCustomerSyncState();
}

export async function syncCustomers({
	q = '',
	dateFrom = '',
	dateTo = '',
} = {}) {
	const currentState = getCustomerSyncState();

	if (currentState.running && !currentState.isStale) {
		const conflictError = new Error('Ya hay una sincronización de clientes en curso. Esperá a que termine.');
		conflictError.code = 'CUSTOMER_SYNC_IN_PROGRESS';
		conflictError.statusCode = 409;
		conflictError.syncState = currentState;
		throw conflictError;
	}

	if (currentState.running && currentState.isStale) {
		console.warn('[CUSTOMERS SYNC] Detecté un lock viejo y lo libero automáticamente.', currentState);
		clearSyncState();
	}

	syncState.running = true;
	syncState.startedAt = new Date();
	syncState.finishedAt = null;
	syncState.lastHeartbeatAt = new Date();
	syncState.syncId = `customers-sync-${Date.now()}`;
	syncState.query = q || '';
	syncState.dateFrom = dateFrom || null;
	syncState.dateTo = dateTo || null;
	syncState.lastResult = null;
	syncState.lastError = null;

	const startedAt = new Date();
	let syncLog = null;

	try {
		const { storeId, accessToken } = await resolveStoreCredentials();
		touchSyncHeartbeat();

		const cache = await loadStoreProfiles(storeId);
		touchSyncHeartbeat();

		if (prisma.customerSyncLog) {
			syncLog = await prisma.customerSyncLog.create({
				data: {
					storeId,
					status: 'RUNNING',
					fullSync: !q && !dateFrom && !dateTo,
					startedAt,
				},
			});
		}

		const customersResult = await syncCustomersBaseProfiles({
			storeId,
			accessToken,
			q,
			cache,
		});
		touchSyncHeartbeat();

		const ordersResult = await syncOrdersAndMetrics({
			storeId,
			accessToken,
			q,
			dateFrom,
			dateTo,
			cache,
		});
		touchSyncHeartbeat();

		const result = {
			ok: true,
			storeId,
			pagesFetched: customersResult.pagesFetched,
			customersFetched: customersResult.customersFetched,
			customersUpserted: customersResult.customersTouched,
			customersTouched: customersResult.customersTouched,
			orderPagesFetched: ordersResult.pagesFetched,
			ordersFetched: ordersResult.ordersFetched,
			ordersUpserted: ordersResult.ordersUpserted,
			pageSize: CUSTOMERS_PER_PAGE,
			orderPageSize: ORDERS_PER_PAGE,
			concurrency: FETCH_CONCURRENCY,
			dateFrom: dateFrom || null,
			dateTo: dateTo || null,
			durationMs: Date.now() - startedAt.getTime(),
		};

		syncState.lastResult = result;
		syncState.finishedAt = new Date();

		if (syncLog) {
			await prisma.customerSyncLog.update({
				where: { id: syncLog.id },
				data: {
					status: 'SUCCESS',
					finishedAt: new Date(),
					pagesFetched: result.pagesFetched + result.orderPagesFetched,
					ordersFetched: result.ordersFetched,
					ordersUpserted: result.ordersUpserted,
					customersTouched: result.customersTouched,
				},
			});
		}

		return result;
	} catch (error) {
		syncState.lastError = {
			message: error.message || 'Error desconocido',
			code: error.code || null,
			at: new Date(),
		};
		syncState.finishedAt = new Date();

		if (syncLog) {
			await prisma.customerSyncLog.update({
				where: { id: syncLog.id },
				data: {
					status: 'FAILED',
					finishedAt: new Date(),
					message: error.message?.slice(0, 1000) || 'Error desconocido',
				},
			});
		}

		throw error;
	} finally {
		clearSyncState();
		syncState.finishedAt = new Date();
	}
}
