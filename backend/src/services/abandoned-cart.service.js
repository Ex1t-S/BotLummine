import { prisma } from '../lib/prisma.js';
import { resolveStoreCredentials } from './customer.service.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const CHECKOUTS_PER_PAGE = Math.min(
	200,
	Math.max(20, Number(process.env.TIENDANUBE_ABANDONED_SYNC_PER_PAGE || 200))
);
const FETCH_CONCURRENCY = Math.min(
	6,
	Math.max(1, Number(process.env.TIENDANUBE_ABANDONED_SYNC_CONCURRENCY || 3))
);
const MAX_PAGES = Math.max(1, Number(process.env.TIENDANUBE_ABANDONED_SYNC_MAX_PAGES || 80));
const FETCH_RETRIES = Math.max(1, Number(process.env.TIENDANUBE_ABANDONED_SYNC_RETRIES || 3));
const UPSERT_CHUNK_SIZE = Math.max(10, Number(process.env.TIENDANUBE_ABANDONED_UPSERT_CHUNK_SIZE || 200));
const DEFAULT_DAYS_BACK = 7;
const ALLOWED_WINDOWS = new Set([7, 15, 30]);

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
	return [cart?.shipping_address, cart?.shipping_number, cart?.shipping_floor, cart?.shipping_locality]
		.filter(Boolean)
		.join(' ')
		.trim();
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

async function fetchCheckoutsPage({ storeId, accessToken, page }) {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(CHECKOUTS_PER_PAGE),
	});

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/checkouts?${params.toString()}`;
	let lastError = null;

	for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: buildHeaders(accessToken),
			});

			if (!response.ok) {
				const text = await response.text();
				if (response.status === 404 && text.includes('Last page is')) {
					return [];
				}
				throw new Error(`checkouts página ${page}: Tiendanube respondió ${response.status} - ${text}`);
			}

			const payload = await response.json();
			if (!Array.isArray(payload)) throw new Error('La respuesta de Tiendanube para checkouts no fue una lista.');
			return payload;
		} catch (error) {
			lastError = error;
			if (attempt < FETCH_RETRIES) {
				await sleep(300 * attempt);
				continue;
			}
		}
	}

	throw lastError || new Error(`No se pudo obtener checkouts de Tiendanube para la página ${page}.`);
}

function buildCartPayload(cart, storeId) {
	const products = Array.isArray(cart?.products)
		? cart.products.map((product) => ({
				id: product?.id ?? null,
				productId: product?.product_id ?? null,
				variantId: product?.variant_id ?? null,
				name: product?.name || product?.name_without_variants || 'Producto sin nombre',
				baseName: product?.name_without_variants || product?.name || 'Producto sin nombre',
				price: product?.price ?? null,
				quantity: Number(product?.quantity || 1),
				sku: product?.sku || null,
				image: product?.image?.src || null,
				variantValues: Array.isArray(product?.variant_values) ? product.variant_values : [],
		  }))
		: [];

	return {
		storeId: String(cart?.store_id || storeId),
		token: cleanString(cart?.token),
		contactName: cleanString(cart?.contact_name || cart?.shipping_name),
		contactEmail: cleanString(cart?.contact_email),
		contactPhone: normalizePhone(cart?.contact_phone || cart?.shipping_phone || cart?.billing_phone || ''),
		abandonedCheckoutUrl: cleanString(cart?.abandoned_checkout_url),
		subtotal: toDecimalOrNull(cart?.subtotal),
		totalAmount: toDecimalOrNull(cart?.total),
		currency: cleanString(cart?.currency) || 'ARS',
		gateway: cleanString(cart?.gateway_name || cart?.gateway),
		shipping: cleanString(cart?.shipping || cart?.shipping_option),
		shippingPickupType: cleanString(cart?.shipping_pickup_type || cart?.shipping_pickup_details),
		shippingAddress: mapAddress(cart) || null,
		shippingCity: cleanString(cart?.shipping_city),
		shippingProvince: cleanString(cart?.shipping_province),
		shippingZipcode: cleanString(cart?.shipping_zipcode),
		products,
		rawPayload: cart,
		checkoutCreatedAt: parseDateOrNull(cart?.created_at),
	};
}

async function replaceCartBatch(carts, storeId) {
	const checkoutIds = carts.map((cart) => String(cart.id));
	await prisma.abandonedCart.deleteMany({
		where: {
			storeId,
			checkoutId: { in: checkoutIds },
		},
	});

	const rows = carts.map((cart) => ({
		checkoutId: String(cart.id),
		status: 'NEW',
		...buildCartPayload(cart, storeId),
	}));

	for (const chunk of chunkArray(rows, UPSERT_CHUNK_SIZE)) {
		if (!chunk.length) continue;
		await prisma.abandonedCart.createMany({ data: chunk });
	}

	return rows.length;
}

export async function syncAbandonedCarts(daysBack = DEFAULT_DAYS_BACK) {
	const normalizedDaysBack = ALLOWED_WINDOWS.has(Number(daysBack)) ? Number(daysBack) : DEFAULT_DAYS_BACK;
	const { storeId, accessToken } = await resolveStoreCredentials();

	const startedAt = new Date();
	const cutoff = new Date(startedAt);
	cutoff.setDate(cutoff.getDate() - normalizedDaysBack);

	let pagesFetched = 0;
	let totalReceived = 0;
	let syncedCount = 0;
	let skippedOldCount = 0;
	let stopSync = false;
	const seenCheckoutIds = new Set();

	for (let pageStart = 1; pageStart <= MAX_PAGES && !stopSync; pageStart += FETCH_CONCURRENCY) {
		const pages = buildConcurrentPageList(pageStart, MAX_PAGES, FETCH_CONCURRENCY);
		const pageResults = await Promise.all(
			pages.map((page) => fetchCheckoutsPage({ storeId, accessToken, page }))
		);

		const validCarts = [];

		for (const carts of pageResults) {
			pagesFetched += 1;
			totalReceived += carts.length;
			if (!carts.length) {
				stopSync = true;
				continue;
			}

			for (const cart of carts) {
				const checkoutDate = parseDateOrNull(cart?.created_at);
				if (!checkoutDate || checkoutDate < cutoff) {
					skippedOldCount += 1;
					continue;
				}

				seenCheckoutIds.add(String(cart.id));
				validCarts.push(cart);
			}

			if (carts.length < CHECKOUTS_PER_PAGE) stopSync = true;
		}

		if (validCarts.length) {
			syncedCount += await replaceCartBatch(validCarts, storeId);
		}
	}

	const deleteResult = await prisma.abandonedCart.deleteMany({
		where: {
			storeId,
			OR: [
				{ checkoutCreatedAt: { lt: cutoff } },
				seenCheckoutIds.size
					? { checkoutId: { notIn: [...seenCheckoutIds] } }
					: { checkoutCreatedAt: { lt: startedAt } },
			],
		},
	});

	return {
		ok: true,
		daysBack: normalizedDaysBack,
		pagesFetched,
		totalReceived,
		syncedCount,
		skippedOldCount,
		deletedCount: deleteResult.count,
		cutoff,
	};
}
