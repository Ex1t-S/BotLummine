import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import fs from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
	path: path.resolve(__dirname, '../.env'),
});

const STORE_ID = process.env.TIENDANUBE_STORE_ID;
const ACCESS_TOKEN = process.env.TIENDANUBE_ACCESS_TOKEN;
const USER_AGENT =
	process.env.TIENDANUBE_USER_AGENT || 'BladeIA Debug (debug@example.com)';

const PER_PAGE = Number(process.argv[2] || 50);
const MAX_PAGES = Number(process.argv[3] || 10);
const START_PAGE = Number(process.argv[4] || 1);

if (!STORE_ID) throw new Error('Falta TIENDANUBE_STORE_ID');
if (!ACCESS_TOKEN) throw new Error('Falta TIENDANUBE_ACCESS_TOKEN');

function buildOrdersUrl(page, perPage) {
	const url = new URL(`https://api.tiendanube.com/v1/${STORE_ID}/orders`);
	url.searchParams.set('page', String(page));
	url.searchParams.set('per_page', String(perPage));
	url.searchParams.set(
		'fields',
		[
			'id',
			'number',
			'created_at',
			'updated_at',
			'total',
			'payment_status',
			'shipping_status',
			'contact_email',
			'contact_phone',
			'customer',
			'products',
		].join(',')
	);
	return url.toString();
}

async function fetchPage(page, perPage) {
	const url = buildOrdersUrl(page, perPage);
	const started = Date.now();

	const response = await fetch(url, {
		method: 'GET',
		headers: {
			Authentication: `bearer ${ACCESS_TOKEN}`,
			'User-Agent': USER_AGENT,
			'Content-Type': 'application/json',
		},
	});

	const elapsedMs = Date.now() - started;
	const rawText = await response.text();

	let json = null;
	try {
		json = JSON.parse(rawText);
	} catch {
		json = null;
	}

	return {
		page,
		url,
		status: response.status,
		ok: response.ok,
		elapsedMs,
		count: Array.isArray(json) ? json.length : 0,
		firstOrderNumber: Array.isArray(json) && json[0] ? json[0].number : null,
		lastOrderNumber:
			Array.isArray(json) && json.length > 0 ? json[json.length - 1].number : null,
		body: json,
		rawText,
	};
}

async function main() {
	console.log('=== AUDITORÍA TIENDANUBE ORDERS ===');
	console.log({
		storeId: STORE_ID,
		perPage: PER_PAGE,
		startPage: START_PAGE,
		maxPages: MAX_PAGES,
	});

	const summary = [];
	let totalOrders = 0;
	let emptyPageReached = false;

	for (let page = START_PAGE; page < START_PAGE + MAX_PAGES; page += 1) {
		const result = await fetchPage(page, PER_PAGE);

		console.log(
			`Página ${page} -> status ${result.status} | ${result.count} pedidos | ${result.elapsedMs} ms | first=${result.firstOrderNumber} | last=${result.lastOrderNumber}`
		);

		if (!result.ok) {
			console.error(`Error en página ${page}`);
			console.error(result.rawText);
			break;
		}

		summary.push({
			page: result.page,
			status: result.status,
			elapsedMs: result.elapsedMs,
			count: result.count,
			firstOrderNumber: result.firstOrderNumber,
			lastOrderNumber: result.lastOrderNumber,
		});

		totalOrders += result.count;

		if (result.count === 0) {
			emptyPageReached = true;
			break;
		}
	}

	const outputDir = path.resolve(__dirname, '../debug-output');
	await fs.mkdir(outputDir, { recursive: true });

	const outputPath = path.join(
		outputDir,
		`orders-audit-${Date.now()}.json`
	);

	await fs.writeFile(
		outputPath,
		JSON.stringify(
			{
				storeId: STORE_ID,
				perPage: PER_PAGE,
				startPage: START_PAGE,
				maxPages: MAX_PAGES,
				totalOrders,
				emptyPageReached,
				summary,
			},
			null,
			2
		),
		'utf8'
	);

	console.log('\n=== RESUMEN ===');
	console.log({
		totalOrders,
		pagesAudited: summary.length,
		emptyPageReached,
		outputPath,
	});
}

main().catch((error) => {
	console.error('Fallo auditoría:', error);
	process.exit(1);
});
