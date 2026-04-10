import { prisma } from '../../lib/prisma.js';
import { getTiendanubeClient } from '../tiendanube/client.js';

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_DELAY_MS = 250;
const DEFAULT_SYNC_WINDOW_DAYS = 30;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickLocalized(value) {
	if (value == null) return null;
	if (typeof value === 'string') return value.trim() || null;

	if (typeof value === 'object') {
		return (
			value.es ||
			value['es_AR'] ||
			value['es-AR'] ||
			value.en ||
			value.pt ||
			Object.values(value).find((entry) => typeof entry === 'string' && entry.trim()) ||
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

function normalizeTags(tags) {
	if (Array.isArray(tags)) {
		return tags
			.map((tag) => {
				if (typeof tag === 'string') return tag.trim();
				if (tag && typeof tag === 'object') {
					return String(tag.name || tag.value || '').trim();
				}
				return '';
			})
			.filter(Boolean)
			.join(', ');
	}

	if (typeof tags === 'string') {
		return tags.trim() || null;
	}

	return null;
}

function buildProductUrl(product, installation, handle) {
	if (product?.canonical_url) {
		return product.canonical_url;
	}

	if (!installation?.storeUrl || !handle) {
		return null;
	}

	const cleanStoreUrl = String(installation.storeUrl).replace(/\/+$/, '');
	const cleanHandle = String(handle).replace(/^\/+/, '');
	return `${cleanStoreUrl}/${cleanHandle}`;
}

function normalizeProduct(product, installation) {
	const name = pickLocalized(product?.name) || `Producto ${product?.id ?? ''}`.trim();
	const handle = pickLocalized(product?.handle);
	const description = pickLocalized(product?.description);
	const brand = typeof product?.brand === 'string' ? product.brand : pickLocalized(product?.brand);

	const variants = Array.isArray(product?.variants) ? product.variants : [];
	const images = Array.isArray(product?.images) ? product.images : [];
	const categories = Array.isArray(product?.categories) ? product.categories : [];
	const attributes = Array.isArray(product?.attributes) ? product.attributes : [];

	const firstVariant = variants[0] || null;
	const featuredImage =
		images[0]?.src ||
		images[0]?.url ||
		firstVariant?.image?.src ||
		firstVariant?.image?.url ||
		null;

	const basePrice = firstVariant?.price ?? product?.price ?? null;
	const promoPrice = firstVariant?.promotional_price ?? product?.promotional_price ?? null;
	const resolvedPrices = resolveCatalogPrices(basePrice, promoPrice);

	return {
		productId: String(product?.id),
		name,
		handle,
		description,
		brand,
		price: resolvedPrices.currentPrice,
		compareAtPrice: resolvedPrices.originalPrice,
		published: product?.published !== false,
		tags: normalizeTags(product?.tags),
		featuredImage,
		productUrl: buildProductUrl(product, installation, handle),
		variants,
		images,
		categories,
		attributes,
		rawPayload: product
	};
}

function buildCatalogWhere({ q = '', published = undefined } = {}) {
	const search = String(q || '').trim();
	return {
		...(published == null ? {} : { published: Boolean(published) }),
		...(search
			? {
					OR: [
						{ name: { contains: search, mode: 'insensitive' } },
						{ brand: { contains: search, mode: 'insensitive' } },
						{ tags: { contains: search, mode: 'insensitive' } },
						{ handle: { contains: search, mode: 'insensitive' } },
						{ description: { contains: search, mode: 'insensitive' } },
						{ productId: { contains: search, mode: 'insensitive' } }
					]
			  }
			: {})
	};
}

async function upsertCatalogPage({ products, storeId, installation }) {
	const now = new Date();
	const tx = [];

	for (const product of products) {
		const normalized = normalizeProduct(product, installation);
		tx.push(
			prisma.catalogProduct.upsert({
				where: {
					storeId_productId: {
						storeId,
						productId: normalized.productId
					}
				},
				update: {
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
					syncedAt: now
				},
				create: {
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
					syncedAt: now
				}
			})
		);
	}

	if (tx.length) {
		await prisma.$transaction(tx);
	}

	return products.map((product) => String(product?.id)).filter(Boolean);
}

export async function syncCatalogFromTiendanube({
	pageSize = DEFAULT_PAGE_SIZE,
	delayMs = DEFAULT_DELAY_MS,
	markMissingAsUnpublished = true
} = {}) {
	const syncLog = await prisma.catalogSyncLog.create({
		data: {
			status: 'RUNNING',
			message: 'Sincronización completa del catálogo iniciada'
		}
	});

	try {
		const { client, installation } = await getTiendanubeClient();
		const storeId = String(installation.storeId);
		const seenProductIds = new Set();
		let page = 1;
		let processed = 0;
		let publishedCount = 0;
		let unpublishedCount = 0;

		while (true) {
			const response = await client.get('/products', {
				params: {
					page,
					per_page: pageSize
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

			const pageIds = await upsertCatalogPage({
				products,
				storeId,
				installation
			});

			for (const product of products) {
				if (product?.published === false) unpublishedCount += 1;
				else publishedCount += 1;
			}

			pageIds.forEach((id) => seenProductIds.add(id));
			processed += products.length;

			if (products.length < pageSize) {
				break;
			}

			page += 1;
			if (delayMs > 0) {
				await sleep(delayMs);
			}
		}

		let missingMarked = 0;
		if (markMissingAsUnpublished && seenProductIds.size) {
			const missingResult = await prisma.catalogProduct.updateMany({
				where: {
					storeId,
					NOT: {
						productId: {
							in: [...seenProductIds]
						}
					}
				},
				data: {
					published: false,
					syncedAt: new Date()
				}
			});
			missingMarked = missingResult.count || 0;
		}

		await prisma.catalogSyncLog.update({
			where: { id: syncLog.id },
			data: {
				storeId,
				status: 'SUCCESS',
				finishedAt: new Date(),
				productsProcessed: processed,
				message: `Catálogo sincronizado correctamente. ${processed} productos procesados, ${publishedCount} publicados, ${unpublishedCount} no publicados, ${missingMarked} marcados como no publicados por no venir en el sync.`
			}
		});

		return {
			ok: true,
			storeId,
			productsProcessed: processed,
			publishedCount,
			unpublishedCount,
			missingMarked
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

export async function getCatalogSummary() {
	const recentWindow = new Date(Date.now() - DEFAULT_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
	const [total, published, unpublished, stale, lastSync] = await Promise.all([
		prisma.catalogProduct.count(),
		prisma.catalogProduct.count({ where: { published: true } }),
		prisma.catalogProduct.count({ where: { published: false } }),
		prisma.catalogProduct.count({ where: { syncedAt: { lt: recentWindow } } }),
		prisma.catalogSyncLog.findFirst({ orderBy: { startedAt: 'desc' } })
	]);

	return {
		total,
		published,
		unpublished,
		stale,
		lastSync
	};
}

export async function getCatalogPage({ q = '', page = 1, pageSize = 24, published = undefined } = {}) {
	const safePage = Math.max(1, Number(page) || 1);
	const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 24));
	const where = buildCatalogWhere({ q, published });

	const [items, total, summary] = await Promise.all([
		prisma.catalogProduct.findMany({
			where,
			orderBy: [{ published: 'desc' }, { updatedAt: 'desc' }],
			skip: (safePage - 1) * safePageSize,
			take: safePageSize
		}),
		prisma.catalogProduct.count({ where }),
		getCatalogSummary()
	]);

	return {
		items,
		total,
		page: safePage,
		pageSize: safePageSize,
		totalPages: Math.max(1, Math.ceil(total / safePageSize)),
		summary
	};
}
