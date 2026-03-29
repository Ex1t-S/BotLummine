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

const COLOR_TERMS = ['negro', 'blanco', 'beige', 'avellana', 'marron', 'nude', 'rosa', 'gris', 'azul', 'verde', 'bordo'];
const SIZE_TERMS = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', 'm/l', 'l/xl', 'xl/xxl'];

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

function detectRequestedSignals(query = '', interestedProducts = []) {
	const normalizedQuery = normalizeText(query);
	const interestText = Array.isArray(interestedProducts) ? interestedProducts.join(' ') : '';
	const combined = `${normalizedQuery} ${normalizeText(interestText)}`.trim();
	const terms = splitTerms(combined);

	const requestedColors = COLOR_TERMS.filter((color) => combined.includes(color));
	const requestedSizes = SIZE_TERMS.filter((size) => combined.includes(size));

	let requestedFamily = null;
	if (/(body|bodies|body modelador|bodys modeladores|body reductor)/.test(combined)) {
		requestedFamily = 'body_modelador';
	} else if (/(short|faja short|short faja)/.test(combined)) {
		requestedFamily = 'short_faja';
	} else if (/(faja|reductor|reductora|cinturilla)/.test(combined)) {
		requestedFamily = 'faja';
	} else if (/(bombacha|colaless)/.test(combined)) {
		requestedFamily = 'bombacha_modeladora';
	}

	return {
		normalizedQuery,
		terms,
		requestedColors,
		requestedSizes,
		requestedFamily,
		asksPromo: /(promo|promocion|promoción|oferta|2x1|3x1|combo|pack)/.test(combined),
		asksPrice: /(precio|cuanto|cuánto|sale|valor)/.test(combined),
		asksLink: /(link|url|web|pagina|página|catalogo|catálogo|tienda)/.test(combined),
		asksComparison: /(que opciones|qué opciones|que promos|qué promos|alguna promo mas|alguna promo más|otras opciones|otras promos|mostrar|ver opciones)/.test(combined),
		hasVariantSpecificity: requestedColors.length > 0 || requestedSizes.length > 0,
		exactOfferRequested: /(2x1|3x1)/.exec(combined)?.[1] || null
	};
}

function inferProductFamily(product = {}) {
	const blob = normalizeText([
		product.name,
		product.tags,
		product.description,
		JSON.stringify(product.categories || []),
		JSON.stringify(product.attributes || [])
	].join(' '));

	if (/(body|bodies|body modelador|body reductor)/.test(blob)) return 'body_modelador';
	if (/(short|short faja|faja short)/.test(blob)) return 'short_faja';
	if (/(bombacha|colaless)/.test(blob)) return 'bombacha_modeladora';
	if (/(faja|reductora|reductor|cinturilla)/.test(blob)) return 'faja';
	return 'general';
}

function inferOfferMeta(product = {}) {
	const blob = normalizeText([product.name, product.tags, product.description].join(' '));
	if (/(3x1|tres por uno)/.test(blob)) return { offerType: 'pack_3x1', packCount: 3 };
	if (/(2x1|dos por uno)/.test(blob)) return { offerType: 'pack_2x1', packCount: 2 };
	if (/(pack|combo)/.test(blob)) return { offerType: 'pack', packCount: null };
	return { offerType: 'single', packCount: 1 };
}

function scoreProduct(product, signals, variantMeta) {
	let score = 0;

	const name = normalizeText(product.name || '');
	const brand = normalizeText(product.brand || '');
	const tags = normalizeText(product.tags || '');
	const description = normalizeText(product.description || '');
	const handle = normalizeText(product.handle || '');
	const variantBlob = normalizeText(
		JSON.stringify(product.variants || []) + ' ' + JSON.stringify(product.attributes || [])
	);

	if (!signals.normalizedQuery && !signals.terms.length) return 0;

	if (name.includes(signals.normalizedQuery)) score += 14;
	if (brand.includes(signals.normalizedQuery)) score += 6;
	if (tags.includes(signals.normalizedQuery)) score += 10;
	if (description.includes(signals.normalizedQuery)) score += 5;
	if (handle.includes(signals.normalizedQuery)) score += 6;
	if (variantBlob.includes(signals.normalizedQuery)) score += 8;

	for (const term of signals.terms) {
		if (name.includes(term)) score += 5;
		if (brand.includes(term)) score += 2;
		if (tags.includes(term)) score += 4;
		if (description.includes(term)) score += 2;
		if (handle.includes(term)) score += 3;
		if (variantBlob.includes(term)) score += 4;
	}

	const family = inferProductFamily(product);
	const offerMeta = inferOfferMeta(product);

	if (signals.requestedFamily && family === signals.requestedFamily) {
		score += 28;
	}

	if (signals.requestedColors.length) {
		const matchesColor = signals.requestedColors.some((color) =>
			variantMeta.colors.some((value) => normalizeText(value).includes(color))
		);
		score += matchesColor ? 24 : -12;
	}

	if (signals.requestedSizes.length) {
		const matchesSize = signals.requestedSizes.some((size) =>
			variantMeta.sizes.some((value) => normalizeText(value).includes(size))
		);
		score += matchesSize ? 20 : -10;
	}

	if (signals.exactOfferRequested) {
		if (offerMeta.offerType === `pack_${signals.exactOfferRequested}`) score += 30;
		else if (offerMeta.offerType.startsWith('pack_')) score -= 8;
	} else if (signals.asksPromo || signals.asksPrice || signals.asksComparison) {
		if (product.compareAtPrice != null) score += 12;
		if (offerMeta.offerType === 'pack_3x1') score += 14;
		if (offerMeta.offerType === 'pack_2x1') score += 10;
	} else {
		if (offerMeta.offerType === 'single') score += 12;
		if (offerMeta.offerType.startsWith('pack')) score -= 10;
	}

	if (product.published) score += 2;
	if (product.featuredImage) score += 1;
	if (product.productUrl) score += 1;

	return {
		score,
		family,
		offerMeta
	};
}

function formatOfferLabel(offerType = 'single') {
	if (offerType === 'pack_3x1') return '3x1';
	if (offerType === 'pack_2x1') return '2x1';
	if (offerType === 'pack') return 'pack';
	return 'individual';
}

export async function searchCatalogProducts({
	query = '',
	interestedProducts = [],
	limit = 4
} = {}) {
	const signals = detectRequestedSignals(query, interestedProducts);

	if (!signals.normalizedQuery && !signals.terms.length) {
		return [];
	}

	const rawProducts = await prisma.catalogProduct.findMany({
		where: {
			published: true
		},
		orderBy: [{ updatedAt: 'desc' }],
		take: 120
	});

	return rawProducts
		.map((product) => {
			const variantMeta = extractVariantMeta(product.variants);
			const { score, family, offerMeta } = scoreProduct(product, signals, variantMeta);
			return {
				product,
				score,
				family,
				offerMeta,
				variantMeta
			};
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({ product, score, family, offerMeta, variantMeta }) => {
			const { currentPrice, originalPrice } = resolveCatalogPrices(product.price, product.compareAtPrice);

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
				family,
				offerType: offerMeta.offerType,
				offerLabel: formatOfferLabel(offerMeta.offerType),
				packCount: offerMeta.packCount,
				score
			};
		});
}

export function buildCatalogContext(products = [], commercialPlan = null) {
	if (!Array.isArray(products) || !products.length) {
		return 'No se encontraron productos relevantes del catálogo local para este mensaje.';
	}

	const includeLinks = Boolean(commercialPlan?.shareLinkNow);

	return products
		.map((product, index) => {
			const lines = [
				`${index + 1}. ${product.name}`,
				`   - Familia: ${product.family || 'general'}`,
				`   - Tipo de oferta: ${product.offerLabel || 'individual'}`,
				`   - Precio actual: ${product.price || 'No informado'}`,
				`   - Resumen: ${product.shortDescription}`
			];

			if (includeLinks && product.productUrl) {
				lines.push(`   - Link: ${product.productUrl}`);
			}

			if (product.originalPrice) {
				lines.push(`   - Precio anterior: ${product.originalPrice}`);
			}

			if (product.colors?.length) {
				lines.push(`   - Colores detectados: ${product.colors.join(', ')}`);
			}

			if (product.sizes?.length) {
				lines.push(`   - Talles detectados: ${product.sizes.join(', ')}`);
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
	const briefOptions = Array.isArray(commercialPlan?.offerOptions) ? commercialPlan.offerOptions : [];

	if (commercialPlan?.recommendedAction === 'guide_and_discover') {
		hints.push('Respondé primero con orientación breve. Antes de cerrar una promo, explicá que hay opción individual y promos más elegidas.');
		hints.push('Podés invitar a ver la web o catálogo, pero quedate disponible para ayudar a elegir por WhatsApp.');
	}

	if (commercialPlan?.recommendedAction === 'present_offer_options_brief' && briefOptions.length) {
		hints.push(`Contá como mucho 2 o 3 opciones breves: ${briefOptions.map((option) => `${option.label}${option.price ? ` (${option.price})` : ''}`).join(' | ')}.`);
	}

	if (commercialPlan?.productFocus) {
		hints.push(`Mantené el foco en ${commercialPlan.productFocus}, no en una promo distinta.`);
	}

	if (commercialPlan?.requestedVariant?.color || commercialPlan?.requestedVariant?.size) {
		const parts = [];
		if (commercialPlan.requestedVariant.color) parts.push(`color ${commercialPlan.requestedVariant.color}`);
		if (commercialPlan.requestedVariant.size) parts.push(`talle ${commercialPlan.requestedVariant.size}`);
		hints.push(`Respetá la especificidad pedida por la clienta (${parts.join(', ')}).`);
	}

	if (commercialPlan?.shareLinkNow) {
		hints.push('Compartí un solo link, del producto que ya quedó acordado.');
	} else {
		hints.push('Mantené el link guardado para cuando lo pidan o cuando la conversación ya esté lista para comprar.');
	}

	if (commercialPlan?.repeatPriceNow) {
		hints.push('Respondé el precio una sola vez y después avanzá al siguiente paso natural.');
	}

		hints.push('Abrí directo con información útil, sin saludo repetido ni muletillas como claro, perfecto, genial o buenísimo.');
		hints.push('Si la clienta pide opciones, hablá en tono conversado y breve, no como una lista de catálogo.');

	return hints;
}
