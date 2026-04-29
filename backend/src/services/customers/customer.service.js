import { prisma } from '../../lib/prisma.js';
import { normalizeWhatsAppIdentityPhone } from '../../lib/phone-normalization.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || 'v1';
const ORDERS_PER_PAGE = Math.max(1, Math.min(200, Number(process.env.TIENDANUBE_ORDERS_SYNC_PER_PAGE || 50)));
const RECENT_LOOKBACK_DAYS = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_INCREMENTAL_LOOKBACK_DAYS || 14));
const HISTORY_MONTHS_PER_RUN = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_BACKFILL_MONTHS_PER_RUN || 2));
const FETCH_RETRIES = Math.max(1, Number(process.env.TIENDANUBE_FETCH_RETRIES || 3));
const UPDATE_BATCH_SIZE = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_UPDATE_BATCH_SIZE || 50));
const ITEM_BATCH_SIZE = Math.max(50, Number(process.env.TIENDANUBE_ORDER_ITEMS_BATCH_SIZE || 500));
const MAX_MONTH_WINDOWS_PER_SYNC = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_MAX_MONTH_WINDOWS || 120));
const MAX_PAGES_PER_WINDOW = Math.max(1, Number(process.env.TIENDANUBE_MAX_PAGES_PER_WINDOW || 120));
const ORDER_FIELDS = [
	'id',
	'number',
	'token',
	'created_at',
	'updated_at',
	'total',
	'currency',
	'payment_status',
	'shipping_status',
	'contact_name',
	'contact_email',
	'contact_phone',
	'contact_identification',
	'status',
	'subtotal',
	'gateway',
	'gateway_id',
	'gateway_name',
	'gateway_link',
	'products'
].join(',');

const syncState = {
	running: false,
	startedAt: null,
	finishedAt: null,
	phase: 'idle',
	message: 'Sin sincronizaciones todavía.',
	pagesFetched: 0,
	ordersFetched: 0,
	ordersUpserted: 0,
	itemsUpserted: 0,
	warnings: [],
	errors: [],
	hasMoreHistory: false,
	recentFrom: null,
	activeWindow: null,
	localOrdersBefore: 0,
	localOrdersAfter: 0,
};

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanString(value) {
	const text = String(value ?? '').trim();
	return text || null;
}

let cachedWorkspaceId = null;

async function resolveWorkspaceId() {
	const configuredWorkspaceId = cleanString(process.env.WORKSPACE_ID) || cleanString(process.env.DEFAULT_WORKSPACE_ID);
	if (configuredWorkspaceId) return configuredWorkspaceId;
	if (cachedWorkspaceId) return cachedWorkspaceId;

	try {
		const rows = await prisma.$queryRaw`
			SELECT "id"
			FROM "Workspace"
			ORDER BY "createdAt" ASC NULLS LAST, "id" ASC
			LIMIT 1
		`;
		const workspaceId = cleanString(rows?.[0]?.id);
		if (workspaceId) {
			cachedWorkspaceId = workspaceId;
			return workspaceId;
		}
	} catch {
		// Older single-tenant schemas do not have Workspace.
	}

	return 'default';
}

function normalizeEmail(value) {
	const text = cleanString(value);
	return text ? text.toLowerCase() : null;
}

function normalizePhone(value) {
	return normalizeWhatsAppIdentityPhone(value) || null;
}

function normalizeText(value) {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

function toDecimalOrNull(value) {
	if (value === null || value === undefined || value === '') return null;
	const amount = Number(value);
	return Number.isFinite(amount) ? amount : null;
}

function parseDateOrNull(value) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}


function normalizeOrderStatus(value) {
	const normalized = cleanString(value);
	return normalized ? normalized.toLowerCase() : null;
}

function subtractDays(date, days) {
	return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function startOfMonthUTC(date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfMonthUTC(date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function monthLabel(date) {
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function sanitizeWindow(window) {
	if (!window) return null;
	return {
		label: window.label,
		from: window.from?.toISOString() || null,
		to: window.to?.toISOString() || null,
	};
}

function resetSyncState() {
	syncState.pagesFetched = 0;
	syncState.ordersFetched = 0;
	syncState.ordersUpserted = 0;
	syncState.itemsUpserted = 0;
	syncState.warnings = [];
	syncState.errors = [];
	syncState.hasMoreHistory = false;
	syncState.recentFrom = null;
	syncState.activeWindow = null;
	syncState.localOrdersBefore = 0;
	syncState.localOrdersAfter = 0;
}

export function getCustomerSyncStatus() {
	return {
		running: syncState.running,
		startedAt: syncState.startedAt,
		finishedAt: syncState.finishedAt,
		phase: syncState.phase,
		message: syncState.message,
		pagesFetched: syncState.pagesFetched,
		ordersFetched: syncState.ordersFetched,
		ordersUpserted: syncState.ordersUpserted,
		itemsUpserted: syncState.itemsUpserted,
		warnings: syncState.warnings.slice(-10),
		errors: syncState.errors.slice(-10),
		hasMoreHistory: syncState.hasMoreHistory,
		recentFrom: syncState.recentFrom,
		activeWindow: sanitizeWindow(syncState.activeWindow),
		localOrdersBefore: syncState.localOrdersBefore,
		localOrdersAfter: syncState.localOrdersAfter,
	};
}

function pushWarning(message) {
	syncState.warnings.push({ message, at: new Date().toISOString() });
	syncState.message = message;
}

function pushError(message) {
	syncState.errors.push({ message, at: new Date().toISOString() });
	syncState.message = message;
}

export async function resolveStoreCredentials() {
	const envStoreId = cleanString(process.env.TIENDANUBE_STORE_ID);
	const envAccessToken = cleanString(process.env.TIENDANUBE_ACCESS_TOKEN);
	const workspaceId = await resolveWorkspaceId();

	if (envStoreId && envAccessToken) {
		return {
			storeId: envStoreId,
			accessToken: envAccessToken,
			source: 'env',
			workspaceId,
		};
	}

	const installation = await prisma.storeInstallation.findFirst({
		orderBy: { updatedAt: 'desc' },
		select: { storeId: true, accessToken: true },
	});

	if (!installation?.storeId || !installation?.accessToken) {
		throw new Error('Faltan credenciales de Tiendanube. Configurá TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN.');
	}

	return {
		storeId: installation.storeId,
		accessToken: installation.accessToken,
		source: 'storeInstallation',
		workspaceId,
	};
}

async function fetchJson(url, accessToken, resourceLabel) {
	const userAgent = process.env.TIENDANUBE_USER_AGENT || 'Lummine IA Assistant';

	let lastError = null;
	for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					Authentication: `bearer ${accessToken}`,
					'User-Agent': userAgent,
					'Content-Type': 'application/json',
				},
			});

			if (!response.ok) {
				const text = await response.text();
				const error = new Error(`${resourceLabel}: Tiendanube respondió ${response.status} - ${text}`);
				error.status = response.status;
				error.body = text;
				throw error;
			}

			const payload = await response.json();
			return payload;
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

async function fetchOrdersPage({
	storeId,
	accessToken,
	page,
	createdAtMin = null,
	createdAtMax = null,
	perPage = ORDERS_PER_PAGE,
}) {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(perPage),
		fields: ORDER_FIELDS,
	});

	if (createdAtMin) params.set('created_at_min', createdAtMin.toISOString());
	if (createdAtMax) params.set('created_at_max', createdAtMax.toISOString());

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/orders?${params.toString()}`;

	try {
		const payload = await fetchJson(url, accessToken, `pedidos página ${page}`);
		if (!Array.isArray(payload)) {
			throw new Error('La respuesta de Tiendanube para pedidos no fue una lista.');
		}
		return payload;
	} catch (error) {
		const bodyText = String(error?.body || error?.message || '');

		if (error?.status === 422 && perPage > 50) {
			pushWarning(`Paginación 422 en página ${page}. Reintentando con per_page=50.`);
			return fetchOrdersPage({ storeId, accessToken, page, createdAtMin, createdAtMax, perPage: 50 });
		}

		const isEmptyPagination404 =
			error?.status === 404 &&
			(
				bodyText.includes('Last page is 0') ||
				bodyText.includes('"Last page is 0"') ||
				bodyText.toLowerCase().includes('last page is')
			);

		if (isEmptyPagination404) {
			return [];
		}

		throw error;
	}
}

async function getLocalOrderBounds(storeId, workspaceId) {
	const [count, earliest, latest] = await Promise.all([
		prisma.customerOrder.count({ where: { storeId, workspaceId } }),
		prisma.customerOrder.findFirst({
			where: { storeId, workspaceId },
			orderBy: [{ orderCreatedAt: 'asc' }, { createdAt: 'asc' }],
			select: { orderCreatedAt: true },
		}),
		prisma.customerOrder.findFirst({
			where: { storeId, workspaceId },
			orderBy: [{ orderUpdatedAt: 'desc' }, { orderCreatedAt: 'desc' }, { createdAt: 'desc' }],
			select: { orderCreatedAt: true, orderUpdatedAt: true },
		}),
	]);

	return {
		count,
		earliestOrderCreatedAt: earliest?.orderCreatedAt || null,
		latestOrderCreatedAt: latest?.orderCreatedAt || null,
		latestOrderUpdatedAt: latest?.orderUpdatedAt || latest?.orderCreatedAt || null,
	};
}

function buildProfileIdentity(order) {
	const identityBase =
		cleanString(order?.contact_email) ||
		cleanString(order?.contact_phone) ||
		String(order?.id || Date.now());

	return {
		externalCustomerId: `order-profile-${identityBase}`,
		normalizedEmail: normalizeEmail(order?.contact_email),
		normalizedPhone: normalizePhone(order?.contact_phone),
		displayName: cleanString(order?.contact_name) || 'Cliente sin nombre',
		email: cleanString(order?.contact_email),
		phone: cleanString(order?.contact_phone),
		currency: 'ARS',
		syncedAt: new Date(),
	};
}

async function ensureProfilesForOrders(orders, storeId, workspaceId) {
	const candidatesMap = new Map();
	for (const order of orders) {
		const candidate = buildProfileIdentity(order);
		candidatesMap.set(candidate.externalCustomerId, candidate);
	}

	const candidates = Array.from(candidatesMap.values());
	if (!candidates.length) return new Map();

	const externalIds = candidates.map((item) => item.externalCustomerId).filter(Boolean);
	const emails = candidates.map((item) => item.normalizedEmail).filter(Boolean);
	const phones = candidates.map((item) => item.normalizedPhone).filter(Boolean);

	const existingProfiles = await prisma.customerProfile.findMany({
		where: {
			storeId,
			workspaceId,
			OR: [
				externalIds.length ? { externalCustomerId: { in: externalIds } } : null,
				emails.length ? { normalizedEmail: { in: emails } } : null,
				phones.length ? { normalizedPhone: { in: phones } } : null,
			].filter(Boolean),
		},
		select: { id: true, externalCustomerId: true, normalizedEmail: true, normalizedPhone: true },
	});

	const byExternal = new Map();
	const byEmail = new Map();
	const byPhone = new Map();
	for (const profile of existingProfiles) {
		if (profile.externalCustomerId) byExternal.set(profile.externalCustomerId, profile.id);
		if (profile.normalizedEmail) byEmail.set(profile.normalizedEmail, profile.id);
		if (profile.normalizedPhone) byPhone.set(profile.normalizedPhone, profile.id);
	}

	const missing = candidates.filter((item) => {
		if (item.externalCustomerId && byExternal.has(item.externalCustomerId)) return false;
		if (item.normalizedEmail && byEmail.has(item.normalizedEmail)) return false;
		if (item.normalizedPhone && byPhone.has(item.normalizedPhone)) return false;
		return true;
	});

	if (missing.length) {
		await prisma.customerProfile.createMany({
			data: missing.map((item) => ({
				storeId,
				workspaceId,
				externalCustomerId: item.externalCustomerId,
				displayName: item.displayName,
				email: item.email,
				normalizedEmail: item.normalizedEmail,
				phone: item.phone,
				normalizedPhone: item.normalizedPhone,
				currency: item.currency,
				syncedAt: item.syncedAt,
			})),
			skipDuplicates: true,
		});
	}

	const reloadedProfiles = await prisma.customerProfile.findMany({
		where: {
			storeId,
			workspaceId,
			OR: [
				externalIds.length ? { externalCustomerId: { in: externalIds } } : null,
				emails.length ? { normalizedEmail: { in: emails } } : null,
				phones.length ? { normalizedPhone: { in: phones } } : null,
			].filter(Boolean),
		},
		select: { id: true, externalCustomerId: true, normalizedEmail: true, normalizedPhone: true },
	});

	byExternal.clear();
	byEmail.clear();
	byPhone.clear();
	for (const profile of reloadedProfiles) {
		if (profile.externalCustomerId) byExternal.set(profile.externalCustomerId, profile.id);
		if (profile.normalizedEmail) byEmail.set(profile.normalizedEmail, profile.id);
		if (profile.normalizedPhone) byPhone.set(profile.normalizedPhone, profile.id);
	}

	const orderToProfileId = new Map();
	for (const order of orders) {
		const candidate = buildProfileIdentity(order);
		const profileId =
			(candidate.externalCustomerId ? byExternal.get(candidate.externalCustomerId) : null) ||
			(candidate.normalizedEmail ? byEmail.get(candidate.normalizedEmail) : null) ||
			(candidate.normalizedPhone ? byPhone.get(candidate.normalizedPhone) : null);

		if (profileId) {
			orderToProfileId.set(String(order?.id), profileId);
		}
	}

	return orderToProfileId;
}

function mapOrderPayload(order, storeId, workspaceId, customerProfileId) {
	return {
		customerProfileId,
		workspaceId,
		storeId,
		orderId: String(order?.id),
		orderNumber: cleanString(order?.number),
		token: cleanString(order?.token),
		contactName: cleanString(order?.contact_name) || 'Cliente sin nombre',
		contactEmail: cleanString(order?.contact_email),
		normalizedEmail: normalizeEmail(order?.contact_email),
		contactPhone: cleanString(order?.contact_phone),
		normalizedPhone: normalizePhone(order?.contact_phone),
		contactIdentification: cleanString(order?.contact_identification),
		status: normalizeOrderStatus(order?.status),
		paymentStatus: normalizeOrderStatus(order?.payment_status),
		shippingStatus: normalizeOrderStatus(order?.shipping_status),
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

function buildOrderItems(order, storeId, workspaceId, customerOrderId, customerProfileId) {
	const orderId = String(order?.id);
	const orderNumber = cleanString(order?.number);
	const orderCreatedAt = parseDateOrNull(order?.created_at);
	const products = Array.isArray(order?.products) ? order.products : [];

	return products.map((product, index) => {
		const quantity = Number(product?.quantity || 1) || 1;
		const unitPrice = toDecimalOrNull(product?.price);
		const lineTotal = unitPrice !== null ? unitPrice * quantity : null;
		const variantValues = Array.isArray(product?.variant_values) ? product.variant_values.filter(Boolean) : [];
		const baseName = cleanString(product?.name_without_variants) || cleanString(product?.name) || `Ítem ${index + 1}`;
		const variantName = variantValues.length ? variantValues.join(' / ') : null;

		return {
			customerOrderId,
			customerProfileId,
			workspaceId,
			storeId,
			orderId,
			orderNumber,
			productId: cleanString(product?.product_id),
			variantId: cleanString(product?.variant_id),
			lineItemId: cleanString(product?.id),
			sku: cleanString(product?.sku),
			name: cleanString(product?.name) || baseName,
			normalizedName: normalizeText(`${baseName} ${variantName || ''} ${product?.sku || ''}`),
			variantName,
			quantity,
			unitPrice,
			lineTotal,
			imageUrl: cleanString(product?.image?.src || product?.image?.url),
			rawPayload: product,
			orderCreatedAt,
		};
	});
}

async function upsertOrdersAndItems(orders, storeId, workspaceId = null) {
	if (!orders.length) return { ordersUpserted: 0, itemsUpserted: 0 };
	const resolvedWorkspaceId = workspaceId || await resolveWorkspaceId();

	const orderToProfileId = await ensureProfilesForOrders(orders, storeId, resolvedWorkspaceId);
	const orderIds = orders.map((order) => String(order.id));

	const existingOrders = await prisma.customerOrder.findMany({
		where: { storeId, workspaceId: resolvedWorkspaceId, orderId: { in: orderIds } },
		select: { id: true, orderId: true },
	});
	const existingMap = new Map(existingOrders.map((item) => [item.orderId, item.id]));

	const createData = [];
	const updates = [];
	for (const order of orders) {
		const orderId = String(order.id);
		const customerProfileId = orderToProfileId.get(orderId);
		if (!customerProfileId) continue;

		const payload = mapOrderPayload(order, storeId, resolvedWorkspaceId, customerProfileId);
		if (existingMap.has(orderId)) {
			updates.push({ id: existingMap.get(orderId), data: payload });
		} else {
			createData.push(payload);
		}
	}

	for (let index = 0; index < createData.length; index += UPDATE_BATCH_SIZE) {
		const batch = createData.slice(index, index + UPDATE_BATCH_SIZE);
		if (batch.length) {
			await prisma.customerOrder.createMany({ data: batch, skipDuplicates: true });
		}
	}

	for (let index = 0; index < updates.length; index += UPDATE_BATCH_SIZE) {
		const batch = updates.slice(index, index + UPDATE_BATCH_SIZE);
		if (!batch.length) continue;

		await prisma.$transaction(
			batch.map((item) =>
				prisma.customerOrder.update({
					where: { id: item.id },
					data: item.data,
				})
			)
		);
	}

	const savedOrders = await prisma.customerOrder.findMany({
		where: { storeId, workspaceId: resolvedWorkspaceId, orderId: { in: orderIds } },
		select: { id: true, orderId: true },
	});
	const savedOrderMap = new Map(savedOrders.map((item) => [item.orderId, item.id]));

	if (savedOrders.length) {
		await prisma.customerOrderItem.deleteMany({
			where: { customerOrderId: { in: savedOrders.map((row) => row.id) } },
		});
	}

	const items = [];
	for (const order of orders) {
		const orderId = String(order.id);
		const customerOrderId = savedOrderMap.get(orderId);
		const customerProfileId = orderToProfileId.get(orderId);
		if (!customerOrderId || !customerProfileId) continue;
		items.push(...buildOrderItems(order, storeId, resolvedWorkspaceId, customerOrderId, customerProfileId));
	}

	for (let index = 0; index < items.length; index += ITEM_BATCH_SIZE) {
		const batch = items.slice(index, index + ITEM_BATCH_SIZE);
		if (batch.length) {
			await prisma.customerOrderItem.createMany({ data: batch });
		}
	}

	return { ordersUpserted: orders.length, itemsUpserted: items.length };
}


export async function fetchTiendanubeOrderById({ storeId, accessToken, orderId }) {
	const normalizedOrderId = String(orderId || '').trim();
	if (!storeId || !accessToken || !normalizedOrderId) {
		throw new Error('fetchTiendanubeOrderById requiere storeId, accessToken y orderId.');
	}

	const params = new URLSearchParams({ fields: ORDER_FIELDS });
	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/orders/${normalizedOrderId}?${params.toString()}`;
	const payload = await fetchJson(url, accessToken, `pedido ${normalizedOrderId}`);
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		throw new Error(`La respuesta de Tiendanube para el pedido ${normalizedOrderId} no fue un objeto válido.`);
	}
	return payload;
}

export async function upsertTiendanubeOrder(order, storeId) {
	if (!order || !order.id) {
		throw new Error('No se pudo guardar la orden de Tiendanube porque el payload no trae id.');
	}

	return upsertOrdersAndItems([order], storeId);
}

async function processWindow({ storeId, workspaceId, accessToken, from, to, label }) {
	syncState.phase = label === 'recent' ? 'recent_sync' : 'historical_backfill';
	syncState.activeWindow = { from, to, label };
	syncState.message = `Sincronizando ${label === 'recent' ? 'recientes' : 'histórico'} ${label}.`;

	let page = 1;
	let windowPages = 0;
	let windowOrders = 0;
	let windowUpserted = 0;
	let windowItems = 0;

	while (page <= MAX_PAGES_PER_WINDOW) {
		let orders;
		try {
			orders = await fetchOrdersPage({ storeId, accessToken, page, createdAtMin: from, createdAtMax: to });
		} catch (error) {
			if (error?.status === 422) {
				pushWarning(`Ventana ${label}: paginación interrumpida en página ${page}. Se continúa con la siguiente ventana.`);
				break;
			}
			throw error;
		}

		syncState.pagesFetched += 1;
		windowPages += 1;

		if (!orders.length) break;

		syncState.ordersFetched += orders.length;
		windowOrders += orders.length;

		const saved = await upsertOrdersAndItems(orders, storeId, workspaceId);
		syncState.ordersUpserted += saved.ordersUpserted;
		syncState.itemsUpserted += saved.itemsUpserted;
		windowUpserted += saved.ordersUpserted;
		windowItems += saved.itemsUpserted;

		syncState.localOrdersAfter = await prisma.customerOrder.count({ where: { storeId, workspaceId } });
		syncState.message = `Ventana ${label}: página ${page} · pedidos ${syncState.ordersFetched} · guardados ${syncState.ordersUpserted}.`;

		if (orders.length < ORDERS_PER_PAGE) break;
		page += 1;
	}

	if (page > MAX_PAGES_PER_WINDOW) {
		pushWarning(`Ventana ${label}: se alcanzó el límite de ${MAX_PAGES_PER_WINDOW} páginas en una sola corrida.`);
	}

	return {
		label,
		pagesFetched: windowPages,
		ordersFetched: windowOrders,
		ordersUpserted: windowUpserted,
		itemsUpserted: windowItems,
	};
}

function safeSyncLogData(data) {
	return {
		workspaceId: data.workspaceId || 'default',
		storeId: data.storeId || null,
		status: data.status,
		fullSync: Boolean(data.fullSync),
		startedAt: data.startedAt,
		finishedAt: data.finishedAt ?? null,
		pagesFetched: Number(data.pagesFetched || 0),
		ordersFetched: Number(data.ordersFetched || 0),
		ordersUpserted: Number(data.ordersUpserted || 0),
		customersTouched: Number(data.customersTouched || 0),
		message: data.message || null,
	};
}

async function runSyncJob() {
	const startedAt = Date.now();
	let syncLog = null;
	let storeId = null;
	let workspaceId = null;

	try {
		const credentials = await resolveStoreCredentials();
		storeId = credentials.storeId;
		workspaceId = credentials.workspaceId;
		const { accessToken } = credentials;

		try {
			syncLog = await prisma.customerSyncLog.create({
				data: safeSyncLogData({
					storeId,
					workspaceId,
					status: 'RUNNING',
					fullSync: false,
					startedAt: new Date(),
					message: 'Sync de pedidos iniciada',
				}),
			});
		} catch (logError) {
			pushWarning(`No se pudo crear customerSyncLog: ${logError?.message || 'error desconocido'}`);
		}

		const boundsBefore = await getLocalOrderBounds(storeId, workspaceId);
		syncState.localOrdersBefore = boundsBefore.count;
		syncState.localOrdersAfter = boundsBefore.count;

		const recentFrom = subtractDays(new Date(), RECENT_LOOKBACK_DAYS);
		syncState.recentFrom = recentFrom.toISOString();

		const runs = [];
		runs.push(
			await processWindow({
				storeId,
				workspaceId,
				accessToken,
				from: recentFrom,
				to: new Date(),
				label: 'recent',
			})
		);

		let cursor = boundsBefore.earliestOrderCreatedAt
			? startOfMonthUTC(new Date(boundsBefore.earliestOrderCreatedAt.getTime() - 24 * 60 * 60 * 1000))
			: startOfMonthUTC(subtractDays(new Date(), RECENT_LOOKBACK_DAYS + 1));

		let emptyWindows = 0;
		let hitPerRunLimit = false;

		for (let index = 0; index < Math.min(HISTORY_MONTHS_PER_RUN, MAX_MONTH_WINDOWS_PER_SYNC); index += 1) {
			const monthStart = startOfMonthUTC(cursor);
			const monthEnd = endOfMonthUTC(cursor);
			const label = monthLabel(monthStart);

			const result = await processWindow({
				storeId,
				workspaceId,
				accessToken,
				from: monthStart,
				to: monthEnd,
				label,
			});
			runs.push(result);

			if (result.ordersFetched === 0) {
				emptyWindows += 1;
			} else {
				emptyWindows = 0;
			}

			cursor = new Date(
				Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1, 0, 0, 0, 0)
			);

			if (emptyWindows >= 2) {
				break;
			}

			if (index === Math.min(HISTORY_MONTHS_PER_RUN, MAX_MONTH_WINDOWS_PER_SYNC) - 1) {
				hitPerRunLimit = true;
			}
		}

		syncState.hasMoreHistory = hitPerRunLimit && emptyWindows < 2;
		syncState.finishedAt = new Date().toISOString();
		syncState.phase = 'completed';
		syncState.message = syncState.hasMoreHistory
			? 'Sync lista. Se actualizaron pedidos recientes y quedó histórico pendiente para próximas corridas.'
			: 'Sync lista. Se actualizaron pedidos y no quedaron ventanas históricas pendientes visibles.';

		if (syncLog?.id) {
			await prisma.customerSyncLog.update({
				where: { id: syncLog.id },
				data: safeSyncLogData({
					status: 'SUCCESS',
					storeId,
					workspaceId,
					finishedAt: new Date(),
					pagesFetched: syncState.pagesFetched,
					ordersFetched: syncState.ordersFetched,
					ordersUpserted: syncState.ordersUpserted,
					customersTouched: 0,
					message: syncState.message,
				}),
			});
		}

		return {
			runs,
			durationMs: Date.now() - startedAt,
		};
	} catch (error) {
		pushError(error?.message || 'Error sincronizando pedidos.');
		syncState.phase = 'error';
		syncState.finishedAt = new Date().toISOString();

		if (syncLog?.id) {
			try {
				await prisma.customerSyncLog.update({
					where: { id: syncLog.id },
					data: safeSyncLogData({
						status: 'ERROR',
						storeId,
						workspaceId,
						finishedAt: new Date(),
						pagesFetched: syncState.pagesFetched,
						ordersFetched: syncState.ordersFetched,
						ordersUpserted: syncState.ordersUpserted,
						customersTouched: 0,
						message: error?.message || 'Error sincronizando pedidos',
					}),
				});
			} catch {
				// no-op
			}
		}
	} finally {
		syncState.running = false;
		syncState.activeWindow = null;
	}
}

export async function syncCustomers() {
	if (syncState.running) {
		return {
			ok: true,
			started: false,
			...getCustomerSyncStatus(),
		};
	}

	resetSyncState();
	syncState.running = true;
	syncState.startedAt = new Date().toISOString();
	syncState.finishedAt = null;
	syncState.phase = 'starting';
	syncState.message = 'Preparando sincronización de pedidos...';

	setTimeout(() => {
		runSyncJob().catch((error) => {
			pushError(error?.message || 'Error sincronizando pedidos.');
			syncState.running = false;
			syncState.phase = 'error';
			syncState.finishedAt = new Date().toISOString();
		});
	}, 0);

	return {
		ok: true,
		started: true,
		...getCustomerSyncStatus(),
	};
}
