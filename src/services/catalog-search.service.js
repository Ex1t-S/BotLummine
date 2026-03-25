import { prisma } from '../lib/prisma.js';

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

function splitTerms(text = '') {
	return normalizeText(text)
		.split(/[^a-z0-9]+/i)
		.map((term) => term.trim())
		.filter((term) => term.length >= 2);
}

function parseJsonArray(value) {
	return Array.isArray(value) ? value : [];
}

function extractVariantHints(variants = []) {
	const flat = parseJsonArray(variants);

	const hints = flat
		.flatMap((variant) => {
			const collected = [];

			if (variant?.sku) collected.push(String(variant.sku));

			if (Array.isArray(variant?.values)) {
				collected.push(...variant.values.map((v) => String(v)));
			}

			if (variant?.option1) collected.push(String(variant.option1));
			if (variant?.option2) collected.push(String(variant.option2));
			if (variant?.option3) collected.push(String(variant.option3));

			if (Array.isArray(variant?.attributes)) {
				collected.push(...variant.attributes.map((a) => String(a?.value || a?.name || '')));
			}

			return collected;
		})
		.filter(Boolean);

	return [...new Set(hints)].slice(0, 8);
}

function scoreProduct(product, normalizedQuery, terms = []) {
	let score = 0;

	const name = normalizeText(product.name || '');
	const brand = normalizeText(product.brand || '');
	const tags = normalizeText(product.tags || '');
	const description = normalizeText(product.description || '');
	const handle = normalizeText(product.handle || '');

	if (!normalizedQuery) return 0;

	if (name.includes(normalizedQuery)) score += 14;
	if (brand.includes(normalizedQuery)) score += 8;
	if (tags.includes(normalizedQuery)) score += 10;
	if (description.includes(normalizedQuery)) score += 6;
	if (handle.includes(normalizedQuery)) score += 7;

	for (const term of terms) {
		if (name.includes(term)) score += 5;
		if (brand.includes(term)) score += 2;
		if (tags.includes(term)) score += 4;
		if (description.includes(term)) score += 2;
		if (handle.includes(term)) score += 3;
	}

	if (product.published) score += 2;
	if (product.featuredImage) score += 1;
	if (product.productUrl) score += 1;

	return score;
}

function buildShortDescription(product) {
	const description = String(product.description || '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (!description) return 'Sin descripción cargada.';
	return description.length > 180 ? `${description.slice(0, 177)}...` : description;
}

function formatPrice(value) {
	if (value == null) return null;

	try {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return String(value);
		return `$${numeric}`;
	} catch {
		return String(value);
	}
}

export async function searchCatalogProducts({
	query = '',
	interestedProducts = [],
	limit = 4
} = {}) {
	const normalizedQuery = normalizeText(query);
	const directTerms = splitTerms(query);
	const interestTerms = Array.isArray(interestedProducts)
		? interestedProducts.map((v) => normalizeText(v)).filter(Boolean)
		: [];

	const allTerms = [...new Set([...directTerms, ...interestTerms])];

	if (!normalizedQuery && !allTerms.length) {
		return [];
	}

	const rawProducts = await prisma.catalogProduct.findMany({
		where: {
			published: true
		},
		orderBy: [
			{ updatedAt: 'desc' }
		],
		take: 80
	});

	const ranked = rawProducts
		.map((product) => ({
			product,
			score: scoreProduct(product, normalizedQuery, allTerms)
		}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({ product, score }) => {
			const variantHints = extractVariantHints(product.variants);

			return {
				id: product.id,
				productId: product.productId,
				name: product.name,
				brand: product.brand || null,
				price: formatPrice(product.price),
				handle: product.handle || null,
				productUrl: product.productUrl || null,
				featuredImage: product.featuredImage || null,
				shortDescription: buildShortDescription(product),
				variantHints,
				tags: product.tags
					? product.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6)
					: [],
				score
			};
		});

	return ranked;
}

export function buildCatalogContext(products = []) {
	if (!Array.isArray(products) || !products.length) {
		return 'No se encontraron productos relevantes del catálogo local para este mensaje.';
	}

	return products
		.map((product, index) => {
			const lines = [
				`${index + 1}. ${product.name}`,
				`   - Marca: ${product.brand || 'No informada'}`,
				`   - Precio: ${product.price || 'No informado'}`,
				`   - Link: ${product.productUrl || 'No disponible'}`,
				`   - Resumen: ${product.shortDescription}`
			];

			if (product.tags?.length) {
				lines.push(`   - Tags: ${product.tags.join(', ')}`);
			}

			if (product.variantHints?.length) {
				lines.push(`   - Variantes detectadas: ${product.variantHints.join(', ')}`);
			}

			return lines.join('\n');
		})
		.join('\n\n');
}

export function pickCommercialHints(products = []) {
	if (!Array.isArray(products) || !products.length) {
		return [];
	}

	const hints = [];

	if (products.length >= 2) {
		hints.push('Si tiene sentido, podés comparar dos opciones y ayudar a elegir.');
	}

	if (products.some((p) => p.price)) {
		hints.push('Si la clienta está lista para comprar, cerrá con una invitación a ver el link o avanzar con la compra.');
	}

	if (products.some((p) => Array.isArray(p.variantHints) && p.variantHints.length)) {
		hints.push('Si preguntan por talle, color o variante, usá solo las variantes detectadas y no inventes otras.');
	}

	return hints;
}