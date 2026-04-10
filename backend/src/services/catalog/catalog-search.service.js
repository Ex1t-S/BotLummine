import { prisma } from '../../lib/prisma.js';
import {
	getCommercialProfile,
	inferCommercialFamily,
	scoreProductAgainstCommercialProfile
} from '../../data/catalog-commercial-map.js';
import {
	getSkuVariantLabel,
	getSkuVariantMeta,
	getSkuVariantSearchText,
	isGenericSkuColor,
	normalizeSku,
} from '../../data/sku-size-map.js';

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

function normalizeSpacing(value = '') {
	return String(value || '')
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
		if (b > 0 && b < a) return { currentPrice: b, originalPrice: a };
		if (a > 0 && a < b) return { currentPrice: a, originalPrice: b };
		return { currentPrice: a, originalPrice: null };
	}

	if (a != null) return { currentPrice: a, originalPrice: null };
	if (b != null) return { currentPrice: b, originalPrice: null };
	return { currentPrice: null, originalPrice: null };
}

const COLOR_PATTERNS = /(negro|negra|blanco|blanca|beige|avellana|marron|marrón|nude|rosa|gris|azul|verde|bordo|chocolate)/i;
const CATALOG_STOPWORDS = new Set([
	'hola', 'holi', 'buenas', 'buenos', 'dias', 'dia', 'día', 'tardes', 'noches',
	'gracias', 'ok', 'oka', 'dale', 'joya', 'bien', 'genial', 'perfecto',
	'buenisimo', 'buenísimo', 'entiendo', 'barbaro', 'bárbaro', 'si', 'sí', 'claro'
]);
const GENERIC_VARIANT_VALUES = new Set([
	'pack',
	'cualquiera',
	'1 de c/u',
	'1 de c/u + boob tape',
	'bodys 1 c/u',
	'3 unidades',
	'corpiño 1 c/u',
	'3 de c/u item',
	'muscu 1 c/u',
	'1 u',
	'1 unidad',
	'pack x 2',
	'pack x 3',
	'pack 2',
	'pack 3',
	'pack x3',
	'pack x2',
	'-'
]);

function uniqueStrings(values = []) {
	return [...new Set(values.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}

function looksLikeSkuCode(value = '') {
	return /^[A-Z]{1,8}-\d{3,}$/i.test(normalizeSku(value));
}

function looksLikeInternalCode(value = '') {
	const normalized = normalizeSpacing(value).toUpperCase();
	return looksLikeSkuCode(normalized) || /^[A-Z]{1,8}\s*-\s*\d{3,}$/i.test(normalized);
}

function isGenericVariantValue(value = '') {
	return GENERIC_VARIANT_VALUES.has(normalizeText(value));
}

function normalizeColorLabel(value = '') {
	const raw = normalizeSpacing(value).toLowerCase();
	if (!raw) return null;

	const normalized = raw
		.replace(/\bnegra\b/g, 'negro')
		.replace(/\bblanca\b/g, 'blanco');

	if (!COLOR_PATTERNS.test(normalized)) return null;
	return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeSizeLabel(value = '') {
	let normalized = normalizeSpacing(value)
		.toUpperCase()
		.replace(/\s*\/\s*/g, '/')
		.replace(/\s*=\s*/g, '=')
		.replace(/\bML\b/g, 'M/L')
		.replace(/\bSM\b/g, 'S/M')
		.replace(/\bTALLEUNICO\b/g, 'TALLE UNICO');

	normalized = normalized
		.replace(/\bP\/M\b/g, 'M/L')
		.replace(/\bG\/GG\b/g, 'XL/2XL');

	return normalized;
}

function extractAtomicSizes(value = '') {
	const normalized = normalizeSizeLabel(value);
	if (!normalized) return [];

	const matches = normalized.match(
		/(TALLE UNICO|TALLE 1|TALLE 2|TALLE 3|TALLE 4|5XL\/6XL|4XL|3XL\/4XL|2XL\/3XL|XL\/2XL|XL\/XXL|L\/XL|M\/L|S\/M|XXXL|XXL|XL|L|M|S|XS|110)/g
	);

	return uniqueStrings(matches || []);
}

function pickFamilyRelevantSizes(meta = {}, family = null) {
	const baseSize = normalizeSizeLabel(meta.size || '');
	if (!baseSize) return [];

	if (family === 'calzas_linfaticas' && /\s+Y\s+/i.test(baseSize)) {
		return uniqueStrings([normalizeSizeLabel(baseSize.split(/\s+Y\s+/i).pop())]);
	}

	if (family === 'body_modelador' && /\s+Y\s+/i.test(baseSize)) {
		return uniqueStrings([normalizeSizeLabel(baseSize.split(/\s+Y\s+/i)[0])]);
	}

	const directSizes = extractAtomicSizes(baseSize);
	if (directSizes.length) return directSizes;

	const fromDescription = extractAtomicSizes(meta.description || '');
	return uniqueStrings(fromDescription);
}

function extractTextSizes(value = '', family = null) {
	const base = normalizeSizeLabel(value);
	if (!base) return [];

	if (family === 'calzas_linfaticas' && /\s+Y\s+/i.test(base)) {
		return uniqueStrings([normalizeSizeLabel(base.split(/\s+Y\s+/i).pop())]);
	}

	if (family === 'body_modelador' && /\s+Y\s+/i.test(base)) {
		return uniqueStrings([normalizeSizeLabel(base.split(/\s+Y\s+/i)[0])]);
	}

	return extractAtomicSizes(base);
}

function extractVariantMeta(variants = [], { family = null } = {}) {
	const flat = parseJsonArray(variants);
	const hintSet = new Set();
	const colorSet = new Set();
	const sizeSet = new Set();
	const searchChunks = [];

	const pushSkuMeta = (skuValue) => {
		const meta = getSkuVariantMeta(skuValue);
		if (!meta) return;

		const label = getSkuVariantLabel(skuValue);
		if (label) hintSet.add(label);

		const mappedColor = normalizeColorLabel(meta.color || '');
		if (mappedColor && !isGenericSkuColor(meta.color || '')) {
			colorSet.add(mappedColor);
		}

		for (const size of pickFamilyRelevantSizes(meta, family)) {
			sizeSet.add(size);
		}

		const searchText = getSkuVariantSearchText(skuValue);
		if (searchText) searchChunks.push(searchText);
	};

	const pushPlainValue = (rawValue) => {
		const cleaned = normalizeSpacing(rawValue);
		if (!cleaned) return;

		if (looksLikeSkuCode(cleaned)) {
			pushSkuMeta(cleaned);
			return;
		}

		if (isGenericVariantValue(cleaned)) return;

		const normalizedColor = normalizeColorLabel(cleaned);
		if (normalizedColor) colorSet.add(normalizedColor);

		for (const size of extractTextSizes(cleaned, family)) {
			sizeSet.add(size);
		}

		if (!looksLikeInternalCode(cleaned) && cleaned.length <= 80) {
			hintSet.add(cleaned);
		}
	};

	for (const variant of flat) {
		if (variant?.sku) {
			pushSkuMeta(variant.sku);
		}

		if (variant?.option1) pushPlainValue(variant.option1);
		if (variant?.option2) pushPlainValue(variant.option2);
		if (variant?.option3) pushPlainValue(variant.option3);

		if (Array.isArray(variant?.values)) {
			for (const value of variant.values) {
				pushPlainValue(value);
			}
		}

		if (Array.isArray(variant?.attributes)) {
			for (const attribute of variant.attributes) {
				pushPlainValue(attribute?.value || '');
				pushPlainValue(attribute?.name || '');
			}
		}
	}

	return {
		variantHints: uniqueStrings([...hintSet]).slice(0, 12),
		colors: uniqueStrings([...colorSet]).slice(0, 8),
		sizes: uniqueStrings([...sizeSet]).slice(0, 8),
		searchBlob: normalizeText(searchChunks.join(' '))
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

function detectRequestedSignals(query = '', interestedProducts = []) {
	const normalizedQuery = normalizeText(query);
	const terms = [
		...new Set([
			...splitTerms(query),
			...(Array.isArray(interestedProducts)
				? interestedProducts.map((v) => normalizeText(v)).filter(Boolean)
				: [])
		])
	];
	const requestedFamily = inferCommercialFamily([query, ...(interestedProducts || [])].join(' '));

	return {
		normalizedQuery,
		terms,
		requestedFamily,
		asksPromo: /(oferta|promo|promocion|promoción|pack|combo|2x1|3x1)/i.test(normalizedQuery),
		asksPrice: /(precio|cuanto|cuánto|sale|valor)/i.test(normalizedQuery),
		asksLink: /(pasame|mandame|enviame).*(link|url)|\b(link|url|web|tienda|comprar)\b/i.test(normalizedQuery),
		asksComparison: /(cual|cuál|conviene|mejor|diferencia|compar)/i.test(normalizedQuery),
		hasVariantSpecificity: /(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(normalizedQuery)
	};
}

function shouldSkipCatalogLookup(signals = {}) {
	const query = String(signals.normalizedQuery || '').trim();
	if (!query) return true;

	const meaningfulTerms = (signals.terms || []).filter((term) => !CATALOG_STOPWORDS.has(term));
	if (!meaningfulTerms.length) return true;

	const hasCommercialSignal =
		Boolean(signals.requestedFamily) ||
		signals.asksPromo ||
		signals.asksPrice ||
		signals.asksLink ||
		signals.asksComparison ||
		signals.hasVariantSpecificity;

	return !hasCommercialSignal && meaningfulTerms.length < 2;
}

function inferOfferType(product = {}) {
	const haystack = normalizeText([
		product.name,
		product.tags,
		product.description,
		product.handle,
		JSON.stringify(product.attributes || []),
		JSON.stringify(product.variants || []),
		JSON.stringify(product.rawPayload || {})
	].filter(Boolean).join(' '));

	if (/3x1|tres por uno/.test(haystack)) return '3x1';
	if (/2x1|dos por uno/.test(haystack)) return '2x1';
	if (/pack|combo|promo|promocion|promoción|oferta/.test(haystack)) return 'pack';
	return 'single';
}

function inferPackCount(offerType = 'single') {
	if (offerType === '3x1') return 3;
	if (offerType === '2x1') return 2;
	return 1;
}

function scoreProduct(product, normalizedQuery, terms = [], signals = {}) {
	let score = 0;
	const guessedFamily =
		signals.requestedFamily ||
		inferCommercialFamily([product.name, product.tags, product.handle, product.description].filter(Boolean).join(' '));

	const variantMeta = extractVariantMeta(product.variants, { family: guessedFamily });

	const name = normalizeText(product.name || '');
	const brand = normalizeText(product.brand || '');
	const tags = normalizeText(product.tags || '');
	const description = normalizeText(product.description || '');
	const handle = normalizeText(product.handle || '');
	const variantBlob = normalizeText([
		JSON.stringify(product.variants || []),
		JSON.stringify(product.attributes || []),
		variantMeta.variantHints.join(' '),
		variantMeta.colors.join(' '),
		variantMeta.sizes.join(' '),
		variantMeta.searchBlob
	].join(' '));

	if (!normalizedQuery && !terms.length) return 0;

	if (name.includes(normalizedQuery)) score += 14;
	if (brand.includes(normalizedQuery)) score += 8;
	if (tags.includes(normalizedQuery)) score += 10;
	if (description.includes(normalizedQuery)) score += 6;
	if (handle.includes(normalizedQuery)) score += 7;
	if (variantBlob.includes(normalizedQuery)) score += 10;

	for (const term of terms) {
		if (name.includes(term)) score += 5;
		if (brand.includes(term)) score += 2;
		if (tags.includes(term)) score += 4;
		if (description.includes(term)) score += 2;
		if (handle.includes(term)) score += 3;
		if (variantBlob.includes(term)) score += 5;
	}

	if (signals.asksPromo) {
		if (/(oferta|promo|pack|combo|2x1|3x1)/i.test(name)) score += 20;
		if (/(oferta|promo|pack|combo|2x1|3x1)/i.test(tags)) score += 16;
		if (/(oferta|promo|pack|combo|2x1|3x1)/i.test(variantBlob)) score += 14;
	}

	if (signals.requestedFamily === 'body_modelador' && /(body|modelador|reductor|reductora)/i.test(name)) score += 20;
	if (signals.requestedFamily === 'calzas_linfaticas' && /(calza|linfat|modeladora|pantymedia)/i.test(`${name} ${description}`)) score += 20;
	if (signals.hasVariantSpecificity && /(negro|blanco|beige|nude|rosa|gris|azul|verde|bordo|xl|xxl|xxxl|s\/m|m\/l|l\/xl)/i.test(variantBlob)) score += 14;

	if (product.published) score += 2;
	if (product.featuredImage) score += 1;
	if (product.productUrl) score += 1;

	return score;
}

export async function getCatalogLookupStatus() {
	try {
		const [totalProducts, totalPublished] = await Promise.all([
			prisma.catalogProduct.count(),
			prisma.catalogProduct.count({ where: { published: true } })
		]);

		return {
			ok: true,
			available: totalPublished > 0,
			reason: totalPublished > 0 ? 'catalog_ready' : 'catalog_empty',
			totalProducts,
			totalPublished
		};
	} catch (error) {
		const message = error?.message || String(error);
		const missingTable =
			/relation\s+"?CatalogProduct"?\s+does not exist/i.test(message) ||
			/P2021|P2022/i.test(message);

		return {
			ok: false,
			available: false,
			reason: missingTable ? 'catalog_table_missing' : 'catalog_lookup_failed',
			totalProducts: 0,
			totalPublished: 0,
			error: message
		};
	}
}

export async function searchCatalogProducts({ query = '', interestedProducts = [], limit = 4 } = {}) {
	const signals = detectRequestedSignals(query, interestedProducts);
	if (shouldSkipCatalogLookup(signals)) return [];

	let rawProducts = [];
	try {
		rawProducts = await prisma.catalogProduct.findMany({
			where: { published: true },
			orderBy: [{ updatedAt: 'desc' }],
			take: signals.asksPromo || signals.requestedFamily ? 220 : 120
		});
	} catch (error) {
		console.error('[CATALOG SEARCH] No se pudo consultar CatalogProduct:', error?.message || error);
		return [];
	}

	return rawProducts
		.map((product) => ({
			product,
			score: scoreProduct(product, signals.normalizedQuery, signals.terms, signals)
		}))
		.filter((entry) => entry.score > 0)
		.map(({ product, score }) => {
			const { currentPrice, originalPrice } = resolveCatalogPrices(product.price, product.compareAtPrice);
			const shortDescription = buildShortDescription(product);
			const family = inferCommercialFamily([
				product.name,
				product.tags,
				product.handle,
				shortDescription
			].filter(Boolean).join(' '));
			const variantMeta = extractVariantMeta(product.variants, { family });
			const offerType = inferOfferType(product);

			const profileScore = scoreProductAgainstCommercialProfile({
				name: product.name,
				handle: product.handle,
				tags: product.tags,
				shortDescription,
				variantHints: variantMeta.variantHints,
				colors: variantMeta.colors,
				sizes: variantMeta.sizes
			}, family);

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
				shortDescription,
				variantHints: variantMeta.variantHints,
				colors: variantMeta.colors,
				sizes: variantMeta.sizes,
				tags: product.tags
					? product.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 6)
					: [],
				score,
				family,
				offerType,
				packCount: inferPackCount(offerType),
				commercialProfile: getCommercialProfile(family),
				commercialScoreBoost: profileScore,
				isGiftLike: /(gift|regalo|segunda piel de regalo|mes de la mujer)/i.test(normalizeText(product.name || ''))
			};
		})
		.filter((item) => !item.isGiftLike)
		.sort((a, b) => (b.score + b.commercialScoreBoost) - (a.score + a.commercialScoreBoost))
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
				`   - Familia: ${product.family || 'sin clasificar'}`,
				`   - Tipo de oferta: ${product.offerType || 'single'}`,
				`   - Precio actual: ${product.price || 'No informado'}`,
				`   - Link: ${product.productUrl || 'No disponible'}`,
				`   - Resumen: ${product.shortDescription}`
			];

			if (product.originalPrice) lines.push(`   - Precio anterior: ${product.originalPrice}`);
			if (product.colors?.length) lines.push(`   - Colores detectados: ${product.colors.join(', ')}`);
			if (product.sizes?.length) lines.push(`   - Talles disponibles: ${product.sizes.join(', ')}`);

			return lines.join('\n');
		})
		.join('\n\n');
}

export function pickCommercialHints(products = [], commercialPlan = null) {
	if (!Array.isArray(products) || !products.length) return [];

	const hints = [];
	const family = commercialPlan?.productFamily || products[0]?.family || null;
	const profile = getCommercialProfile(family);

	if (profile?.defaultPitch) hints.push(profile.defaultPitch);
	if (commercialPlan?.bestOffer?.name) hints.push(`Priorizá como oferta principal ${commercialPlan.bestOffer.name}.`);
	if (commercialPlan?.requestedAction === 'ASK_OFFER') {
		hints.push('Mostrá primero la oferta principal de esta familia; si no avanza, recién ahí abrí la alternativa.');
	}
	if (commercialPlan?.requestedAction === 'ASK_VARIANT') {
		hints.push('Cuando hables de talles o colores, nombrá talles humanos (S/M, M/L, XL/XXL) y no SKUs internos.');
	}
	if (commercialPlan?.shareLinkNow) {
		hints.push(profile?.linkHint || 'Compartí un único link y solo del producto foco más reciente.');
	} else {
		hints.push('No compartas link todavía si la conversación sigue definiendo producto, variante o promo.');
	}

	hints.push('No abras varias promos salvo pedido explícito.');
	hints.push('No arranques con saludo repetido ni con claro, perfecto, genial o buenísimo.');
	hints.push('Nunca muestres SKUs internos al cliente como si fueran talles.');

	return hints;
}
