import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import { requireWorkspaceScope } from '../workspaces/workspace-scope.js';
import {
	commercialFamilyAllowedForProfile,
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

function localizedValue(value) {
	if (value == null) return '';
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	if (typeof value === 'object') {
		return String(
			value.es ||
			value.en ||
			value.value ||
			value.name ||
			Object.values(value).find((item) => typeof item === 'string' || typeof item === 'number') ||
			''
		);
	}
	return '';
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

function resolveVariantPriceRange(variants = []) {
	const prices = uniqueStrings(parseJsonArray(variants)
		.map((variant) => toNumberOrNull(variant?.price))
		.filter((value) => value != null)
		.map((value) => String(value)))
		.map(Number)
		.filter(Number.isFinite)
		.sort((a, b) => a - b);
	if (prices.length < 2 || prices[0] === prices[prices.length - 1]) return null;
	return { min: prices[0], max: prices[prices.length - 1] };
}

const COLOR_PATTERNS = /(negro|negra|blanco|blanca|beige|avellana|marron|nude|rosa|gris|azul|verde|bordo|chocolate)/i;
const CATALOG_STOPWORDS = new Set([
	'hola', 'holi', 'buenas', 'buenos', 'dias', 'dia', 'tardes', 'noches',
	'gracias', 'ok', 'oka', 'dale', 'joya', 'bien', 'genial', 'perfecto',
	'buenisimo', 'entiendo', 'barbaro', 'si', 'claro',
	'que', 'tienen', 'tiene', 'tenes', 'quiero', 'necesito',
	'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del',
	'al', 'sobre', 'info', 'informacion', 'mas', 'me', 'mi', 'mis', 'tu',
	'tus', 'para', 'por', 'con', 'sin', 'como', 'cuando', 'donde',
	'contame', 'contar', 'contas', 'saber', 'ayuda', 'ayudame', 'ver',
	'ese', 'esa', 'eso', 'estos', 'estas', 'este', 'esta', 'producto',
	'algo', 'alguna', 'alguno', 'algunos', 'algunas', 'lindo', 'linda',
	'lindos', 'lindas', 'bueno', 'buena', 'buenos', 'buenas'
]);
const STRONG_PRODUCT_TOKEN_MIN_LENGTH = 5;
const FUZZY_TOKEN_MIN_LENGTH = 4;
const FUZZY_MAX_DISTANCE = 1;
const FUZZY_LONG_TOKEN_MAX_DISTANCE = 2;
const GENERIC_VARIANT_VALUES = new Set([
	'pack',
	'cualquiera',
	'1 de c/u',
	'1 de c/u + boob tape',
	'bodys 1 c/u',
	'3 unidades',
	'corpino 1 c/u',
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
	'default title',
	'-'
]);

function uniqueStrings(values = []) {
	return [...new Set(values.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}

function meaningfulTerms(terms = []) {
	return uniqueStrings(terms).filter((term) => term && !CATALOG_STOPWORDS.has(term));
}

function getTokenDistance(a = '', b = '') {
	if (a === b) return 0;
	if (!a || !b) return Math.max(a.length, b.length);
	const maxDistance = Math.min(a.length, b.length) >= 6 ? FUZZY_LONG_TOKEN_MAX_DISTANCE : FUZZY_MAX_DISTANCE;
	const lengthDelta = Math.abs(a.length - b.length);
	if (lengthDelta > maxDistance) return lengthDelta;

	const rows = a.length + 1;
	const cols = b.length + 1;
	const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

	for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
	for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

	for (let i = 1; i < rows; i += 1) {
		let rowMin = matrix[i][0];
		for (let j = 1; j < cols; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1,
				matrix[i][j - 1] + 1,
				matrix[i - 1][j - 1] + cost
			);
			rowMin = Math.min(rowMin, matrix[i][j]);
		}
		if (rowMin > maxDistance) return rowMin;
	}

	return matrix[a.length][b.length];
}

function splitSearchTokens(value = '') {
	return splitTerms(value).filter((term) => term && !CATALOG_STOPWORDS.has(term));
}

function countTokenMatches({ fieldTokens = [], terms = [], allowFuzzy = false } = {}) {
	const tokenSet = new Set(fieldTokens);
	const direct = [];
	const fuzzy = [];

	for (const term of meaningfulTerms(terms)) {
		if (tokenSet.has(term)) {
			direct.push(term);
			continue;
		}

		if (!allowFuzzy || term.length < FUZZY_TOKEN_MIN_LENGTH) continue;

		const matched = fieldTokens.find((token) =>
			token.length >= FUZZY_TOKEN_MIN_LENGTH &&
			getTokenDistance(term, token) <= (Math.min(term.length, token.length) >= 6 ? FUZZY_LONG_TOKEN_MAX_DISTANCE : FUZZY_MAX_DISTANCE)
		);

		if (matched) fuzzy.push(`${term}:${matched}`);
	}

	return {
		direct: uniqueStrings(direct),
		fuzzy: uniqueStrings(fuzzy)
	};
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
	const raw = normalizeText(value);
	if (!raw) return null;

	const normalized = raw
		.replace(/\bnegra\b/g, 'negro')
		.replace(/\bblanca\b/g, 'blanco');

	if (!COLOR_PATTERNS.test(normalized)) return null;
	return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeVariantLabel(value = '') {
	return normalizeSpacing(localizedValue(value));
}

function isColorOptionName(value = '') {
	const normalized = normalizeText(value);
	return /\b(color|colour|tono|tonalidad)\b/.test(normalized);
}

function isSizeOptionName(value = '') {
	const normalized = normalizeText(value);
	return /\b(talle|talla|size|tamano|medida)\b/.test(normalized);
}

function extractColorLabels(value = '') {
	const normalized = normalizeText(value)
		.replace(/\bnegra\b/g, 'negro')
		.replace(/\bblanca\b/g, 'blanco');
	const matches = normalized.match(/negro|blanco|beige|avellana|marron|nude|rosa|gris|azul|verde|bordo|chocolate/g);
	return uniqueStrings(
		(matches || []).map((color) => color.charAt(0).toUpperCase() + color.slice(1))
	);
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

	const matches = [...normalized.matchAll(
		/(^|[^A-Z0-9])(TALLE UNICO|TALLE 1|TALLE 2|TALLE 3|TALLE 4|5XL\/6XL|4XL|3XL\/4XL|2XL\/3XL|XL\/2XL|XL\/XXL|L\/XL|M\/L|S\/M|XXXL|XXL|XL|XS|L|M|S|110)(?=$|[^A-Z0-9])/g
	)];

	return uniqueStrings(matches.map((match) => match[2]));
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
	return extractAtomicSizes(meta.description || '');
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

function extractVariantMeta(variants = [], { family = null, attributes = [] } = {}) {
	const flat = parseJsonArray(variants);
	const optionDefinitions = parseJsonArray(attributes);
	const optionNames = optionDefinitions.map((attribute) => normalizeVariantLabel(attribute?.name || attribute));
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

	const pushColorValue = (rawValue) => {
		const cleaned = normalizeVariantLabel(rawValue);
		if (!cleaned || isGenericVariantValue(cleaned)) return;

		const knownColors = extractColorLabels(cleaned);
		if (knownColors.length) {
			for (const color of knownColors) colorSet.add(color);
			return;
		}

		if (!looksLikeInternalCode(cleaned) && cleaned.length <= 80) {
			colorSet.add(cleaned);
		}
	};

	const pushSizeValue = (rawValue) => {
		const cleaned = normalizeVariantLabel(rawValue);
		if (!cleaned || isGenericVariantValue(cleaned)) return;

		const sizes = extractTextSizes(cleaned, family);
		if (sizes.length) {
			for (const size of sizes) sizeSet.add(size);
			return;
		}

		if (!looksLikeInternalCode(cleaned) && cleaned.length <= 40) {
			sizeSet.add(normalizeSizeLabel(cleaned));
		}
	};

	const pushPlainValue = (rawValue, optionName = '') => {
		const cleaned = normalizeVariantLabel(rawValue);
		if (!cleaned) return;

		if (looksLikeSkuCode(cleaned)) {
			pushSkuMeta(cleaned);
			return;
		}

		if (isGenericVariantValue(cleaned)) return;

		if (isColorOptionName(optionName)) {
			pushColorValue(cleaned);
		} else if (isSizeOptionName(optionName)) {
			pushSizeValue(cleaned);
		}

		for (const color of extractColorLabels(cleaned)) {
			colorSet.add(color);
		}

		for (const size of extractTextSizes(cleaned, family)) {
			sizeSet.add(size);
		}

		if (!looksLikeInternalCode(cleaned) && cleaned.length <= 80) {
			hintSet.add(cleaned);
		}
	};

	for (const attribute of optionDefinitions) {
		const optionName = normalizeVariantLabel(attribute?.name || attribute);
		const values = Array.isArray(attribute?.values) ? attribute.values : [];
		for (const value of values) {
			pushPlainValue(value, optionName);
		}
	}

	for (const variant of flat) {
		if (variant?.sku) pushSkuMeta(variant.sku);
		if (variant?.option1) pushPlainValue(variant.option1, optionNames[0]);
		if (variant?.option2) pushPlainValue(variant.option2, optionNames[1]);
		if (variant?.option3) pushPlainValue(variant.option3, optionNames[2]);

		if (Array.isArray(variant?.values)) {
			for (const [index, value] of variant.values.entries()) {
				pushPlainValue(value, optionNames[index]);
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
	const storefrontFacts = product.commercialData?.storefrontFacts || {};
	const enriched = [
		description,
		storefrontFacts.summary,
		storefrontFacts.includes,
		storefrontFacts.usage,
		storefrontFacts.ingredients
	].filter(Boolean).join(' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (!enriched) return 'Sin descripcion cargada.';
	return enriched.length > 320 ? `${enriched.slice(0, 317)}...` : enriched;
}

function storefrontFactsText(product = {}) {
	const facts = product.commercialData?.storefrontFacts || {};
	const faq = Array.isArray(facts.faq)
		? facts.faq.map((item) => `${item.question || ''} ${item.answer || ''}`).join(' ')
		: '';
	return [facts.summary, facts.includes, facts.usage, facts.ingredients, facts.packLabel, faq]
		.filter(Boolean)
		.join(' ');
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

function resolveVariantAvailability(variants = []) {
	const normalized = Array.isArray(variants) ? variants : [];
	const signals = normalized
		.map((variant) => {
			if (!variant || typeof variant !== 'object') return null;

			if (typeof variant.available === 'boolean') {
				return variant.available;
			}

			const quantities = [variant.stock, variant.inventory_management ? variant.inventory_quantity : null, variant.quantity]
				.map((value) => (value === '' || value == null ? null : Number(value)))
				.filter((value) => Number.isFinite(value));

			if (quantities.length) return quantities[0] > 0;
			return null;
		})
		.filter((value) => value !== null);

	if (!signals.length) return null;

	const availableCount = signals.filter(Boolean).length;
	if (!availableCount) return 'No disponible según las variantes sincronizadas.';
	if (availableCount === signals.length) return 'Disponible según las variantes sincronizadas.';
	return `Disponible en ${availableCount} de ${signals.length} variantes sincronizadas.`;
}

export function detectRequestedSignals(query = '', interestedProducts = [], { aiProfile = '' } = {}) {
	const normalizedQuery = normalizeText(query);
	const attachmentPlaceholder = /^\[(imagen|documento|audio|video|sticker|archivo)\s+recibid[oa]/i.test(
		String(query || '').trim()
	);
	const terms = [
		...new Set([
			...splitTerms(query),
			...(Array.isArray(interestedProducts)
				? interestedProducts.flatMap((v) => splitTerms(v)).filter(Boolean)
				: [])
		])
	];
	const requestedFamily = inferCommercialFamily([query, ...(interestedProducts || [])].join(' '), { aiProfile });

	return {
		normalizedQuery,
		terms,
		requestedFamily,
		asksCatalog: /(catalogo|catálogo|servicio|servicios|opciones|ver productos|(?:qu[eé])\s+(?:productos?|opciones?).*(?:tienen|hay|venden|ofrecen)|qu[eé]\s+tienen|qu[eé]\s+seguros|seguros que tienen|polizas|p[oó]lizas)/i.test(normalizedQuery),
		asksInsurance: /(seguro|seguros|poliza|p[oó]liza|polizas|p[oó]lizas|salud|medico|m[eé]dico|dental|decesos|hogar|vida|renta|autonomo|aut[oó]nomo|autonomos|aut[oó]nomos|pyme|pymes|empresa|empresas)/i.test(normalizedQuery),
		asksPromo: /(oferta|promo|promocion|pack|combo|2x1|3x1|5x2|cinco por dos)/i.test(normalizedQuery),
		asksPrice: /(precio|cuanto|sale|valor)/i.test(normalizedQuery),
		asksLink: /(pasame|mandame|enviame).*(link|url)|\b(link|url|web|tienda|comprar)\b/i.test(normalizedQuery),
		asksImage: !attachmentPlaceholder && /(foto|fotos|imagen|imagenes|video|ver como queda|como se ve|me lo mostras|me la mostras|tenes foto|tenes imagen)/i.test(normalizedQuery),
		asksComparison: /(cual|conviene|mejor|diferencia|compar)/i.test(normalizedQuery),
		hasVariantSpecificity: /(talle|medida|size|xl|xxl|xxxl|color|negro|blanco|beige|nude|rosa|gris|azul|verde|bordo)/i.test(normalizedQuery)
	};
}

function shouldSkipCatalogLookup(signals = {}) {
	const query = String(signals.normalizedQuery || '').trim();
	if (!query) return true;

	const terms = meaningfulTerms(signals.terms || []);
	if (!terms.length) return true;

	const hasCommercialSignal =
		Boolean(signals.requestedFamily) ||
		signals.asksCatalog ||
		signals.asksInsurance ||
		signals.asksPromo ||
		signals.asksPrice ||
		signals.asksLink ||
		signals.asksImage ||
		signals.asksComparison ||
		signals.hasVariantSpecificity;

	if (terms.some((term) => term.length >= STRONG_PRODUCT_TOKEN_MIN_LENGTH)) return false;
	return !hasCommercialSignal && terms.length < 2;
}

function isSpecificCatalogRequest(signals = {}) {
	const terms = meaningfulTerms(signals.terms || []);
	if (
		signals.asksCatalog &&
		!signals.requestedFamily &&
		!signals.asksPrice &&
		!signals.asksLink &&
		!signals.asksImage &&
		!signals.asksComparison &&
		!signals.hasVariantSpecificity
	) {
		return false;
	}
	if (signals.asksComparison || signals.hasVariantSpecificity) return true;
	if (signals.asksImage && terms.length >= 2) return true;
	if (signals.asksLink && terms.length >= 2) return true;
	if (signals.asksPrice && terms.length >= 2) return true;
	// A two-word product request such as "mascarilla colageno" is already
	// specific. Requiring three tokens allowed unrelated products to pass the
	// base published/image/url score when the requested product was absent.
	return terms.length >= 2 || terms.some((term) => term.length >= STRONG_PRODUCT_TOKEN_MIN_LENGTH);
}

function inferOfferType(product = {}) {
	const primaryHaystack = normalizeText([
		product.name,
		product.handle,
		product.tags
	].filter(Boolean).join(' '));

	const secondaryHaystack = normalizeText([
		product.description,
		JSON.stringify(product.attributes || []),
		JSON.stringify(product.variants || []),
		storefrontFactsText(product),
		product.commercialData?.presentationLabel,
		product.commercialData?.offerLabel
	].filter(Boolean).join(' '));

	if (/5x2|cinco por dos/.test(primaryHaystack)) return '5x2';
	if (/3x1|tres por uno/.test(primaryHaystack)) return '3x1';
	if (/2x1|dos por uno/.test(primaryHaystack)) return '2x1';

	if (/5x2|cinco por dos/.test(secondaryHaystack)) return '5x2';
	if (/3x1|tres por uno/.test(secondaryHaystack)) return '3x1';
	if (/2x1|dos por uno/.test(secondaryHaystack)) return '2x1';

	if (/pack|combo|promo|promocion|oferta/.test(primaryHaystack)) return 'pack';
	if (/pack|combo|promo|promocion|oferta/.test(secondaryHaystack)) return 'pack';
	return 'single';
}

function inferPackCountFromText(value = '') {
	const text = normalizeText(value).replace(/\s+/g, ' ');
	if (!text) return null;

	const patterns = [
		/\bpack\s*(?:x|de)?\s*(\d{1,2})\b/,
		/\b(?:x|de)\s*(\d{1,2})\s*(?:unidades?|unid|uds?|u)\b/,
		/\b(\d{1,2})\s*(?:unidades?|unid|uds?|mascarillas?|sobres?|parches?|piezas?|pares)\b/,
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		const count = Number(match?.[1] || 0);
		if (Number.isInteger(count) && count > 1 && count <= 100) return count;
	}

	return null;
}

function inferPackCount(offerType = 'single', product = {}) {
	if (offerType === '5x2') return 5;
	if (offerType === '3x1') return 3;
	if (offerType === '2x1') return 2;
	const text = [
		product.commercialData?.presentationLabel,
		product.commercialData?.offerLabel,
		product.name,
		product.handle,
		product.tags,
		product.description,
		storefrontFactsText(product),
		JSON.stringify(product.attributes || []),
		JSON.stringify(product.variants || []),
	].filter(Boolean).join(' ');
	const inferred = inferPackCountFromText(text);
	if (inferred) return inferred;
	if (offerType === 'pack') return null;
	return 1;
}

function resolveCommercialOverride(product = {}, now = new Date()) {
	const source = product.commercialData && typeof product.commercialData === 'object' && !Array.isArray(product.commercialData)
		? product.commercialData
		: {};
	const startsAt = source.offerStartsAt ? new Date(source.offerStartsAt) : null;
	const endsAt = source.offerEndsAt ? new Date(source.offerEndsAt) : null;
	const offerWindowOpen = (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now);
	const offerLabel = offerWindowOpen ? normalizeSpacing(source.offerLabel || '') : '';
	const offerPrice = offerWindowOpen ? toNumberOrNull(source.offerPrice) : null;
	const unitsPerPack = Number(source.unitsPerPack);
	return {
		presentationLabel: normalizeSpacing(source.presentationLabel || source.storefrontFacts?.packLabel || ''),
		unitsPerPack: Number.isInteger(unitsPerPack) && unitsPerPack > 1 ? unitsPerPack : null,
		offerLabel,
		offerPrice: offerPrice != null && offerPrice > 0 ? offerPrice : null,
		offerActive: Boolean(offerLabel || (offerPrice != null && offerPrice > 0))
	};
}

function normalizeOfferSignature(product = {}) {
	return [
		normalizeText(product.family || ''),
		normalizeText(product.offerType || ''),
		normalizeText(product.name || ''),
		normalizeText(product.price || '')
	].join('::');
}

function countDirectTermMatches(product = {}, terms = []) {
	const haystacks = [
		normalizeText(product.name || ''),
		normalizeText(product.handle || ''),
		normalizeText(product.tags || ''),
		normalizeText(product.description || ''),
		normalizeText(storefrontFactsText(product))
	];

	let matches = 0;
	for (const term of terms) {
		if (!term || CATALOG_STOPWORDS.has(term)) continue;
		if (haystacks.some((value) => value.includes(term))) matches += 1;
	}

	return matches;
}

function buildProductMatchMeta(product = {}, terms = [], normalizedQuery = '') {
	const name = normalizeText(product.name || '');
	const handle = normalizeText(product.handle || '');
	const tags = normalizeText(product.tags || '');
	const description = normalizeText(product.description || '');
	const storefrontFacts = normalizeText(storefrontFactsText(product));
	const primaryTokens = splitSearchTokens(`${name} ${handle}`);
	const secondaryTokens = splitSearchTokens(`${tags} ${description} ${storefrontFacts}`);
	const primaryMatches = countTokenMatches({ fieldTokens: primaryTokens, terms, allowFuzzy: true });
	const secondaryMatches = countTokenMatches({ fieldTokens: secondaryTokens, terms, allowFuzzy: false });
	const directTermMatches = uniqueStrings([...primaryMatches.direct, ...secondaryMatches.direct]).length;
	const fuzzyTermMatches = primaryMatches.fuzzy.length;
	const strongTokenMatch = meaningfulTerms(terms).some((term) =>
		term.length >= STRONG_PRODUCT_TOKEN_MIN_LENGTH &&
		(name.includes(term) || handle.includes(term))
	);
	const fullQueryMatch = Boolean(
		normalizedQuery &&
		[name, handle, tags, description, storefrontFacts].some((value) => value.includes(normalizedQuery))
	);

	return {
		directTermMatches,
		fuzzyTermMatches,
		strongTokenMatch,
		fullQueryMatch,
		matchedTerms: uniqueStrings([...primaryMatches.direct, ...secondaryMatches.direct]),
		fuzzyMatchedTerms: primaryMatches.fuzzy
	};
}

function shouldFilterGiftLikeProduct(product = {}, family = null, offerType = 'single') {
	const haystack = normalizeText([
		product.name,
		product.handle,
		product.tags,
		product.description
	].filter(Boolean).join(' '));

	if (/mes de la mujer/.test(haystack)) return true;
	if (/gift card|tarjeta regalo|tarjeta de regalo/.test(haystack)) return true;
	if (/segunda piel de regalo/.test(haystack) && !family) return true;
	return false;
}

function scoreProduct(product, normalizedQuery, terms = [], signals = {}) {
	let score = 0;
	const scope = { aiProfile: signals.aiProfile || '' };
	const guessedFamily =
		signals.requestedFamily ||
		inferCommercialFamily([product.name, product.tags, product.handle, product.description].filter(Boolean).join(' '), scope);

	const variantMeta = extractVariantMeta(product.variants, { family: guessedFamily, attributes: product.attributes });

	const name = normalizeText(product.name || '');
	const brand = normalizeText(product.brand || '');
	const tags = normalizeText(product.tags || '');
	const description = normalizeText(product.description || '');
	const handle = normalizeText(product.handle || '');
	const matchMeta = buildProductMatchMeta(product, terms, normalizedQuery);
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
	if (matchMeta.strongTokenMatch) score += 14;
	score += matchMeta.directTermMatches * 6;
	score += matchMeta.fuzzyTermMatches * 8;

	for (const term of terms) {
		if (name.includes(term)) score += 5;
		if (brand.includes(term)) score += 2;
		if (tags.includes(term)) score += 4;
		if (description.includes(term)) score += 2;
		if (handle.includes(term)) score += 3;
		if (variantBlob.includes(term)) score += 5;
	}

	if (signals.asksPromo) {
		if (/(oferta|promo|pack|combo|2x1|3x1|5x2)/i.test(name)) score += 20;
		if (/(oferta|promo|pack|combo|2x1|3x1|5x2)/i.test(tags)) score += 16;
		if (/(oferta|promo|pack|combo|2x1|3x1|5x2)/i.test(variantBlob)) score += 14;
	}

	if (signals.requestedFamily && inferCommercialFamily(name, scope) === signals.requestedFamily) {
		score += 20;
	}

	if (signals.hasVariantSpecificity && /(negro|blanco|beige|nude|rosa|gris|azul|verde|bordo|xl|xxl|xxxl|s\/m|m\/l|l\/xl)/i.test(variantBlob)) {
		score += 14;
	}

	if (signals.asksComparison && product.productUrl) score += 4;
	if (product.published) score += 2;
	if (product.featuredImage) score += 1;
	if (product.productUrl) score += 1;

	return score;
}

export async function getCatalogLookupStatus({ workspaceId } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	try {
		const [totalProducts, totalPublished, latestProduct] = await Promise.all([
			prisma.catalogProduct.count({ where: { workspaceId: resolvedWorkspaceId } }),
			prisma.catalogProduct.count({ where: { workspaceId: resolvedWorkspaceId, published: true } }),
			prisma.catalogProduct.findFirst({
				where: { workspaceId: resolvedWorkspaceId, published: true },
				orderBy: { syncedAt: 'desc' },
				select: { syncedAt: true }
			})
		]);
		const lastSync = latestProduct?.syncedAt || null;
		const stale = !lastSync || Date.now() - new Date(lastSync).getTime() > 24 * 60 * 60 * 1000;

		return {
			ok: true,
			available: totalPublished > 0,
			reason: totalPublished > 0 ? 'catalog_ready' : 'catalog_empty',
			totalProducts,
			totalPublished,
			lastSync,
			stale,
			message: stale
				? 'El catálogo no se sincroniza desde hace más de 24 horas. No confirmes stock ni cambios recientes sin revisarlo.'
				: null
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
			lastSync: null,
			stale: true,
			message: 'No se pudo verificar la fecha de sincronización del catálogo.',
			error: message
		};
	}
}

export function rankCatalogProductsForSearch(rawProducts = [], signals = {}, { limit = 4, aiProfile = '' } = {}) {
	if (shouldSkipCatalogLookup(signals)) return [];
	const scope = { aiProfile: aiProfile || signals.aiProfile || '' };

	const ranked = rawProducts
		.map((product) => ({
			product,
			score: scoreProduct(product, signals.normalizedQuery, signals.terms, signals)
		}))
		.filter((entry) => entry.score > 0)
		.map(({ product, score }) => {
			const commercialOverride = resolveCommercialOverride(product);
			const catalogPrices = resolveCatalogPrices(product.price, product.compareAtPrice);
			const variantPriceRange = resolveVariantPriceRange(product.variants);
			const currentPrice = commercialOverride.offerPrice ?? catalogPrices.currentPrice;
			const originalPrice = commercialOverride.offerPrice != null && catalogPrices.currentPrice != null
				? catalogPrices.currentPrice
				: variantPriceRange ? null : catalogPrices.originalPrice;
			const shortDescription = buildShortDescription(product);
			const family = inferCommercialFamily(
				[product.name, product.tags, product.handle, shortDescription]
					.filter(Boolean)
					.join(' '),
				scope
			);
			const variantMeta = extractVariantMeta(product.variants, { family, attributes: product.attributes });
			const offerType = inferOfferType(product);
			const packCount = commercialOverride.unitsPerPack || inferPackCount(offerType, product);
			const offerLabel = commercialOverride.offerLabel || commercialOverride.presentationLabel ||
				(Number.isInteger(packCount) && packCount > 1
					? `Pack de ${packCount} unidades`
					: offerType === 'pack'
						? 'Pack con cantidad no confirmada'
						: offerType === '5x2' ? 'Promoción 5x2'
							: offerType === '3x1' ? 'Promoción 3x1'
								: offerType === '2x1' ? 'Promoción 2x1' : 'Unidad');
			const matchMeta = buildProductMatchMeta(product, signals.terms, signals.normalizedQuery);
			const profileScore = scoreProductAgainstCommercialProfile({
				name: product.name,
				handle: product.handle,
				tags: product.tags,
				shortDescription,
				storefrontFaq: Array.isArray(product.commercialData?.storefrontFacts?.faq)
					? product.commercialData.storefrontFacts.faq
					: [],
				variantHints: variantMeta.variantHints,
				colors: variantMeta.colors,
				sizes: variantMeta.sizes
			}, family, scope);

			return {
				id: product.id,
				productId: product.productId,
				name: product.name,
				brand: product.brand || null,
				price: commercialOverride.offerPrice != null
					? formatPrice(currentPrice)
					: variantPriceRange
						? `${formatPrice(variantPriceRange.min)} a ${formatPrice(variantPriceRange.max)}, según la variante`
						: formatPrice(currentPrice),
				priceValue: variantPriceRange && commercialOverride.offerPrice == null ? null : currentPrice,
				variantPriceRange: variantPriceRange ? {
					min: formatPrice(variantPriceRange.min),
					max: formatPrice(variantPriceRange.max),
				} : null,
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
				availabilityLabel: resolveVariantAvailability(product.variants),
				tags: product.tags
					? product.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 6)
					: [],
				score,
				family,
				offerType,
				packCount,
				offerLabel,
				manualOfferActive: commercialOverride.offerActive,
				manualOfferPriceActive: commercialOverride.offerPrice != null,
				commercialProfile: getCommercialProfile(family),
				commercialScoreBoost: profileScore,
				fullQueryMatch: matchMeta.fullQueryMatch,
				directTermMatches: Math.max(countDirectTermMatches(product, signals.terms), matchMeta.directTermMatches),
				fuzzyTermMatches: matchMeta.fuzzyTermMatches,
				strongTokenMatch: matchMeta.strongTokenMatch,
				matchedTerms: matchMeta.matchedTerms,
				fuzzyMatchedTerms: matchMeta.fuzzyMatchedTerms,
				isGiftLike: shouldFilterGiftLikeProduct(product, family, offerType)
			};
		})
		.filter((item) => !item.isGiftLike)
		.sort((a, b) => (b.score + b.commercialScoreBoost) - (a.score + a.commercialScoreBoost));

	const familyScopedRanked =
		signals.requestedFamily && ranked.some((item) => item.family === signals.requestedFamily)
			? ranked.filter((item) => item.family === signals.requestedFamily)
			: ranked;

	const deduped = [];
	const seen = new Set();

	for (const item of familyScopedRanked) {
		const signature = normalizeOfferSignature(item);
		if (seen.has(signature)) continue;
		seen.add(signature);
		deduped.push(item);
	}

	if (isSpecificCatalogRequest(signals)) {
		const strongest = deduped[0] || null;
		const hasStrongMatch = Boolean(
			strongest &&
			(
				strongest.fullQueryMatch ||
				strongest.directTermMatches >= 2 ||
				(strongest.directTermMatches >= 1 && strongest.fuzzyTermMatches >= 1) ||
				strongest.fuzzyTermMatches >= 2 ||
				strongest.strongTokenMatch ||
				strongest.score >= 26
			)
		);

		if (!hasStrongMatch) {
			return [];
		}
	}

	return deduped.slice(0, Math.max(limit, 6));
}

export async function searchCatalogProducts({ query = '', interestedProducts = [], limit = 4, workspaceId, aiProfile = '' } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const signals = {
		...detectRequestedSignals(query, interestedProducts, { aiProfile }),
		aiProfile,
	};
	if (shouldSkipCatalogLookup(signals)) return [];

	let rawProducts = [];
	try {
		rawProducts = await prisma.catalogProduct.findMany({
			where: { workspaceId: resolvedWorkspaceId, published: true },
			orderBy: [{ updatedAt: 'desc' }],
			take: signals.asksPromo || signals.requestedFamily ? 250 : 180
		});
	} catch (error) {
		logger.error('catalog.search_failed', { workspaceId: resolvedWorkspaceId, error });
		return [];
	}

	return rankCatalogProductsForSearch(rawProducts, signals, { limit, aiProfile });
}

export function buildCatalogContext(products = []) {
	if (!Array.isArray(products) || !products.length) {
		return 'No se encontraron productos relevantes del catalogo local para este mensaje.';
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

			if (product.offerLabel) lines.push(`   - Presentación/promoción: ${product.offerLabel}`);
			if (Number.isInteger(product.packCount) && product.packCount > 1) {
				lines.push(`   - El precio publicado corresponde a esa presentación; no hay precio unitario confirmado.`);
			} else if (product.offerType === 'pack') {
				lines.push(`   - Es un pack, pero la cantidad de unidades no está confirmada en los datos sincronizados.`);
			}
			if (product.manualOfferActive) {
				lines.push('   - Presentación/oferta confirmada y vigente en BladeIA.');
				if (product.manualOfferPriceActive) lines.push('   - El precio indicado es el precio de la oferta manual vigente.');
			}

			if (product.originalPrice) lines.push(`   - Precio anterior: ${product.originalPrice}`);
			if (product.variantPriceRange) lines.push('   - El precio cambia según la variante; confirma la presentación elegida antes de cerrar el monto.');
			if (product.colors?.length) lines.push(`   - Colores detectados: ${product.colors.join(', ')}`);
			if (product.sizes?.length) lines.push(`   - Talles disponibles: ${product.sizes.join(', ')}`);
			if (product.availabilityLabel) lines.push(`   - Disponibilidad: ${product.availabilityLabel}`);
			if (product.storefrontFaq?.length) {
				lines.push(`   - Preguntas frecuentes de la ficha: ${product.storefrontFaq
					.slice(0, 6)
					.map((item) => `${item.question}: ${item.answer}`)
					.join(' | ')}`);
			}
			return lines.join('\n');
		})
		.join('\n\n');
}

export function pickCommercialHints(products = [], commercialPlan = null, { aiProfile = '' } = {}) {
	if (!Array.isArray(products) || !products.length) return [];

	const hints = [];
	const family = commercialPlan?.productFamily || products[0]?.family || null;
	const scopedFamily = commercialFamilyAllowedForProfile(family, { aiProfile }) ? family : null;
	const profile = getCommercialProfile(scopedFamily);

	if (profile?.defaultPitch) hints.push(profile.defaultPitch);
	if (commercialPlan?.bestOffer?.name) hints.push(`Prioriza como oferta principal ${commercialPlan.bestOffer.name}.`);
	if (Array.isArray(commercialPlan?.bestOffer?.sizes) && commercialPlan.bestOffer.sizes.length) {
		hints.push(`Talles confirmados del producto foco: ${commercialPlan.bestOffer.sizes.join(', ')}.`);
	}
	if (Array.isArray(commercialPlan?.bestOffer?.colors) && commercialPlan.bestOffer.colors.length) {
		hints.push(`Colores confirmados del producto foco: ${commercialPlan.bestOffer.colors.join(', ')}.`);
	}

	if (Array.isArray(commercialPlan?.offerCandidates) && commercialPlan.offerCandidates.length > 1) {
		const labels = commercialPlan.offerCandidates
			.slice(0, 3)
			.map((option) => option.label)
			.filter(Boolean);

		if (labels.length) {
			hints.push(`Si abris opciones, mantenete dentro de la misma familia: ${labels.join(', ')}.`);
		}
	}

	if (commercialPlan?.requestedAction === 'ASK_OFFER') {
		hints.push('Mostra primero la oferta principal de esta familia; si no avanza, recien ahi abri la alternativa.');
	}

	if (commercialPlan?.requestedAction === 'ASK_IMAGE') {
		hints.push('Si pide fotos o imagenes, no prometas enviar imagenes ni inventes adjuntos; pasa solo el link real del producto foco.');
	}

	if (commercialPlan?.recommendedAction === 'present_offer_options_brief') {
		hints.push('Si comparas opciones, mostra solo 2 o 3 variantes de esa familia con precio corto y cierre de ayuda.');
	}

	if (commercialPlan?.requestedOfferType && commercialPlan?.requestedOfferAvailable === false) {
		hints.push(`No afirmes que existe una ${commercialPlan.requestedOfferType} exacta si no aparece confirmada en el catalogo.`);
	}

	if (commercialPlan?.requestedAction === 'ASK_VARIANT') {
		hints.push('Cuando hables de talles o colores, nombra talles humanos y no SKUs internos.');
	}

	if (commercialPlan?.shareLinkNow) {
		hints.push(profile?.linkHint || 'Comparti un unico link y solo del producto foco mas reciente.');
	} else {
		hints.push('No compartas link todavia si la conversacion sigue definiendo producto, variante o promo.');
	}

	hints.push('No abras varias promos salvo pedido explicito.');
	hints.push('No arranques con saludo repetido ni con claro, perfecto, genial o buenisimo.');
	hints.push('Nunca muestres SKUs internos al cliente como si fueran talles.');
	return hints;
}
