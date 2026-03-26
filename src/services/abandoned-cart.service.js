import { prisma } from '../lib/prisma.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const REQUESTED_PER_PAGE = Number.parseInt(process.env.TIENDANUBE_CHECKOUTS_PER_PAGE || '200', 10);
const CHECKOUTS_PER_PAGE = Math.min(Math.max(REQUESTED_PER_PAGE, 1), 200);
const MAX_PAGES = Number.parseInt(process.env.TIENDANUBE_CHECKOUTS_MAX_PAGES || '80', 10);
const FULL_SYNC_MONTH = process.env.TIENDANUBE_FULL_SYNC_MONTH || '';

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

function getCartReferenceDate(cart) {
	return (
		parseDateOrNull(cart.updated_at) ||
		parseDateOrNull(cart.created_at) ||
		parseDateOrNull(cart.completed_at) ||
		null
	);
}

function isInsideRequestedMonth(cart, monthFilter) {
	if (!monthFilter) return true;
	const date = getCartReferenceDate(cart);
	if (!date) return true;
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	return `${year}-${month}` === monthFilter;
}

function buildCartPayload(cart, storeId) {
	return {
		storeId: String(cart.store_id || storeId),
		token: cart.token || null,
		contactName: cart.contact_name || null,
		contactEmail: cart.contact_email || null,
		contactPhone: normalizePhone(cart.contact_phone || cart.shipping_phone || ''),
		abandonedCheckoutUrl: cart.abandoned_checkout_url || null,
		subtotal: toDecimalOrNull(cart.subtotal),
		totalAmount: toDecimalOrNull(cart.total),
		currency: cart.currency || null,
		gateway: cart.gateway || null,
		shipping: cart.shipping || null,
		shippingPickupType: cart.shipping_pickup_type || null,
		shippingAddress: mapAddress(cart) || null,
		shippingCity: cart.shipping_city || null,
		shippingProvince: cart.shipping_province || null,
		shippingZipcode: cart.shipping_zipcode || null,
		products: Array.isArray(cart.products) ? cart.products : [],
		rawPayload: cart
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

async function fetchAllCheckouts({ storeId, accessToken, monthFilter }) {
	const allCarts = [];
	const seenCheckoutIds = new Set();
	let pagesFetched = 0;

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const { carts, reachedEnd } = await fetchCheckoutPage({ storeId, accessToken, page });

		if (reachedEnd) {
			break;
		}

		pagesFetched += 1;

		if (!carts.length) break;

		let newItemsInPage = 0;

		for (const cart of carts) {
			const checkoutId = String(cart.id || '');
			if (!checkoutId || seenCheckoutIds.has(checkoutId)) continue;

			seenCheckoutIds.add(checkoutId);

			if (isInsideRequestedMonth(cart, monthFilter)) {
				allCarts.push(cart);
			}

			newItemsInPage += 1;
		}

		if (newItemsInPage === 0) break;
	}

	return {
		carts: allCarts,
		pagesFetched
	};
}

export async function syncAbandonedCarts() {
	const { storeId, accessToken } = await resolveStoreCredentials();
	const monthFilter = FULL_SYNC_MONTH.trim();

	console.log('[ABANDONED CARTS] Sync usando store:', storeId);
	console.log('[ABANDONED CARTS] Per page:', CHECKOUTS_PER_PAGE, 'Max pages:', MAX_PAGES, 'Month:', monthFilter || 'ALL');

	const { carts, pagesFetched } = await fetchAllCheckouts({ storeId, accessToken, monthFilter });

	for (const cart of carts) {
		const data = buildCartPayload(cart, storeId);

		await prisma.abandonedCart.upsert({
			where: { checkoutId: String(cart.id) },
			update: data,
			create: {
				checkoutId: String(cart.id),
				...data
			}
		});
	}

	return {
		ok: true,
		count: carts.length,
		pagesFetched,
		monthFilter: monthFilter || null
	};
}
