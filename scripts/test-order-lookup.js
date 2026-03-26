import 'dotenv/config';
import { getOrderByNumber } from '../src/services/tiendanube/orders.service.js';

const orderNumber = process.argv[2];

if (!orderNumber) {
	console.error('Uso: node scripts/test-order-lookup.js 22997');
	process.exit(1);
}

async function main() {
	console.log(`🔎 Buscando pedido: ${orderNumber}`);

	const result = await getOrderByNumber(orderNumber);

	if (!result) {
		console.log('❌ No se encontró el pedido');
		return;
	}

	console.log('✅ Pedido encontrado');
	console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
	console.error('❌ Error buscando pedido');
	console.error(error.response?.data || error.message || error);
	process.exit(1);
});