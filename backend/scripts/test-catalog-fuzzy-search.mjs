import assert from 'node:assert/strict';
import {
	detectRequestedSignals,
	rankCatalogProductsForSearch,
} from '../src/services/catalog/catalog-search.service.js';

const PRODUCTS = [
	{
		id: 'prod_bubble_gun',
		productId: 'bubble-gun-1',
		name: 'Pistola de Burbujas Bubble Gun',
		handle: 'pistola-de-burbujas-bubble-gun',
		description: 'Pistola lanza burbujas para chicos. Disponible en azul.',
		tags: 'juguetes, burbujas, verano',
		published: true,
		price: 12990,
		compareAtPrice: null,
		productUrl: 'https://example.test/pistola-de-burbujas-bubble-gun',
		variants: [],
		attributes: [],
	},
	{
		id: 'prod_magnetic_tiles',
		productId: 'magnetic-tiles-1',
		name: 'Bloques Magneticos 42 piezas',
		handle: 'bloques-magneticos-42-piezas',
		description: 'Juego de construccion con imanes.',
		tags: 'juguetes, didacticos, magneticos',
		published: true,
		price: 34990,
		compareAtPrice: null,
		productUrl: 'https://example.test/bloques-magneticos',
		variants: [],
		attributes: [],
	},
];

function runSearch(query, interestedProducts = []) {
	const signals = detectRequestedSignals(query, interestedProducts);
	return rankCatalogProductsForSearch(PRODUCTS, signals, { limit: 5 });
}

function assertTopBubbleGun(query, interestedProducts = []) {
	const results = runSearch(query, interestedProducts);
	assert.ok(results.length > 0, `Expected results for "${query}"`);
	assert.equal(results[0].productId, 'bubble-gun-1', `Expected Bubble Gun first for "${query}"`);
	return results[0];
}

assertTopBubbleGun('la Pistola de Burbujas Bubble Gun');
assertTopBubbleGun('si sobre la pistola de burbujas bubble gun');

const typoMatch = assertTopBubbleGun('pistalo de burbujas');
assert.ok(typoMatch.fuzzyTermMatches >= 1, 'Expected at least one fuzzy token match for typo');

const partialMatch = assertTopBubbleGun('la pistola');
assert.equal(partialMatch.strongTokenMatch, true, 'Expected strong token match for partial product name');

assertTopBubbleGun('contame mas', ['Pistola de Burbujas Bubble Gun']);

const genericResults = runSearch('quiero algo lindo');
assert.equal(genericResults.length, 0, 'Generic vague query should not invent a product');

console.log(JSON.stringify({
	ok: true,
	cases: 6,
}, null, 2));
