import { prisma } from '../../lib/prisma.js';
import { fetchWithTimeout, getHttpTimeoutMs } from '../../lib/http-timeout.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import { attributeOrdersByIds } from '../campaigns/campaign-attribution.service.js';
import { deriveShippingStatus } from '../common/shipping-status.js';
import { resolveActiveCommerceConnection } from '../commerce/active-commerce.service.js';
import { getShopifyClient, getShopifyConfig } from '../shopify/client.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || 'v1';
const ORDERS_PER_PAGE = Math.max(1, Math.min(200, Number(process.env.TIENDANUBE_ORDERS_SYNC_PER_PAGE || 50)));
const RECENT_LOOKBACK_DAYS = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_INCREMENTAL_LOOKBACK_DAYS || 14));
const HISTORY_MONTHS_PER_RUN = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_BACKFILL_MONTHS_PER_RUN || 2));
const FETCH_RETRIES = Math.max(1, Number(process.env.TIENDANUBE_FETCH_RETRIES || 3));
const UPDATE_BATCH_SIZE = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_UPDATE_BATCH_SIZE || 50));
const ITEM_BATCH_SIZE = Math.max(50, Number(process.env.TIENDANUBE_ORDER_ITEMS_BATCH_SIZE || 500));
const MAX_MONTH_WINDOWS_PER_SYNC = Math.max(1, Number(process.env.TIENDANUBE_ORDERS_MAX_MONTH_WINDOWS || 120));
const MAX_PAGES_PER_WINDOW = Math.max(1, Number(process.env.TIENDANUBE_MAX_PAGES_PER_WINDOW || 120));
const TIENDANUBE_TIMEOUT_MS = getHttpTimeoutMs('TIENDANUBE_TIMEOUT_MS', 15000);
const SHOPIFY_ORDERS_PER_PAGE = Math.max(1, Math.min(250, Number(process.env.SHOPIFY_ORDERS_SYNC_PER_PAGE || 250)));
const SHOPIFY_CUSTOMERS_PER_PAGE = Math.max(1, Math.min(250, Number(process.env.SHOPIFY_CUSTOMERS_SYNC_PER_PAGE || 250)));
const CUSTOMER_ORDER_LIST_FIELDS = [
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
	customersTouched: 0,
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

function normalizeEmail(value) {
	const text = cleanString(value);
	return text ? text.toLowerCase() : null;
}

function normalizePhone(value) {
	const digits = String(value ?? '').replace(/\D/g, '');
	return digits || null;
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

function isInvalidFieldsError(error) {
	const text = String(error?.body || error?.message || '').toLowerCase();
	return error?.status === 404 && text.includes('some chosen field do not exist');
}

function normalizeProvider(value = '') {
	const provider = String(value || '').trim().toUpperCase();
	return provider === 'SHOPIFY' ? 'SHOPIFY' : 'TIENDANUBE';
}

function normalizeShopDomain(value = '') {
	return String(value || '')
		.trim()
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '')
		.toLowerCase();
}

function getShopifyCustomerName(customer = {}, fallback = null) {
	const firstName = cleanString(customer?.first_name);
	const lastName = cleanString(customer?.last_name);
	const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
	return fullName || cleanString(customer?.name) || fallback;
}

function normalizeShopifyOrder(order = {}) {
	const customerName = getShopifyCustomerName(customerFromOrder(order), cleanString(order?.name));
	const contactEmail =
		cleanString(order?.email) ||
		cleanString(order?.contact_email) ||
		cleanString(order?.customer?.email);
	const contactPhone =
		cleanString(order?.phone) ||
		cleanString(order?.customer?.phone) ||
		cleanString(order?.shipping_address?.phone) ||
		cleanString(order?.billing_address?.phone);
	const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

	return {
		...order,
		id: String(order?.id || order?.admin_graphql_api_id || ''),
		number: cleanString(order?.order_number) || cleanString(order?.name),
		token: cleanString(order?.token) || cleanString(order?.checkout_token),
		created_at: order?.created_at,
		updated_at: order?.updated_at,
		total: order?.total_price,
		currency: order?.currency,
		payment_status: order?.financial_status,
		shipping_status: order?.fulfillment_status || 'unfulfilled',
		contact_name: customerName,
		contact_email: contactEmail,
		contact_phone: contactPhone,
		status: order?.cancelled_at ? 'cancelled' : order?.closed_at ? 'closed' : 'open',
		subtotal: order?.subtotal_price,
		gateway: Array.isArray(order?.payment_gateway_names) ? order.payment_gateway_names.join(', ') : null,
		products: lineItems.map((item) => ({
			id: item?.id,
			product_id: item?.product_id,
			variant_id: item?.variant_id,
			sku: item?.sku,
			name: item?.title || item?.name,
			name_without_variants: item?.title,
			variant_values: [item?.variant_title].filter(Boolean),
			quantity: item?.quantity,
			price: item?.price,
			image: null,
			rawPayload: item
		})),
		_shopifyRaw: order
	};
}

function customerFromOrder(order = {}) {
	return order?.customer && typeof order.customer === 'object' ? order.customer : {};
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
	syncState.customersTouched = 0;
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
		customersTouched: syncState.customersTouched,
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

export async function resolveStoreCredentials({ workspaceId = DEFAULT_WORKSPACE_ID, provider = 'TIENDANUBE' } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedProvider = normalizeProvider(provider);
	if (normalizedProvider === 'SHOPIFY') {
		const config = await getShopifyConfig({ workspaceId: resolvedWorkspaceId });
		return {
			storeId: normalizeShopDomain(config.shopDomain || config.externalStoreId),
			accessToken: config.accessToken,
			workspaceId: resolvedWorkspaceId,
			provider: 'SHOPIFY',
			source: config.source,
		};
	}

	const envStoreId = cleanString(process.env.TIENDANUBE_STORE_ID);
	const envAccessToken = cleanString(process.env.TIENDANUBE_ACCESS_TOKEN);

	if (resolvedWorkspaceId === DEFAULT_WORKSPACE_ID && envStoreId && envAccessToken) {
		return {
			storeId: envStoreId,
			accessToken: envAccessToken,
			workspaceId: resolvedWorkspaceId,
			provider: 'TIENDANUBE',
			source: 'env',
		};
	}

	const installation = await prisma.storeInstallation.findFirst({
		where: {
			workspaceId: resolvedWorkspaceId,
			provider: 'TIENDANUBE',
		},
		orderBy: { updatedAt: 'desc' },
		select: { storeId: true, accessToken: true, workspaceId: true },
	});

	if (!installation?.storeId || !installation?.accessToken) {
		throw new Error('Faltan credenciales de Tiendanube. Configurá TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN.');
	}

	return {
		storeId: installation.storeId,
		accessToken: installation.accessToken,
		workspaceId: installation.workspaceId,
		provider: 'TIENDANUBE',
		source: 'storeInstallation',
	};
}

function normalizeShopifyCustomer(customer = {}) {
	const firstName = cleanString(customer?.first_name);
	const lastName = cleanString(customer?.last_name);
	const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() ||
		cleanString(customer?.name) ||
		cleanString(customer?.email) ||
		'Cliente sin nombre';
	const defaultAddress = customer?.default_address && typeof customer.default_address === 'object'
		? customer.default_address
		: null;
	const phone = cleanString(customer?.phone) || cleanString(defaultAddress?.phone);

	return {
		externalCustomerId: String(customer?.id || ''),
		displayName,
		email: cleanString(customer?.email),
		normalizedEmail: normalizeEmail(customer?.email),
		phone,
		normalizedPhone: normalizePhone(phone),
		note: cleanString(customer?.note),
		acceptsMarketing: customer?.accepts_marketing == null ? null : Boolean(customer.accepts_marketing),
		acceptsMarketingUpdatedAt: parseDateOrNull(customer?.accepts_marketing_updated_at),
		defaultAddress,
		addresses: Array.isArray(customer?.addresses) ? customer.addresses : [],
		billingAddress: cleanString(defaultAddress?.address1),
		billingNumber: cleanString(defaultAddress?.address2),
		billingZipcode: cleanString(defaultAddress?.zip),
		billingCity: cleanString(defaultAddress?.city),
		billingProvince: cleanString(defaultAddress?.province),
		billingCountry: cleanString(defaultAddress?.country),
		billingPhone: cleanString(defaultAddress?.phone),
		orderCount: Number(customer?.orders_count || 0),
		totalSpent: toDecimalOrNull(customer?.total_spent),
		currency: cleanString(customer?.currency) || null,
		rawCustomerPayload: customer,
		syncedAt: new Date(),
	};
}

async function upsertCustomerProfiles(customers, storeId, workspaceId, provider = 'SHOPIFY') {
	const normalizedProvider = normalizeProvider(provider);
	const normalizedCustomers = customers
		.map(normalizeShopifyCustomer)
		.filter((customer) => customer.externalCustomerId || customer.normalizedEmail || customer.normalizedPhone);

	let touched = 0;
	for (const customer of normalizedCustomers) {
		const existing = await prisma.customerProfile.findFirst({
			where: {
				workspaceId,
				OR: [
					customer.externalCustomerId
						? { provider: normalizedProvider, externalCustomerId: customer.externalCustomerId }
						: null,
					customer.normalizedEmail ? { normalizedEmail: customer.normalizedEmail } : null,
					customer.normalizedPhone ? { normalizedPhone: customer.normalizedPhone } : null,
				].filter(Boolean),
			},
			select: { id: true },
		});

		const data = {
			provider: normalizedProvider,
			storeId,
			externalCustomerId: customer.externalCustomerId || null,
			displayName: customer.displayName,
			email: customer.email,
			normalizedEmail: customer.normalizedEmail,
			phone: customer.phone,
			normalizedPhone: customer.normalizedPhone,
			note: customer.note,
			acceptsMarketing: customer.acceptsMarketing,
			acceptsMarketingUpdatedAt: customer.acceptsMarketingUpdatedAt,
			defaultAddress: customer.defaultAddress,
			addresses: customer.addresses,
			billingAddress: customer.billingAddress,
			billingNumber: customer.billingNumber,
			billingZipcode: customer.billingZipcode,
			billingCity: customer.billingCity,
			billingProvince: customer.billingProvince,
			billingCountry: customer.billingCountry,
			billingPhone: customer.billingPhone,
			orderCount: customer.orderCount,
			totalSpent: customer.totalSpent,
			currency: customer.currency,
			rawCustomerPayload: customer.rawCustomerPayload,
			syncedAt: customer.syncedAt,
		};

		if (existing?.id) {
			await prisma.customerProfile.update({
				where: { id: existing.id },
				data,
			});
		} else {
			await prisma.customerProfile.create({
				data: {
					workspaceId,
					...data,
				},
			});
		}
		touched += 1;
	}

	return touched;
}

async function fetchJson(url, accessToken, resourceLabel) {
	const userAgent = process.env.TIENDANUBE_USER_AGENT || 'Multi Brand IA Assistant';

	let lastError = null;
	for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
		try {
			const response = await fetchWithTimeout(url, {
				method: 'GET',
				headers: {
					Authentication: `bearer ${accessToken}`,
					'User-Agent': userAgent,
					'Content-Type': 'application/json',
				},
			}, TIENDANUBE_TIMEOUT_MS);

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
		fields: CUSTOMER_ORDER_LIST_FIELDS,
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

async function getLocalOrderBounds(storeId, workspaceId, provider = 'TIENDANUBE') {
	const normalizedProvider = normalizeProvider(provider);
	const [count, earliest, latest] = await Promise.all([
		prisma.customerOrder.count({ where: { workspaceId, provider: normalizedProvider, storeId } }),
		prisma.customerOrder.findFirst({
			where: { workspaceId, provider: normalizedProvider, storeId },
			orderBy: [{ orderCreatedAt: 'asc' }, { createdAt: 'asc' }],
			select: { orderCreatedAt: true },
		}),
		prisma.customerOrder.findFirst({
			where: { workspaceId, provider: normalizedProvider, storeId },
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

async function ensureProfilesForOrders(orders, storeId, workspaceId, provider = 'TIENDANUBE') {
	const normalizedProvider = normalizeProvider(provider);
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
			workspaceId,
			storeId,
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
				workspaceId,
				provider: normalizedProvider,
				storeId,
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
			workspaceId,
			storeId,
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

function mapOrderPayload(order, storeId, customerProfileId, workspaceId, provider = 'TIENDANUBE') {
	const normalizedProvider = normalizeProvider(provider);
	return {
		workspaceId,
		provider: normalizedProvider,
		customerProfileId,
		storeId,
		orderId: String(order?.id),
		orderNumber: cleanString(order?.number),
		token: cleanString(order?.token),
		contactName: cleanString(order?.contact_name) || 'Cliente sin nombre',
		contactEmail: cleanString(order?.contact_email),
		normalizedEmail: normalizeEmail(order?.contact_email),
		contactPhone: cleanString(order?.contact_phone),
		normalizedPhone: normalizePhone(order?.contact_phone),
		paymentStatus: normalizeOrderStatus(order?.payment_status),
		shippingStatus: normalizeOrderStatus(deriveShippingStatus(order)),
		totalAmount: toDecimalOrNull(order?.total),
		currency: cleanString(order?.currency) || 'ARS',
		products: Array.isArray(order?.products) ? order.products : [],
		rawPayload: order,
		orderCreatedAt: parseDateOrNull(order?.created_at),
		orderUpdatedAt: parseDateOrNull(order?.updated_at),
	};
}

function buildOrderItems(order, storeId, customerOrderId, customerProfileId, workspaceId, provider = 'TIENDANUBE') {
	const normalizedProvider = normalizeProvider(provider);
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
			workspaceId,
			provider: normalizedProvider,
			customerOrderId,
			customerProfileId,
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

async function upsertOrdersAndItems(orders, storeId, workspaceId = DEFAULT_WORKSPACE_ID, provider = 'TIENDANUBE') {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedProvider = normalizeProvider(provider);
	if (!orders.length) return { ordersUpserted: 0, itemsUpserted: 0 };

	const orderToProfileId = await ensureProfilesForOrders(orders, storeId, resolvedWorkspaceId, normalizedProvider);
	const orderIds = orders.map((order) => String(order.id));

	const existingOrders = await prisma.customerOrder.findMany({
		where: { workspaceId: resolvedWorkspaceId, provider: normalizedProvider, storeId, orderId: { in: orderIds } },
		select: { id: true, orderId: true },
	});
	const existingMap = new Map(existingOrders.map((item) => [item.orderId, item.id]));

	const createData = [];
	const updates = [];
	for (const order of orders) {
		const orderId = String(order.id);
		const customerProfileId = orderToProfileId.get(orderId);
		if (!customerProfileId) continue;

		const payload = mapOrderPayload(order, storeId, customerProfileId, resolvedWorkspaceId, normalizedProvider);
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
		where: { workspaceId: resolvedWorkspaceId, provider: normalizedProvider, storeId, orderId: { in: orderIds } },
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
		items.push(...buildOrderItems(order, storeId, customerOrderId, customerProfileId, resolvedWorkspaceId, normalizedProvider));
	}

	for (let index = 0; index < items.length; index += ITEM_BATCH_SIZE) {
		const batch = items.slice(index, index + ITEM_BATCH_SIZE);
		if (batch.length) {
			await prisma.customerOrderItem.createMany({ data: batch });
		}
	}

	return { ordersUpserted: orders.length, itemsUpserted: items.length, orderIds };
}


export async function fetchTiendanubeOrderById({ storeId, accessToken, orderId }) {
	const normalizedOrderId = String(orderId || '').trim();
	if (!storeId || !accessToken || !normalizedOrderId) {
		throw new Error('fetchTiendanubeOrderById requiere storeId, accessToken y orderId.');
	}

	const params = new URLSearchParams({ fields: CUSTOMER_ORDER_LIST_FIELDS });
	const baseUrl = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/orders/${normalizedOrderId}`;
	const url = `${baseUrl}?${params.toString()}`;
	let payload;
	try {
		payload = await fetchJson(url, accessToken, `pedido ${normalizedOrderId}`);
	} catch (error) {
		if (!isInvalidFieldsError(error)) throw error;
		payload = await fetchJson(baseUrl, accessToken, `pedido ${normalizedOrderId} sin fields`);
	}
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		throw new Error(`La respuesta de Tiendanube para el pedido ${normalizedOrderId} no fue un objeto válido.`);
	}
	return payload;
}

export async function upsertTiendanubeOrder(order, storeId, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	if (!order || !order.id) {
		throw new Error('No se pudo guardar la orden de Tiendanube porque el payload no trae id.');
	}

	return upsertOrdersAndItems([order], storeId, workspaceId, 'TIENDANUBE');
}

export async function fetchShopifyOrderById({ workspaceId = DEFAULT_WORKSPACE_ID, orderId }) {
	const normalizedOrderId = String(orderId || '').trim();
	if (!normalizedOrderId) {
		throw new Error('fetchShopifyOrderById requiere orderId.');
	}

	const { client } = await getShopifyClient({ workspaceId });
	const response = await client.get(`/orders/${normalizedOrderId}.json`, {
		params: {
			fields: [
				'id',
				'name',
				'order_number',
				'token',
				'checkout_token',
				'created_at',
				'updated_at',
				'total_price',
				'subtotal_price',
				'currency',
				'financial_status',
				'fulfillment_status',
				'cancelled_at',
				'closed_at',
				'email',
				'phone',
				'customer',
				'shipping_address',
				'billing_address',
				'payment_gateway_names',
				'line_items',
				'fulfillments'
			].join(',')
		}
	});
	const order = response.data?.order;
	if (!order || typeof order !== 'object') {
		throw new Error(`La respuesta de Shopify para la orden ${normalizedOrderId} no fue valida.`);
	}
	return order;
}

export async function upsertShopifyOrder(order, storeId, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	if (!order || !order.id) {
		throw new Error('No se pudo guardar la orden de Shopify porque el payload no trae id.');
	}

	return upsertOrdersAndItems([normalizeShopifyOrder(order)], storeId, workspaceId, 'SHOPIFY');
}

async function processWindow({ storeId, accessToken, workspaceId, from, to, label }) {
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
		await attributeOrdersByIds({
			workspaceId,
			storeId,
			orderIds: saved.orderIds || orders.map((order) => String(order.id)),
		}).catch((error) => {
			pushWarning(`No se pudo atribuir conversiones de campaÃ±a: ${error?.message || error}`);
		});
		syncState.ordersUpserted += saved.ordersUpserted;
		syncState.itemsUpserted += saved.itemsUpserted;
		windowUpserted += saved.ordersUpserted;
		windowItems += saved.itemsUpserted;

		syncState.localOrdersAfter = await prisma.customerOrder.count({ where: { workspaceId, storeId } });
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

async function fetchShopifyOrdersPage({ client, page, createdAtMin = null, createdAtMax = null, sinceId = 0 }) {
	const params = {
		limit: SHOPIFY_ORDERS_PER_PAGE,
		status: 'any',
		since_id: sinceId,
		fields: [
			'id',
			'name',
			'order_number',
			'token',
			'checkout_token',
			'created_at',
			'updated_at',
			'total_price',
			'subtotal_price',
			'currency',
			'financial_status',
			'fulfillment_status',
			'cancelled_at',
			'closed_at',
			'email',
			'phone',
			'customer',
			'shipping_address',
			'billing_address',
			'payment_gateway_names',
			'line_items',
			'fulfillments'
		].join(',')
	};

	if (createdAtMin) params.created_at_min = createdAtMin.toISOString();
	if (createdAtMax) params.created_at_max = createdAtMax.toISOString();

	const response = await client.get('/orders.json', { params });
	const orders = Array.isArray(response.data?.orders) ? response.data.orders : [];
	syncState.pagesFetched += 1;
	syncState.message = `Shopify: pagina ${page} procesada.`;
	return orders;
}

async function fetchShopifyCustomersPage({ client, sinceId = 0 }) {
	const response = await client.get('/customers.json', {
		params: {
			limit: SHOPIFY_CUSTOMERS_PER_PAGE,
			since_id: sinceId,
			fields: [
				'id',
				'first_name',
				'last_name',
				'email',
				'phone',
				'note',
				'orders_count',
				'total_spent',
				'currency',
				'accepts_marketing',
				'accepts_marketing_updated_at',
				'default_address',
				'addresses',
				'created_at',
				'updated_at'
			].join(',')
		}
	});
	return Array.isArray(response.data?.customers) ? response.data.customers : [];
}

async function syncShopifyCustomerProfiles({ client, storeId, workspaceId }) {
	let sinceId = 0;
	let pages = 0;
	let touched = 0;

	while (pages < MAX_PAGES_PER_WINDOW) {
		const customers = await fetchShopifyCustomersPage({ client, sinceId });
		pages += 1;
		syncState.pagesFetched += 1;
		if (!customers.length) break;

		touched += await upsertCustomerProfiles(customers, storeId, workspaceId, 'SHOPIFY');
		syncState.customersTouched += customers.length;
		sinceId = Math.max(...customers.map((customer) => Number(customer.id || 0)), sinceId);

		if (customers.length < SHOPIFY_CUSTOMERS_PER_PAGE || !sinceId) break;
		await sleep(350);
	}

	return { pagesFetched: pages, customersTouched: touched };
}

async function processShopifyWindow({ client, storeId, workspaceId, from, to, label }) {
	syncState.phase = label === 'recent' ? 'recent_sync' : 'historical_backfill';
	syncState.activeWindow = { from, to, label };
	syncState.message = `Sincronizando Shopify ${label}.`;

	let sinceId = 0;
	let page = 1;
	let windowOrders = 0;
	let windowUpserted = 0;
	let windowItems = 0;

	while (page <= MAX_PAGES_PER_WINDOW) {
		const rawOrders = await fetchShopifyOrdersPage({ client, page, createdAtMin: from, createdAtMax: to, sinceId });
		if (!rawOrders.length) break;

		const orders = rawOrders.map(normalizeShopifyOrder).filter((order) => order.id);
		syncState.ordersFetched += orders.length;
		windowOrders += orders.length;

		const saved = await upsertOrdersAndItems(orders, storeId, workspaceId, 'SHOPIFY');
		await attributeOrdersByIds({
			workspaceId,
			storeId,
			orderIds: saved.orderIds || orders.map((order) => String(order.id)),
		}).catch((error) => {
			pushWarning(`No se pudo atribuir conversiones Shopify: ${error?.message || error}`);
		});

		syncState.ordersUpserted += saved.ordersUpserted;
		syncState.itemsUpserted += saved.itemsUpserted;
		windowUpserted += saved.ordersUpserted;
		windowItems += saved.itemsUpserted;
		syncState.localOrdersAfter = await prisma.customerOrder.count({ where: { workspaceId, provider: 'SHOPIFY', storeId } });

		sinceId = Math.max(...orders.map((order) => Number(order.id || 0)), sinceId);
		if (rawOrders.length < SHOPIFY_ORDERS_PER_PAGE || !sinceId) break;
		page += 1;
		await sleep(350);
	}

	return {
		label,
		pagesFetched: page,
		ordersFetched: windowOrders,
		ordersUpserted: windowUpserted,
		itemsUpserted: windowItems,
	};
}

function safeSyncLogData(data) {
	return {
		workspaceId: data.workspaceId,
		provider: data.provider || 'TIENDANUBE',
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

async function runSyncJob({ workspaceId = DEFAULT_WORKSPACE_ID, provider = 'TIENDANUBE' } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedProvider = normalizeProvider(provider);
	const startedAt = Date.now();
	let syncLog = null;

	try {
		const { storeId, accessToken } = await resolveStoreCredentials({ workspaceId: resolvedWorkspaceId, provider: normalizedProvider });
		try {
			syncLog = await prisma.customerSyncLog.create({
				data: safeSyncLogData({
					workspaceId: resolvedWorkspaceId,
					provider: normalizedProvider,
					storeId,
					status: 'RUNNING',
					fullSync: false,
					startedAt: new Date(),
					message: `Sync de pedidos ${normalizedProvider} iniciada`,
				}),
			});
		} catch (logError) {
			pushWarning(`No se pudo crear customerSyncLog: ${logError?.message || 'error desconocido'}`);
		}

		const boundsBefore = await getLocalOrderBounds(storeId, resolvedWorkspaceId, normalizedProvider);
		syncState.localOrdersBefore = boundsBefore.count;
		syncState.localOrdersAfter = boundsBefore.count;

		const recentFrom = subtractDays(new Date(), RECENT_LOOKBACK_DAYS);
		syncState.recentFrom = recentFrom.toISOString();

		const runs = [];
		if (normalizedProvider === 'SHOPIFY') {
			const { client } = await getShopifyClient({ workspaceId: resolvedWorkspaceId });
			runs.push({
				label: 'customers',
				...(await syncShopifyCustomerProfiles({
					client,
					storeId,
					workspaceId: resolvedWorkspaceId,
				})),
				ordersFetched: 0,
				ordersUpserted: 0,
				itemsUpserted: 0,
			});
			runs.push(
				await processShopifyWindow({
					client,
					storeId,
					workspaceId: resolvedWorkspaceId,
					from: recentFrom,
					to: new Date(),
					label: 'recent',
				})
			);
		} else {
		runs.push(
			await processWindow({
				storeId,
				accessToken,
				workspaceId: resolvedWorkspaceId,
				from: recentFrom,
				to: new Date(),
				label: 'recent',
			})
		);
		}

		let cursor = boundsBefore.earliestOrderCreatedAt
			? startOfMonthUTC(new Date(boundsBefore.earliestOrderCreatedAt.getTime() - 24 * 60 * 60 * 1000))
			: startOfMonthUTC(subtractDays(new Date(), RECENT_LOOKBACK_DAYS + 1));

		let emptyWindows = 0;
		let hitPerRunLimit = false;

		for (let index = 0; index < Math.min(HISTORY_MONTHS_PER_RUN, MAX_MONTH_WINDOWS_PER_SYNC); index += 1) {
			const monthStart = startOfMonthUTC(cursor);
			const monthEnd = endOfMonthUTC(cursor);
			const label = monthLabel(monthStart);

			const result = normalizedProvider === 'SHOPIFY'
				? await processShopifyWindow({
					client: (await getShopifyClient({ workspaceId: resolvedWorkspaceId })).client,
					storeId,
					workspaceId: resolvedWorkspaceId,
					from: monthStart,
					to: monthEnd,
					label,
				})
				: await processWindow({
					storeId,
					accessToken,
					workspaceId: resolvedWorkspaceId,
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
					workspaceId: resolvedWorkspaceId,
					provider: normalizedProvider,
					storeId,
					finishedAt: new Date(),
					pagesFetched: syncState.pagesFetched,
					ordersFetched: syncState.ordersFetched,
					ordersUpserted: syncState.ordersUpserted,
					customersTouched: syncState.customersTouched,
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
						workspaceId: resolvedWorkspaceId,
						provider: normalizedProvider,
						storeId: syncLog.storeId,
						finishedAt: new Date(),
						pagesFetched: syncState.pagesFetched,
						ordersFetched: syncState.ordersFetched,
						ordersUpserted: syncState.ordersUpserted,
						customersTouched: syncState.customersTouched,
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

export async function syncCustomers({ workspaceId = DEFAULT_WORKSPACE_ID, provider = '' } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedProvider = provider
		? normalizeProvider(provider)
		: (await resolveActiveCommerceConnection({ workspaceId: resolvedWorkspaceId })).provider;
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
	syncState.message = `Preparando sincronizacion de pedidos ${normalizedProvider}...`;

	setTimeout(() => {
		runSyncJob({ workspaceId: resolvedWorkspaceId, provider: normalizedProvider }).catch((error) => {
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
