import 'dotenv/config';
import { syncCatalogFromTiendanube } from '../src/services/catalog/catalog.service.js';

try {
	const result = await syncCatalogFromTiendanube();
	console.log('✅ Catálogo sincronizado');
	console.log(JSON.stringify(result, null, 2));
	process.exit(0);
} catch (error) {
	console.error('❌ Error sincronizando catálogo');
	console.error(error);
	process.exit(1);
}
