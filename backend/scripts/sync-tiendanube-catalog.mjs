import 'dotenv/config';
import { syncCatalogFromTiendanube } from '../src/services/catalog.service.js';

try {
	const result = await syncCatalogFromTiendanube();
	console.log('✅ Catálogo sincronizado');
	console.log(result);
	process.exit(0);
} catch (error) {
	console.error('❌ Error sincronizando catálogo');
	console.error(error);
	process.exit(1);
}