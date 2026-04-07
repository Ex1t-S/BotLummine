import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
	path: path.resolve(__dirname, '../.env'),
});

const STORE_ID = process.env.TIENDANUBE_STORE_ID;
const ACCESS_TOKEN = process.env.TIENDANUBE_ACCESS_TOKEN;
const USER_AGENT =
	process.env.TIENDANUBE_USER_AGENT || 'BotLummine Debug (debug@example.com)';

const PER_PAGE = Number(process.argv[2] || 200);
const MAX_PAGES = Number(process.argv[3] || 100);

if (!STORE_ID) throw new Error('Falta TIENDANUBE_STORE_ID');
if (!ACCESS_TOKEN) throw new Error('Falta TIENDANUBE_ACCESS_TOKEN');

function buildUrl(page, perPage) {
	const url = new URL(`https://api.tiendanube.com/v1/${STORE_ID}/orders`);
	url.searchParams.set('page', String(page));
	url.searchParams.set('per_page', String(perPage));
	url.searchParams.set('fields', 'id,number,created_at,updated_at,total,customer,products');
	return url.toString();
}

async function main() {
	const startedAt = Date.now();
	let totalOrders = 0;
	let totalPagesRead = 0;

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const pageStarted = Date.now();

		const response = await fetch(buildUrl(page, PER_PAGE), {
			headers: {
				Authentication: `bearer ${ACCESS_TOKEN}`,
				'User-Agent': USER_AGENT,
				'Content-Type': 'application/json',
			},
		});

		const json = await response.json();
		const elapsed = Date.now() - pageStarted;

		if (!response.ok) {
			console.error(`Página ${page} falló con status ${response.status}`);
			console.error(json);
			process.exit(1);
		}

		const count = Array.isArray(json) ? json.length : 0;
		totalOrders += count;
		totalPagesRead += 1;

		console.log(
			`Página ${page}: ${count} pedidos en ${elapsed} ms | acumulado=${totalOrders}`
		);

		if (count === 0) {
			break;
		}
	}

	const totalElapsed = Date.now() - startedAt;

	console.log('\n=== RESULTADO FINAL ===');
	console.log({
		totalOrders,
		totalPagesRead,
		totalElapsedMs: totalElapsed,
		totalElapsedSec: Number((totalElapsed / 1000).toFixed(2)),
	});
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});