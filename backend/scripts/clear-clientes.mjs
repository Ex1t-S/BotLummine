// backend/scripts/clear-commerce-data.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
	await prisma.$transaction([
		prisma.customerOrderItem.deleteMany({}),
		prisma.customerOrder.deleteMany({}),
		prisma.customerProfile.deleteMany({}),
		prisma.abandonedCart.deleteMany({})
	]);

	console.log('OK: se limpiaron CustomerOrderItem, CustomerOrder, CustomerProfile y AbandonedCart');
}

main()
	.catch((error) => {
		console.error('Error limpiando datos:', error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});