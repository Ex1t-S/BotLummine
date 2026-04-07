import { prisma } from '../lib/prisma.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const ORDERS_PER_PAGE = Math.min(
	200,
	Math.max(50, Number(process.env.TIENDANUBE_ORDERS_SYNC_PER_PAGE || 200))
);
const FETCH_CONCURRENCY = Math.min(
	6,
	Math.max(1, Number(process.env.TIENDANUBE_ORDERS_SYNC_CONCURRENCY || 3))
);
const MAX_ORDER_PAGES = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_SYNC_MAX_PAGES || 80));
const FETCH_RETRIES = Math.max(1, Number(process.env.TIENDANUBE_SYNC_RETRIES || 3));
const PROFILE_CREATE_CHUNK_SIZE = Math.max(
	10,
	Number(process.env.TIENDANUBE_PROFILE_CREATE_CHUNK_SIZE || 200)
);
const ORDER_CREATE_CHUNK_SIZE = Math.max(
	10,
	Number(process.env.TIENDANUBE_ORDER_CREATE_CHUNK_SIZE || 200)
);
const ITEM_CREATE_CHUNK_SIZE = Math.max(
	20,
	Number(process.env.TIENDANUBE_ORDER_ITEM_CREATE_CHUNK_SIZE || 500)
);
const INITIAL_SYNC_DAYS_BACK = Math.max(
	7,
	Number(process.env.TIENDANUBE_INITIAL_ORDERS_SYNC_DAYS || 120)
);
const INCREMENTAL_LOOKBACK_HOURS = Math.max(
	12,
	Number(process.env.TIENDANUBE_INCREMENTAL_LOOKBACK_HOURS || 72)
);

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

function chunkArray(values = [], size = 100) {
	const chunks = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
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
				await sleep(300 * attempt);
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

async function fetchOrdersPage({ storeId, accessToken, page, updatedFrom, updatedTo, q = '' }) {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(ORDERS_PER_PAGE),
		fields: [
			'id',
			'number',
			'contact_email',
			'contact_phone',
			'subtotal',
			'total',
			'created_at',
			'updated_at',
			'payment_status',
			'shipping_status',
			'customer',
			'products',
			'fulfillments',
		].join(','),
	});

	if (updatedFrom) params.set('updated_at_min', updatedFrom.toISOString());
	if (updatedTo) params.set('updated_at_max', updatedTo.toISOString());
	if (q) params.set('q', q);

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/orders?${params.toString()}`;
	const payload = await fetchJson(url, accessToken, `pedidos página ${page}`);

	if (!Array.isArray(payload)) {
		throw new Error('La respuesta de Tiendanube para pedidos no fue una lista.');
	}

	return payload;
}

function buildOrderProductSummary(products = []) {
	if (!Array.isArray(products)) return [];

	return products.map((product) => ({
		name: cleanString(product?.name) || cleanString(product?.name_without_variants) || 'Producto',
		baseName: cleanString(product?.name_without_variants) || cleanString(product?.name) || 'Producto',
		variantValues: Array.isArray(product?.variant_values) ? product.variant_values.filter(Boolean) : [],
		sku: cleanString(product?.sku),
		quantity: toPositiveInt(product?.quantity, 1),
		price: toDecimalOrNull(product?.price),
	}));
}

function buildProfileCandidate(order, storeId) {
	const customer = order?.customer || {};
	const externalCustomerId = cleanString(customer?.id) || `ORDER-${String(order?.id || '')}`;
	const email = cleanString(order?.contact_email || customer?.email);
	const phone = cleanString(order?.contact_phone || customer?.phone);

	return {
		storeId,
		externalCustomerId,
		displayName: cleanString(customer?.name) || cleanString(order?.contact_name) || 'Cliente sin nombre',
		email,
		normalizedEmail: normalizeEmail(email),
		phone,
		normalizedPhone: normalizePhone(phone),
		acceptsMarketing:
			typeof customer?.accepts_marketing === 'boolean' ? customer.accepts_marketing : null,
		rawCustomerPayload: customer && Object.keys(customer).length ? customer : null,
		syncedAt: new Date(),
	};
}

function mapOrderPayload(order, storeId, customerProfileId) {
	const customer = order?.customer || {};
	const phone = cleanString(order?.contact_phone || customer?.phone);
	const email = cleanString(order?.contact_email || customer?.email);

	return {
		customerProfileId,
		storeId,
		orderId: String(order?.id),
		orderNumber: cleanString(order?.number),
		token: null,
		contactName: cleanString(customer?.name) || cleanString(order?.contact_name),
		contactEmail: email,
		normalizedEmail: normalizeEmail(email),
		contactPhone: phone,
		normalizedPhone: normalizePhone(phone),
		contactIdentification: cleanString(customer?.identification),
		status: null,
		paymentStatus: cleanString(order?.payment_status)?.toLowerCase() || null,
		shippingStatus: cleanString(order?.shipping_status)?.toLowerCase() || null,
		subtotal: toDecimalOrNull(order?.subtotal),
		totalAmount: toDecimalOrNull(order?.total),
		currency: 'ARS',
		gateway: null,
		gatewayId: null,
		gatewayName: null,
		gatewayLink: null,
		products: buildOrderProductSummary(order?.products),
		rawPayload: order,
		orderCreatedAt: parseDateOrNull(order?.created_at),
		orderUpdatedAt: parseDateOrNull(order?.updated_at),
	};
}

function mapOrderItemPayload(orderRow, product) {
	const quantity = toPositiveInt(product?.quantity, 1);
	const unitPrice = toDecimalOrNull(product?.price);
	const unitPriceNumber = Number(product?.price || 0);
	const lineTotal = Number.isFinite(unitPriceNumber) ? String(unitPriceNumber * quantity) : unitPrice;
	const variantValues = Array.isArray(product?.variant_values) ? product.variant_values.filter(Boolean) : [];
	const variantName = variantValues.join(' / ') || null;
	const baseName = cleanString(product?.name_without_variants) || cleanString(product?.name) || 'Producto';
	const visibleName = cleanString(product?.name) || baseName;

	return {
		customerOrderId: orderRow.id,
		customerProfileId: orderRow.customerProfileId,
		storeId: orderRow.storeId,
		orderId: orderRow.orderId,
		orderNumber: orderRow.orderNumber,
		productId: cleanString(product?.product_id),
		variantId: cleanString(product?.variant_id),
		lineItemId: cleanString(product?.id),
		sku: cleanString(product?.sku),
		barcode: cleanString(product?.barcode),
		name: visibleName,
		normalizedName: normalizeProductText(baseName),
		variantName,
		quantity,
		unitPrice,
		lineTotal,
		imageUrl: cleanString(product?.image?.src),
		rawPayload: {
			...product,
			base_name: baseName,
			variant_values: variantValues,
		},
		orderCreatedAt: orderRow.orderCreatedAt,
	};
}

async function ensureProfilesForOrders(orders, storeId) {
	const candidates = orders.map((order) => buildProfileCandidate(order, storeId));
	const externalIds = [...new Set(candidates.map((item) => item.externalCustomerId).filter(Boolean))];
	const normalizedEmails = [...new Set(candidates.map((item) => item.normalizedEmail).filter(Boolean))];
	const normalizedPhones = [...new Set(candidates.map((item) => item.normalizedPhone).filter(Boolean))];

	const existing = await prisma.customerProfile.findMany({
		where: {
			storeId,
			OR: [
				externalIds.length ? { externalCustomerId: { in: externalIds } } : null,
				normalizedEmails.length ? { normalizedEmail: { in: normalizedEmails } } : null,
				normalizedPhones.length ? { normalizedPhone: { in: normalizedPhones } } : null,
			].filter(Boolean),
		},
		select: {
			id: true,
			externalCustomerId: true,
			normalizedEmail: true,
			normalizedPhone: true,
		},
	});

	const byExternalId = new Map();
	const byEmail = new Map();
	const byPhone = new Map();

	for (const profile of existing) {
		if (profile.externalCustomerId) byExternalId.set(profile.externalCustomerId, profile);
		if (profile.normalizedEmail) byEmail.set(profile.normalizedEmail, profile);
		if (profile.normalizedPhone) byPhone.set(profile.normalizedPhone, profile);
	}

	const toCreateMap = new Map();

	for (const candidate of candidates) {
		const existingProfile =
			byExternalId.get(candidate.externalCustomerId) ||
			(candidate.normalizedEmail ? byEmail.get(candidate.normalizedEmail) : null) ||
			(candidate.normalizedPhone ? byPhone.get(candidate.normalizedPhone) : null);

		if (existingProfile) continue;

		const dedupeKey =
			candidate.externalCustomerId ||
			candidate.normalizedEmail ||
			candidate.normalizedPhone ||
			`${candidate.displayName}-${Math.random()}`;

		if (!toCreateMap.has(dedupeKey)) {
			toCreateMap.set(dedupeKey, candidate);
		}
	}

	const toCreate = [...toCreateMap.values()];

	for (const chunk of chunkArray(toCreate, PROFILE_CREATE_CHUNK_SIZE)) {
		if (!chunk.length) continue;
		await prisma.customerProfile.createMany({
			data: chunk,
			skipDuplicates: true,
		});
	}

	const allProfiles = await prisma.customerProfile.findMany({
		where: {
			storeId,
			OR: [
				externalIds.length ? { externalCustomerId: { in: externalIds } } : null,
				normalizedEmails.length ? { normalizedEmail: { in: normalizedEmails } } : null,
				normalizedPhones.length ? { normalizedPhone: { in: normalizedPhones } } : null,
			].filter(Boolean),
		},
		select: {
			id: true,
			externalCustomerId: true,
			normalizedEmail: true,
			normalizedPhone: true,
		},
	});

	const finalByExternal = new Map();
	const finalByEmail = new Map();
	const finalByPhone = new Map();

	for (const profile of allProfiles) {
		if (profile.externalCustomerId) finalByExternal.set(profile.externalCustomerId, profile);
		if (profile.normalizedEmail) finalByEmail.set(profile.normalizedEmail, profile);
		if (profile.normalizedPhone) finalByPhone.set(profile.normalizedPhone, profile);
	}

	const resolved = new Map();

	for (const order of orders) {
		const candidate = buildProfileCandidate(order, storeId);
		const profile =
			finalByExternal.get(candidate.externalCustomerId) ||
			(candidate.normalizedEmail ? finalByEmail.get(candidate.normalizedEmail) : null) ||
			(candidate.normalizedPhone ? finalByPhone.get(candidate.normalizedPhone) : null);

		if (!profile) {
			throw new Error(`No se pudo resolver un perfil para la orden ${order?.id || 'sin id'}.`);
		}

		resolved.set(String(order.id), profile.id);
	}

	return {
		profileIdsTouched: new Set([...resolved.values()]),
		resolvedProfileIdByOrderId: resolved,
	};
}

async function refreshProfilesFromOrders(profileIds = []) {
	if (!profileIds.length) return;

	for (const chunk of chunkArray(profileIds, 100)) {
		const orders = await prisma.customerOrder.findMany({
			where: { customerProfileId: { in: chunk } },
			select: {
				customerProfileId: true,
				orderId: true,
				orderNumber: true,
				paymentStatus: true,
				shippingStatus: true,
				totalAmount: true,
				orderCreatedAt: true,
			},
			orderBy: [{ orderCreatedAt: 'asc' }],
		});

		const items = await prisma.customerOrderItem.findMany({
			where: { customerProfileId: { in: chunk } },
			select: {
				customerProfileId: true,
				name: true,
				variantName: true,
				quantity: true,
				normalizedName: true,
			},
		});

		const ordersByProfile = new Map();
		for (const order of orders) {
			if (!ordersByProfile.has(order.customerProfileId)) ordersByProfile.set(order.customerProfileId, []);
			ordersByProfile.get(order.customerProfileId).push(order);
		}

		const itemsByProfile = new Map();
		for (const item of items) {
			if (!itemsByProfile.has(item.customerProfileId)) itemsByProfile.set(item.customerProfileId, []);
			itemsByProfile.get(item.customerProfileId).push(item);
		}

		for (const profileId of chunk) {
			const profileOrders = ordersByProfile.get(profileId) || [];
			const profileItems = itemsByProfile.get(profileId) || [];

			let totalSpent = 0;
			let paidOrderCount = 0;
			let lastOrder = null;
			let firstOrder = null;

			for (const order of profileOrders) {
				const total = Number(order.totalAmount || 0);
				totalSpent += Number.isFinite(total) ? total : 0;
				if (String(order.paymentStatus || '').toLowerCase() === 'paid') paidOrderCount += 1;
				if (!firstOrder || new Date(order.orderCreatedAt || 0) < new Date(firstOrder.orderCreatedAt || 0)) {
					firstOrder = order;
				}
				if (!lastOrder || new Date(order.orderCreatedAt || 0) > new Date(lastOrder.orderCreatedAt || 0)) {
					lastOrder = order;
				}
			}

			const productCounter = new Map();
			let totalUnitsPurchased = 0;
			for (const item of profileItems) {
				totalUnitsPurchased += Number(item.quantity || 0);
				const key = item.normalizedName || item.name;
				const current = productCounter.get(key) || {
					name: item.name,
					totalQuantity: 0,
					variants: new Set(),
				};
				current.totalQuantity += Number(item.quantity || 0);
				if (item.variantName) current.variants.add(item.variantName);
				productCounter.set(key, current);
			}

			const productSummary = [...productCounter.values()]
				.sort((a, b) => b.totalQuantity - a.totalQuantity)
				.slice(0, 8)
				.map((entry) => ({
					name: entry.name,
					totalQuantity: entry.totalQuantity,
					variants: [...entry.variants],
				}));

			await prisma.customerProfile.update({
				where: { id: profileId },
				data: {
					orderCount: profileOrders.length,
					paidOrderCount,
					distinctProductsCount: productCounter.size,
					totalUnitsPurchased,
					totalSpent: profileOrders.length ? String(totalSpent) : null,
					currency: 'ARS',
					firstOrderAt: firstOrder?.orderCreatedAt || null,
					lastOrderAt: lastOrder?.orderCreatedAt || null,
					lastOrderId: lastOrder?.orderId || null,
					lastOrderNumber: lastOrder?.orderNumber || null,
					lastPaymentStatus: lastOrder?.paymentStatus || null,
					lastShippingStatus: lastOrder?.shippingStatus || null,
					productSummary,
					rawLastOrderPayload: null,
					syncedAt: new Date(),
				},
			});
		}
	}
}

async function replaceOrdersBatch(orders, storeId) {
	if (!orders.length) {
		return {
			ordersUpserted: 0,
			itemsUpserted: 0,
			customersTouched: 0,
		};
	}

	const { resolvedProfileIdByOrderId, profileIdsTouched } = await ensureProfilesForOrders(orders, storeId);
	const orderIds = orders.map((order) => String(order.id));

	await prisma.customerOrderItem.deleteMany({
		where: {
			storeId,
			orderId: { in: orderIds },
		},
	});

	await prisma.customerOrder.deleteMany({
		where: {
			storeId,
			orderId: { in: orderIds },
		},
	});

	const orderRows = orders.map((order) =>
		mapOrderPayload(order, storeId, resolvedProfileIdByOrderId.get(String(order.id)))
	);

	for (const chunk of chunkArray(orderRows, ORDER_CREATE_CHUNK_SIZE)) {
		if (!chunk.length) continue;
		await prisma.customerOrder.createMany({ data: chunk });
	}

	const createdOrders = await prisma.customerOrder.findMany({
		where: {
			storeId,
			orderId: { in: orderIds },
		},
		select: {
			id: true,
			storeId: true,
			orderId: true,
			orderNumber: true,
			customerProfileId: true,
			orderCreatedAt: true,
		},
	});

	const createdByOrderId = new Map(createdOrders.map((row) => [row.orderId, row]));
	const itemRows = [];

	for (const order of orders) {
		const orderRow = createdByOrderId.get(String(order.id));
		if (!orderRow) continue;

		for (const product of Array.isArray(order?.products) ? order.products : []) {
			itemRows.push(mapOrderItemPayload(orderRow, product));
		}
	}

	for (const chunk of chunkArray(itemRows, ITEM_CREATE_CHUNK_SIZE)) {
		if (!chunk.length) continue;
		await prisma.customerOrderItem.createMany({ data: chunk });
	}

	await refreshProfilesFromOrders([...profileIdsTouched]);

	return {
		ordersUpserted: orderRows.length,
		itemsUpserted: itemRows.length,
		customersTouched: profileIdsTouched.size,
	};
}

async function resolveSyncWindow({ dateFrom = '', dateTo = '' } = {}) {
	const explicitFrom = parseDateOrNull(dateFrom ? `${dateFrom}T00:00:00.000Z` : null);
	const explicitTo = parseDateOrNull(dateTo ? `${dateTo}T23:59:59.999Z` : null);

	if (explicitFrom || explicitTo) {
		return {
			updatedFrom: explicitFrom,
			updatedTo: explicitTo || new Date(),
			mode: 'manual-range',
		};
	}

	const latest = await prisma.customerOrder.aggregate({
		_max: { orderUpdatedAt: true },
	});

	const latestUpdatedAt = latest?._max?.orderUpdatedAt || null;

	if (latestUpdatedAt) {
		const from = new Date(latestUpdatedAt);
		from.setHours(from.getHours() - INCREMENTAL_LOOKBACK_HOURS);
		return {
			updatedFrom: from,
			updatedTo: new Date(),
			mode: 'incremental',
		};
	}

	const from = new Date();
	from.setDate(from.getDate() - INITIAL_SYNC_DAYS_BACK);

	return {
		updatedFrom: from,
		updatedTo: new Date(),
		mode: 'initial',
	};
}

export async function syncCustomers({ q = '', dateFrom = '', dateTo = '' } = {}) {
	if (syncState.running) {
		throw new Error('Ya hay una sincronización de pedidos corriendo. Esperá a que termine.');
	}

	syncState.running = true;
	syncState.startedAt = new Date();

	const startedAt = Date.now();

	try {
		const { storeId, accessToken } = await resolveStoreCredentials();
		const { updatedFrom, updatedTo, mode } = await resolveSyncWindow({ dateFrom, dateTo });

		let pagesFetched = 0;
		let ordersFetched = 0;
		let ordersUpserted = 0;
		let itemsUpserted = 0;
		let customersTouched = 0;
		let stop = false;

		for (
			let pageStart = 1;
			pageStart <= MAX_ORDER_PAGES && !stop;
			pageStart += FETCH_CONCURRENCY
		) {
			const pages = buildConcurrentPageList(pageStart, MAX_ORDER_PAGES, FETCH_CONCURRENCY);
			const pageResults = await Promise.all(
				pages.map((page) =>
					fetchOrdersPage({
						storeId,
						accessToken,
						page,
						updatedFrom,
						updatedTo,
						q,
					})
				)
			);

			const batch = [];

			for (const result of pageResults) {
				pagesFetched += 1;
				ordersFetched += result.length;
				batch.push(...result);
				if (result.length < ORDERS_PER_PAGE) stop = true;
			}

			if (!batch.length) {
				stop = true;
				continue;
			}

			const deduped = [...new Map(batch.map((order) => [String(order.id), order])).values()];
			const batchResult = await replaceOrdersBatch(deduped, storeId);

			ordersUpserted += batchResult.ordersUpserted;
			itemsUpserted += batchResult.itemsUpserted;
			customersTouched += batchResult.customersTouched;
		}

		return {
			ok: true,
			mode,
			pagesFetched,
			ordersFetched,
			ordersUpserted,
			itemsUpserted,
			customersTouched,
			updatedFrom,
			updatedTo,
			durationMs: Date.now() - startedAt,
		};
	} finally {
		syncState.running = false;
		syncState.startedAt = null;
	}
}
