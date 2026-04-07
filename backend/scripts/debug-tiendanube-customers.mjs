import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCustomersDebugPage } from '../src/services/customer.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const page = Number(process.argv[2] || 1);
const perPage = Number(process.argv[3] || 5);
const q = String(process.argv[4] || '');

async function main() {
	const result = await fetchCustomersDebugPage({ page, perPage, q });
	const outputDir = path.join(__dirname, '..', 'debug-output');
	await fs.mkdir(outputDir, { recursive: true });

	const filePath = path.join(outputDir, `customers-page-${page}.json`);
	await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');

	console.log(`[DEBUG CUSTOMERS] storeId: ${result.storeId}`);
	console.log(`[DEBUG CUSTOMERS] page: ${result.page}`);
	console.log(`[DEBUG CUSTOMERS] perPage: ${result.perPage}`);
	console.log(`[DEBUG CUSTOMERS] count: ${result.count}`);
	console.log(`[DEBUG CUSTOMERS] archivo: ${filePath}`);
}

main().catch((error) => {
	console.error('[DEBUG CUSTOMERS ERROR]', error);
	process.exit(1);
});
