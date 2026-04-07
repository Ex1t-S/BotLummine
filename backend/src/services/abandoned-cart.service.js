import pkg from '@prisma/client';
const { Prisma } = pkg;
import { prisma } from '../lib/prisma.js';
import { resolveStoreCredentials } from './customer.service.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const CHECKOUTS_PER_PAGE = Math.min(
	200,
	Math.max(20, Number(process.env.TIENDANUBE_ABANDONED_SYNC_PER_PAGE || 200))
);
const FETCH_CONCURRENCY = Math.min(
	8,
	Math.max(1, Number(process.env.TIENDANUBE_ABANDONED_SYNC_CONCURRENCY || 6))
);
const MAX_PAGES = Math.max(1, Number(process.env.TIENDANUBE_ABANDONED_SYNC_MAX_PAGES || 120));
const FETCH_RETRIES = Math.max(1, Number(process.env.TIENDANUBE_ABANDONED_SYNC_RETRIES || 3));
const UPSERT_CHUNK_SIZE = Math.max(25, Number(process.env.TIENDANUBE_ABANDONED_UPSERT_CHUNK_SIZE || 250));
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

function jsonb(value) {
	if (value === null || value === undefined) {
		return Prisma.sql`NULL`;
	}

	return Prisma.sql`CAST(${JSON.stringify(value)} AS jsonb)`;
}

function mapAddress(cart) {
	return [
		cart?.shipping_address,
		cart?.shipping_number,
		cart?.shipping_floor,
		cart?.shipping_locality,
	]
		.filter(Boolean)
		.join(' ')
		.trim();
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

function chunkArray(values = [], size = 50) {
	const chunks = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
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

				if (response.status === 404) {
					let payload = null;

					try {
						payload = JSON.parse(text);
					} catch {
						payload = null;
					}

					const description = payload?.description || '';
					if (description.includes('Last page is')) {
						return [];
					}
				}

				throw new Error(`checkouts página ${page}: Tiendanube respondió ${response.status} - ${text}`);
			}

			const payload = await response.json();

			if (!Array.isArray(payload)) {
				throw new Error('La respuesta de Tiendanube para checkouts no fue una lista.');
			}

			return payload;
		} catch (error) {
			lastError = error;

			if (attempt < FETCH_RETRIES) {
				await sleep(350 * attempt);
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
				price: product?.price ?? null,
				quantity: Number(product?.quantity || 1),
				sku: product?.sku || null,
				image: product?.image?.src || null,
				variantValues: Array.isArray(product?.variant_values) ? product.variant_values : [],
			}))
		: [];

	return {
		checkoutId: String(cart?.id),
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

async function upsertCartBatch(carts, storeId) {
	let syncedCount = 0;

	for (const batch of chunkArray(carts, UPSERT_CHUNK_SIZE)) {
		const payloads = batch.map((cart) => buildCartPayload(cart, storeId));
		const valuesSql = payloads.map((item) => Prisma.sql`(
			${item.storeId},
			${item.checkoutId},
			${item.token},
			${item.contactName},
			${item.contactEmail},
			${item.contactPhone},
			${item.abandonedCheckoutUrl},
			${item.subtotal},
			${item.totalAmount},
			${item.currency},
			${item.gateway},
			${item.shipping},
			${item.shippingPickupType},
			${item.shippingAddress},
			${item.shippingCity},
			${item.shippingProvince},
			${item.shippingZipcode},
			${jsonb(item.rawPayload)},
			${jsonb(item.products)},
			${item.checkoutCreatedAt},
			${'NEW'}
		)`);

		await prisma.$executeRaw(Prisma.sql`
			INSERT INTO "AbandonedCart" (
				"storeId",
				"checkoutId",
				"token",
				"contactName",
				"contactEmail",
				"contactPhone",
				"abandonedCheckoutUrl",
				"subtotal",
				"totalAmount",
				"currency",
				"gateway",
				"shipping",
				"shippingPickupType",
				"shippingAddress",
				"shippingCity",
				"shippingProvince",
				"shippingZipcode",
				"rawPayload",
				"products",
				"checkoutCreatedAt",
				"status"
			)
			VALUES ${Prisma.join(valuesSql)}
			ON CONFLICT ("checkoutId")
			DO UPDATE SET
				"storeId" = EXCLUDED."storeId",
				"token" = EXCLUDED."token",
				"contactName" = EXCLUDED."contactName",
				"contactEmail" = EXCLUDED."contactEmail",
				"contactPhone" = EXCLUDED."contactPhone",
				"abandonedCheckoutUrl" = EXCLUDED."abandonedCheckoutUrl",
				"subtotal" = EXCLUDED."subtotal",
				"totalAmount" = EXCLUDED."totalAmount",
				"currency" = EXCLUDED."currency",
				"gateway" = EXCLUDED."gateway",
				"shipping" = EXCLUDED."shipping",
				"shippingPickupType" = EXCLUDED."shippingPickupType",
				"shippingAddress" = EXCLUDED."shippingAddress",
				"shippingCity" = EXCLUDED."shippingCity",
				"shippingProvince" = EXCLUDED."shippingProvince",
				"shippingZipcode" = EXCLUDED."shippingZipcode",
				"rawPayload" = EXCLUDED."rawPayload",
				"products" = EXCLUDED."products",
				"checkoutCreatedAt" = EXCLUDED."checkoutCreatedAt",
				"updatedAt" = NOW()
		`);

		syncedCount += batch.length;
	}

	return syncedCount;
}

export async function syncAbandonedCarts(daysBack = DEFAULT_DAYS_BACK) {
	const normalizedDaysBack = ALLOWED_WINDOWS.has(Number(daysBack))
		? Number(daysBack)
		: DEFAULT_DAYS_BACK;

	const { storeId, accessToken } = await resolveStoreCredentials();

	const startedAt = new Date();
	const cutoff = new Date(startedAt);
	cutoff.setDate(cutoff.getDate() - normalizedDaysBack);

	let pagesFetched = 0;
	let totalReceived = 0;
	let syncedCount = 0;
	let skippedOldCount = 0;
	let stopSync = false;
	const syncedCheckoutIds = new Set();

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

			let foundOlderInPage = false;

			for (const cart of carts) {
				const checkoutDate = parseDateOrNull(cart?.created_at);

				if (!checkoutDate) continue;

				if (checkoutDate < cutoff) {
					skippedOldCount += 1;
					foundOlderInPage = true;
					continue;
				}

				validCarts.push(cart);
				syncedCheckoutIds.add(String(cart.id));
			}

			if (carts.length < CHECKOUTS_PER_PAGE || foundOlderInPage) {
				stopSync = true;
			}
		}

		if (validCarts.length) {
			syncedCount += await upsertCartBatch(validCarts, storeId);
		}
	}

	const deletionFilters = [
		{
			storeId,
			OR: [
				{
					checkoutCreatedAt: {
						lt: cutoff,
					},
				},
				{
					checkoutCreatedAt: null,
					updatedAt: {
						lt: cutoff,
					},
				},
			],
		},
	];

	deletionFilters.push({
		storeId,
		checkoutCreatedAt: { gte: cutoff },
		...(syncedCheckoutIds.size
			? { checkoutId: { notIn: Array.from(syncedCheckoutIds) } }
			: {}),
	});

	const deleted = await prisma.abandonedCart.deleteMany({
		where: {
			OR: deletionFilters,
		},
	});

	const remainingCount = await prisma.abandonedCart.count({
		where: {
			storeId,
			OR: [
				{ checkoutCreatedAt: { gte: cutoff } },
				{ checkoutCreatedAt: null },
			],
		},
	});

	const finishedAt = new Date();

	return {
		ok: true,
		daysBack: normalizedDaysBack,
		pagesFetched,
		receivedCount: totalReceived,
		syncedCount,
		skippedOldCount,
		deletedCount: Number(deleted?.count || 0),
		remainingCount,
		durationMs: finishedAt.getTime() - startedAt.getTime(),
		startedAt,
		finishedAt,
	};
}
