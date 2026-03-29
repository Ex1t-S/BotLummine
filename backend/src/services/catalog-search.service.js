import { prisma } from '../lib/prisma.js';

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
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

function buildShortDescription(product) {
	const description = String(product.description || '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (!description) return 'Sin descripción cargada.';
	return description.length > 180 ? `${description.slice(0, 177)}...` : description;
}

function extractVariantMeta(variants = []) {
	const flat = parseJsonArray(variants);

	const rawValues = flat
		.flatMap((variant) => {
			const collected = [];

			if (variant?.sku) collected.push(String(variant.sku));
			if (Array.isArray(variant?.values)) collected.push(...variant.values.map((v) => String(v)));
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

function extractOfferMeta(product = {}) {
	const blob = normalizeText([
		product.name || '',
		product.tags || '',
		product.handle || '',
		JSON.stringify(product.categories || []),
		JSON.stringify(product.attributes || [])
	].join(' '));

	const packCount = /(3x1|tres por uno)/i.test(blob)
		? 3
		: /(2x1|dos por uno)/i.test(blob)
			? 2
			: 1;

	const family = extractProductFamily(product);
	const normalizedName = normalizeText(product.name || '');
	const promoLabel = /(total white)/i.test(blob)
		? 'total white'
		: /(pack)/i.test(blob)
			? 'pack'
			: family || 'producto';

	return {
		offerType: packCount > 1 ? `${packCount}x1` : 'single',
		packCount,
		promoLabel,
		normalizedName
	};
}

function extractProductFamily(product = {}) {
	const blob = normalizeText([
		product.name || '',
		product.tags || '',
		product.handle || '',
		JSON.stringify(product.categories || []),
		JSON.stringify(product.attributes || [])
	].join(' '));

	if (/(body|bodies)/i.test(blob)) return 'body modelador';
	if (/(short faja|short faj|short reduct|faja)/i.test(blob)) return 'faja reductora';
	if (/(bombacha)/i.test(blob)) return 'bombacha modeladora';
	if (/(corpiño|corpino)/i.test(blob)) return 'corpiño';
	if (/(calza)/i.test(blob)) return 'calza modeladora';
	return null;
}

function detectRequestedFamily(text = '') {
	const normalized = normalizeText(text);
	if (/(body|bodies)/.test(normalized)) return 'body modelador';
	if (/(short faja|short faj|faja|reduct)/.test(normalized)) return 'faja reductora';
	if (/(bombacha)/.test(normalized)) return 'bombacha modeladora';
	if (/(corpiño|corpino)/.test(normalized)) return 'corpiño';
	if (/(calza)/.test(normalized)) return 'calza modeladora';
	return null;
}

function buildVariantMatchScore({ normalizedQuery = '', colors = [], sizes = [] }) {
	let score = 0;
	const query = normalizeText(normalizedQuery);
	const requestedColor = colors.some((color) => query.includes(normalizeText(color)));
	const requestedSize = sizes.some((size) => query.includes(normalizeText(size)));

	for (const color of colors) {
		if (query.includes(normalizeText(color))) score += 18;
	}

	for (const size of sizes) {
		if (query.includes(normalizeText(size))) score += 16;
	}

	return {
		score,
		requestedColor,
		requestedSize
	};
}

function scoreProduct(product, normalizedQuery, terms = []) {
	let score = 0;

	const name = normalizeText(product.name || '');
	const brand = normalizeText(product.brand || '');
	const tags = normalizeText(product.tags || '');
	const description = normalizeText(product.description || '');
	const handle = normalizeText(product.handle || '');
	const variantBlob = normalizeText(JSON.stringify(product.variants || []) + ' ' + JSON.stringify(product.attributes || []));
	const requestedFamily = detectRequestedFamily(normalizedQuery);
	const productFamily = extractProductFamily(product);
	const askingPromo = /(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(normalizedQuery);
	const askingPriceOrLink = /(precio|cuanto|cu[aá]nto|sale|valor|link|comprar|web|url)/i.test(normalizedQuery);

	if (!normalizedQuery && !terms.length) return 0;

	if (name.includes(normalizedQuery)) score += 14;
	if (brand.includes(normalizedQuery)) score += 6;
	if (tags.includes(normalizedQuery)) score += 10;
	if (description.includes(normalizedQuery)) score += 5;
	if (handle.includes(normalizedQuery)) score += 7;
	if (variantBlob.includes(normalizedQuery)) score += 8;

	for (const term of terms) {
		if (name.includes(term)) score += 5;
		if (brand.includes(term)) score += 1;
		if (tags.includes(term)) score += 4;
		if (description.includes(term)) score += 2;
		if (handle.includes(term)) score += 3;
		if (variantBlob.includes(term)) score += 3;
	}

	if (requestedFamily && productFamily === requestedFamily) {
		score += 34;
	}

	if (askingPromo) {
		if (/(oferta|promo|pack|combo|2x1|3x1)/i.test(name)) score += 16;
		if (/(oferta|promo|pack|combo|2x1|3x1)/i.test(tags)) score += 12;
	} else if (!askingPriceOrLink) {
		if (/(2x1|3x1|pack total white)/i.test(name)) score -= 3;
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
		where: { published: true },
		orderBy: [{ updatedAt: 'desc' }],
		take: 150
	});

	return rawProducts
		.map((product) => ({
			product,
			score: scoreProduct(product, normalizedQuery, allTerms)
		}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(limit * 3, 10))
		.map(({ product, score }) => {
			const { currentPrice, originalPrice } = resolveCatalogPrices(product.price, product.compareAtPrice);
			const variantMeta = extractVariantMeta(product.variants);
			const family = extractProductFamily(product);
			const offerMeta = extractOfferMeta(product);
			const variantMatch = buildVariantMatchScore({
				normalizedQuery,
				colors: variantMeta.colors,
				sizes: variantMeta.sizes
			});

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
				family,
				offerType: offerMeta.offerType,
				packCount: offerMeta.packCount,
				promoLabel: offerMeta.promoLabel,
				variantHints: variantMeta.variantHints,
				colors: variantMeta.colors,
				sizes: variantMeta.sizes,
				variantMatchScore: variantMatch.score,
				hasRequestedColor: variantMatch.requestedColor,
				hasRequestedSize: variantMatch.requestedSize,
				tags: product.tags
					? product.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6)
					: [],
				score
			};
		})
		.sort((a, b) => {
			const aVariant = (a.variantMatchScore || 0) + (a.hasRequestedColor ? 4 : 0) + (a.hasRequestedSize ? 4 : 0);
			const bVariant = (b.variantMatchScore || 0) + (b.hasRequestedColor ? 4 : 0) + (b.hasRequestedSize ? 4 : 0);
			if (aVariant !== bVariant) return bVariant - aVariant;
			return (b.score || 0) - (a.score || 0);
		})
		.slice(0, limit);
}

export function buildCatalogContext(products = []) {
	if (!Array.isArray(products) || !products.length) {
		return 'No se encontraron productos relevantes del catálogo local para este mensaje.';
	}

	return products
		.map((product, index) => {
			const lines = [
				`${index + 1}. ${product.name}`,
				`   - Familia: ${product.family || 'No detectada'}`,
				`   - Precio actual: ${product.price || 'No informado'}`,
				`   - Oferta detectada: ${product.offerType || 'single'}`,
				`   - Resumen: ${product.shortDescription}`
			];

			if (product.originalPrice) lines.push(`   - Precio anterior: ${product.originalPrice}`);
			if (product.colors?.length) lines.push(`   - Colores detectados: ${product.colors.join(', ')}`);
			if (product.sizes?.length) lines.push(`   - Talles detectados: ${product.sizes.join(', ')}`);
			if (product.variantHints?.length) lines.push(`   - Variantes detectadas: ${product.variantHints.join(', ')}`);
			if (product.productUrl) lines.push(`   - Link: ${product.productUrl}`);

			return lines.join('\n');
		})
		.join('\n\n');
}

export function pickCommercialHints(products = [], commercialPlan = null) {
	if (!Array.isArray(products) || !products.length) {
		return [
			'No cierres una promo si el cliente todavía está explorando.',
			'Contestá corto y seguí el hilo sin volver a saludar.'
		];
	}

	const hints = [];
	const genericFocus = commercialPlan?.productFocus || products[0]?.family || products[0]?.name;

	if (genericFocus) {
		hints.push(`Mantené el foco en ${genericFocus} y no saltes a otra promo sin motivo.`);
	}

	if (commercialPlan?.recommendedAction === 'qualify_before_offer') {
		hints.push('Primero orientá. No cierres una promo específica todavía.');
		hints.push('Si piden body modelador en general, ofrecé ayuda por color, talle o promos disponibles sin elegir una de entrada.');
	}

	if (commercialPlan?.recommendedAction === 'offer_overview') {
		hints.push('Mostrá como máximo dos promos y en lenguaje simple, sin recitar nombres larguísimos.');
	}

	if (commercialPlan?.requestedAction === 'ASK_VARIANT') {
		hints.push('Tratá color y talle como continuidad del producto actual.');
	}

	if (commercialPlan?.requestedAction === 'ASK_MORE_OPTIONS') {
		hints.push('Mostrá que hay otras promos, pero sin imponer una sola ni mandar link todavía.');
	}

	if (commercialPlan?.bestOffer?.price && commercialPlan.repeatPriceNow) {
		hints.push(`Si te vuelven a pedir precio, usá ${commercialPlan.bestOffer.price}.`);
	} else if (commercialPlan?.bestOffer?.price) {
		hints.push('No repitas el precio si no te lo pidieron de nuevo.');
	}

	if (commercialPlan?.shareLinkNow) {
		hints.push('Si compartís link, que sea uno solo y del producto foco.');
	} else {
		hints.push('No compartas link hasta que el cliente lo pida o ya esté cerrando compra.');
	}

	if (products.some((p) => p.colors?.length)) {
		hints.push('Si preguntan color, respondé directo y seguí la charla.');
	}

	if (products.some((p) => p.sizes?.length)) {
		hints.push('Si preguntan talle, respondé directo y evitá mandarlo a la web.');
	}

	hints.push('No arranques con “claro”, “perfecto”, “buenísimo” ni saludos repetidos.');

	return hints;
}
