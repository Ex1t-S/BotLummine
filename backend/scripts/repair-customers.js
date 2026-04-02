import { repairCustomers } from '../services/customer.service.js';

async function main() {
	const result = await repairCustomers();
	console.log('[CUSTOMERS REPAIR]', result);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('[CUSTOMERS REPAIR ERROR]', error);
		process.exit(1);
	});
