import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { getTiendanubeClient } from '../tiendanube/client.js';
import { getShopifyClient } from '../shopify/client.js';
import { resolveActiveCommerceConnection } from '../commerce/active-commerce.service.js';
import { normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import { requireWorkspaceScope, workspaceOwnedWhere } from '../workspaces/workspace-scope.js';
import { fetchWithTimeout, getHttpTimeoutMs } from '../../lib/http-timeout.js';
import { load } from 'cheerio';
import {
	getSkuVariantMeta,
	isGenericSkuColor,
	normalizeSku,
} from '../../data/sku-size-map.js';

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSpacing(value = '') {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeProductDescription(value = '') {
	const raw = String(value || '').trim();
	if (!raw) return null;

	// Some storefronts include merchandising JavaScript in the description
	// field. It is not product data and must never reach the AI context.
	if (/<script\b|window\.|document\.|WIGY_CONFIG|addEventListener|function\s*\(|(?:const|let|var)\s+[A-Z_][\w]*\s*=/i.test(raw)) {
		return null;
	}

	const $ = load(`<div id="bladeia-product-description">${raw}</div>`);
	$('#bladeia-product-description script, #bladeia-product-description style, #bladeia-product-description noscript, #bladeia-product-description template').remove();
	const text = normalizeSpacing($('#bladeia-product-description').text());
	return text ? text.slice(0, 5000) : null;
}

function normalizeStorefrontFacts(facts = null) {
	if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return null;
	const clean = (value, limit = 900) => normalizeSpacing(value).slice(0, limit) || null;
	const sourceUrl = clean(facts.sourceUrl, 500);
	const fetchedAt = facts.fetchedAt ? new Date(facts.fetchedAt) : null;
	const faq = Array.isArray(facts.faq)
		? facts.faq
			.map((item) => ({
				question: clean(item?.question, 180),
				answer: clean(item?.answer, 700)
			}))
			.filter((item) => item.question && item.answer)
			.slice(0, 8)
		: [];
	if (!sourceUrl || !clean(facts.summary) && !clean(facts.usage) && !clean(facts.includes) && !faq.length) return null;
	return {
		sourceUrl,
		fetchedAt: fetchedAt && Number.isFinite(fetchedAt.getTime()) ? fetchedAt.toISOString() : null,
		summary: clean(facts.summary),
		usage: clean(facts.usage),
		includes: clean(facts.includes),
		ingredients: clean(facts.ingredients),
		packLabel: clean(facts.packLabel, 180),
		faq
	};
}

function mergeCommercialData(existing = null, storefrontFacts = null) {
	const current = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
	const normalizedFacts = normalizeStorefrontFacts(storefrontFacts);
	if (!normalizedFacts) return Object.keys(current).length ? current : null;
	return { ...current, storefrontFacts: normalizedFacts };
}

function sameSourceProduct(existing, product) {
	const raw = existing?.rawPayload;
	if (!raw || !product) return false;
	const existingUpdatedAt = raw.updated_at || raw.updatedAt || raw.date_modified || null;
	const productUpdatedAt = product.updated_at || product.updatedAt || product.date_modified || null;
	if (existingUpdatedAt && productUpdatedAt) {
		return String(existingUpdatedAt) === String(productUpdatedAt);
	}
	const comparable = (value) => JSON.stringify({
		id: value?.id ?? null,
		name: value?.name ?? value?.title ?? null,
		handle: value?.handle ?? null,
		description: value?.description ?? value?.body_html ?? null,
		price: value?.price ?? null,
		promotional_price: value?.promotional_price ?? value?.compare_at_price ?? null,
		variants: value?.variants ?? [],
		images: value?.images ?? [],
		tags: value?.tags ?? null,
		status: value?.status ?? value?.published ?? null
	});
	return comparable(raw) === comparable(product);
}

function extractStorefrontFacts(html, { sourceUrl, productName = '' } = {}) {
	const $ = load(html);
	$('script,style,noscript,header,footer,nav,[role="navigation"],.shopify-section-header,.shopify-section-footer').remove();
	const main = $('main').first();
	if (!main.length) return null;
	const pageHeading = normalizeSpacing(main.find('h1').first().text());
	const cleanName = normalizeSpacing(productName).toLowerCase();
	if (cleanName && pageHeading && !pageHeading.toLowerCase().includes(cleanName.slice(0, 18))) return null;

	const sections = [];
	main.find('h2,h3,h4').each((_index, heading) => {
		const title = normalizeSpacing($(heading).text());
		if (!title || title.length > 180) return;
		const parent = $(heading).parent();
		const parentBody = normalizeSpacing(parent.text()).slice(title.length).trim();
		const nextBody = normalizeSpacing(parent.nextUntil('h2,h3,h4').text());
		const body = parentBody || nextBody;
		if (body && body.length <= 1500) sections.push({ title, body });
	});
	const getSection = (pattern) => sections.find((section) => pattern.test(section.title))?.body || null;
	const faq = [];
	main.find('details').each((_index, details) => {
		const question = normalizeSpacing($(details).find('summary').first().text());
		const answer = normalizeSpacing($(details).text().replace(question, '')).slice(0, 700);
		if (question && answer && /[?¿]/.test(question)) faq.push({ question, answer });
	});
	for (const section of sections) {
		if (faq.length >= 8) break;
		if (/[?¿]/.test(section.title) && section.body) faq.push({ question: section.title, answer: section.body });
	}
	const description = normalizeSpacing(main.find('.product__description,[itemprop="description"],.product-description').first().text());
	const summary = description || sections
		.filter((section) => !/(reseñas|reviews|antes y después|customer reviews)/i.test(section.title))
		.map((section) => `${section.title}: ${section.body}`)
		.join(' ');
	const includes = getSection(/(?:qué incluye|que incluye|contenido|presentaci[oó]n)/i)
		|| faq.find((item) => /(?:qué incluye|que incluye)/i.test(item.question))?.answer
		|| null;
	const usage = getSection(/(?:c[oó]mo se usa|modo de uso|aplicaci[oó]n)/i)
		|| faq.find((item) => /(?:c[oó]mo se usa|frecuencia|enjuag)/i.test(item.question))?.answer
		|| null;
	const ingredients = getSection(/(?:ingredientes|f[oó]rmula|composici[oó]n)/i) || null;
	const exactPack = [description, includes, ...faq.map((item) => item.answer)]
		.filter(Boolean).join(' ')
		.match(/\bpack\s*(?:x|de)?\s*(\d{1,2})\s*(?:unidades?|mascarillas?|sobres?|parches?|piezas?|pares)\b/i);
	return normalizeStorefrontFacts({
		sourceUrl,
		fetchedAt: new Date().toISOString(),
		summary: summary.slice(0, 900),
		usage,
		includes,
		ingredients,
		packLabel: exactPack?.[0] || null,
		faq
	});
}

function isAllowedProductUrl(productUrl, config) {
	try {
		const url = new URL(productUrl);
		if (url.protocol !== 'https:') return false;
		const allowedHosts = [config?.shopDomain, config?.storeUrl]
			.filter(Boolean)
			.map((value) => {
				try { return new URL(String(value).startsWith('http') ? value : `https://${value}`).hostname; } catch { return null; }
			})
			.filter(Boolean);
		return allowedHosts.includes(url.hostname);
	} catch {
		return false;
	}
}

async function fetchStorefrontFacts(normalized, config) {
	if (!normalized?.productUrl || !isAllowedProductUrl(normalized.productUrl, config)) return null;
	try {
		let currentUrl = normalized.productUrl;
		let response = null;
		for (let redirects = 0; redirects < 4; redirects += 1) {
			if (!isAllowedProductUrl(currentUrl, config)) return null;
			response = await fetchWithTimeout(currentUrl, {
				method: 'GET',
				redirect: 'manual',
				headers: {
					'User-Agent': 'BladeIA Catalog Sync',
					Accept: 'text/html,application/xhtml+xml'
				}
			}, getHttpTimeoutMs('CATALOG_DETAIL_TIMEOUT_MS', 8000));
			if (![301, 302, 303, 307, 308].includes(response.status)) break;
			const location = response.headers.get('location');
			if (!location) return null;
			currentUrl = new URL(location, currentUrl).toString();
		}
		if (!response || [301, 302, 303, 307, 308].includes(response.status)) return null;
		if (!response.ok) return null;
		if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) return null;
		const maxBytes = Number(process.env.CATALOG_DETAIL_MAX_BYTES || 750000);
		if (Number(response.headers.get('content-length') || 0) > maxBytes) return null;
		const html = String(await response.text() || '').slice(0, maxBytes);
		return extractStorefrontFacts(html, { sourceUrl: currentUrl, productName: normalized.name });
	} catch (error) {
		logger.warn('catalog.storefront_detail_fetch_failed', {
			productId: normalized.productId,
			url: normalized.productUrl,
			error: error?.message || String(error)
		});
		return null;
	}
}

function pickLocalized(value) {
	if (value == null) return null;
	if (typeof value === 'string') return value;

	if (typeof value === 'object') {
		return (
			value.es ||
			value['es_AR'] ||
			value['es-AR'] ||
			value.en ||
			value.pt ||
			Object.values(value).find((v) => typeof v === 'string') ||
			null
		);
	}

	return null;
}

function toNumberOrNull(value) {
	if (value == null || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function resolveCatalogPrices(baseValue, promoValue) {
	const base = toNumberOrNull(baseValue);
	const promo = toNumberOrNull(promoValue);

	if (base != null && promo != null) {
		if (promo > 0 && promo < base) {
			return {
				currentPrice: promo,
				originalPrice: base
			};
		}

		if (base > 0 && base < promo) {
			return {
				currentPrice: base,
				originalPrice: promo
			};
		}

		return {
			currentPrice: base,
			originalPrice: null
		};
	}

	if (promo != null) {
		return {
			currentPrice: promo,
			originalPrice: null
		};
	}

	if (base != null) {
		return {
			currentPrice: base,
			originalPrice: null
		};
	}

	return {
		currentPrice: null,
		originalPrice: null
	};
}

function looksLikeSkuCode(value = '') {
	return /^[A-Z]{1,8}-\d{3,}$/i.test(normalizeSku(value));
}

function normalizeColorLabel(value = '') {
	const raw = normalizeSpacing(value).toLowerCase();
	if (!raw) return null;

	const normalized = raw
		.replace(/\bnegra\b/g, 'negro')
		.replace(/\bblanca\b/g, 'blanco');

	if (!/(negro|blanco|beige|avellana|marron|marrón|nude|rosa|gris|azul|verde|bordo|chocolate)/i.test(normalized)) {
		return null;
	}

	return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeSizeLabel(value = '') {
	return normalizeSpacing(value)
		.toUpperCase()
		.replace(/\s*\/\s*/g, '/')
		.replace(/\bML\b/g, 'M/L')
		.replace(/\bSM\b/g, 'S/M')
		.replace(/\bP\/M\b/g, 'M/L')
		.replace(/\bG\/GG\b/g, 'XL/2XL');
}

function extractAtomicSizes(value = '') {
	const normalized = normalizeSizeLabel(value);
	if (!normalized) return [];

	return [...new Set((normalized.match(/(TALLE UNICO|TALLE 1|TALLE 2|TALLE 3|TALLE 4|5XL\/6XL|4XL|3XL\/4XL|2XL\/3XL|XL\/2XL|XL\/XXL|L\/XL|M\/L|S\/M|XXXL|XXL|XL|L|M|S|XS|110)/g) || []))];
}

function extractVariantMeta(variants = []) {
	const flat = Array.isArray(variants) ? variants : [];
	const hints = new Set();
	const colors = new Set();
	const sizes = new Set();

	const addValue = (rawValue) => {
		const cleaned = normalizeSpacing(rawValue);
		if (!cleaned) return;

		if (looksLikeSkuCode(cleaned)) {
			const meta = getSkuVariantMeta(cleaned);
			if (!meta) return;

			if (meta.color && !isGenericSkuColor(meta.color)) {
				const colorLabel = normalizeColorLabel(meta.color);
				if (colorLabel) colors.add(colorLabel);
			}

			extractAtomicSizes(meta.size || '').forEach((size) => sizes.add(size));
			return;
		}

		const colorLabel = normalizeColorLabel(cleaned);
		if (colorLabel) colors.add(colorLabel);
		extractAtomicSizes(cleaned).forEach((size) => sizes.add(size));

		if (!looksLikeSkuCode(cleaned) && cleaned.length <= 80) {
			hints.add(cleaned);
		}
	};

	for (const variant of flat) {
		if (variant?.sku) addValue(variant.sku);
		if (variant?.option1) addValue(variant.option1);
		if (variant?.option2) addValue(variant.option2);
		if (variant?.option3) addValue(variant.option3);

		if (Array.isArray(variant?.values)) {
			variant.values.forEach(addValue);
		}

		if (Array.isArray(variant?.attributes)) {
			variant.attributes.forEach((attribute) => {
				addValue(attribute?.value || '');
				addValue(attribute?.name || '');
			});
		}
	}

	return {
		variantHints: [...hints].slice(0, 12),
		colors: [...colors].slice(0, 8),
		sizes: [...sizes].slice(0, 8)
	};
}

function formatMoney(value) {
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

function normalizeTags(tags) {
	if (Array.isArray(tags)) {
		return tags.map((t) => String(t).trim()).filter(Boolean).join(', ');
	}

	if (typeof tags === 'string') {
		return tags;
	}

	return null;
}

function normalizeProduct(product, installation) {
	const name = pickLocalized(product.name) || `Producto ${product.id}`;
	const handle = pickLocalized(product.handle);
	const description = sanitizeProductDescription(pickLocalized(product.description));
	const brand =
		typeof product.brand === 'string'
			? product.brand
			: pickLocalized(product.brand);

	const variants = Array.isArray(product.variants) ? product.variants : [];
	const images = Array.isArray(product.images) ? product.images : [];
	const categories = Array.isArray(product.categories) ? product.categories : [];
	const attributes = Array.isArray(product.attributes) ? product.attributes : [];

	const firstVariant = variants[0] || null;
	const featuredImage =
		images[0]?.src ||
		images[0]?.url ||
		firstVariant?.image?.src ||
		firstVariant?.image?.url ||
		null;

	const basePrice =
		firstVariant?.price ??
		product?.price ??
		null;

	const promoPrice =
		firstVariant?.promotional_price ??
		product?.promotional_price ??
		null;

	const resolvedPrices = resolveCatalogPrices(basePrice, promoPrice);

	let productUrl = null;

	if (product.canonical_url) {
		productUrl = product.canonical_url;
	} else if (installation?.storeUrl && handle) {
		const cleanStoreUrl = String(installation.storeUrl).replace(/\/+$/, '');
		productUrl = `${cleanStoreUrl}/${handle}`;
	}

	return {
		productId: String(product.id),
		name,
		handle,
		description,
		brand,
		price: resolvedPrices.currentPrice,
		compareAtPrice: resolvedPrices.originalPrice,
		published: product.published !== false,
		tags: normalizeTags(product.tags),
		featuredImage,
		productUrl,
		variants,
		images,
		categories,
		attributes,
		rawPayload: product
	};
}

async function unpublishMissingProducts({ workspaceId, provider, storeId, seenProductIds }) {
	const ids = [...seenProductIds].filter(Boolean);
	// Do not mass-unpublish a catalog when the provider returned no products.
	if (!ids.length) return 0;
	const result = await prisma.catalogProduct.updateMany({
		where: {
			workspaceId,
			provider,
			storeId,
			productId: { notIn: ids }
		},
		data: {
			published: false,
			syncedAt: new Date()
		}
	});
	return result.count;
}

export async function syncCatalogFromTiendanube({ workspaceId } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const syncLog = await prisma.catalogSyncLog.create({
		data: {
			workspaceId: resolvedWorkspaceId,
			provider: 'TIENDANUBE',
			status: 'RUNNING',
			message: 'Sincronización iniciada'
		}
	});

	try {
		const { client, installation } = await getTiendanubeClient({ workspaceId: resolvedWorkspaceId });
		const storeId = String(installation.storeId);
		const existingProducts = await prisma.catalogProduct.findMany({
			where: {
				workspaceId: resolvedWorkspaceId,
				provider: 'TIENDANUBE',
				storeId
			},
			select: {
				id: true,
				productId: true,
				rawPayload: true,
				commercialData: true
			}
		});
		const existingByProductId = new Map(existingProducts.map((item) => [String(item.productId), item]));

		let page = 1;
		const perPage = 100;
		let processed = 0;
		let added = 0;
		let updated = 0;
		let skipped = 0;
		let detailFetched = 0;
		const seenProductIds = new Set();

		while (true) {
			const response = await client.get('/products', {
				params: {
					page,
					per_page: perPage
				}
			});

			const products = Array.isArray(response.data)
				? response.data
				: Array.isArray(response.data?.products)
					? response.data.products
					: [];

			if (!products.length) {
				break;
			}

			for (const product of products) {
				seenProductIds.add(String(product.id));
				const existing = existingByProductId.get(String(product.id));
				if (existing && sameSourceProduct(existing, product)) {
					skipped += 1;
					processed += 1;
					continue;
				}
				const normalized = normalizeProduct(product, installation);
				const storefrontFacts = await fetchStorefrontFacts(normalized, installation);
				if (storefrontFacts) detailFetched += 1;

				await upsertCatalogProduct({
					workspaceId: resolvedWorkspaceId,
					provider: 'TIENDANUBE',
					storeId,
					normalized: { ...normalized, storefrontFacts },
					existing
				});

				processed += 1;
				if (existing) updated += 1;
				else added += 1;
				existingByProductId.set(String(product.id), { ...existing, rawPayload: product });
			}

			if (products.length < perPage) {
				break;
			}

			page += 1;
			await sleep(350);
		}

		const unpublished = await unpublishMissingProducts({
			workspaceId: resolvedWorkspaceId,
			provider: 'TIENDANUBE',
			storeId,
			seenProductIds
		});

		await prisma.catalogSyncLog.update({
			where: workspaceOwnedWhere({ id: syncLog.id, workspaceId: resolvedWorkspaceId }),
			data: {
				storeId,
				status: 'SUCCESS',
				finishedAt: new Date(),
				productsProcessed: processed,
				message: `Catálogo sincronizado. ${added} nuevos, ${updated} actualizados, ${skipped} sin cambios, ${unpublished} obsoletos ocultos, ${detailFetched} fichas ampliadas.`
			}
		});

		return {
			ok: true,
			storeId,
			productsProcessed: processed,
			productsAdded: added,
			productsUpdated: updated,
			productsSkipped: skipped,
			productsUnpublished: unpublished,
			detailsFetched: detailFetched
		};
	} catch (error) {
		await prisma.catalogSyncLog.update({
			where: workspaceOwnedWhere({ id: syncLog.id, workspaceId: resolvedWorkspaceId }),
			data: {
				status: 'ERROR',
				finishedAt: new Date(),
				message: error.message
			}
		});

		throw error;
	}
}

export async function syncCatalogFromShopify({ workspaceId } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const syncLog = await prisma.catalogSyncLog.create({
		data: {
			workspaceId: resolvedWorkspaceId,
			provider: 'SHOPIFY',
			status: 'RUNNING',
			message: 'Sincronizacion Shopify iniciada'
		}
	});

	try {
		const { client, config } = await getShopifyClient({ workspaceId: resolvedWorkspaceId });
		const storeId = String(config.externalStoreId || config.shopDomain);
		const existingProducts = await prisma.catalogProduct.findMany({
			where: {
				workspaceId: resolvedWorkspaceId,
				provider: 'SHOPIFY',
				storeId
			},
			select: {
				id: true,
				productId: true,
				rawPayload: true,
				commercialData: true
			}
		});
		const existingByProductId = new Map(existingProducts.map((item) => [String(item.productId), item]));
		let sinceId = 0;
		const limit = 250;
		let processed = 0;
		let added = 0;
		let updated = 0;
		let skipped = 0;
		let detailFetched = 0;
		const seenProductIds = new Set();

		while (true) {
			const response = await client.get('/products.json', {
				params: {
					limit,
					since_id: sinceId,
					fields: [
						'id',
						'title',
						'handle',
						'body_html',
						'vendor',
						'product_type',
						'tags',
						'status',
						'published_at',
						'variants',
						'images',
						'image',
						'options',
						'updated_at'
					].join(',')
				}
			});

			const products = Array.isArray(response.data?.products) ? response.data.products : [];
			if (!products.length) break;

			for (const product of products) {
				seenProductIds.add(String(product.id));
				const existing = existingByProductId.get(String(product.id));
				if (existing && sameSourceProduct(existing, product)) {
					skipped += 1;
					processed += 1;
					sinceId = Math.max(sinceId, Number(product.id || 0));
					continue;
				}
				const normalized = normalizeShopifyProduct(product, config);
				const storefrontFacts = await fetchStorefrontFacts(normalized, config);
				if (storefrontFacts) detailFetched += 1;
				await upsertCatalogProduct({
					workspaceId: resolvedWorkspaceId,
					provider: 'SHOPIFY',
					storeId,
					normalized: { ...normalized, storefrontFacts },
					existing
				});

				processed += 1;
				if (existing) updated += 1;
				else added += 1;
				existingByProductId.set(String(product.id), {
					...existing,
					rawPayload: product
				});
				sinceId = Math.max(sinceId, Number(product.id || 0));
			}

			if (products.length < limit || !sinceId) break;
			await sleep(350);
		}

		const unpublished = await unpublishMissingProducts({
			workspaceId: resolvedWorkspaceId,
			provider: 'SHOPIFY',
			storeId,
			seenProductIds
		});

		await prisma.catalogSyncLog.update({
			where: workspaceOwnedWhere({ id: syncLog.id, workspaceId: resolvedWorkspaceId }),
			data: {
				storeId,
				status: 'SUCCESS',
				finishedAt: new Date(),
				productsProcessed: processed,
				message: `Catalogo Shopify sincronizado. ${added} nuevos, ${updated} actualizados, ${skipped} sin cambios, ${unpublished} obsoletos ocultos, ${detailFetched} fichas ampliadas.`
			}
		});

		return {
			ok: true,
			storeId,
			productsProcessed: processed,
			productsAdded: added,
			productsUpdated: updated,
			productsSkipped: skipped,
			productsUnpublished: unpublished,
			detailsFetched: detailFetched
		};
	} catch (error) {
		await prisma.catalogSyncLog.update({
			where: workspaceOwnedWhere({ id: syncLog.id, workspaceId: resolvedWorkspaceId }),
			data: {
				status: 'ERROR',
				finishedAt: new Date(),
				message: error.message
			}
		});

		throw error;
	}
}

export async function syncCatalogFromProvider({
	workspaceId,
	provider = ''
} = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const normalizedProvider = String(provider || '').trim().toUpperCase() ||
		(await resolveActiveCommerceConnection({ workspaceId: resolvedWorkspaceId })).provider;

	if (normalizedProvider === 'SHOPIFY') {
		return syncCatalogFromShopify({ workspaceId: resolvedWorkspaceId });
	}

	return syncCatalogFromTiendanube({ workspaceId: resolvedWorkspaceId });
}

export async function syncCatalogForWorkspace({ workspaceId } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const connection = await resolveActiveCommerceConnection({ workspaceId: resolvedWorkspaceId });
	const result = await syncCatalogFromProvider({ workspaceId: resolvedWorkspaceId, provider: connection.provider });
	return {
		...result,
		provider: connection.provider,
		source: connection.source,
	};
}

export async function getCatalogPage({ q = '', page = 1, pageSize = 24, workspaceId } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const where = {
		workspaceId: resolvedWorkspaceId,
		...(q
			? {
					OR: [
						{ name: { contains: q, mode: 'insensitive' } },
						{ brand: { contains: q, mode: 'insensitive' } },
						{ tags: { contains: q, mode: 'insensitive' } }
					]
			  }
			: {})
	};

	const [itemsRaw, total, lastSync] = await Promise.all([
		prisma.catalogProduct.findMany({
			where,
			orderBy: [
				{ published: 'desc' },
				{ updatedAt: 'desc' }
			],
			skip: (page - 1) * pageSize,
			take: pageSize
		}),
		prisma.catalogProduct.count({ where }),
		prisma.catalogSyncLog.findFirst({
			where: { workspaceId: resolvedWorkspaceId },
			orderBy: { startedAt: 'desc' }
		})
	]);

	const items = itemsRaw.map((item) => {
		const { currentPrice, originalPrice } = resolveCatalogPrices(
			item.price,
			item.compareAtPrice
		);

		const { colors, sizes } = extractVariantMeta(item.variants);
		const variants = Array.isArray(item.variants) ? item.variants : [];
		const explicitQuantities = variants
			.map((variant) => variant?.stock ?? (variant?.inventory_management ? variant?.inventory_quantity : null))
			.map((value) => (value === '' || value == null ? null : Number(value)))
			.filter((value) => Number.isFinite(value));
		const explicitAvailability = variants
			.map((variant) => typeof variant?.available === 'boolean' ? variant.available : null)
			.filter((value) => value !== null);
		const availableVariantCount = explicitQuantities.length
			? explicitQuantities.filter((quantity) => quantity > 0).length
			: explicitAvailability.filter(Boolean).length;
		const trackedVariantCount = explicitQuantities.length || explicitAvailability.length;
		const stockSummary = trackedVariantCount
			? explicitQuantities.length
				? `${availableVariantCount} de ${trackedVariantCount} variantes con stock (${explicitQuantities.reduce((sum, quantity) => sum + quantity, 0)} unidades)`
				: `${availableVariantCount} de ${trackedVariantCount} variantes disponibles según Shopify`
			: 'Shopify no informó stock para las variantes';

		return {
			...item,
			currentPrice,
			originalPrice,
			currentPriceLabel: formatMoney(currentPrice),
			originalPriceLabel: formatMoney(originalPrice),
			colors,
			sizes,
			stockSummary,
			commercialData: normalizeCatalogCommercialData(item.commercialData)
		};
	});

	return {
		items,
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize)),
		lastSync
	};
}

function normalizeCatalogCommercialData(value = {}) {
	const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	const unitsPerPack = Number(source.unitsPerPack);
	const offerPrice = Number(source.offerPrice);
	const normalizedUnitsPerPack = Number.isInteger(unitsPerPack) && unitsPerPack > 1 && unitsPerPack <= 100 ? unitsPerPack : null;
	const presentationLabel = String(source.presentationLabel || '').trim().slice(0, 120) ||
		(normalizedUnitsPerPack ? `Pack de ${normalizedUnitsPerPack} unidades` : '');
	return {
		presentationLabel,
		unitsPerPack: normalizedUnitsPerPack,
		offerLabel: String(source.offerLabel || '').trim().slice(0, 120),
		offerPrice: Number.isFinite(offerPrice) && offerPrice > 0 ? offerPrice : null,
		offerStartsAt: normalizeIsoDate(source.offerStartsAt, false),
		offerEndsAt: normalizeIsoDate(source.offerEndsAt, true),
		storefrontFacts: normalizeStorefrontFacts(source.storefrontFacts)
	};
}

function normalizeIsoDate(value, endOfDay = false) {
	if (!value) return null;
	const normalized = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
		? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
		: value;
	const parsed = new Date(normalized);
	return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export async function updateCatalogCommercialData({ productId, workspaceId, commercialData = {} } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const normalized = normalizeCatalogCommercialData(commercialData);
	if (normalized.offerPrice != null && !normalized.offerLabel) {
		throw new Error('Agregá una descripción para la oferta antes de guardar su precio.');
	}
	if (normalized.offerStartsAt && normalized.offerEndsAt && new Date(normalized.offerEndsAt) < new Date(normalized.offerStartsAt)) {
		throw new Error('La fecha de fin de la oferta debe ser posterior al inicio.');
	}
	const existing = await prisma.catalogProduct.findFirst({
		where: { id: productId, workspaceId: resolvedWorkspaceId },
		select: { id: true, commercialData: true }
	});
	if (!existing) {
		const error = new Error('No se encontró el producto en este catálogo.');
		error.status = 404;
		throw error;
	}
	const existingCommercialData = existing.commercialData && typeof existing.commercialData === 'object' && !Array.isArray(existing.commercialData)
		? existing.commercialData
		: {};
	return prisma.catalogProduct.update({
		where: { id: existing.id },
		data: {
			commercialData: {
				...normalized,
				...(existingCommercialData.catalogExcluded === true
					? {
						catalogExcluded: true,
						catalogExclusionReason: existingCommercialData.catalogExclusionReason || 'producto excluido del catálogo de IA'
					}
					: {})
			}
		}
	});
}
export async function getCatalogSummary({ workspaceId } = {}) {
	const resolvedWorkspaceId = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	try {
		const [totalProducts, totalPublished, lastSync] = await Promise.all([
			prisma.catalogProduct.count({ where: { workspaceId: resolvedWorkspaceId } }),
			prisma.catalogProduct.count({
				where: { workspaceId: resolvedWorkspaceId, published: true }
			}),
			prisma.catalogSyncLog.findFirst({
				where: { workspaceId: resolvedWorkspaceId },
				orderBy: { startedAt: 'desc' }
			})
		]);

		return {
			ok: true,
			totalProducts,
			totalPublished,
			totalUnpublished: Math.max(0, totalProducts - totalPublished),
			lastSync: lastSync
				? {
						id: lastSync.id,
						status: lastSync.status,
						storeId: lastSync.storeId || null,
						productsProcessed: lastSync.productsProcessed || 0,
						message: lastSync.message || null,
						startedAt: lastSync.startedAt || null,
						finishedAt: lastSync.finishedAt || null
				  }
				: null
		};
	} catch (error) {
		const message = error?.message || String(error);
		const missingTable =
			/relation\s+"?Catalog(Product|SyncLog)"?\s+does not exist/i.test(message) ||
			/P2021|P2022/i.test(message);

		return {
			ok: false,
			totalProducts: 0,
			totalPublished: 0,
			totalUnpublished: 0,
			lastSync: null,
			reason: missingTable ? 'catalog_tables_missing' : 'catalog_summary_failed',
			error: message
		};
	}
}

function normalizeShopifyProduct(product, connection) {
	const variants = Array.isArray(product.variants) ? product.variants : [];
	const images = Array.isArray(product.images) ? product.images : [];
	const firstVariant = variants[0] || null;
	const handle = normalizeSpacing(product.handle || '');
	const storeUrl = String(connection?.storeUrl || '').replace(/\/+$/, '');
	const productUrl = storeUrl && handle ? `${storeUrl}/products/${handle}` : null;
	const resolvedPrices = resolveCatalogPrices(
		firstVariant?.price ?? null,
		firstVariant?.compare_at_price ?? null
	);

	return {
		productId: String(product.id),
		name: normalizeSpacing(product.title || `Producto ${product.id}`),
		handle: handle || null,
		description: sanitizeProductDescription(product.body_html),
		brand: product.vendor || null,
		price: resolvedPrices.currentPrice,
		compareAtPrice: resolvedPrices.originalPrice,
		published: product.status === 'active' && product.published_at !== null,
		tags: normalizeTags(product.tags),
		featuredImage: product.image?.src || images[0]?.src || null,
		productUrl,
		variants,
		images,
		categories: product.product_type ? [product.product_type] : [],
		attributes: Array.isArray(product.options) ? product.options : [],
		rawPayload: product
	};
}

async function upsertCatalogProduct({ workspaceId, provider, storeId, normalized, existing = null }) {
	const existingCommercialData = existing?.commercialData && typeof existing.commercialData === 'object' && !Array.isArray(existing.commercialData)
		? existing.commercialData
		: {};
	const commercialData = normalized.storefrontFacts
		? mergeCommercialData(existingCommercialData, normalized.storefrontFacts)
		: Object.keys(existingCommercialData).length ? existingCommercialData : undefined;
	const catalogExcluded = existingCommercialData.catalogExcluded === true;
	return prisma.catalogProduct.upsert({
		where: {
			workspaceId_provider_productId: {
				workspaceId,
				provider,
				productId: normalized.productId
			}
		},
		update: {
			storeId,
			name: normalized.name,
			handle: normalized.handle,
			description: normalized.description,
			brand: normalized.brand,
			price: normalized.price,
			compareAtPrice: normalized.compareAtPrice,
			published: catalogExcluded ? false : normalized.published,
			tags: normalized.tags,
			featuredImage: normalized.featuredImage,
			productUrl: normalized.productUrl,
			variants: normalized.variants,
			images: normalized.images,
			categories: normalized.categories,
			attributes: normalized.attributes,
			commercialData,
			rawPayload: normalized.rawPayload,
			syncedAt: new Date()
		},
		create: {
			workspaceId,
			provider,
			storeId,
			productId: normalized.productId,
			name: normalized.name,
			handle: normalized.handle,
			description: normalized.description,
			brand: normalized.brand,
			price: normalized.price,
			compareAtPrice: normalized.compareAtPrice,
			published: normalized.published,
			tags: normalized.tags,
			featuredImage: normalized.featuredImage,
			productUrl: normalized.productUrl,
			variants: normalized.variants,
			images: normalized.images,
			categories: normalized.categories,
			attributes: normalized.attributes,
			commercialData,
			rawPayload: normalized.rawPayload,
			syncedAt: new Date()
		}
	});
}
