import { getTiendanubeClient } from '../src/services/tiendanube/client.js';

async function main() {
	const { client, installation } = await getTiendanubeClient();
	const response = await client.get('/store');

	console.log('✅ Auth OK');
	console.log({
		storeId: installation.storeId,
		source: installation.source || 'unknown',
		storeName: installation.storeName || null,
		storeUrl: installation.storeUrl || null
	});
	console.log(response.data);
}

main().catch((error) => {
	console.error('❌ Auth falló');

	if (error.response) {
		console.error('Status:', error.response.status);
		console.error('Data:', error.response.data);
	} else {
		console.error(error.message);
	}

	process.exit(1);
});