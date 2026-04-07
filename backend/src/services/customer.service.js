import pkg from '@prisma/client';
const { Prisma, PrismaClientKnownRequestError } = pkg;
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
	8,
	Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_CONCURRENCY || 6))
);
const MAX_CUSTOMER_PAGES = Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_MAX_PAGES || 150));
const FETCH_RETRIES = Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_RETRIES || 3));
const UPDATE_CHUNK_SIZE = Math.max(25, Number(process.env.TIENDANUBE_CUSTOMERS_UPDATE_CHUNK_SIZE || 250));
const ORDERS_SYNC_MONTHS_BACK = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_SYNC_MONTHS_BACK || 36));

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

function buildHeaders(accessToken) {
	return {
		Authentication: `bearer ${accessToken}`,
		'Content-Type': 'application/json; charset=utf-8',
		'User-Agent': process.env.TIENDANUBE_USER_AGENT || 'Lummine IA Assistant',
	};
}

function chunkArray(values = [], size = 50) {
	const chunks = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
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

function jsonb(value) {
	if (value === null || value === undefined) {
		return Prisma.sql`NULL`;
	}

	return Prisma.sql`CAST(${JSON.stringify(value)} AS jsonb)`;
}

function coalesceUniqueFieldSql(targetColumn, excludedColumn) {
	return Prisma.raw(`COALESCE("CustomerProfile"."${targetColumn}", EXCLUDED."${excludedColumn}")`);
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

async function fetchCustomersPage({ storeId, accessToken, page, q = '', dateFrom = '', dateTo = '', perPage = CUSTOMERS_PER_PAGE }) {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(Math.min(200, Math.max(1, Number(perPage) || CUSTOMERS_PER_PAGE))),
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

export async function fetchCustomersDebugPage({ page = 1, q = '', dateFrom = '', dateTo = '', perPage = 5 } = {}) {
	const { storeId, accessToken } = await resolveStoreCredentials();
	const items = await fetchCustomersPage({
		storeId,
		accessToken,
		page: Math.max(1, Number(page) || 1),
		q,
		dateFrom,
		dateTo,
		perPage,
	});

	return {
		ok: true,
		storeId,
		page: Math.max(1, Number(page) || 1),
		perPage: Math.min(200, Math.max(1, Number(perPage) || 5)),
		count: items.length,
		items,
	};
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
	return error instanceof PrismaClientKnownRequestError && error.code === 'P2002';
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

async function bulkUpsertCustomerProfilesByExternalId(payloads = []) {
	const rows = payloads.filter((item) => item.externalCustomerId);
	if (!rows.length) return 0;

	let processed = 0;

	for (const batch of chunkArray(rows, UPDATE_CHUNK_SIZE)) {
		const valuesSql = batch.map((item) => Prisma.sql`(
			${item.storeId},
			${item.externalCustomerId},
			${item.displayName},
			${item.email},
			${item.normalizedEmail},
			${item.phone},
			${item.normalizedPhone},
			${item.identification},
			${item.note},
			${item.acceptsMarketing},
			${item.acceptsMarketingUpdatedAt},
			${jsonb(item.defaultAddress)},
			${jsonb(item.addresses)},
			${item.billingAddress},
			${item.billingNumber},
			${item.billingFloor},
			${item.billingLocality},
			${item.billingZipcode},
			${item.billingCity},
			${item.billingProvince},
			${item.billingCountry},
			${item.billingPhone},
			${item.totalSpent},
			${item.currency},
			${item.lastOrderId},
			${jsonb(item.rawCustomerPayload)},
			${item.syncedAt}
		)`);

		try {
			await prisma.$executeRaw(Prisma.sql`
				INSERT INTO "CustomerProfile" (
					"storeId",
					"externalCustomerId",
					"displayName",
					"email",
					"normalizedEmail",
					"phone",
					"normalizedPhone",
					"identification",
					"note",
					"acceptsMarketing",
					"acceptsMarketingUpdatedAt",
					"defaultAddress",
					"addresses",
					"billingAddress",
					"billingNumber",
					"billingFloor",
					"billingLocality",
					"billingZipcode",
					"billingCity",
					"billingProvince",
					"billingCountry",
					"billingPhone",
					"totalSpent",
					"currency",
					"lastOrderId",
					"rawCustomerPayload",
					"syncedAt"
				)
				VALUES ${Prisma.join(valuesSql)}
				ON CONFLICT ("storeId", "externalCustomerId")
				DO UPDATE SET
					"displayName" = EXCLUDED."displayName",
					"email" = EXCLUDED."email",
					"normalizedEmail" = ${coalesceUniqueFieldSql('normalizedEmail', 'normalizedEmail')},
					"phone" = EXCLUDED."phone",
					"normalizedPhone" = ${coalesceUniqueFieldSql('normalizedPhone', 'normalizedPhone')},
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
					"rawCustomerPayload" = EXCLUDED."rawCustomerPayload",
					"syncedAt" = EXCLUDED."syncedAt",
					"updatedAt" = NOW()
			`);
		} catch (error) {
			for (const item of batch) {
				await saveCustomerProfileSafely(item.storeId, item);
			}
		}

		processed += batch.length;
	}

	return processed;
}

async function upsertCustomerProfiles(customers, storeId) {
	let customersUpserted = 0;

	const payloads = customers
		.map((customer) => mapCustomerPayload(customer, storeId))
		.filter((item) => item.externalCustomerId || item.normalizedEmail || item.normalizedPhone);

	const withExternalId = payloads.filter((item) => item.externalCustomerId);
	const withoutExternalId = payloads.filter((item) => !item.externalCustomerId);

	customersUpserted += await bulkUpsertCustomerProfilesByExternalId(withExternalId);

	for (const batch of chunkArray(withoutExternalId, UPDATE_CHUNK_SIZE)) {
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

async function bulkUpsertOrdersReturning(ordersPayloads = []) {
	if (!ordersPayloads.length) return [];

	const valuesSql = ordersPayloads.map((item) => Prisma.sql`(
		${item.customerProfileId},
		${item.storeId},
		${item.orderId},
		${item.orderNumber},
		${item.token},
		${item.contactName},
		${item.contactEmail},
		${item.normalizedEmail},
		${item.contactPhone},
		${item.normalizedPhone},
		${item.contactIdentification},
		${item.status},
		${item.paymentStatus},
		${item.shippingStatus},
		${item.subtotal},
		${item.totalAmount},
		${item.currency},
		${item.gateway},
		${item.gatewayId},
		${item.gatewayName},
		${item.gatewayLink},
		${jsonb(item.products)},
		${jsonb(item.rawPayload)},
		${item.orderCreatedAt},
		${item.orderUpdatedAt}
	)`);

	return prisma.$queryRaw(Prisma.sql`
		INSERT INTO "CustomerOrder" (
			"customerProfileId",
			"storeId",
			"orderId",
			"orderNumber",
			"token",
			"contactName",
			"contactEmail",
			"normalizedEmail",
			"contactPhone",
			"normalizedPhone",
			"contactIdentification",
			"status",
			"paymentStatus",
			"shippingStatus",
			"subtotal",
			"totalAmount",
			"currency",
			"gateway",
			"gatewayId",
			"gatewayName",
			"gatewayLink",
			"products",
			"rawPayload",
			"orderCreatedAt",
			"orderUpdatedAt"
		)
		VALUES ${Prisma.join(valuesSql)}
		ON CONFLICT ("storeId", "orderId")
		DO UPDATE SET
			"customerProfileId" = EXCLUDED."customerProfileId",
			"orderNumber" = EXCLUDED."orderNumber",
			"token" = EXCLUDED."token",
			"contactName" = EXCLUDED."contactName",
			"contactEmail" = EXCLUDED."contactEmail",
			"normalizedEmail" = EXCLUDED."normalizedEmail",
			"contactPhone" = EXCLUDED."contactPhone",
			"normalizedPhone" = EXCLUDED."normalizedPhone",
			"contactIdentification" = EXCLUDED."contactIdentification",
			"status" = EXCLUDED."status",
			"paymentStatus" = EXCLUDED."paymentStatus",
			"shippingStatus" = EXCLUDED."shippingStatus",
			"subtotal" = EXCLUDED."subtotal",
			"totalAmount" = EXCLUDED."totalAmount",
			"currency" = EXCLUDED."currency",
			"gateway" = EXCLUDED."gateway",
			"gatewayId" = EXCLUDED."gatewayId",
			"gatewayName" = EXCLUDED."gatewayName",
			"gatewayLink" = EXCLUDED."gatewayLink",
			"products" = EXCLUDED."products",
			"rawPayload" = EXCLUDED."rawPayload",
			"orderCreatedAt" = EXCLUDED."orderCreatedAt",
			"orderUpdatedAt" = EXCLUDED."orderUpdatedAt",
			"updatedAt" = NOW()
		RETURNING "id", "customerProfileId", "orderId", "storeId"
	`);
}

async function upsertOrdersAndItems(orders, storeId, indexes) {
	let ordersUpserted = 0;
	const touchedCustomerProfileIds = new Set();

	for (const batch of chunkArray(orders, UPDATE_CHUNK_SIZE)) {
		const ordersPayloads = [];

		for (const order of batch) {
			const profile = await resolveProfileForOrder(order, storeId, indexes);
			ordersPayloads.push(mapOrderPayload(order, storeId, profile.id));
			touchedCustomerProfileIds.add(profile.id);
		}

		const orderRows = await bulkUpsertOrdersReturning(ordersPayloads);
		const customerOrderIdByOrderId = new Map(
			orderRows.map((row) => [String(row.orderId), { id: row.id, customerProfileId: row.customerProfileId }])
		);

		const customerOrderIds = orderRows.map((row) => row.id);
		if (customerOrderIds.length) {
			await prisma.customerOrderItem.deleteMany({
				where: { customerOrderId: { in: customerOrderIds } },
			});
		}

		const items = [];
		for (const order of batch) {
			const linked = customerOrderIdByOrderId.get(String(order?.id));
			if (!linked) continue;
			items.push(...buildOrderItems(order, storeId, linked.id, linked.customerProfileId));
		}

		for (const itemsBatch of chunkArray(items, UPDATE_CHUNK_SIZE * 4)) {
			if (!itemsBatch.length) continue;
			await prisma.customerOrderItem.createMany({ data: itemsBatch });
		}

		ordersUpserted += batch.length;
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
}) {
	const indexes = await getAllProfileIndexes(storeId);
	const now = new Date();

	let startDate =
		parseDateOrNull(dateFrom ? `${dateFrom}T00:00:00.000Z` : null) ||
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

			for (const pageData of pageResults) {
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

		const ordersResult = await fetchAndUpsertOrders({
			storeId,
			accessToken,
			q,
			dateFrom,
			dateTo,
			earliestCustomerDate,
		});

		const result = {
			ok: true,
			storeId,
			pagesFetched: pagesFetched + ordersResult.pagesFetched,
			customersFetched,
			customersUpserted,
			ordersFetched: ordersResult.ordersFetched,
			ordersUpserted: ordersResult.ordersUpserted,
			customersTouched: ordersResult.customersTouched,
			startedAt: syncState.startedAt,
			finishedAt: new Date(),
		};

		await prisma.customerSyncLog.update({
			where: { id: syncLog.id },
			data: {
				storeId,
				status: 'SUCCESS',
				finishedAt: new Date(),
				pagesFetched: result.pagesFetched,
				ordersFetched: result.ordersFetched,
				ordersUpserted: result.ordersUpserted,
				customersTouched: result.customersTouched,
				message: `Clientes: ${customersUpserted} · Pedidos: ${ordersResult.ordersUpserted}`,
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
