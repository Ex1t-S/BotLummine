import { prisma } from '../lib/prisma.js';
import { getTiendanubeClient } from './tiendanube/client.js';

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
			return { currentPrice: promo, originalPrice: base };
		}
		if (base > 0 && base < promo) {
			return { currentPrice: base, originalPrice: promo };
		}
		return { currentPrice: base, originalPrice: null };
	}

	if (promo != null) return { currentPrice: promo, originalPrice: null };
	if (base != null) return { currentPrice: base, originalPrice: null };
	return { currentPrice: null, originalPrice: null };
}

function resolveBestCatalogPrices(product = {}) {
	const candidates = [];
	const variants = Array.isArray(product.variants) ? product.variants : [];

	candidates.push(resolveCatalogPrices(product?.price ?? null, product?.promotional_price ?? null));

	for (const variant of variants) {
		candidates.push(resolveCatalogPrices(variant?.price ?? null, variant?.promotional_price ?? null));
	}

	const valid = candidates.filter((item) => item.currentPrice != null && item.currentPrice > 0);
	if (!valid.length) return { currentPrice: null, originalPrice: null };

	valid.sort((a, b) => a.currentPrice - b.currentPrice);
	return valid[0];
}

function extractVariantMeta(variants = []) {
	const flat = Array.isArray(variants) ? variants : [];
	const values = [];

	for (const variant of flat) {
		if (variant?.option1) values.push(String(variant.option1));
		if (variant?.option2) values.push(String(variant.option2));
		if (variant?.option3) values.push(String(variant.option3));
		if (Array.isArray(variant?.values)) {
			values.push(...variant.values.map((v) => String(v)));
		}
		if (Array.isArray(variant?.attributes)) {
			values.push(...variant.attributes.map((a) => String(a?.value || a?.name || '')));
		}
	}

	const cleaned = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
	const colors = cleaned.filter((v) =>
		/(negro|blanco|beige|avellana|marron|marrón|rosa|nude|gris|azul|verde|bordo)/i.test(v)
	);
	const sizes = cleaned.filter((v) =>
		/(^xs$|^s$|^m$|^l$|^xl$|^xxl$|^xxxl$|s\/m|m\/l|l\/xl|xl\/xxl|talle|[0-9]+)/i.test(v)
	);

	return { colors: colors.slice(0, 8), sizes: sizes.slice(0, 8) };
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
		return tags
			.map((t) => String(t).trim())
			.filter(Boolean)
			.join(', ');
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
	const brand = typeof product.brand === 'string' ? product.brand : pickLocalized(product.brand);
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

	const resolvedPrices = resolveBestCatalogPrices(product);

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

export async function syncCatalogFromTiendanube() {
	const syncLog = await prisma.catalogSyncLog.create({
		data: { status: 'RUNNING', message: 'Sincronización iniciada' }
	});

	try {
		const { client, installation } = await getTiendanubeClient();
		const storeId = String(installation.storeId);

		let page = 1;
		const perPage = 100;
		let processed = 0;

		while (true) {
			const response = await client.get('/products', {
				params: { page, per_page: perPage }
			});

			const products = Array.isArray(response.data)
				? response.data
				: Array.isArray(response.data?.products)
					? response.data.products
					: [];

			if (!products.length) break;

			for (const product of products) {
				const normalized = normalizeProduct(product, installation);

				await prisma.catalogProduct.upsert({
					where: {
						storeId_productId: { storeId, productId: normalized.productId }
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
						syncedAt: new Date()
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
						syncedAt: new Date()
					}
				});

				processed += 1;
			}

			if (products.length < perPage) break;
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
				message: `Catálogo sincronizado correctamente.\n${processed} productos procesados.`
			}
		});

		return { ok: true, storeId, productsProcessed: processed };
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

export async function getCatalogPage({ q = '', page = 1, pageSize = 24 } = {}) {
	const where = {
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
			orderBy: [{ published: 'desc' }, { updatedAt: 'desc' }],
			skip: (page - 1) * pageSize,
			take: pageSize
		}),
		prisma.catalogProduct.count({ where }),
		prisma.catalogSyncLog.findFirst({ orderBy: { startedAt: 'desc' } })
	]);

	const items = itemsRaw.map((item) => {
		const { currentPrice, originalPrice } = resolveCatalogPrices(item.price, item.compareAtPrice);
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
