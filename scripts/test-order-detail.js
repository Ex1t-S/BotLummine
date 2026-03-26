import { getTiendanubeClient } from '../src/services/tiendanube/client.js';

async function main() {
	const orderIdOrNumber = process.argv[2];

	if (!orderIdOrNumber) {
		console.error('Uso: npm run tiendanube:order:detail -- 12345');
		process.exit(1);
	}

	const { client } = await getTiendanubeClient();

	// 1) Buscar en listado para encontrar el ID real
	const listResponse = await client.get('/orders', {
		params: {
			q: orderIdOrNumber,
			page: 1,
			per_page: 50
		}
	});

	const orders = Array.isArray(listResponse.data) ? listResponse.data : [];
	const match = orders.find((order) =>
		String(order?.number || '') === String(orderIdOrNumber) ||
		String(order?.id || '') === String(orderIdOrNumber) ||
		String(order?.token || '') === String(orderIdOrNumber)
	);

	if (!match) {
		console.error(`No encontré una orden con: ${orderIdOrNumber}`);
		process.exit(1);
	}

	console.log('Orden encontrada en listado:');
	console.log(JSON.stringify(match, null, 2));

	// 2) Traer detalle completo
	const detailResponse = await client.get(`/orders/${match.id}`);
	const detail = detailResponse.data;

	console.log('\n===== DETALLE COMPLETO =====\n');
	console.log(JSON.stringify(detail, null, 2));
}

main().catch((error) => {
	console.error('Error al consultar la orden');
	if (error.response) {
		console.error('Status:', error.response.status);
		console.error(JSON.stringify(error.response.data, null, 2));
	} else {
		console.error(error.message);
	}
	process.exit(1);
});