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

function normalizeProduct(product, installation) {
	const name = pickLocalized(product.name) || `Producto ${product.id}`;
	const handle = pickLocalized(product.handle);
	const description = pickLocalized(product.description);
	const brand = typeof product.brand === 'string'
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

	const price = toNumberOrNull(
		firstVariant?.price ??
		product?.price ??
		null
	);

	const compareAtPrice = toNumberOrNull(
		firstVariant?.promotional_price ??
		product?.promotional_price ??
		null
	);

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
		price,
		compareAtPrice,
		published: product.published !== false,
		tags: typeof product.tags === 'string' ? product.tags : null,
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
		data: {
			status: 'RUNNING',
			message: 'Sincronización iniciada'
		}
	});

	try {
		const { client, installation } = await getTiendanubeClient();
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

				await prisma.catalogProduct.upsert({
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

			if (products.length < perPage) {
				break;
			}

			page += 1;

			// Pequeña pausa para no ir a los bifes con la API
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

	const [items, total, lastSync] = await Promise.all([
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
			orderBy: { startedAt: 'desc' }
		})
	]);

	return {
		items,
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize)),
		lastSync
	};
}