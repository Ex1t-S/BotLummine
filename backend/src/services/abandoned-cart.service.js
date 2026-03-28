import { prisma } from '../lib/prisma.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';

// Seguimos trayendo de a 20
const CHECKOUTS_PER_PAGE = 20;

// Pero ahora permitimos recorrer más páginas
const MAX_PAGES = Number.MAX_SAFE_INTEGER;

// Default
const DEFAULT_DAYS_BACK = 7;
const ALLOWED_WINDOWS = new Set([7, 15, 30]);

function normalizePhone(value = '') {
	return String(value || '').replace(/\D/g, '');
}

function buildHeaders(accessToken) {
	return {
		Authentication: `bearer ${accessToken}`,
		'Content-Type': 'application/json',
		'User-Agent': process.env.TIENDANUBE_USER_AGENT || 'Lummine IA Assistant'
	};
}

async function resolveStoreCredentials() {
	const installation = await prisma.storeInstallation.findFirst({
		orderBy: { installedAt: 'desc' }
	});

	const storeId = installation?.storeId || process.env.TIENDANUBE_STORE_ID || null;
	const accessToken = installation?.accessToken || process.env.TIENDANUBE_ACCESS_TOKEN || null;

	if (!storeId || !accessToken) {
		throw new Error(
			'Faltan credenciales de Tiendanube. Necesitás StoreInstallation cargada o TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN en el .env.'
		);
	}

	return { storeId, accessToken };
}

function mapAddress(cart) {
	return [cart.shipping_address, cart.shipping_number, cart.shipping_floor, cart.shipping_locality]
		.filter(Boolean)
		.join(' ');
}

function toDecimalOrNull(value) {
	if (value === null || value === undefined || value === '') return null;
	return String(value);
}

function parseDateOrNull(value) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function buildCartPayload(cart, storeId) {
	const products = Array.isArray(cart.products)
		? cart.products.map((product) => ({
				id: product?.id ?? null,
				productId: product?.product_id ?? null,
				variantId: product?.variant_id ?? null,
				name: product?.name || product?.name_without_variants || 'Producto sin nombre',
				price: product?.price ?? null,
				quantity: Number(product?.quantity || 1),
				sku: product?.sku || null,
				image: product?.image?.src || null,
				variantValues: Array.isArray(product?.variant_values) ? product.variant_values : []
		  }))
		: [];

	return {
		storeId: String(cart.store_id || storeId),
		token: cart.token || null,
		contactName: cart.contact_name || cart.shipping_name || null,
		contactEmail: cart.contact_email || null,
		contactPhone: normalizePhone(cart.contact_phone || cart.shipping_phone || cart.billing_phone || ''),
		abandonedCheckoutUrl: cart.abandoned_checkout_url || null,
		subtotal: toDecimalOrNull(cart.subtotal),
		totalAmount: toDecimalOrNull(cart.total),
		currency: cart.currency || null,
		gateway: cart.gateway_name || cart.gateway || null,
		shipping: null,
		shippingPickupType: null,
		shippingAddress: mapAddress(cart) || null,
		shippingCity: cart.shipping_city || null,
		shippingProvince: cart.shipping_province || null,
		shippingZipcode: cart.shipping_zipcode || null,
		products,
		rawPayload: cart,
		checkoutCreatedAt: parseDateOrNull(cart.created_at)
	};
}

async function fetchCheckoutPage({ storeId, accessToken, page }) {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(CHECKOUTS_PER_PAGE)
	});

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/checkouts?${params.toString()}`;

	const response = await fetch(url, {
		method: 'GET',
		headers: buildHeaders(accessToken)
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
				return {
					carts: [],
					reachedEnd: true
				};
			}
		}

		throw new Error(`Tiendanube error ${response.status}: ${text}`);
	}

	const carts = await response.json();

	if (!Array.isArray(carts)) {
		throw new Error('La respuesta de Tiendanube no fue una lista de carritos.');
	}

	return {
		carts,
		reachedEnd: false
	};
}

export async function syncAbandonedCarts(daysBack = DEFAULT_DAYS_BACK) {
	const normalizedDaysBack = ALLOWED_WINDOWS.has(Number(daysBack))
		? Number(daysBack)
		: DEFAULT_DAYS_BACK;

	const { storeId, accessToken } = await resolveStoreCredentials();

	const now = new Date();
	const cutoff = new Date(now);
	cutoff.setDate(cutoff.getDate() - normalizedDaysBack);

	console.log('[ABANDONED CARTS] Sync usando store:', storeId);
	console.log('[ABANDONED CARTS] Per page:', CHECKOUTS_PER_PAGE, 'Max pages:', MAX_PAGES, 'Days back:', normalizedDaysBack);
	console.log('[ABANDONED CARTS] Hoy:', now.toISOString());
	console.log('[ABANDONED CARTS] Cutoff:', cutoff.toISOString());

	let totalReceived = 0;
	let syncedCount = 0;
	let skippedOld = 0;
	let pagesFetched = 0;

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const { carts, reachedEnd } = await fetchCheckoutPage({ storeId, accessToken, page });

		if (reachedEnd || !carts.length) {
			break;
		}

		pagesFetched += 1;
		totalReceived += carts.length;

		let foundOlderInThisPage = false;

		for (const cart of carts) {
			const checkoutDate = parseDateOrNull(cart.created_at);

			if (!checkoutDate) {
				continue;
			}

			if (checkoutDate < cutoff) {
				foundOlderInThisPage = true;
				skippedOld += 1;
				continue;
			}

			const data = buildCartPayload(cart, storeId);

			await prisma.abandonedCart.upsert({
				where: { checkoutId: String(cart.id) },
				update: data,
				create: {
					checkoutId: String(cart.id),
					status: 'NEW',
					...data
				}
			});

			syncedCount += 1;
		}

		// Si la API viene de más nuevo a más viejo,
		// y en esta página ya apareció uno más viejo que el corte,
		// ya no tiene sentido seguir bajando más páginas.
		if (foundOlderInThisPage) {
			break;
		}
	}

	console.log('[ABANDONED CARTS] DONE', {
		totalReceived,
		syncedCount,
		skippedOld,
		pagesFetched,
		daysBack: normalizedDaysBack,
		now: now.toISOString(),
		cutoff: cutoff.toISOString()
	});

	return {
		ok: true,
		count: syncedCount,
		pagesFetched,
		daysBack: normalizedDaysBack
	};
}