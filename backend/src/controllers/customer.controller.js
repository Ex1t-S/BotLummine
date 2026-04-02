import { prisma } from '../lib/prisma.js';
import { syncCustomers } from '../services/customer.service.js';

function ensureCustomerModels() {
	if (!prisma?.customerProfile || !prisma?.customerOrder || !prisma?.customerSyncLog) {
		throw new Error(
			'Los modelos de clientes no están disponibles en Prisma Client. Ejecutá prisma generate y corré la migración nueva antes de probar la sync.'
		);
	}
}

export async function postSyncCustomers(req, res, next) {
	try {
		ensureCustomerModels();

		const fullSync = req.body?.fullSync !== false;
		const result = await syncCustomers({ fullSync });

		return res.json(result);
	} catch (error) {
		next(error);
	}
}