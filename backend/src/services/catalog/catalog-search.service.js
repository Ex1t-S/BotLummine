import { prisma } from '../../lib/prisma.js';
import {
	getCommercialProfile,
	inferCommercialFamily,
	scoreProductAgainstCommercialProfile
} from '../../data/catalog-commercial-map.js';

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

function sanitizeExcludedKeyword(raw = '') {
	return String(raw || '')
		.toLowerCase()
		.replace(/^[\s,.;:!?-]+/, '')
		.replace(/^(el|la|los|las|un|una)\s+/, '')
		.split(/(?:\s+pero\s+|\s+y\s+|\s+porque\s+|\s+que\s+trae\s+|\s+que\s+tenga\s+)/i)[0]
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function extractExcludedKeywords(text = '') {
	const normalized = normalizeText(text);
	const patterns = [
		/que no sea\s+([^,.!?]+)/gi,
		/no quiero(?:\s+(?:el|la|los|las))?\s+([^,.!?]+)/gi,
		/sin\s+([^,.!?]+)/gi,
		/excepto\s+([^,.!?]+)/gi,
		/menos\s+([^,.!?]+)/gi
	];
	const detected = [];
	for (const pattern of patterns) {
		for (const match of normalized.matchAll(pattern)) {
			const cleaned = sanitizeExcludedKeyword(match?.[1] || '');
			if (cleaned && cleaned.length >= 3) detected.push(cleaned);
		}
	}
	return [...new Set(detected)];
}

function detectRequestedOfferType(text = '') {
	const normalized = normalizeText(text);
	if (/(3x1|tres por uno)/i.test(normalized)) return '3x1';
	if (/(2x1|dos por uno)/i.test(normalized)) return '2x1';
	if (/(pack|combo|promo|promocion|promoción|oferta)/i.test(normalized)) return 'pack';
	return null;
}

function detectRequestedSignals(query = '', interestedProducts = []) {
	const normalizedQuery = normalizeText(query);
	const terms = [...new Set([...splitTerms(query), ...(Array.isArray(interestedProducts) ? interestedProducts.map((v) => normalizeText(v)).filter(Boolean) : [])])];
	const requestedFamily = inferCommercialFamily([query, ...(interestedProducts || [])].join(' '));
	return {
		normalizedQuery,
		terms,
		requestedFamily,
		requestedOfferType: detectRequestedOfferType(normalizedQuery),
		excludedKeywords: extractExcludedKeywords(normalizedQuery),
		asksPromo: /(oferta|promo|promocion|promoción|pack|combo|2x1|3x1|tres por uno|dos por uno)/i.test(normalizedQuery),
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

function buildOfferHaystack(product = {}) {
	return normalizeText([
		product.name,
		product.tags,
		product.description,
		product.handle,
		JSON.stringify(product.rawPayload || {}),
		JSON.stringify(product.attributes || []),
		JSON.stringify(product.variants || [])
	].filter(Boolean).join(' '));
}

function inferOfferType(productOrName = '') {
	const haystack = typeof productOrName === 'string'
		? normalizeText(productOrName)
		: buildOfferHaystack(productOrName);

	if (/(3x1|3 x 1|tres por uno|llevas 3 pagas 1|lleva 3 paga 1|pagas 1|paga 1)/.test(haystack)) return '3x1';
	if (/(2x1|2 x 1|dos por uno|llevas 2 pagas 1|lleva 2 paga 1)/.test(haystack)) return '2x1';
	if (/(pack|combo|promo|promocion|promoción|oferta)/.test(haystack)) return 'pack';
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
	const offerHaystack = buildOfferHaystack(product);
	const offerType = inferOfferType(product);

	if (!normalizedQuery && !terms.length) return 0;

	if (name.includes(normalizedQuery)) score += 14;
	if (brand.includes(normalizedQuery)) score += 8;
	if (tags.includes(normalizedQuery)) score += 10;
	if (description.includes(normalizedQuery)) score += 6;
	if (handle.includes(normalizedQuery)) score += 7;
	if (variantBlob.includes(normalizedQuery)) score += 8;
	if (offerHaystack.includes(normalizedQuery)) score += 8;

	for (const term of terms) {
		if (name.includes(term)) score += 5;
		if (brand.includes(term)) score += 2;
		if (tags.includes(term)) score += 4;
		if (description.includes(term)) score += 2;
		if (handle.includes(term)) score += 3;
		if (variantBlob.includes(term)) score += 4;
		if (offerHaystack.includes(term)) score += 3;
	}

	if (signals.asksPromo) {
		if (/(oferta|promo|pack|combo|2x1|3x1|tres por uno|dos por uno)/i.test(offerHaystack)) score += 28;
		if (offerType === '3x1') score += 18;
		if (offerType === '2x1') score += 12;
	}

	if (signals.requestedOfferType) {
		if (offerType === signals.requestedOfferType) score += 38;
		else score -= 20;
	}

	if (signals.requestedFamily === 'body_modelador' && /(body|bodies|modelador|reductor|reductora)/i.test(offerHaystack)) score += 24;
	if (signals.requestedFamily === 'calzas_linfaticas' && /(calza|linfat|modeladora)/i.test(offerHaystack)) score += 24;
	if (signals.requestedFamily === 'faja_reductora' && /(faja|ballena|corset)/i.test(offerHaystack)) score += 24;
	if (signals.hasVariantSpecificity && /(negro|blanco|beige|nude|rosa|gris|azul|verde|bordo|xl|xxl|xxxl)/i.test(variantBlob)) score += 14;

	if (Array.isArray(signals.excludedKeywords) && signals.excludedKeywords.length) {
		const isExcluded = signals.excludedKeywords.some((keyword) => keyword && offerHaystack.includes(keyword));
		if (isExcluded) score -= 240;
	}

	if (product.published) score += 2;
	if (product.featuredImage) score += 1;
	if (product.productUrl) score += 1;

	return score;
}

function buildCatalogWhere(signals = {}) {
	const andConditions = [{ published: true }];
	const orConditions = [];

	if (signals.requestedFamily === 'body_modelador') {
		orConditions.push(
			{ name: { contains: 'body', mode: 'insensitive' } },
			{ name: { contains: 'bodies', mode: 'insensitive' } },
			{ tags: { contains: 'body', mode: 'insensitive' } },
			{ description: { contains: 'body', mode: 'insensitive' } }
		);
	}

	if (signals.requestedFamily === 'calzas_linfaticas') {
		orConditions.push(
			{ name: { contains: 'calza', mode: 'insensitive' } },
			{ tags: { contains: 'calza', mode: 'insensitive' } },
			{ description: { contains: 'calza', mode: 'insensitive' } },
			{ description: { contains: 'linfat', mode: 'insensitive' } }
		);
	}

	if (signals.requestedFamily === 'faja_reductora') {
		orConditions.push(
			{ name: { contains: 'faja', mode: 'insensitive' } },
			{ tags: { contains: 'faja', mode: 'insensitive' } },
			{ description: { contains: 'faja', mode: 'insensitive' } }
		);
	}

	for (const term of signals.terms || []) {
		if (CATALOG_STOPWORDS.has(term)) continue;
		orConditions.push(
			{ name: { contains: term, mode: 'insensitive' } },
			{ tags: { contains: term, mode: 'insensitive' } },
			{ handle: { contains: term, mode: 'insensitive' } },
			{ description: { contains: term, mode: 'insensitive' } }
		);
	}

	if (orConditions.length) {
		andConditions.push({ OR: orConditions });
	}

	return andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
}

function resolveCatalogTake(signals = {}) {
	if (signals.requestedFamily && signals.requestedOfferType) return 300;
	if (signals.requestedFamily || signals.requestedOfferType) return 220;
	return 160;
}

export async function searchCatalogProducts({ query = '', interestedProducts = [], limit = 4 } = {}) {
	const signals = detectRequestedSignals(query, interestedProducts);
	if (shouldSkipCatalogLookup(signals)) return [];

	let rawProducts = [];
	try {
		rawProducts = await prisma.catalogProduct.findMany({
			where: buildCatalogWhere(signals),
			orderBy: [{ updatedAt: 'desc' }],
			take: resolveCatalogTake(signals)
		});
	} catch (error) {
		console.error('[CATALOG] Error consultando catalogProduct:', error?.message || error);
		return [];
	}

	return rawProducts
		.map((product) => ({ product, score: scoreProduct(product, signals.normalizedQuery, signals.terms, signals) }))
		.filter((entry) => entry.score > 0)
		.map(({ product, score }) => {
			const { currentPrice, originalPrice } = resolveCatalogPrices(product.price, product.compareAtPrice);
			const variantMeta = extractVariantMeta(product.variants);
			const shortDescription = buildShortDescription(product);
			const family = inferCommercialFamily([product.name, product.tags, product.handle, shortDescription].filter(Boolean).join(' '));
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
			const haystack = buildOfferHaystack(product);
			const isExactOfferMatch = !signals.requestedOfferType || offerType === signals.requestedOfferType;
			const containsExcludedKeyword = (signals.excludedKeywords || []).some((keyword) => keyword && haystack.includes(keyword));
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
				isGiftLike: /(gift|regalo|segunda piel de regalo|mes de la mujer)/i.test(normalizeText(product.name || '')),
				isExactOfferMatch,
				containsExcludedKeyword
			};
		})
		.filter((item) => !item.isGiftLike)
		.sort((a, b) => {
			const aTotal = (a.score + a.commercialScoreBoost) + (a.isExactOfferMatch ? 25 : 0) - (a.containsExcludedKeyword ? 200 : 0);
			const bTotal = (b.score + b.commercialScoreBoost) + (b.isExactOfferMatch ? 25 : 0) - (b.containsExcludedKeyword ? 200 : 0);
			return bTotal - aTotal;
		})
		.slice(0, limit);
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
