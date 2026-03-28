import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { prisma } from '../src/lib/prisma.js';

dotenv.config();

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const DEBUG_PER_PAGE = 20;
const DEBUG_MAX_PAGES = 1;

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

async function fetchCheckoutPage({ storeId, accessToken, page, perPage = DEBUG_PER_PAGE }) {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(perPage)
	});

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/checkouts?${params.toString()}`;

	console.log(`[DEBUG CHECKOUTS] GET ${url}`);

	const response = await fetch(url, {
		method: 'GET',
		headers: buildHeaders(accessToken)
	});

	const text = await response.text();

	if (!response.ok) {
		throw new Error(`Tiendanube error ${response.status}: ${text}`);
	}

	let data;
	try {
		data = JSON.parse(text);
	} catch (error) {
		throw new Error(`No se pudo parsear JSON de Tiendanube: ${error.message}`);
	}

	if (!Array.isArray(data)) {
		throw new Error('La respuesta de Tiendanube no fue una lista de checkouts.');
	}

	return data;
}

function summarizeCheckout(cart) {
	return {
		id: cart?.id ?? null,
		token: cart?.token ?? null,
		created_at: cart?.created_at ?? null,
		updated_at: cart?.updated_at ?? null,
		completed_at: cart?.completed_at ?? null,
		contact_name: cart?.contact_name ?? null,
		contact_email: cart?.contact_email ?? null,
		contact_phone: cart?.contact_phone ?? null,
		shipping_phone: cart?.shipping_phone ?? null,
		subtotal: cart?.subtotal ?? null,
		total: cart?.total ?? null,
		currency: cart?.currency ?? null,
		shipping_city: cart?.shipping_city ?? null,
		shipping_province: cart?.shipping_province ?? null,
		abandoned_checkout_url: cart?.abandoned_checkout_url ?? null,
		products_count: Array.isArray(cart?.products) ? cart.products.length : 0,
		first_product: Array.isArray(cart?.products) && cart.products.length
			? {
					name: cart.products[0]?.name ?? cart.products[0]?.title ?? null,
					quantity: cart.products[0]?.quantity ?? null,
					price: cart.products[0]?.price ?? null
			  }
			: null
	};
}

async function main() {
	const requestedCheckoutId = process.argv[2] ? String(process.argv[2]).trim() : null;
	const { storeId, accessToken } = await resolveStoreCredentials();

	console.log('[DEBUG CHECKOUTS] Store:', storeId);
	console.log('[DEBUG CHECKOUTS] API version:', TIENDANUBE_API_VERSION);
	console.log('[DEBUG CHECKOUTS] per_page:', DEBUG_PER_PAGE);
	console.log('[DEBUG CHECKOUTS] max_pages:', DEBUG_MAX_PAGES);
	console.log('[DEBUG CHECKOUTS] target checkoutId:', requestedCheckoutId || 'NONE');

	const all = [];

	for (let page = 1; page <= DEBUG_MAX_PAGES; page += 1) {
		const pageItems = await fetchCheckoutPage({
			storeId,
			accessToken,
			page,
			perPage: DEBUG_PER_PAGE
		});

		console.log(`[DEBUG CHECKOUTS] Página ${page}: ${pageItems.length} resultados`);

		all.push(...pageItems);

		if (pageItems.length < DEBUG_PER_PAGE) {
			break;
		}
	}

	if (!all.length) {
		console.log('[DEBUG CHECKOUTS] No llegaron checkouts.');
		return;
	}

	const summaries = all.map(summarizeCheckout);

	console.log('\n[DEBUG CHECKOUTS] Resumen de checkouts recibidos:\n');
	console.table(
		summaries.map((item) => ({
			id: item.id,
			created_at: item.created_at,
			updated_at: item.updated_at,
			contact_name: item.contact_name,
			contact_email: item.contact_email,
			contact_phone: item.contact_phone,
			total: item.total,
			products_count: item.products_count
		}))
	);

	let selected = all[0];

	if (requestedCheckoutId) {
		const found = all.find((item) => String(item?.id) === requestedCheckoutId);
		if (found) {
			selected = found;
		} else {
			console.log(`\n[DEBUG CHECKOUTS] No encontré el checkout ${requestedCheckoutId} dentro de estas ${all.length} filas.`);
			console.log('[DEBUG CHECKOUTS] Voy a guardar igual el primero para inspección.');
		}
	}

	const outputDir = path.resolve('debug-output');
	await fs.mkdir(outputDir, { recursive: true });

	const fullPath = path.join(outputDir, 'checkout-full.json');
	const summariesPath = path.join(outputDir, 'checkouts-summary.json');

	await fs.writeFile(fullPath, JSON.stringify(selected, null, 2), 'utf8');
	await fs.writeFile(summariesPath, JSON.stringify(summaries, null, 2), 'utf8');

	console.log('\n[DEBUG CHECKOUTS] Checkout elegido:\n');
	console.log(JSON.stringify(summarizeCheckout(selected), null, 2));

	console.log('\n[DEBUG CHECKOUTS] Archivo JSON completo guardado en:');
	console.log(fullPath);

	console.log('\n[DEBUG CHECKOUTS] Resumen de todos los recibidos guardado en:');
	console.log(summariesPath);
}

main()
	.catch((error) => {
		console.error('\n[DEBUG CHECKOUTS] ERROR:', error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});