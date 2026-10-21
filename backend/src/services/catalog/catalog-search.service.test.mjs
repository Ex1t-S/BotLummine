import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectRequestedSignals, rankCatalogProductsForSearch } from './catalog-search.service.js';

describe('catalog commercial facts', () => {
	it('recognizes an explicitly listed four-unit pack and keeps its price attached to the pack', () => {
		const signals = detectRequestedSignals('mascarilla de colageno');
		const [product] = rankCatalogProductsForSearch([
			{
				id: 'product-1',
				productId: 'product-1',
				name: 'Mascarilla de colágeno',
				description: 'Pack x 4 unidades para el tratamiento facial.',
				price: 39900,
				variants: [],
			},
		], signals);

		assert.equal(product.packCount, 4);
		assert.equal(product.offerLabel, 'Pack de 4 unidades');
		assert.match(product.price, /39\.900/);
	});

	it('uses a currently configured manual offer price and description', () => {
		const signals = detectRequestedSignals('mascarilla de colageno promo');
		const [product] = rankCatalogProductsForSearch([
			{
				id: 'product-2',
				productId: 'product-2',
				name: 'Mascarilla de colágeno',
				description: 'Mascarilla facial.',
				price: 49900,
				variants: [],
				commercialData: {
					presentationLabel: 'Pack de 4 unidades',
					unitsPerPack: 4,
					offerLabel: 'Pack de 4 unidades en promo',
					offerPrice: 39900,
				},
			},
		], signals);

		assert.equal(product.packCount, 4);
		assert.equal(product.priceValue, 39900);
		assert.equal(product.offerLabel, 'Pack de 4 unidades en promo');
		assert.equal(product.manualOfferActive, true);
		assert.equal(product.originalPriceValue, 49900);
	});

	it('reports stock only when Shopify supplied a tracked quantity or availability signal', () => {
		const signals = detectRequestedSignals('mascarilla de colageno');
		const [product] = rankCatalogProductsForSearch([
			{
				id: 'product-3',
				productId: 'product-3',
				name: 'Mascarilla de colágeno',
				description: 'Mascarilla facial.',
				price: 39900,
				variants: [{ inventory_management: 'shopify', inventory_quantity: 7 }],
			},
		], signals);

		assert.match(product.availabilityLabel, /Disponible según las variantes sincronizadas/);
	});
});
