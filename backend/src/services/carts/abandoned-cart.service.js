import { prisma } from '../../lib/prisma.js';

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

function buildHeaders(accessToken) {
	return {
		Authentication: `bearer ${accessToken}`,
		'Content-Type': 'application/json; charset=utf-8',
		'User-Agent': process.env.TIENDANUBE_USER_AGENT || 'Lummine IA Assistant',
	};
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

async function resolveStoreCredentials() {
	const installation = await prisma.storeInstallation.findFirst({
		orderBy: { installedAt: 'desc' }
	});

	const storeId = installation?.storeId || process.env.TIENDANUBE_STORE_ID || null;
	const accessToken = installation?.accessToken || process.env.TIENDANUBE_ACCESS_TOKEN || null;

	if (!storeId || !accessToken) {
		throw new Error(
			'Faltan credenciales de Tiendanube. Necesitás StoreInstallation o TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN.'
		);
	}

	const normalizedStoreId = String(storeId);
	return { storeId: normalizedStoreId, accessToken, workspaceId: await resolveWorkspaceId() };
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
			const response = await fetch(url, {
				method: 'GET',
				headers: buildHeaders(accessToken)
			});

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

async function replaceCartBatch(carts, storeId, workspaceId) {
	const rows = carts
		.map((cart) => ({
			checkoutId: String(cart?.id || '').trim(),
			...buildCartPayload(cart, storeId, workspaceId)
		}))
		.filter((row) => row.checkoutId);

	for (const chunk of chunkArray(rows, UPSERT_CHUNK_SIZE)) {
		if (!chunk.length) continue;

		for (const row of chunk) {
			await prisma.abandonedCart.upsert({
				where: {
					checkoutId: row.checkoutId
				},
				update: {
					workspaceId: row.workspaceId,
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

async function deleteCartIdsInChunks(ids = []) {
	let deletedCount = 0;

	for (const chunk of chunkArray(ids, DELETE_CHUNK_SIZE)) {
		if (!chunk.length) continue;
		const removed = await prisma.abandonedCart.deleteMany({
			where: {
				id: { in: chunk }
			}
		});
		deletedCount += Number(removed?.count || 0);
	}

	return deletedCount;
}

export async function syncAbandonedCarts(daysBack = DEFAULT_DAYS_BACK) {
	const normalizedDaysBack = ALLOWED_WINDOWS.has(Number(daysBack))
		? Number(daysBack)
		: DEFAULT_DAYS_BACK;

	const { storeId, workspaceId, accessToken } = await resolveStoreCredentials();

	const startedAt = new Date();
	const cutoff = new Date(startedAt);
	cutoff.setDate(cutoff.getDate() - normalizedDaysBack);

	let pagesFetched = 0;
	let totalReceived = 0;
	let syncedCount = 0;
	let skippedOldCount = 0;
	let stopSync = false;
	let effectivePerPage = CHECKOUTS_PER_PAGE;

	for (let page = 1; page <= MAX_PAGES && !stopSync; page += 1) {
		const pageResult = await fetchCheckoutsPage({
			storeId,
			accessToken,
			page,
			perPage: effectivePerPage
		});

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
			syncedCount += await replaceCartBatch(validCarts, storeId, workspaceId);
		}

		if (pageResult.reachedEnd) {
			stopSync = true;
		}
	}

	const oldNewCarts = await prisma.abandonedCart.findMany({
		where: {
			workspaceId,
			storeId,
			status: 'NEW',
			checkoutCreatedAt: { lt: cutoff }
		},
		select: { id: true }
	});

	const idsToDelete = oldNewCarts.map((item) => item.id);
	const uniqueIdsToDelete = [...new Set(idsToDelete)];
	const deletedCount = await deleteCartIdsInChunks(uniqueIdsToDelete);
	const remainingCount = await prisma.abandonedCart.count({ where: { workspaceId, storeId } });

	return {
		ok: true,
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
