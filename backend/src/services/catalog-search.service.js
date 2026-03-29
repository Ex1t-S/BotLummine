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

	if (/(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(normalizedQuery)) {
		if (/(oferta|promo|pack|combo|2x1|3x1)/i.test(name)) score += 20;
		if (/(oferta|promo|pack|combo|2x1|3x1)/i.test(tags)) score += 16;
		if (/(oferta|promo|pack|combo|2x1|3x1)/i.test(description)) score += 10;
	}

	if (/(body|modelador|faja|reductor|reductora)/i.test(normalizedQuery)) {
		if (/(body|modelador|faja|reductor|reductora)/i.test(name)) score += 18;
		if (/(body|modelador|faja|reductor|reductora)/i.test(tags)) score += 10;
	}

	if (product.published) score += 2;
	if (product.featuredImage) score += 1;
	if (product.productUrl) score += 1;

	return score;
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

export function pickCommercialHints(products = [], commercialPlan = null) {
	if (!Array.isArray(products) || !products.length) {
		return [];
	}

	const hints = [];

	if (commercialPlan?.bestOffer?.name) {
		hints.push(`Priorizá como oferta principal ${commercialPlan.bestOffer.name}.`);
	}

	if (commercialPlan?.requestedAction === 'ASK_OFFER') {
		hints.push('No abras varias promos: mostrá solo la mejor oferta disponible.');
	}

	if (commercialPlan?.requestedAction === 'AFFIRM_CONTINUATION') {
		hints.push('Interpretá el "sí" como continuidad de la última oferta principal, no como permiso para listar todo.');
	}

	if (commercialPlan?.requestedAction === 'ASK_VARIANT') {
		hints.push('Tratà color y talle como continuación natural del producto ya elegido.');
	}

	if (commercialPlan?.bestOffer?.price && commercialPlan.repeatPriceNow) {
		hints.push(`Si vuelve a preguntar precio, usá ${commercialPlan.bestOffer.price} como precio principal.`);
	}

	if (commercialPlan?.bestOffer?.price && !commercialPlan.repeatPriceNow) {
		hints.push('No repitas el precio si ya quedó claro, salvo pedido explícito.');
	}

	if (commercialPlan?.shareLinkNow) {
		hints.push('Compartí un único link y solo del producto foco.');
	} else {
		hints.push('No compartas link todavía si la conversación sigue definiendo variante o promo.');
	}

	if (products.some((p) => Array.isArray(p.colors) && p.colors.length)) {
		hints.push('Si preguntan por color, respondé directo con continuidad comercial.');
	}

	if (products.some((p) => Array.isArray(p.sizes) && p.sizes.length)) {
		hints.push('Si preguntan por talle, respondé directo y evitá derivar a la web.');
	}

	hints.push('No compares más de una promo salvo pedido explícito.');
	hints.push('Soná más directa y menos celebratoria.');

	return hints;
}