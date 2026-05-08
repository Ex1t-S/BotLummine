import { prisma } from '../../lib/prisma.js';
import { getTiendanubeClient } from '../tiendanube/client.js';
import { getShopifyClient } from '../shopify/client.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import {
	getSkuVariantMeta,
	isGenericSkuColor,
	normalizeSku,
} from '../../data/sku-size-map.js';

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeSpacing(value = '') {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
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
	const description = pickLocalized(product.description);
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

export async function syncCatalogFromTiendanube({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
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

		let page = 1;
		const perPage = 100;
		let processed = 0;

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
				const normalized = normalizeProduct(product, installation);

				await upsertCatalogProduct({
					workspaceId: resolvedWorkspaceId,
					provider: 'TIENDANUBE',
					storeId,
					normalized
				});

				processed += 1;
			}

			if (products.length < perPage) {
				break;
			}

			page += 1;
			await sleep(350);
		}

		await prisma.catalogSyncLog.update({
			where: { id: syncLog.id },
			data: {
				storeId,
				status: 'SUCCESS',
				finishedAt: new Date(),
				productsProcessed: processed,
				message: `Catálogo sincronizado correctamente. ${processed} productos procesados.`
			}
		});

		return {
			ok: true,
			storeId,
			productsProcessed: processed
		};
	} catch (error) {
		await prisma.catalogSyncLog.update({
			where: { id: syncLog.id },
			data: {
				status: 'ERROR',
				finishedAt: new Date(),
				message: error.message
			}
		});

		throw error;
	}
}

export async function syncCatalogFromShopify({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
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
		let sinceId = 0;
		const limit = 250;
		let processed = 0;

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
				const normalized = normalizeShopifyProduct(product, config);
				await upsertCatalogProduct({
					workspaceId: resolvedWorkspaceId,
					provider: 'SHOPIFY',
					storeId,
					normalized
				});

				processed += 1;
				sinceId = Math.max(sinceId, Number(product.id || 0));
			}

			if (products.length < limit || !sinceId) break;
			await sleep(350);
		}

		await prisma.catalogSyncLog.update({
			where: { id: syncLog.id },
			data: {
				storeId,
				status: 'SUCCESS',
				finishedAt: new Date(),
				productsProcessed: processed,
				message: `Catalogo Shopify sincronizado. ${processed} productos procesados.`
			}
		});

		return {
			ok: true,
			storeId,
			productsProcessed: processed
		};
	} catch (error) {
		await prisma.catalogSyncLog.update({
			where: { id: syncLog.id },
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
	workspaceId = DEFAULT_WORKSPACE_ID,
	provider = 'TIENDANUBE'
} = {}) {
	const normalizedProvider = String(provider || 'TIENDANUBE').trim().toUpperCase();

	if (normalizedProvider === 'SHOPIFY') {
		return syncCatalogFromShopify({ workspaceId });
	}

	return syncCatalogFromTiendanube({ workspaceId });
}

export async function getCatalogPage({ q = '', page = 1, pageSize = 24, workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
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

		return {
			...item,
			currentPrice,
			originalPrice,
			currentPriceLabel: formatMoney(currentPrice),
			originalPriceLabel: formatMoney(originalPrice),
			colors,
			sizes
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
export async function getCatalogSummary({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
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
		description: product.body_html || null,
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

async function upsertCatalogProduct({ workspaceId, provider, storeId, normalized }) {
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
			published: normalized.published,
			tags: normalized.tags,
			featuredImage: normalized.featuredImage,
			productUrl: normalized.productUrl,
			variants: normalized.variants,
			images: normalized.images,
			categories: normalized.categories,
			attributes: normalized.attributes,
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
			rawPayload: normalized.rawPayload,
			syncedAt: new Date()
		}
	});
}
