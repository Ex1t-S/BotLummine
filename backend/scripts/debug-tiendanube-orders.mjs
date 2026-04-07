import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
	path: path.resolve(__dirname, '../.env')
});

const STORE_ID =
	process.env.TIENDANUBE_STORE_ID ||
	process.env.NUVEMSHOP_STORE_ID ||
	process.env.TN_STORE_ID;

const ACCESS_TOKEN =
	process.env.TIENDANUBE_ACCESS_TOKEN ||
	process.env.NUVEMSHOP_ACCESS_TOKEN ||
	process.env.TN_ACCESS_TOKEN;

const USER_AGENT =
	process.env.TIENDANUBE_USER_AGENT ||
	process.env.NUVEMSHOP_USER_AGENT ||
	'BotLummine (tu-email@dominio.com)';

function buildUrl(page = 1, perPage = 5) {
	const url = new URL(`https://api.tiendanube.com/v1/${STORE_ID}/orders`);
	url.searchParams.set('page', String(page));
	url.searchParams.set('per_page', String(perPage));
	url.searchParams.set('fields', [
		'id',
		'number',
		'created_at',
		'updated_at',
		'contact_email',
		'contact_phone',
		'total',
		'subtotal',
		'payment_status',
		'shipping_status',
		'customer',
		'products'
	].join(','));
	return url.toString();
}

async function main() {
	if (!STORE_ID) {
		throw new Error('Falta TIENDANUBE_STORE_ID');
	}

	if (!ACCESS_TOKEN) {
		throw new Error('Falta TIENDANUBE_ACCESS_TOKEN');
	}

	const page = Number(process.argv[2] || 1);
	const perPage = Number(process.argv[3] || 5);

	const url = buildUrl(page, perPage);

	console.log('Consultando:', url);

	const response = await fetch(url, {
		method: 'GET',
		headers: {
			Authentication: `bearer ${ACCESS_TOKEN}`,
			'User-Agent': USER_AGENT,
			'Content-Type': 'application/json'
		}
	});

	const text = await response.text();

	if (!response.ok) {
		console.error('Status:', response.status);
		console.error(text);
		process.exit(1);
	}

	let json;
	try {
		json = JSON.parse(text);
	} catch (error) {
		console.error('La respuesta no es JSON válido');
		console.error(text);
		process.exit(1);
	}

	const outputDir = path.resolve('debug-output');
	await fs.mkdir(outputDir, { recursive: true });

	const outputPath = path.join(outputDir, `orders-page-${page}.json`);
	await fs.writeFile(outputPath, JSON.stringify(json, null, 2), 'utf8');

	console.log(`OK. JSON guardado en: ${outputPath}`);

	if (Array.isArray(json) && json.length > 0) {
		const first = json[0];
		console.log('\nPrimer pedido resumido:\n');
		console.log({
			id: first.id,
			number: first.number,
			created_at: first.created_at,
			contact_email: first.contact_email,
			contact_phone: first.contact_phone,
			total: first.total,
			payment_status: first.payment_status,
			shipping_status: first.shipping_status,
			customer_id: first.customer?.id ?? null,
			customer_name: first.customer?.name ?? null,
			products_count: Array.isArray(first.products) ? first.products.length : 0
		});
	} else {
		console.log('No vinieron pedidos en esta página.');
	}
}

main().catch((error) => {
	console.error('Error ejecutando debug de orders:', error);
	process.exit(1);
});