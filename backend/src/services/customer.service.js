import { prisma } from '../lib/prisma.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const ORDERS_PER_PAGE = Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_PER_PAGE || 50);
const MAX_PAGES = Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_MAX_PAGES || 500);

function normalizePhone(value = '') {
	const digits = String(value || '').replace(/\D/g, '');
	return digits || null;
}

function normalizeEmail(value = '') {
	const email = String(value || '').trim().toLowerCase();
	return email || null;
}

function cleanString(value = '') {
	const text = String(value ?? '').trim();
	return text || null;
}

function toDecimalOrNull(value) {
	if (value === null || value === undefined || value === '') return null;
	return String(value);
}

function parseDateOrNull(value) {
	if (!value) return null;

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function buildHeaders(accessToken) {
	return {
		Authentication: `bearer ${accessToken}`,
		'Content-Type': 'application/json',
		'User-Agent': process.env.TIENDANUBE_USER_AGENT || 'Lummine IA Assistant'
	};
}

async function resolveStoreCredentials() {
	const installation = await prisma.storeInstallation.findFirst({
		orderBy: { installedAt: 'desc' }
	});

	const storeId = installation?.storeId || process.env.TIENDANUBE_STORE_ID || null;
	const accessToken = installation?.accessToken || process.env.TIENDANUBE_ACCESS_TOKEN || null;

	if (!storeId || !accessToken) {
		throw new Error(
			'Faltan credenciales de Tiendanube. Necesitás StoreInstallation cargada o TIENDANUBE_STORE_ID y TIENDANUBE_ACCESS_TOKEN en el .env.'
		);
	}

	return { storeId, accessToken };
}

function buildProductsSnapshot(order = {}) {
	if (!Array.isArray(order.products)) return [];

	return order.products.map((product) => ({
		id: product?.id ?? null,
		productId: product?.product_id ?? null,
		variantId: product?.variant_id ?? null,
		name: product?.name || product?.name_without_variants || 'Producto sin nombre',
		sku: product?.sku || null,
		price: product?.price ?? null,
		quantity: Number(product?.quantity || 1),
		image: product?.image?.src || null,
		variantValues: Array.isArray(product?.variant_values) ? product.variant_values : []
	}));
}

function buildCustomerSnapshot(order = {}) {
	const customer = order?.customer && typeof order.customer === 'object' ? order.customer : null;
	const orderEmail = cleanString(order.contact_email);
	const orderPhone = cleanString(order.contact_phone || order.billing_phone);
	const orderName = cleanString(order.contact_name || order.billing_name || order.name);

	return {
		externalCustomerId: customer?.id ? String(customer.id) : null,
		displayName: cleanString(customer?.name) || orderName,
		email: cleanString(customer?.email) || orderEmail,
		normalizedEmail: normalizeEmail(customer?.email || orderEmail),
		phone: cleanString(customer?.phone) || orderPhone,
		normalizedPhone: normalizePhone(customer?.phone || orderPhone),
		identification: cleanString(customer?.identification || order.contact_identification),
		note: cleanString(customer?.note),
		acceptsMarketing:
			typeof customer?.accepts_marketing === 'boolean' ? customer.accepts_marketing : null,
		acceptsMarketingUpdatedAt: parseDateOrNull(customer?.accepts_marketing_updated_at),
		defaultAddress: customer?.default_address ?? null,
		addresses: Array.isArray(customer?.addresses) ? customer.addresses : null,
		billingAddress: cleanString(customer?.billing_address || order.billing_address),
		billingNumber: cleanString(customer?.billing_number || order.billing_number),
		billingFloor: cleanString(customer?.billing_floor || order.billing_floor),
		billingLocality: cleanString(customer?.billing_locality || order.billing_locality),
		billingZipcode: cleanString(customer?.billing_zipcode || order.billing_zipcode),
		billingCity: cleanString(customer?.billing_city || order.billing_city),
		billingProvince: cleanString(customer?.billing_province || order.billing_province),
		billingCountry: cleanString(customer?.billing_country || order.billing_country),
		billingPhone: cleanString(customer?.billing_phone || order.billing_phone),
		rawCustomerPayload: customer || null
	};
}

function buildOrderPayload(order = {}, storeId) {
	const email = cleanString(order.contact_email || order.customer?.email);
	const phone = cleanString(order.contact_phone || order.customer?.phone || order.billing_phone);

	return {
		storeId: String(order.store_id || storeId),
		orderNumber: order.number ? String(order.number) : null,
		token: cleanString(order.token),
		contactName: cleanString(order.contact_name || order.customer?.name || order.billing_name),
		contactEmail: email,
		normalizedEmail: normalizeEmail(email),
		contactPhone: phone,
		normalizedPhone: normalizePhone(phone),
		contactIdentification: cleanString(order.contact_identification || order.customer?.identification),
		status: cleanString(order.status),
		paymentStatus: cleanString(order.payment_status),
		shippingStatus: cleanString(order.shipping_status),
		subtotal: toDecimalOrNull(order.subtotal),
		totalAmount: toDecimalOrNull(order.total),
		currency: cleanString(order.currency),
		gateway: cleanString(order.gateway),
		gatewayId: order.gateway_id ? String(order.gateway_id) : null,
		gatewayName: cleanString(order.gateway_name),
		gatewayLink: cleanString(order.gateway_link),
		products: buildProductsSnapshot(order),
		rawPayload: order,
		orderCreatedAt: parseDateOrNull(order.created_at),
		orderUpdatedAt: parseDateOrNull(order.updated_at)
	};
}

function isMeaningful(value) {
	if (value === null || value === undefined) return false;
	if (typeof value === 'string') return value.trim() !== '';
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === 'object') return Object.keys(value).length > 0;
	return true;
}

function pickIncoming(existingValue, incomingValue) {
	return isMeaningful(incomingValue) ? incomingValue : existingValue;
}

async function findMatchingCustomerProfile({
	storeId,
	externalCustomerId,
	normalizedEmail,
	normalizedPhone,
}) {
	if (externalCustomerId) {
		const byExternal = await prisma.customerProfile.findFirst({
			where: {
				storeId,
				externalCustomerId,
			},
		});

		if (byExternal) return byExternal;
	}

	if (normalizedEmail) {
		const byEmail = await prisma.customerProfile.findFirst({
			where: {
				storeId,
				normalizedEmail,
			},
		});

		if (byEmail) return byEmail;
	}

	if (normalizedPhone) {
		const byPhone = await prisma.customerProfile.findFirst({
			where: {
				storeId,
				normalizedPhone,
			},
		});

		if (byPhone) return byPhone;
	}

	return null;
}

function buildProfileCreateData(snapshot, storeId) {
	return {
		storeId,
		externalCustomerId: snapshot.externalCustomerId,
		displayName: snapshot.displayName,
		email: snapshot.email,
		normalizedEmail: snapshot.normalizedEmail,
		phone: snapshot.phone,
		normalizedPhone: snapshot.normalizedPhone,
		identification: snapshot.identification,
		note: snapshot.note,
		acceptsMarketing: snapshot.acceptsMarketing,
		acceptsMarketingUpdatedAt: snapshot.acceptsMarketingUpdatedAt,
		defaultAddress: snapshot.defaultAddress,
		addresses: snapshot.addresses,
		billingAddress: snapshot.billingAddress,
		billingNumber: snapshot.billingNumber,
		billingFloor: snapshot.billingFloor,
		billingLocality: snapshot.billingLocality,
		billingZipcode: snapshot.billingZipcode,
		billingCity: snapshot.billingCity,
		billingProvince: snapshot.billingProvince,
		billingCountry: snapshot.billingCountry,
		billingPhone: snapshot.billingPhone,
		rawCustomerPayload: snapshot.rawCustomerPayload,
		syncedAt: new Date(),
	};
}

function buildProfileUpdateData(existing, snapshot, rawLastOrderPayload) {
	return {
		externalCustomerId: pickIncoming(existing.externalCustomerId, snapshot.externalCustomerId),
		displayName: pickIncoming(existing.displayName, snapshot.displayName),
		email: pickIncoming(existing.email, snapshot.email),
		normalizedEmail: pickIncoming(existing.normalizedEmail, snapshot.normalizedEmail),
		phone: pickIncoming(existing.phone, snapshot.phone),
		normalizedPhone: pickIncoming(existing.normalizedPhone, snapshot.normalizedPhone),
		identification: pickIncoming(existing.identification, snapshot.identification),
		note: pickIncoming(existing.note, snapshot.note),
		acceptsMarketing:
			typeof snapshot.acceptsMarketing === 'boolean'
				? snapshot.acceptsMarketing
				: existing.acceptsMarketing,
		acceptsMarketingUpdatedAt: pickIncoming(
			existing.acceptsMarketingUpdatedAt,
			snapshot.acceptsMarketingUpdatedAt
		),
		defaultAddress: pickIncoming(existing.defaultAddress, snapshot.defaultAddress),
		addresses: pickIncoming(existing.addresses, snapshot.addresses),
		billingAddress: pickIncoming(existing.billingAddress, snapshot.billingAddress),
		billingNumber: pickIncoming(existing.billingNumber, snapshot.billingNumber),
		billingFloor: pickIncoming(existing.billingFloor, snapshot.billingFloor),
		billingLocality: pickIncoming(existing.billingLocality, snapshot.billingLocality),
		billingZipcode: pickIncoming(existing.billingZipcode, snapshot.billingZipcode),
		billingCity: pickIncoming(existing.billingCity, snapshot.billingCity),
		billingProvince: pickIncoming(existing.billingProvince, snapshot.billingProvince),
		billingCountry: pickIncoming(existing.billingCountry, snapshot.billingCountry),
		billingPhone: pickIncoming(existing.billingPhone, snapshot.billingPhone),
		rawCustomerPayload: pickIncoming(existing.rawCustomerPayload, snapshot.rawCustomerPayload),
		rawLastOrderPayload,
		syncedAt: new Date(),
	};
}

function summarizeProducts(orders = []) {
	const map = new Map();

	for (const order of orders) {
		const items = Array.isArray(order.products) ? order.products : [];

		for (const item of items) {
			const productId = item?.productId ? String(item.productId) : null;
			const variantId = item?.variantId ? String(item.variantId) : null;
			const key = `${productId || 'no-product'}:${variantId || 'no-variant'}:${item?.name || 'sin-nombre'}`;
			const quantity = Number(item?.quantity || 0);
			const current = map.get(key) || {
				productId,
				variantId,
				name: item?.name || 'Producto sin nombre',
				sku: item?.sku || null,
				image: item?.image || null,
				ordersCount: 0,
				unitsPurchased: 0,
				lastPrice: item?.price ?? null,
			};

			current.ordersCount += 1;
			current.unitsPurchased += quantity;
			current.lastPrice = item?.price ?? current.lastPrice;
			map.set(key, current);
		}
	}

	return Array.from(map.values()).sort((a, b) => {
		if (b.unitsPurchased !== a.unitsPurchased) {
			return b.unitsPurchased - a.unitsPurchased;
		}

		return String(a.name || '').localeCompare(String(b.name || ''), 'es');
	});
}

async function recalculateCustomerProfile(profileId) {
	const profile = await prisma.customerProfile.findUnique({
		where: { id: profileId },
		include: {
			orders: {
				orderBy: [
					{ orderCreatedAt: 'asc' },
					{ createdAt: 'asc' }
				]
			}
		}
	});

	if (!profile) return null;

	const orders = profile.orders || [];
	const validOrders = orders.filter((order) => String(order.paymentStatus || '').toLowerCase() !== 'abandoned');
	const lastOrder = validOrders[validOrders.length - 1] || orders[orders.length - 1] || null;
	const productSummary = summarizeProducts(validOrders);
	const paidStatuses = new Set(['paid', 'authorized', 'partially_paid', 'partially_refunded', 'refunded']);

	let totalSpent = 0;
	let totalUnitsPurchased = 0;

	for (const order of validOrders) {
		totalSpent += Number(order.totalAmount || 0);

		const items = Array.isArray(order.products) ? order.products : [];
		for (const item of items) {
			totalUnitsPurchased += Number(item?.quantity || 0);
		}
	}

	const firstOrder = validOrders[0] || orders[0] || null;
	const paidOrderCount = validOrders.filter((order) =>
		paidStatuses.has(String(order.paymentStatus || '').toLowerCase())
	).length;

	return prisma.customerProfile.update({
		where: { id: profileId },
		data: {
			orderCount: validOrders.length,
			paidOrderCount,
			distinctProductsCount: productSummary.length,
			totalUnitsPurchased,
			totalSpent: validOrders.length ? totalSpent.toFixed(2) : null,
			currency: lastOrder?.currency || profile.currency || null,
			firstOrderAt: firstOrder?.orderCreatedAt || null,
			lastOrderAt: lastOrder?.orderCreatedAt || lastOrder?.orderUpdatedAt || null,
			lastOrderId: lastOrder?.orderId || null,
			lastOrderNumber: lastOrder?.orderNumber || null,
			lastPaymentStatus: lastOrder?.paymentStatus || null,
			lastShippingStatus: lastOrder?.shippingStatus || null,
			productSummary,
			rawLastOrderPayload: lastOrder?.rawPayload || profile.rawLastOrderPayload,
			syncedAt: new Date(),
		}
	});
}

async function fetchOrdersPage({ storeId, accessToken, page }) {
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(ORDERS_PER_PAGE),
	});

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/orders?${params.toString()}`;
	const response = await fetch(url, {
		method: 'GET',
		headers: buildHeaders(accessToken)
	});

	if (!response.ok) {
		const text = await response.text();

		if (response.status === 404) {
			let payload = null;

			try {
				payload = JSON.parse(text);
			} catch {
				payload = null;
			}

			const description = payload?.description || '';
			if (description.includes('Last page is')) {
				return {
					orders: [],
					reachedEnd: true,
				};
			}
		}

		throw new Error(`Tiendanube error ${response.status}: ${text}`);
	}

	const orders = await response.json();
	if (!Array.isArray(orders)) {
		throw new Error('La respuesta de Tiendanube no fue una lista de órdenes.');
	}

	return {
		orders,
		reachedEnd: false,
	};
}

export async function syncCustomers({ fullSync = true } = {}) {
	const syncLog = await prisma.customerSyncLog.create({
		data: {
			status: 'RUNNING',
			fullSync,
		}
	});

	try {
		const { storeId, accessToken } = await resolveStoreCredentials();
		const touchedProfileIds = new Set();
		let ordersFetched = 0;
		let ordersUpserted = 0;
		let profilesCreated = 0;
		let profilesUpdated = 0;
		let pagesFetched = 0;

		await prisma.customerSyncLog.update({
			where: { id: syncLog.id },
			data: { storeId }
		});

		for (let page = 1; page <= MAX_PAGES; page += 1) {
			const { orders, reachedEnd } = await fetchOrdersPage({
				storeId,
				accessToken,
				page,
			});

			if (reachedEnd || !orders.length) {
				break;
			}

			pagesFetched += 1;
			ordersFetched += orders.length;

			for (const order of orders) {
				if (String(order?.payment_status || '').toLowerCase() === 'abandoned') {
					continue;
				}

				const orderId = order?.id ? String(order.id) : null;
				if (!orderId) continue;

				const customerSnapshot = buildCustomerSnapshot(order);
				const orderPayload = buildOrderPayload(order, storeId);
				let profile = await findMatchingCustomerProfile({
					storeId,
					externalCustomerId: customerSnapshot.externalCustomerId,
					normalizedEmail: customerSnapshot.normalizedEmail,
					normalizedPhone: customerSnapshot.normalizedPhone,
				});

				if (!profile) {
					profile = await prisma.customerProfile.create({
						data: buildProfileCreateData(customerSnapshot, storeId)
					});
					profilesCreated += 1;
				} else {
					profile = await prisma.customerProfile.update({
						where: { id: profile.id },
						data: buildProfileUpdateData(profile, customerSnapshot, orderPayload.rawPayload)
					});
					profilesUpdated += 1;
				}

				await prisma.customerOrder.upsert({
					where: {
						storeId_orderId: {
							storeId,
							orderId,
						}
					},
					update: {
						customerProfileId: profile.id,
						...orderPayload,
					},
					create: {
						customerProfileId: profile.id,
						orderId,
						...orderPayload,
					}
				});

				touchedProfileIds.add(profile.id);
				ordersUpserted += 1;
			}
		}

		for (const profileId of touchedProfileIds) {
			await recalculateCustomerProfile(profileId);
		}

		const result = {
			ok: true,
			storeId,
			fullSync,
			pagesFetched,
			ordersFetched,
			ordersUpserted,
			profilesCreated,
			profilesUpdated,
			customersTouched: touchedProfileIds.size,
		};

		await prisma.customerSyncLog.update({
			where: { id: syncLog.id },
			data: {
				status: 'SUCCESS',
				finishedAt: new Date(),
				pagesFetched,
				ordersFetched,
				ordersUpserted,
				customersTouched: touchedProfileIds.size,
				message: 'Sync de clientes finalizada correctamente.',
			}
		});

		return result;
	} catch (error) {
		await prisma.customerSyncLog.update({
			where: { id: syncLog.id },
			data: {
				status: 'FAILED',
				finishedAt: new Date(),
				message: error.message || 'Error inesperado en sync de clientes.',
			}
		}).catch(() => null);

		throw error;
	}
}