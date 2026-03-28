import { prisma } from '../src/lib/prisma.js';

function toNumberOrNull(value) {
	if (value == null || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function resolveCatalogPrices(aValue, bValue) {
	const a = toNumberOrNull(aValue);
	const b = toNumberOrNull(bValue);

	if (a != null && b != null) {
		if (b > 0 && b < a) {
			return { currentPrice: b, originalPrice: a };
		}

		if (a > 0 && a < b) {
			return { currentPrice: a, originalPrice: b };
		}

		return { currentPrice: a, originalPrice: null };
	}

	if (a != null) return { currentPrice: a, originalPrice: null };
	if (b != null) return { currentPrice: b, originalPrice: null };

	return { currentPrice: null, originalPrice: null };
}

function money(value) {
	if (value == null) return 'Sin precio';

	return new Intl.NumberFormat('es-AR', {
		style: 'currency',
		currency: 'ARS',
		maximumFractionDigits: 0
	}).format(Number(value));
}

async function main() {
	const terms = process.argv.slice(2);

	const products = await prisma.catalogProduct.findMany({
		where: {
			published: true
		},
		orderBy: [
			{ updatedAt: 'desc' }
		],
		take: 200
	});

	const filtered = !terms.length
		? products
		: products.filter((p) => {
				const haystack = `${p.name || ''} ${p.handle || ''} ${p.tags || ''}`.toLowerCase();
				return terms.some((term) => haystack.includes(String(term).toLowerCase()));
		  });

	if (!filtered.length) {
		console.log('No se encontraron productos para esos términos.');
		return;
	}

	for (const p of filtered) {
		const { currentPrice, originalPrice } = resolveCatalogPrices(p.price, p.compareAtPrice);

		console.log('--------------------------------------------------');
		console.log(`Producto: ${p.name}`);
		console.log(`Handle: ${p.handle || '-'}`);
		console.log(`Precio actual: ${money(currentPrice)}`);
		console.log(`Precio original: ${originalPrice ? money(originalPrice) : '-'}`);
		console.log(`Link: ${p.productUrl || '-'}`);
	}
}

main()
	.catch((error) => {
		console.error('Error leyendo precios del catálogo:', error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});