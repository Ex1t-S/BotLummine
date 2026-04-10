import { prisma } from '../../lib/prisma.js';
import {
	getCommercialProfile,
	inferCommercialFamily,
	scoreProductAgainstCommercialProfile
} from '../../data/catalog-commercial-map.js';

const catalogLookupStatus = {
	available: true,
	reason: 'ok',
	message: null,
	checkedAt: null
};

function setCatalogLookupStatus(partial = {}) {
	Object.assign(catalogLookupStatus, partial, {
		checkedAt: new Date().toISOString()
	});
}

function isMissingCatalogTableError(error) {
	const message = String(error?.message || '').toLowerCase();
	const code = String(error?.code || '').toUpperCase();
	const metaTarget = String(error?.meta?.target || error?.meta?.table || '').toLowerCase();
	return (
		code in { 'P2021': 1, 'P2022': 1 } ||
		message.includes('catalogproduct') ||
		message.includes('relation "catalogproduct" does not exist') ||
		metaTarget.includes('catalogproduct')
	);
}

export function getCatalogLookupStatus() {
	return { ...catalogLookupStatus };
}

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
		if (b > 0 && b < a) return { currentPrice: b, originalPrice: a };
		if (a > 0 && a < b) return { currentPrice: a, originalPrice: b };
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

const CATALOG_STOPWORDS = new Set([
	'hola','holi','buenas','buenos','dias','dia','día','tardes','noches','gracias','ok','oka','dale','joya','bien','genial','perfecto','buenisimo','buenísimo','entiendo','barbaro','bárbaro','si','sí','claro'
]);

function detectRequestedSignals(query = '', interestedProducts = []) {
	const normalizedQuery = normalizeText(query);
	const terms = [...new Set([...splitTerms(query), ...(Array.isArray(interestedProducts) ? interestedProducts.map((v) => normalizeText(v)).filter(Boolean) : [])])];
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
	const hasCommercialSignal = Boolean(signals.requestedFamily) || signals.asksPromo || signals.asksPrice || signals.asksLink || signals.asksComparison || signals.hasVariantSpecificity;
	return !hasCommercialSignal && meaningfulTerms.length < 2;
}

function inferOfferType(name = '') {
	const normalized = normalizeText(name);
	if (/3x1|tres por uno/.test(normalized)) return '3x1';
	if (/2x1|dos por uno/.test(normalized)) return '2x1';
	if (/pack|combo|promo|promocion|promoción/.test(normalized)) return 'pack';
	return 'single';
}

function inferPackCount(offerType = 'single') {
	if (offerType === '3x1') return 3;
	if (offerType === '2x1') return 2;
	return 1;
}

function scoreProduct(product, normalizedQuery, terms = [], signals = {}) {
	let score = 0;
	const name = normalizeText(product.name || '');
	const brand = normalizeText(product.brand || '');
	const tags = normalizeText(product.tags || '');
	const description = normalizeText(product.description || '');
	const handle = normalizeText(product.handle || '');
	const variantBlob = normalizeText(JSON.stringify(product.variants || []) + ' ' + JSON.stringify(product.attributes || []));

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

	if (signals.asksPromo) {
		if (/(oferta|promo|pack|combo|2x1|3x1)/i.test(name)) score += 20;
		if (/(oferta|promo|pack|combo|2x1|3x1)/i.test(tags)) score += 16;
	}

	if (signals.requestedFamily === 'body_modelador' && /(body|modelador|reductor|reductora)/i.test(name)) score += 20;
	if (signals.requestedFamily === 'calzas_linfaticas' && /(calza|linfat|modeladora)/i.test(name)) score += 20;
	if (signals.hasVariantSpecificity && /(negro|blanco|beige|nude|rosa|gris|azul|verde|bordo|xl|xxl|xxxl)/i.test(variantBlob)) score += 14;

	if (product.published) score += 2;
	if (product.featuredImage) score += 1;
	if (product.productUrl) score += 1;

	return score;
}

export async function searchCatalogProducts({ query = '', interestedProducts = [], limit = 4 } = {}) {
	const signals = detectRequestedSignals(query, interestedProducts);
	if (shouldSkipCatalogLookup(signals)) {
		setCatalogLookupStatus({ available: true, reason: 'skipped', message: null });
		return [];
	}

	try {
		const rawProducts = await prisma.catalogProduct.findMany({
			where: { published: true },
			orderBy: [{ updatedAt: 'desc' }],
			take: 120
		});

		setCatalogLookupStatus({
			available: true,
			reason: rawProducts.length ? 'ok' : 'empty',
			message: rawProducts.length ? null : 'No hay productos publicados en el catálogo local.'
		});

		return rawProducts
			.map((product) => ({ product, score: scoreProduct(product, signals.normalizedQuery, signals.terms, signals) }))
			.filter((entry) => entry.score > 0)
			.map(({ product, score }) => {
				const { currentPrice, originalPrice } = resolveCatalogPrices(product.price, product.compareAtPrice);
				const variantMeta = extractVariantMeta(product.variants);
				const shortDescription = buildShortDescription(product);
				const family = inferCommercialFamily([product.name, product.tags, product.handle, shortDescription].filter(Boolean).join(' '));
				const offerType = inferOfferType(product.name || '');
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
					tags: product.tags ? product.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6) : [],
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
	} catch (error) {
		if (isMissingCatalogTableError(error)) {
			setCatalogLookupStatus({
				available: false,
				reason: 'missing_catalog_table',
				message: 'La tabla CatalogProduct no existe en esta base.'
			});
			console.warn('[CATALOG] La tabla CatalogProduct no existe todavía en esta base.');
			return [];
		}

		setCatalogLookupStatus({
			available: false,
			reason: 'lookup_error',
			message: error?.message || String(error)
		});
		console.error('[CATALOG] Error buscando productos en catálogo local:', error);
		return [];
	}
}

export function buildCatalogContext(products = []) {
	if (!Array.isArray(products) || !products.length) return 'No se encontraron productos relevantes del catálogo local para este mensaje.';
	return products.map((product, index) => {
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
		if (product.sizes?.length) lines.push(`   - Talles detectados: ${product.sizes.join(', ')}`);
		return lines.join('\n');
	}).join('\n\n');
}

export function pickCommercialHints(products = [], commercialPlan = null) {
	if (!Array.isArray(products) || !products.length) return [];
	const hints = [];
	const family = commercialPlan?.productFamily || products[0]?.family || null;
	const profile = getCommercialProfile(family);
	if (profile?.defaultPitch) hints.push(profile.defaultPitch);
	if (commercialPlan?.bestOffer?.name) hints.push(`Priorizá como oferta principal ${commercialPlan.bestOffer.name}.`);
	if (commercialPlan?.requestedAction === 'ASK_OFFER') hints.push('Mostrá primero la oferta principal de esta familia; si no avanza, recién ahí abrí la alternativa.');
	if (commercialPlan?.requestedAction === 'ASK_VARIANT') hints.push('Tomá color y talle como continuidad del producto o familia actual, sin reiniciar la venta.');
	if (commercialPlan?.shareLinkNow) hints.push(profile?.linkHint || 'Compartí un único link y solo del producto foco más reciente.');
	else hints.push('No compartas link todavía si la conversación sigue definiendo producto, variante o promo.');
	hints.push('No abras varias promos salvo pedido explícito.');
	hints.push('No arranques con saludo repetido ni con claro, perfecto, genial o buenísimo.');
	return hints;
}
