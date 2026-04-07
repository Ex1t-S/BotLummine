import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const CUSTOMERS_PER_PAGE = Math.min(
	200,
	Math.max(50, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_PER_PAGE || 100))
);
const ORDERS_PER_PAGE = Math.min(
	200,
	Math.max(50, Number(process.env.TIENDANUBE_ORDERS_SYNC_PER_PAGE || 100))
);
const TIENDANUBE_QUERY_RESULT_LIMIT = 10000;
const ORDER_QUERY_PAGE_LIMIT = Math.max(1, Math.floor(TIENDANUBE_QUERY_RESULT_LIMIT / ORDERS_PER_PAGE));
const FETCH_CONCURRENCY = Math.min(
	8,
	Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_CONCURRENCY || 4))
);
const MAX_CUSTOMER_PAGES = Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_MAX_PAGES || 100));
const FETCH_RETRIES = Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_RETRIES || 3));
const UPDATE_CHUNK_SIZE = Math.max(25, Number(process.env.TIENDANUBE_CUSTOMERS_UPDATE_CHUNK_SIZE || 250));
const ORDERS_SYNC_MONTHS_BACK = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_SYNC_MONTHS_BACK || 2));
const ORDER_SYNC_BUFFER_DAYS = Math.max(1, Number(process.env.TIENDANUBE_ORDER_SYNC_BUFFER_DAYS || 2));

const syncState = {
	running: false,
	startedAt: null,
};

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
			'Faltan credenciales de Tiendanube. Necesitás StoreInstallation cargada o TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN en el .env.'
		);
	}

	return {
		storeId: String(storeId),
		accessToken,
	};
}

async function fetchJson(url, accessToken, resourceLabel) {
	let lastError = null;

	for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: buildHeaders(accessToken),
			});

			if (!response.ok) {
				const text = await response.text();
				throw new Error(`${resourceLabel}: Tiendanube respondió ${response.status} - ${text}`);
			}

			return await response.json();
		} catch (error) {
			lastError = error;

			if (attempt < FETCH_RETRIES) {
				await sleep(350 * attempt);
				continue;
			}
		}
	}

	throw lastError || new Error(`No se pudo obtener ${resourceLabel} de Tiendanube.`);
}

function buildConcurrentPageList(pageStart, maxPage, concurrency) {
	const pages = [];

	for (let offset = 0; offset < concurrency; offset += 1) {
		const nextPage = pageStart + offset;
		if (nextPage > maxPage) break;
		pages.push(nextPage);
	}

	return pages;
}

async function fetchCustomersPage({ storeId, accessToken, page, q = '', dateFrom = '', dateTo = '' }) {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(CUSTOMERS_PER_PAGE),
	});

	if (q) params.set('q', q);
	if (dateFrom) params.set('updated_at_min', new Date(`${dateFrom}T00:00:00.000Z`).toISOString());
	if (dateTo) params.set('updated_at_max', new Date(`${dateTo}T23:59:59.999Z`).toISOString());

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/customers?${params.toString()}`;
	const payload = await fetchJson(url, accessToken, `clientes página ${page}`);

	if (!Array.isArray(payload)) {
		throw new Error('La respuesta de Tiendanube para clientes no fue una lista.');
	}

	return payload;
}

async function fetchOrdersPage({
	storeId,
	accessToken,
	page,
	windowStart,
	windowEnd,
	q = '',
}) {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(ORDERS_PER_PAGE),
		created_at_min: windowStart.toISOString(),
		created_at_max: windowEnd.toISOString(),
		fields: [
			'id',
			'number',
			'token',
			'store_id',
			'customer',
			'contact_name',
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
			'products',
		].join(','),
	});

	if (q) params.set('q', q);

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/orders?${params.toString()}`;
	const payload = await fetchJson(url, accessToken, `pedidos página ${page}`);

	if (!Array.isArray(payload)) {
		throw new Error('La respuesta de Tiendanube para pedidos no fue una lista.');
	}

	return payload;
}

function mapCustomerPayload(customer, storeId) {
	const totalSpent = toDecimalOrNull(customer?.total_spent);
	const currency = cleanString(customer?.total_spent_currency) || 'ARS';

	return {
		storeId,
		externalCustomerId: cleanString(customer?.id),
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
		addresses: Array.isArray(customer?.addresses) ? customer.addresses : [],
		billingAddress: cleanString(customer?.billing_address),
		billingNumber: cleanString(customer?.billing_number),
		billingFloor: cleanString(customer?.billing_floor),
		billingLocality: cleanString(customer?.billing_locality),
		billingZipcode: cleanString(customer?.billing_zipcode),
		billingCity: cleanString(customer?.billing_city),
		billingProvince: cleanString(customer?.billing_province),
		billingCountry: cleanString(customer?.billing_country),
		billingPhone: cleanString(customer?.billing_phone),
		totalSpent,
		currency,
		lastOrderId: cleanString(customer?.last_order_id),
		rawCustomerPayload: customer,
		syncedAt: new Date(),
	};
}

function mapOrderPayload(order, storeId, customerProfileId) {
	return {
		customerProfileId,
		storeId,
		orderId: String(order?.id),
		orderNumber: cleanString(order?.number),
		token: cleanString(order?.token),
		contactName: cleanString(order?.contact_name || order?.customer?.name),
		contactEmail: cleanString(order?.contact_email || order?.customer?.email),
		normalizedEmail: normalizeEmail(order?.contact_email || order?.customer?.email),
		contactPhone: cleanString(order?.contact_phone || order?.customer?.phone),
		normalizedPhone: normalizePhone(order?.contact_phone || order?.customer?.phone),
		contactIdentification: cleanString(order?.contact_identification),
		status: cleanString(order?.status),
		paymentStatus: cleanString(order?.payment_status),
		shippingStatus: cleanString(order?.shipping_status),
		subtotal: toDecimalOrNull(order?.subtotal),
		totalAmount: toDecimalOrNull(order?.total),
		currency: cleanString(order?.currency) || 'ARS',
		gateway: cleanString(order?.gateway),
		gatewayId: cleanString(order?.gateway_id),
		gatewayName: cleanString(order?.gateway_name),
		gatewayLink: cleanString(order?.gateway_link),
		products: Array.isArray(order?.products) ? order.products : [],
		rawPayload: order,
		orderCreatedAt: parseDateOrNull(order?.created_at),
		orderUpdatedAt: parseDateOrNull(order?.updated_at),
	};
}

function buildOrderItems(order, storeId, customerOrderId, customerProfileId) {
	const products = Array.isArray(order?.products) ? order.products : [];

	return products.map((product) => {
		const quantity = Math.max(1, Number(product?.quantity || 1));
		const unitPrice = Number(product?.price || 0);
		const lineTotal = unitPrice * quantity;

		const variantValues = Array.isArray(product?.variant_values) ? product.variant_values : [];
		const variantName = variantValues
			.map((value) => cleanString(value?.value || value?.name))
			.filter(Boolean)
			.join(' / ');

		const productName =
			cleanString(product?.name || product?.name_without_variants || product?.title) || 'Producto sin nombre';

		return {
			customerOrderId,
			customerProfileId,
			storeId,
			orderId: String(order?.id),
			orderNumber: cleanString(order?.number),
			productId: cleanString(product?.product_id ?? product?.productId),
			variantId: cleanString(product?.variant_id ?? product?.variantId),
			lineItemId: cleanString(product?.id),
			sku: cleanString(product?.sku),
			barcode: cleanString(product?.barcode),
			name: productName,
			normalizedName: normalizeProductText(productName),
			variantName: cleanString(variantName),
			quantity,
			unitPrice: toDecimalOrNull(product?.price),
			lineTotal: Number.isFinite(lineTotal) ? String(lineTotal) : null,
			imageUrl: cleanString(product?.image?.src || product?.image_url),
			rawPayload: product,
			orderCreatedAt: parseDateOrNull(order?.created_at),
		};
	});
}

function buildProductSummary(items = []) {
	const productMap = new Map();

	for (const item of items) {
		const key = item.normalizedName || item.name || 'producto';
		const current = productMap.get(key) || {
			name: item.name || 'Producto',
			totalQuantity: 0,
			variants: new Set(),
		};

		current.totalQuantity += Number(item.quantity || 0);
		if (item.variantName) current.variants.add(item.variantName);

		productMap.set(key, current);
	}

	return Array.from(productMap.values())
		.sort((a, b) => b.totalQuantity - a.totalQuantity || a.name.localeCompare(b.name))
		.slice(0, 8)
		.map((entry) => ({
			name: entry.name,
			totalQuantity: entry.totalQuantity,
			variants: Array.from(entry.variants).slice(0, 4),
		}));
}

function isPaidStatus(value = '') {
	return ['paid', 'partially_paid'].includes(String(value || '').trim().toLowerCase());
}

function chunkArray(values = [], size = 50) {
	const chunks = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
}

function buildProfileIndexes(profiles = []) {
	const byExternalCustomerId = new Map();
	const byNormalizedEmail = new Map();
	const byNormalizedPhone = new Map();

	for (const profile of profiles) {
		if (profile.externalCustomerId) byExternalCustomerId.set(String(profile.externalCustomerId), profile);
		if (profile.normalizedEmail) byNormalizedEmail.set(profile.normalizedEmail, profile);
		if (profile.normalizedPhone) byNormalizedPhone.set(profile.normalizedPhone, profile);
	}

	return {
		byExternalCustomerId,
		byNormalizedEmail,
		byNormalizedPhone,
	};
}

function registerProfileInIndexes(indexes, profile) {
	if (!profile) return;

	if (profile.externalCustomerId) {
		indexes.byExternalCustomerId.set(String(profile.externalCustomerId), profile);
	}

	if (profile.normalizedEmail) {
		indexes.byNormalizedEmail.set(profile.normalizedEmail, profile);
	}

	if (profile.normalizedPhone) {
		indexes.byNormalizedPhone.set(profile.normalizedPhone, profile);
	}
}
function buildCustomerProfileDefaults(data) {
	return {
		...data,
		orderCount: 0,
		paidOrderCount: 0,
		distinctProductsCount: 0,
		totalUnitsPurchased: 0,
		productSummary: [],
	};
}

function buildUniqueOwnerKey(type, value) {
	return `${type}:${value}`;
}

async function sanitizeCustomerPayloadsForBulk(storeId, payloads = []) {
	if (!payloads.length) return payloads;

	const emailSet = new Set();
	const phoneSet = new Set();

	for (const payload of payloads) {
		if (payload.normalizedEmail) emailSet.add(payload.normalizedEmail);
		if (payload.normalizedPhone) phoneSet.add(payload.normalizedPhone);
	}

	const or = [];
	if (emailSet.size) or.push({ normalizedEmail: { in: Array.from(emailSet) } });
	if (phoneSet.size) or.push({ normalizedPhone: { in: Array.from(phoneSet) } });

	const existingProfiles = or.length
		? await prisma.customerProfile.findMany({
			where: { storeId, OR: or },
			select: {
				externalCustomerId: true,
				normalizedEmail: true,
				normalizedPhone: true,
			},
		})
		: [];

	const owners = new Map();
	for (const profile of existingProfiles) {
		if (profile.normalizedEmail) {
			owners.set(buildUniqueOwnerKey('email', profile.normalizedEmail), String(profile.externalCustomerId || ''));
		}
		if (profile.normalizedPhone) {
			owners.set(buildUniqueOwnerKey('phone', profile.normalizedPhone), String(profile.externalCustomerId || ''));
		}
	}

	const seenInBatch = new Map();

	return payloads.map((payload) => {
		const next = { ...payload };
		const externalCustomerId = String(next.externalCustomerId || '');

		if (next.normalizedEmail) {
			const ownerKey = buildUniqueOwnerKey('email', next.normalizedEmail);
			const existingOwner = owners.get(ownerKey);
			const batchOwner = seenInBatch.get(ownerKey);

			if ((existingOwner && existingOwner !== externalCustomerId) || (batchOwner && batchOwner !== externalCustomerId)) {
				next.normalizedEmail = null;
			} else {
				seenInBatch.set(ownerKey, externalCustomerId);
			}
		}

		if (next.normalizedPhone) {
			const ownerKey = buildUniqueOwnerKey('phone', next.normalizedPhone);
			const existingOwner = owners.get(ownerKey);
			const batchOwner = seenInBatch.get(ownerKey);

			if ((existingOwner && existingOwner !== externalCustomerId) || (batchOwner && batchOwner !== externalCustomerId)) {
				next.normalizedPhone = null;
			} else {
				seenInBatch.set(ownerKey, externalCustomerId);
			}
		}

		return next;
	});
}

async function bulkUpsertCustomerProfilesByExternalId(payloads = []) {
	if (!payloads.length) return 0;

	for (const batch of chunkArray(payloads, CUSTOMERS_BULK_UPSERT_CHUNK_SIZE)) {
		const now = new Date();
		const rows = batch.map((payload) => Prisma.sql`(
			${payload.storeId},
			${payload.externalCustomerId},
			${payload.displayName},
			${payload.email},
			${payload.normalizedEmail},
			${payload.phone},
			${payload.normalizedPhone},
			${payload.identification},
			${payload.note},
			${payload.acceptsMarketing},
			${payload.acceptsMarketingUpdatedAt},
			${payload.defaultAddress},
			${payload.addresses},
			${payload.billingAddress},
			${payload.billingNumber},
			${payload.billingFloor},
			${payload.billingLocality},
			${payload.billingZipcode},
			${payload.billingCity},
			${payload.billingProvince},
			${payload.billingCountry},
			${payload.billingPhone},
			${payload.totalSpent},
			${payload.currency},
			${payload.lastOrderId},
			${payload.rawCustomerPayload},
			${payload.syncedAt},
			${0},
			${0},
			${0},
			${0},
			${[]},
			${now},
			${now}
		)`);

		await prisma.$executeRaw(Prisma.sql`
			INSERT INTO "CustomerProfile" (
				"storeId", "externalCustomerId", "displayName", "email", "normalizedEmail", "phone", "normalizedPhone",
				"identification", "note", "acceptsMarketing", "acceptsMarketingUpdatedAt", "defaultAddress", "addresses",
				"billingAddress", "billingNumber", "billingFloor", "billingLocality", "billingZipcode", "billingCity",
				"billingProvince", "billingCountry", "billingPhone", "totalSpent", "currency", "lastOrderId",
				"rawCustomerPayload", "syncedAt", "orderCount", "paidOrderCount", "distinctProductsCount",
				"totalUnitsPurchased", "productSummary", "createdAt", "updatedAt"
			) VALUES ${Prisma.join(rows)}
			ON CONFLICT ("storeId", "externalCustomerId")
			DO UPDATE SET
				"displayName" = EXCLUDED."displayName",
				"email" = EXCLUDED."email",
				"normalizedEmail" = EXCLUDED."normalizedEmail",
				"phone" = EXCLUDED."phone",
				"normalizedPhone" = EXCLUDED."normalizedPhone",
				"identification" = EXCLUDED."identification",
				"note" = EXCLUDED."note",
				"acceptsMarketing" = EXCLUDED."acceptsMarketing",
				"acceptsMarketingUpdatedAt" = EXCLUDED."acceptsMarketingUpdatedAt",
				"defaultAddress" = EXCLUDED."defaultAddress",
				"addresses" = EXCLUDED."addresses",
				"billingAddress" = EXCLUDED."billingAddress",
				"billingNumber" = EXCLUDED."billingNumber",
				"billingFloor" = EXCLUDED."billingFloor",
				"billingLocality" = EXCLUDED."billingLocality",
				"billingZipcode" = EXCLUDED."billingZipcode",
				"billingCity" = EXCLUDED."billingCity",
				"billingProvince" = EXCLUDED."billingProvince",
				"billingCountry" = EXCLUDED."billingCountry",
				"billingPhone" = EXCLUDED."billingPhone",
				"totalSpent" = COALESCE(EXCLUDED."totalSpent", "CustomerProfile"."totalSpent"),
				"currency" = COALESCE(EXCLUDED."currency", "CustomerProfile"."currency"),
				"lastOrderId" = COALESCE(EXCLUDED."lastOrderId", "CustomerProfile"."lastOrderId"),
				"rawCustomerPayload" = EXCLUDED."rawCustomerPayload",
				"syncedAt" = EXCLUDED."syncedAt",
				"updatedAt" = EXCLUDED."updatedAt"
		`);
	}

	return payloads.length;
}

async function findExistingCustomerProfile(storeId, data) {
	const or = [];

	if (data.externalCustomerId) {
		or.push({ externalCustomerId: data.externalCustomerId });
	}

	if (data.normalizedEmail) {
		or.push({ normalizedEmail: data.normalizedEmail });
	}

	if (data.normalizedPhone) {
		or.push({ normalizedPhone: data.normalizedPhone });
	}

	if (!or.length) return null;

	return prisma.customerProfile.findFirst({
		where: {
			storeId,
			OR: or,
		},
		select: {
			id: true,
			externalCustomerId: true,
			normalizedEmail: true,
			normalizedPhone: true,
		},
		orderBy: { createdAt: 'asc' },
	});
}

async function stripConflictingUniqueFields(storeId, data, currentProfileId = null) {
	const next = { ...data };

	if (next.normalizedEmail) {
		const emailOwner = await prisma.customerProfile.findFirst({
			where: {
				storeId,
				normalizedEmail: next.normalizedEmail,
				...(currentProfileId ? { id: { not: currentProfileId } } : {}),
			},
			select: { id: true },
		});

		if (emailOwner) {
			next.normalizedEmail = null;
		}
	}

	if (next.normalizedPhone) {
		const phoneOwner = await prisma.customerProfile.findFirst({
			where: {
				storeId,
				normalizedPhone: next.normalizedPhone,
				...(currentProfileId ? { id: { not: currentProfileId } } : {}),
			},
			select: { id: true },
		});

		if (phoneOwner) {
			next.normalizedPhone = null;
		}
	}

	return next;
}

function isUniqueConstraintError(error) {
	return error?.code === 'P2002';
}

function mergeProfileDataForUpdate(existing, incoming) {
	return {
		...incoming,
		externalCustomerId: existing?.externalCustomerId || incoming.externalCustomerId || null,
		normalizedEmail: existing?.normalizedEmail || incoming.normalizedEmail || null,
		normalizedPhone: existing?.normalizedPhone || incoming.normalizedPhone || null,
	};
}

async function findProfileOwnerByUniqueFields(storeId, data) {
	if (data.externalCustomerId) {
		const byExternal = await prisma.customerProfile.findFirst({
			where: {
				storeId,
				externalCustomerId: data.externalCustomerId,
			},
			select: {
				id: true,
				externalCustomerId: true,
				normalizedEmail: true,
				normalizedPhone: true,
			},
		});

		if (byExternal) return byExternal;
	}

	if (data.normalizedEmail) {
		const byEmail = await prisma.customerProfile.findFirst({
			where: {
				storeId,
				normalizedEmail: data.normalizedEmail,
			},
			select: {
				id: true,
				externalCustomerId: true,
				normalizedEmail: true,
				normalizedPhone: true,
			},
		});

		if (byEmail) return byEmail;
	}

	if (data.normalizedPhone) {
		const byPhone = await prisma.customerProfile.findFirst({
			where: {
				storeId,
				normalizedPhone: data.normalizedPhone,
			},
			select: {
				id: true,
				externalCustomerId: true,
				normalizedEmail: true,
				normalizedPhone: true,
			},
		});

		if (byPhone) return byPhone;
	}

	return null;
}

async function saveCustomerProfileSafely(storeId, data, indexes = null) {
	const existing = await findExistingCustomerProfile(storeId, data);
	const sanitized = await stripConflictingUniqueFields(storeId, data, existing?.id || null);

	let profile;

	try {
		if (existing) {
			profile = await prisma.customerProfile.update({
				where: { id: existing.id },
				data: mergeProfileDataForUpdate(existing, sanitized),
				select: {
					id: true,
					externalCustomerId: true,
					normalizedEmail: true,
					normalizedPhone: true,
				},
			});
		} else {
			profile = await prisma.customerProfile.create({
				data: buildCustomerProfileDefaults(sanitized),
				select: {
					id: true,
					externalCustomerId: true,
					normalizedEmail: true,
					normalizedPhone: true,
				},
			});
		}
	} catch (error) {
		if (!isUniqueConstraintError(error)) {
			throw error;
		}

		const owner = await findProfileOwnerByUniqueFields(storeId, data);
		if (!owner) {
			throw error;
		}

		const retryData = await stripConflictingUniqueFields(storeId, data, owner.id);
		profile = await prisma.customerProfile.update({
			where: { id: owner.id },
			data: mergeProfileDataForUpdate(owner, retryData),
			select: {
				id: true,
				externalCustomerId: true,
				normalizedEmail: true,
				normalizedPhone: true,
			},
		});
	}

	if (indexes) {
		registerProfileInIndexes(indexes, profile);
	}

	return profile;
}
async function upsertCustomerProfiles(customers, storeId) {
	const payloads = customers
		.map((customer) => mapCustomerPayload(customer, storeId))
		.filter((item) => item.externalCustomerId || item.normalizedEmail || item.normalizedPhone);

	const bulkCandidates = payloads.filter((item) => item.externalCustomerId);
	const fallbackCandidates = payloads.filter((item) => !item.externalCustomerId);
	let customersUpserted = 0;

	if (bulkCandidates.length) {
		const sanitized = await sanitizeCustomerPayloadsForBulk(storeId, bulkCandidates);
		customersUpserted += await bulkUpsertCustomerProfilesByExternalId(sanitized);
	}

	for (const batch of chunkArray(fallbackCandidates, UPDATE_CHUNK_SIZE)) {
		for (const data of batch) {
			await saveCustomerProfileSafely(storeId, data);
			customersUpserted += 1;
		}
	}

	return customersUpserted;
}

async function getAllProfileIndexes(storeId) {
	const profiles = await prisma.customerProfile.findMany({
		where: { storeId },
		select: {
			id: true,
			externalCustomerId: true,
			normalizedEmail: true,
			normalizedPhone: true,
		},
	});

	return buildProfileIndexes(profiles);
}

async function resolveProfileForOrder(order, storeId, indexes) {
	const externalCustomerId = cleanString(order?.customer?.id);
	const normalizedEmail = normalizeEmail(order?.contact_email || order?.customer?.email);
	const normalizedPhone = normalizePhone(order?.contact_phone || order?.customer?.phone);

	if (externalCustomerId && indexes.byExternalCustomerId.has(externalCustomerId)) {
		return indexes.byExternalCustomerId.get(externalCustomerId);
	}

	if (normalizedEmail && indexes.byNormalizedEmail.has(normalizedEmail)) {
		return indexes.byNormalizedEmail.get(normalizedEmail);
	}

	if (normalizedPhone && indexes.byNormalizedPhone.has(normalizedPhone)) {
		return indexes.byNormalizedPhone.get(normalizedPhone);
	}

	const payload = {
		storeId,
		externalCustomerId,
		displayName: cleanString(order?.contact_name || order?.customer?.name),
		email: cleanString(order?.contact_email || order?.customer?.email),
		normalizedEmail,
		phone: cleanString(order?.contact_phone || order?.customer?.phone),
		normalizedPhone,
		identification: cleanString(order?.contact_identification),
		totalSpent: null,
		currency: cleanString(order?.currency) || 'ARS',
		rawCustomerPayload: order?.customer ?? null,
		syncedAt: new Date(),
	};

	return saveCustomerProfileSafely(storeId, payload, indexes);
}

async function upsertOrdersAndItems(orders, storeId, indexes) {
	let ordersUpserted = 0;
	const touchedCustomerProfileIds = new Set();

	for (const order of orders) {
		const profile = await resolveProfileForOrder(order, storeId, indexes);
		const customerOrderPayload = mapOrderPayload(order, storeId, profile.id);

		const customerOrder = await prisma.customerOrder.upsert({
			where: {
				storeId_orderId: {
					storeId,
					orderId: String(order?.id),
				},
			},
			update: customerOrderPayload,
			create: customerOrderPayload,
			select: {
				id: true,
				customerProfileId: true,
			},
		});

		const items = buildOrderItems(order, storeId, customerOrder.id, profile.id);

		await prisma.customerOrderItem.deleteMany({
			where: { customerOrderId: customerOrder.id },
		});

		if (items.length) {
			await prisma.customerOrderItem.createMany({
				data: items,
			});
		}

		touchedCustomerProfileIds.add(profile.id);
		ordersUpserted += 1;
	}

	return {
		ordersUpserted,
		touchedCustomerProfileIds: Array.from(touchedCustomerProfileIds),
	};
}

async function rebuildCustomerProfiles(customerProfileIds = []) {
	if (!customerProfileIds.length) return;

	for (const idsBatch of chunkArray(customerProfileIds, UPDATE_CHUNK_SIZE)) {
		const [profiles, orders, items] = await Promise.all([
			prisma.customerProfile.findMany({
				where: { id: { in: idsBatch } },
				select: {
					id: true,
					currency: true,
					rawCustomerPayload: true,
				},
			}),
			prisma.customerOrder.findMany({
				where: { customerProfileId: { in: idsBatch } },
				orderBy: [
					{ orderCreatedAt: 'desc' },
					{ updatedAt: 'desc' },
				],
				select: {
					id: true,
					customerProfileId: true,
					orderId: true,
					orderNumber: true,
					paymentStatus: true,
					shippingStatus: true,
					totalAmount: true,
					currency: true,
					orderCreatedAt: true,
					rawPayload: true,
				},
			}),
			prisma.customerOrderItem.findMany({
				where: { customerProfileId: { in: idsBatch } },
				select: {
					customerProfileId: true,
					name: true,
					normalizedName: true,
					variantName: true,
					quantity: true,
				},
			}),
		]);

		const ordersByProfile = new Map();
		const itemsByProfile = new Map();

		for (const order of orders) {
			const list = ordersByProfile.get(order.customerProfileId) || [];
			list.push(order);
			ordersByProfile.set(order.customerProfileId, list);
		}

		for (const item of items) {
			const list = itemsByProfile.get(item.customerProfileId) || [];
			list.push(item);
			itemsByProfile.set(item.customerProfileId, list);
		}

		await prisma.$transaction(
			profiles.map((profile) => {
				const profileOrders = ordersByProfile.get(profile.id) || [];
				const profileItems = itemsByProfile.get(profile.id) || [];
				const latestOrder = profileOrders[0] || null;
				const orderedDates = profileOrders
					.map((order) => order.orderCreatedAt)
					.filter(Boolean)
					.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

				const orderCount = profileOrders.length;
				const paidOrderCount = profileOrders.filter((order) => isPaidStatus(order.paymentStatus)).length;
				const distinctProductsCount = new Set(
					profileItems.map((item) => item.normalizedName || item.name).filter(Boolean)
				).size;
				const totalUnitsPurchased = profileItems.reduce(
					(total, item) => total + Number(item.quantity || 0),
					0
				);
				const totalSpent = profileOrders.reduce((total, order) => {
					const amount = Number(order.totalAmount || 0);
					return total + (Number.isFinite(amount) ? amount : 0);
				}, 0);

				return prisma.customerProfile.update({
					where: { id: profile.id },
					data: {
						orderCount,
						paidOrderCount,
						distinctProductsCount,
						totalUnitsPurchased,
						totalSpent: orderCount > 0 ? String(totalSpent) : null,
						currency:
							latestOrder?.currency || profile.currency || 'ARS',
						firstOrderAt: orderedDates[0] || null,
						lastOrderAt: latestOrder?.orderCreatedAt || null,
						lastOrderId: latestOrder?.orderId || null,
						lastOrderNumber: latestOrder?.orderNumber || null,
						lastPaymentStatus: latestOrder?.paymentStatus || null,
						lastShippingStatus: latestOrder?.shippingStatus || null,
						productSummary: buildProductSummary(profileItems),
						rawLastOrderPayload: latestOrder?.rawPayload || null,
						syncedAt: new Date(),
					},
				});
			})
		);
	}
}

async function getLatestOrderSyncAnchor(storeId) {
	const latestOrder = await prisma.customerOrder.findFirst({
		where: { storeId },
		orderBy: [{ orderUpdatedAt: 'desc' }, { updatedAt: 'desc' }],
		select: { orderUpdatedAt: true, updatedAt: true },
	});

	const anchor = latestOrder?.orderUpdatedAt || latestOrder?.updatedAt || null;
	if (!anchor) return null;

	const buffered = new Date(anchor);
	buffered.setUTCDate(buffered.getUTCDate() - ORDER_SYNC_BUFFER_DAYS);
	return buffered;
}

function buildMonthlyWindows(startDate, endDate) {
	const windows = [];
	const safeStart = new Date(startDate);
	const safeEnd = new Date(endDate);

	let cursor = new Date(Date.UTC(
		safeStart.getUTCFullYear(),
		safeStart.getUTCMonth(),
		1,
		0,
		0,
		0,
		0
	));

	while (cursor <= safeEnd) {
		const nextCursor = new Date(Date.UTC(
			cursor.getUTCFullYear(),
			cursor.getUTCMonth() + 1,
			1,
			0,
			0,
			0,
			0
		));

		const windowStart = new Date(Math.max(cursor.getTime(), safeStart.getTime()));
		const windowEnd = new Date(Math.min(nextCursor.getTime() - 1, safeEnd.getTime()));

		windows.push({ windowStart, windowEnd });
		cursor = nextCursor;
	}

	return windows;
}

async function fetchAndUpsertOrders({
	storeId,
	accessToken,
	q = '',
	dateFrom = '',
	dateTo = '',
	earliestCustomerDate = null,
	useIncrementalAnchor = true,
}) {
	const indexes = await getAllProfileIndexes(storeId);
	const now = new Date();
	const incrementalAnchor = useIncrementalAnchor && !dateFrom
		? await getLatestOrderSyncAnchor(storeId)
		: null;

	let startDate =
		parseDateOrNull(dateFrom ? `${dateFrom}T00:00:00.000Z` : null) ||
		incrementalAnchor ||
		earliestCustomerDate ||
		new Date(now.getTime() - ORDERS_SYNC_MONTHS_BACK * 30 * 24 * 60 * 60 * 1000);

	let endDate =
		parseDateOrNull(dateTo ? `${dateTo}T23:59:59.999Z` : null) ||
		now;

	if (startDate > endDate) {
		const temp = startDate;
		startDate = endDate;
		endDate = temp;
	}

	const windows = buildMonthlyWindows(startDate, endDate);

	let ordersFetched = 0;
	let ordersUpserted = 0;
	const touchedCustomerProfileIds = new Set();
	let pagesFetched = 0;

	for (const window of windows) {
		for (let pageStart = 1; pageStart <= ORDER_QUERY_PAGE_LIMIT; pageStart += FETCH_CONCURRENCY) {
			const pages = buildConcurrentPageList(pageStart, ORDER_QUERY_PAGE_LIMIT, FETCH_CONCURRENCY);
			const pageResults = await Promise.all(
				pages.map((page) =>
					fetchOrdersPage({
						storeId,
						accessToken,
						page,
						windowStart: window.windowStart,
						windowEnd: window.windowEnd,
						q,
					})
				)
			);

			const flatOrders = [];
			let shouldStopWindow = false;

			for (let index = 0; index < pageResults.length; index += 1) {
				const pageData = pageResults[index];
				pagesFetched += 1;
				ordersFetched += pageData.length;
				flatOrders.push(...pageData);

				if (pageData.length < ORDERS_PER_PAGE) {
					shouldStopWindow = true;
				}
			}

			if (flatOrders.length) {
				const result = await upsertOrdersAndItems(flatOrders, storeId, indexes);
				ordersUpserted += result.ordersUpserted;
				for (const profileId of result.touchedCustomerProfileIds) {
					touchedCustomerProfileIds.add(profileId);
				}
			}

			if (!flatOrders.length || shouldStopWindow) {
				break;
			}
		}
	}

	await rebuildCustomerProfiles(Array.from(touchedCustomerProfileIds));

	return {
		pagesFetched,
		ordersFetched,
		ordersUpserted,
		customersTouched: touchedCustomerProfileIds.size,
	};
}

export async function syncCustomers({ q = '', dateFrom = '', dateTo = '' } = {}) {
	if (syncState.running) {
		throw new Error('Ya hay una sincronización de clientes en curso. Esperá a que termine.');
	}

	syncState.running = true;
	syncState.startedAt = new Date();

	const syncLog = await prisma.customerSyncLog.create({
		data: {
			status: 'RUNNING',
			fullSync: !q && !dateFrom && !dateTo,
			startedAt: new Date(),
			message: 'Sync de clientes iniciada',
		},
	});

	try {
		const { storeId, accessToken } = await resolveStoreCredentials();

		let customersFetched = 0;
		let customersUpserted = 0;
		let pagesFetched = 0;
		let earliestCustomerDate = null;

		for (let pageStart = 1; pageStart <= MAX_CUSTOMER_PAGES; pageStart += FETCH_CONCURRENCY) {
			const pages = buildConcurrentPageList(pageStart, MAX_CUSTOMER_PAGES, FETCH_CONCURRENCY);
			const pageResults = await Promise.all(
				pages.map((page) => fetchCustomersPage({ storeId, accessToken, page, q, dateFrom, dateTo }))
			);

			let shouldStop = false;
			const flatCustomers = [];

			for (const pageData of pageResults) {
				pagesFetched += 1;
				customersFetched += pageData.length;
				flatCustomers.push(...pageData);

				for (const customer of pageData) {
					const createdAt = parseDateOrNull(customer?.created_at);
					if (createdAt && (!earliestCustomerDate || createdAt < earliestCustomerDate)) {
						earliestCustomerDate = createdAt;
					}
				}

				if (pageData.length < CUSTOMERS_PER_PAGE) {
					shouldStop = true;
				}
			}

			if (flatCustomers.length) {
				customersUpserted += await upsertCustomerProfiles(flatCustomers, storeId);
			}

			if (!flatCustomers.length || shouldStop) {
				break;
			}
		}

		const result = {
			ok: true,
			storeId,
			pagesFetched,
			customersFetched,
			customersUpserted,
			ordersFetched: 0,
			ordersUpserted: 0,
			customersTouched: 0,
			startedAt: syncState.startedAt,
			finishedAt: new Date(),
		};

		await prisma.customerSyncLog.update({
			where: { id: syncLog.id },
			data: {
				status: 'SUCCESS',
				finishedAt: new Date(),
				pagesFetched: result.pagesFetched,
				ordersFetched: 0,
				ordersUpserted: 0,
				customersTouched: 0,
				message: `Clientes: ${customersUpserted}` ,
			},
		});

		return result;
	} catch (error) {
		await prisma.customerSyncLog.update({
			where: { id: syncLog.id },
			data: {
				status: 'FAILED',
				finishedAt: new Date(),
				message: error?.message || 'Error en sync de clientes',
			},
		});

		throw error;
	} finally {
		syncState.running = false;
		syncState.startedAt = null;
	}
}

export async function syncCustomerOrders({ q = '', dateFrom = '', dateTo = '', fullResync = false } = {}) {
	const { storeId, accessToken } = await resolveStoreCredentials();
	const ordersResult = await fetchAndUpsertOrders({
		storeId,
		accessToken,
		q,
		dateFrom,
		dateTo,
		earliestCustomerDate: null,
		useIncrementalAnchor: !fullResync,
	});

	return {
		ok: true,
		storeId,
		...ordersResult,
		startedAt: new Date(),
		finishedAt: new Date(),
	};
}


