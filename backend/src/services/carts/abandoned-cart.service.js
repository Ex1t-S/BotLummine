import { prisma } from '../../lib/prisma.js';
import { fetchWithTimeout, getHttpTimeoutMs } from '../../lib/http-timeout.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import { resolveActiveCommerceConnection } from '../commerce/active-commerce.service.js';
import { getShopifyClient } from '../shopify/client.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const CHECKOUTS_PER_PAGE = Math.min(
	50,
	Math.max(20, Number(process.env.TIENDANUBE_ABANDONED_SYNC_PER_PAGE || 50))
);
const MAX_PAGES = Math.max(
	1,
	Number(process.env.TIENDANUBE_ABANDONED_SYNC_MAX_PAGES || 80)
);
const FETCH_RETRIES = Math.max(
	1,
	Number(process.env.TIENDANUBE_ABANDONED_SYNC_RETRIES || 3)
);
const UPSERT_CHUNK_SIZE = Math.max(
	10,
	Number(process.env.TIENDANUBE_ABANDONED_UPSERT_CHUNK_SIZE || 100)
);
const DELETE_CHUNK_SIZE = Math.max(
	25,
	Number(process.env.TIENDANUBE_ABANDONED_DELETE_CHUNK_SIZE || 250)
);
const TIENDANUBE_TIMEOUT_MS = getHttpTimeoutMs('TIENDANUBE_TIMEOUT_MS', 15000);
const DEFAULT_DAYS_BACK = 30;
const ALLOWED_WINDOWS = new Set([30]);

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePhone(value = '') {
	return String(value || '').replace(/\D/g, '') || null;
}

function cleanString(value = '') {
	const normalized = String(value ?? '').trim();
	return normalized || null;
}

function buildHeaders(accessToken) {
	return {
		Authentication: `bearer ${accessToken}`,
		'Content-Type': 'application/json; charset=utf-8',
		'User-Agent': process.env.TIENDANUBE_USER_AGENT || 'Multi Brand IA Assistant',
	};
}

function normalizeProvider(value = '') {
	const provider = String(value || '').trim().toUpperCase();
	return provider === 'SHOPIFY' ? 'SHOPIFY' : 'TIENDANUBE';
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

function mapAddress(cart) {
	return [
		cart?.shipping_address,
		cart?.shipping_number,
		cart?.shipping_floor,
		cart?.shipping_locality
	]
		.filter(Boolean)
		.join(' ')
		.trim();
}

function chunkArray(values = [], size = 50) {
	const chunks = [];
	for (let i = 0; i < values.length; i += size) {
		chunks.push(values.slice(i, i + size));
	}
	return chunks;
}

function isLastPageResponse(status, bodyText = '') {
	if (status !== 404) return false;

	const text = String(bodyText || '');
	if (text.toLowerCase().includes('last page is')) {
		return true;
	}

	try {
		const parsed = JSON.parse(text);
		const description = String(parsed?.description || '');
		return description.toLowerCase().includes('last page is');
	} catch {
		return false;
	}
}

async function resolveStoreCredentials({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const installation = await prisma.storeInstallation.findFirst({
		where: {
			workspaceId: resolvedWorkspaceId,
			provider: 'TIENDANUBE',
		},
		orderBy: { installedAt: 'desc' }
	});

	const useEnv = resolvedWorkspaceId === DEFAULT_WORKSPACE_ID;
	const storeId = installation?.storeId || (useEnv ? process.env.TIENDANUBE_STORE_ID : null) || null;
	const accessToken = installation?.accessToken || (useEnv ? process.env.TIENDANUBE_ACCESS_TOKEN : null) || null;

	if (!storeId || !accessToken) {
		throw new Error(
			'Faltan credenciales de Tiendanube. Necesitás StoreInstallation o TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN.'
		);
	}

	return { workspaceId: resolvedWorkspaceId, storeId: String(storeId), accessToken };
}

async function resolveSyncConnection({ workspaceId = DEFAULT_WORKSPACE_ID, provider = '' } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	if (provider) {
		const normalizedProvider = normalizeProvider(provider);
		if (normalizedProvider === 'SHOPIFY') {
			const connection = await resolveActiveCommerceConnection({ workspaceId: resolvedWorkspaceId });
			if (connection.provider !== 'SHOPIFY') {
				throw new Error('El ecommerce activo no es Shopify.');
			}
			return connection;
		}
		const credentials = await resolveStoreCredentials({ workspaceId: resolvedWorkspaceId });
		return {
			...credentials,
			provider: 'TIENDANUBE',
			source: 'tiendanubeCredentials',
		};
	}

	return resolveActiveCommerceConnection({ workspaceId: resolvedWorkspaceId });
}

async function fetchCheckoutsPage({ storeId, accessToken, page, perPage = CHECKOUTS_PER_PAGE }) {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(perPage)
	});

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/checkouts?${params.toString()}`;

	let lastError = null;

	for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
		try {
			const response = await fetchWithTimeout(url, {
				method: 'GET',
				headers: buildHeaders(accessToken)
			}, TIENDANUBE_TIMEOUT_MS);

			const text = await response.text();

			if (!response.ok) {
				if (isLastPageResponse(response.status, text)) {
					return {
						items: [],
						reachedEnd: true,
						perPageUsed: perPage
					};
				}

				if ((response.status === 400 || response.status === 422) && perPage > 20) {
					const fallbackPerPage = perPage > 50 ? 50 : 20;
					if (fallbackPerPage !== perPage) {
						return fetchCheckoutsPage({
							storeId,
							accessToken,
							page,
							perPage: fallbackPerPage
						});
					}
				}

				const error = new Error(
					`checkouts página ${page}: Tiendanube respondió ${response.status} - ${text}`
				);
				error.status = response.status;
				error.body = text;
				throw error;
			}

			let payload = null;
			try {
				payload = text ? JSON.parse(text) : [];
			} catch (parseError) {
				throw new Error(
					`La respuesta de Tiendanube para checkouts no se pudo parsear como JSON: ${parseError.message}`
				);
			}

			if (!Array.isArray(payload)) {
				throw new Error(
					'La respuesta de Tiendanube para checkouts no fue una lista.'
				);
			}

			return {
				items: payload,
				reachedEnd: payload.length < perPage,
				perPageUsed: perPage
			};
		} catch (error) {
			lastError = error;
			if (attempt < FETCH_RETRIES) {
				await sleep(300 * attempt);
			}
		}
	}

	throw (
		lastError ||
		new Error(
			`No se pudo obtener checkouts de Tiendanube para la página ${page}.`
		)
	);
}

function buildCartPayload(cart, storeId, workspaceId) {
	const products = Array.isArray(cart?.products)
		? cart.products.map((product) => ({
				id: product?.id ?? null,
				productId: product?.product_id ?? null,
				variantId: product?.variant_id ?? null,
				name:
					product?.name ||
					product?.name_without_variants ||
					'Producto sin nombre',
				baseName:
					product?.name_without_variants ||
					product?.name ||
					'Producto sin nombre',
				price: product?.price ?? null,
				quantity: Number(product?.quantity || 1),
				sku: product?.sku || null,
				image: product?.image?.src || null,
				variantValues: Array.isArray(product?.variant_values)
					? product.variant_values
					: [],
		  }))
		: [];

	return {
		workspaceId,
		provider: 'TIENDANUBE',
		storeId: String(cart?.store_id || storeId),
		token: cleanString(cart?.token),
		contactName: cleanString(cart?.contact_name || cart?.shipping_name),
		contactEmail: cleanString(cart?.contact_email),
		contactPhone: normalizePhone(
			cart?.contact_phone ||
				cart?.shipping_phone ||
				cart?.billing_phone ||
				''
		),
		abandonedCheckoutUrl: cleanString(cart?.abandoned_checkout_url),
		subtotal: toDecimalOrNull(cart?.subtotal),
		totalAmount: toDecimalOrNull(cart?.total),
		currency: cleanString(cart?.currency) || 'ARS',
		gateway: cleanString(cart?.gateway_name || cart?.gateway),
		shipping: cleanString(cart?.shipping || cart?.shipping_option),
		shippingPickupType: cleanString(
			cart?.shipping_pickup_type || cart?.shipping_pickup_details
		),
		shippingAddress: mapAddress(cart) || null,
		shippingCity: cleanString(cart?.shipping_city),
		shippingProvince: cleanString(cart?.shipping_province),
		shippingZipcode: cleanString(cart?.shipping_zipcode),
		products,
		rawPayload: cart,
		checkoutCreatedAt: parseDateOrNull(cart?.created_at),
	};
}

function buildShopifyCartPayload(checkout, storeId, workspaceId) {
	const customer = checkout?.customer || {};
	const shippingAddress = checkout?.shipping_address || {};
	const billingAddress = checkout?.billing_address || {};
	const products = Array.isArray(checkout?.line_items)
		? checkout.line_items.map((item) => ({
				id: item?.id ?? null,
				productId: item?.product_id ?? null,
				variantId: item?.variant_id ?? null,
				name: item?.title || item?.name || 'Producto sin nombre',
				baseName: item?.title || item?.name || 'Producto sin nombre',
				price: item?.price ?? null,
				quantity: Number(item?.quantity || 1),
				sku: item?.sku || null,
				image: null,
				variantValues: [item?.variant_title].filter(Boolean),
		  }))
		: [];
	const contactName = [
		cleanString(customer?.first_name || checkout?.shipping_address?.first_name || checkout?.billing_address?.first_name),
		cleanString(customer?.last_name || checkout?.shipping_address?.last_name || checkout?.billing_address?.last_name),
	].filter(Boolean).join(' ') || null;
	const phone = normalizePhone(
		checkout?.phone ||
		customer?.phone ||
		shippingAddress?.phone ||
		billingAddress?.phone ||
		''
	);

	return {
		workspaceId,
		provider: 'SHOPIFY',
		storeId,
		token: cleanString(checkout?.token || checkout?.cart_token),
		contactName,
		contactEmail: cleanString(checkout?.email || customer?.email),
		contactPhone: phone,
		abandonedCheckoutUrl: cleanString(checkout?.abandoned_checkout_url || checkout?.web_url),
		subtotal: toDecimalOrNull(checkout?.subtotal_price),
		totalAmount: toDecimalOrNull(checkout?.total_price),
		currency: cleanString(checkout?.currency) || 'ARS',
		gateway: cleanString(checkout?.gateway || checkout?.payment_due),
		shipping: cleanString(checkout?.shipping_line?.title),
		shippingPickupType: null,
		shippingAddress: [
			shippingAddress?.address1,
			shippingAddress?.address2,
		].filter(Boolean).join(' ').trim() || null,
		shippingCity: cleanString(shippingAddress?.city),
		shippingProvince: cleanString(shippingAddress?.province),
		shippingZipcode: cleanString(shippingAddress?.zip),
		products,
		rawPayload: checkout,
		checkoutCreatedAt: parseDateOrNull(checkout?.created_at),
	};
}

async function replaceCartBatch(carts, storeId, workspaceId, provider = 'TIENDANUBE') {
	const normalizedProvider = normalizeProvider(provider);
	const rows = carts
		.map((cart) => ({
			checkoutId: String(cart?.id || '').trim(),
			...(normalizedProvider === 'SHOPIFY'
				? buildShopifyCartPayload(cart, storeId, workspaceId)
				: buildCartPayload(cart, storeId, workspaceId))
		}))
		.filter((row) => row.checkoutId);

	for (const chunk of chunkArray(rows, UPSERT_CHUNK_SIZE)) {
		if (!chunk.length) continue;

		for (const row of chunk) {
			await prisma.abandonedCart.upsert({
				where: {
					workspaceId_provider_checkoutId: {
						workspaceId,
						provider: normalizedProvider,
						checkoutId: row.checkoutId
					}
				},
				update: {
					storeId: row.storeId,
					token: row.token,
					contactName: row.contactName,
					contactEmail: row.contactEmail,
					contactPhone: row.contactPhone,
					abandonedCheckoutUrl: row.abandonedCheckoutUrl,
					subtotal: row.subtotal,
					totalAmount: row.totalAmount,
					currency: row.currency,
					gateway: row.gateway,
					shipping: row.shipping,
					shippingPickupType: row.shippingPickupType,
					shippingAddress: row.shippingAddress,
					shippingCity: row.shippingCity,
					shippingProvince: row.shippingProvince,
					shippingZipcode: row.shippingZipcode,
					rawPayload: row.rawPayload,
					products: row.products,
					checkoutCreatedAt: row.checkoutCreatedAt
				},
				create: {
					...row,
					status: 'NEW'
				}
			});
		}
	}

	return rows.length;
}

async function fetchShopifyCheckoutsPage({ client, sinceId = 0, limit = CHECKOUTS_PER_PAGE }) {
	const response = await client.get('/checkouts.json', {
		params: {
			limit: Math.min(250, Math.max(1, limit)),
			since_id: sinceId,
			fields: [
				'id',
				'token',
				'cart_token',
				'created_at',
				'updated_at',
				'completed_at',
				'email',
				'phone',
				'customer',
				'shipping_address',
				'billing_address',
				'abandoned_checkout_url',
				'web_url',
				'subtotal_price',
				'total_price',
				'currency',
				'line_items',
				'shipping_line'
			].join(',')
		}
	});
	const checkouts = Array.isArray(response.data?.checkouts) ? response.data.checkouts : [];
	return {
		items: checkouts,
		reachedEnd: checkouts.length < Math.min(250, Math.max(1, limit)),
		perPageUsed: Math.min(250, Math.max(1, limit)),
	};
}

async function deleteCartIdsInChunks(ids = [], workspaceId = DEFAULT_WORKSPACE_ID) {
	let deletedCount = 0;

	for (const chunk of chunkArray(ids, DELETE_CHUNK_SIZE)) {
		if (!chunk.length) continue;
		const removed = await prisma.abandonedCart.deleteMany({
			where: {
				workspaceId,
				id: { in: chunk }
			}
		});
		deletedCount += Number(removed?.count || 0);
	}

	return deletedCount;
}

export async function syncAbandonedCarts(daysBack = DEFAULT_DAYS_BACK, { workspaceId = DEFAULT_WORKSPACE_ID, provider = '' } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedDaysBack = ALLOWED_WINDOWS.has(Number(daysBack))
		? Number(daysBack)
		: DEFAULT_DAYS_BACK;

	const connection = await resolveSyncConnection({ workspaceId: resolvedWorkspaceId, provider });
	const normalizedProvider = normalizeProvider(connection.provider);
	const storeId = String(connection.storeId || connection.externalStoreId);
	const accessToken = connection.accessToken;
	const shopifyClient = normalizedProvider === 'SHOPIFY'
		? (await getShopifyClient({ workspaceId: resolvedWorkspaceId })).client
		: null;

	const startedAt = new Date();
	const cutoff = new Date(startedAt);
	cutoff.setDate(cutoff.getDate() - normalizedDaysBack);

	let pagesFetched = 0;
	let totalReceived = 0;
	let syncedCount = 0;
	let skippedOldCount = 0;
	let stopSync = false;
	let effectivePerPage = CHECKOUTS_PER_PAGE;
	let shopifySinceId = 0;

	for (let page = 1; page <= MAX_PAGES && !stopSync; page += 1) {
		let pageResult;
		try {
			pageResult = normalizedProvider === 'SHOPIFY'
				? await fetchShopifyCheckoutsPage({ client: shopifyClient, sinceId: shopifySinceId, limit: effectivePerPage })
				: await fetchCheckoutsPage({
					storeId,
					accessToken,
					page,
					perPage: effectivePerPage
				});
		} catch (error) {
			if (normalizedProvider === 'SHOPIFY' && error?.response?.status === 403) {
				throw new Error('Shopify no permite leer carritos abandonados. Revisá que la app tenga permiso read_checkouts.');
			}
			throw error;
		}

		effectivePerPage = pageResult.perPageUsed || effectivePerPage;
		pagesFetched += 1;

		const carts = Array.isArray(pageResult.items) ? pageResult.items : [];
		totalReceived += carts.length;

		if (!carts.length) {
			stopSync = true;
			continue;
		}

		const validCarts = [];

		for (const cart of carts) {
			const checkoutId = String(cart?.id || '').trim();
			if (!checkoutId) continue;

			const createdAt = parseDateOrNull(cart?.created_at);
			if (createdAt && createdAt < cutoff) {
				skippedOldCount += 1;
				continue;
			}

			validCarts.push(cart);
		}

		if (validCarts.length) {
			syncedCount += await replaceCartBatch(validCarts, storeId, resolvedWorkspaceId, normalizedProvider);
		}

		if (normalizedProvider === 'SHOPIFY') {
			const checkoutIds = carts.map((cart) => Number(cart?.id || 0)).filter(Boolean);
			shopifySinceId = checkoutIds.length ? Math.max(shopifySinceId, ...checkoutIds) : shopifySinceId;
		}

		if (pageResult.reachedEnd) {
			stopSync = true;
		}
	}

	const oldNewCarts = await prisma.abandonedCart.findMany({
		where: {
			storeId,
			workspaceId: resolvedWorkspaceId,
			provider: normalizedProvider,
			status: 'NEW',
			checkoutCreatedAt: { lt: cutoff }
		},
		select: { id: true }
	});

	const idsToDelete = oldNewCarts.map((item) => item.id);
	const uniqueIdsToDelete = [...new Set(idsToDelete)];
	const deletedCount = await deleteCartIdsInChunks(uniqueIdsToDelete, resolvedWorkspaceId);
	const remainingCount = await prisma.abandonedCart.count({ where: { workspaceId: resolvedWorkspaceId, provider: normalizedProvider, storeId } });

	return {
		ok: true,
		provider: normalizedProvider,
		daysBack: normalizedDaysBack,
		pagesFetched,
		totalReceived,
		syncedCount,
		skippedOldCount,
		removedCount: deletedCount,
		deletedCount,
		remainingCount,
		message: `Sync lista · páginas ${pagesFetched} · checkouts leídos ${totalReceived} · carritos guardados ${syncedCount} · limpiados ${deletedCount}.`
	};
}
