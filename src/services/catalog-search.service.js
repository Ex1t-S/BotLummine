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

function extractVariantMeta(variants = []) {
	const flat = parseJsonArray(variants);

	const rawValues = flat
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
		.filter(Boolean)
		.map((v) => String(v).trim());

	const unique = [...new Set(rawValues)].filter(Boolean);

	const colors = unique.filter((v) =>
		/(negro|blanco|beige|avellana|marron|marrón|nude|rosa|gris|azul|verde|bordo)/i.test(v)
	);

	const sizes = unique.filter((v) =>
		/(^xs$|^s$|^m$|^l$|^xl$|^xxl$|^xxxl$|m\/l|l\/xl|xl\/xxl|talle|110|[0-9]+)/i.test(v)
	);

	return {
		variantHints: unique.slice(0, 12),
		colors: colors.slice(0, 8),
		sizes: sizes.slice(0, 8)
	};
}

function scoreProduct(product, normalizedQuery, terms = []) {
	let score = 0;

	const name = normalizeText(product.name || '');
	const brand = normalizeText(product.brand || '');
	const tags = normalizeText(product.tags || '');
	const description = normalizeText(product.description || '');
	const handle = normalizeText(product.handle || '');
	const variantBlob = normalizeText(
		JSON.stringify(product.variants || []) + ' ' + JSON.stringify(product.attributes || [])
	);

	if (!normalizedQuery && !terms.length) return 0;

	if (name.includes(normalizedQuery)) score += 14;
	if (brand.includes(normalizedQuery)) score += 8;
	if (tags.includes(normalizedQuery)) score += 10;
	if (description.includes(normalizedQuery)) score += 6;
	if (handle.includes(normalizedQuery)) score += 7;
	if (variantBlob.includes(normalizedQuery)) score += 8;

	for (const term of terms) {
		if (name.includes(term)) score += 5;
		if (brand.includes(term)) score += 2;
		if (tags.includes(term)) score += 4;
		if (description.includes(term)) score += 2;
		if (handle.includes(term)) score += 3;
		if (variantBlob.includes(term)) score += 4;
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
		return new Intl.NumberFormat('es-AR', {
			style: 'currency',
			currency: 'ARS',
			maximumFractionDigits: 0
		}).format(Number(value));
	} catch {
		return `$${value}`;
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
		orderBy: [{ updatedAt: 'desc' }],
		take: 100
	});

	return rawProducts
		.map((product) => ({
			product,
			score: scoreProduct(product, normalizedQuery, allTerms)
		}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({ product, score }) => {
			const { currentPrice, originalPrice } = resolveCatalogPrices(product.price, product.compareAtPrice);
			const variantMeta = extractVariantMeta(product.variants);

			return {
				id: product.id,
				productId: product.productId,
				name: product.name,
				brand: product.brand || null,
				price: formatPrice(currentPrice),
				priceValue: currentPrice,
				originalPrice: formatPrice(originalPrice),
				originalPriceValue: originalPrice,
				hasDiscount: currentPrice != null && originalPrice != null && currentPrice !== originalPrice,
				handle: product.handle || null,
				productUrl: product.productUrl || null,
				featuredImage: product.featuredImage || null,
				shortDescription: buildShortDescription(product),
				variantHints: variantMeta.variantHints,
				colors: variantMeta.colors,
				sizes: variantMeta.sizes,
				tags: product.tags
					? product.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6)
					: [],
				score
			};
		});
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
				`   - Precio actual: ${product.price || 'No informado'}`,
				`   - Link: ${product.productUrl || 'No disponible'}`,
				`   - Resumen: ${product.shortDescription}`
			];

			if (product.originalPrice) {
				lines.push(`   - Precio anterior: ${product.originalPrice}`);
			}

			if (product.colors?.length) {
				lines.push(`   - Colores detectados: ${product.colors.join(', ')}`);
			}

			if (product.sizes?.length) {
				lines.push(`   - Talles detectados: ${product.sizes.join(', ')}`);
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
		hints.push('Si la clienta pregunta por precio, usá el precio actual del catálogo como fuente principal.');
	}

	if (products.some((p) => p.hasDiscount)) {
		hints.push('Si hay diferencia entre precio actual y precio anterior, priorizá el precio actual.');
	}

	if (products.some((p) => Array.isArray(p.colors) && p.colors.length)) {
		hints.push('Si preguntan por color, respondé con los colores detectados y no inventes otros.');
	}

	if (products.some((p) => Array.isArray(p.sizes) && p.sizes.length)) {
		hints.push('Si preguntan por talle, respondé con los talles detectados y evitá mandar a la web si ya lo sabés.');
	}

	return hints;
}