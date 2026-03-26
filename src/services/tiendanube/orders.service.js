import 'dotenv/config';
import { getTiendanubeClient } from './client.js';

function humanizePaymentStatus(status) {
	switch (status) {
		case 'paid':
			return 'Pago aprobado';
		case 'pending':
			return 'Pago pendiente';
		case 'authorized':
			return 'Pago autorizado';
		case 'cancelled':
			return 'Pago cancelado';
		case 'partially_paid':
			return 'Pago parcialmente aprobado';
		case 'refunded':
			return 'Pago reembolsado';
		case 'partially_refunded':
			return 'Pago parcialmente reembolsado';
		case 'voided':
			return 'Pago anulado';
		default:
			return status || 'Sin información';
	}
}

function humanizeShippingStatus(status) {
	switch (String(status || '').toLowerCase()) {
		case 'unpacked':
			return 'Estamos preparando tu pedido';
		case 'packed':
		case 'partially_packed':
			return 'Tu pedido ya fue embalado';
		case 'shipped':
		case 'fulfilled':
		case 'partially_fulfilled':
		case 'dispatched':
			return 'Tu pedido fue despachado';
		case 'delivered':
			return 'Tu pedido fue entregado';
		case 'unshipped':
		case 'unfulfilled':
			return 'Tu pedido todavía no fue despachado';
		default:
			return status || 'Sin información';
	}
}

function humanizeOrderStatus(status) {
	switch (status) {
		case 'open':
			return 'Pedido activo';
		case 'closed':
			return 'Pedido cerrado';
		case 'cancelled':
			return 'Pedido cancelado';
		default:
			return status || 'Sin información';
	}
}

function normalizeString(value = '') {
	return String(value || '').trim();
}

function safeString(value) {
	if (value == null) return null;
	const text = String(value).trim();
	return text ? text : null;
}

function extractTrackingFromFulfillments(order) {
	const fulfillments = Array.isArray(order?.fulfillments)
		? order.fulfillments
		: Array.isArray(order?.fulfillment_orders)
			? order.fulfillment_orders
			: [];

	for (const item of fulfillments) {
		if (!item || typeof item !== 'object') continue;

		const trackingInfo = item?.tracking_info || {};
		const code =
			safeString(trackingInfo?.code) ||
			safeString(item?.tracking_number) ||
			safeString(item?.shipping_tracking_number);

		const url =
			safeString(trackingInfo?.url) ||
			safeString(item?.tracking_url) ||
			safeString(item?.shipping_tracking_url);

		const carrierName =
			safeString(item?.shipping?.carrier?.name) ||
			safeString(item?.shipping?.option?.name) ||
			null;

		const fulfillmentStatus = safeString(item?.status) || null;

		if (code || url || carrierName || fulfillmentStatus) {
			return {
				trackingNumber: code || null,
				trackingUrl: url || null,
				carrierName,
				fulfillmentStatus
			};
		}
	}

	return {
		trackingNumber: null,
		trackingUrl: null,
		carrierName: null,
		fulfillmentStatus: null
	};
}

function extractTracking(order) {
	const directTrackingNumber =
		safeString(order?.shipping_tracking_number) ||
		safeString(order?.tracking_number);

	const directTrackingUrl =
		safeString(order?.shipping_tracking_url) ||
		safeString(order?.tracking_url);

	const directCarrier =
		safeString(order?.shipping_option?.name) ||
		safeString(order?.shipping_carrier);

	if (directTrackingNumber || directTrackingUrl || directCarrier) {
		return {
			trackingNumber: directTrackingNumber || null,
			trackingUrl: directTrackingUrl || null,
			carrierName: directCarrier || null,
			fulfillmentStatus: null
		};
	}

	return extractTrackingFromFulfillments(order);
}

function mergeOrderData(baseOrder, detailOrder) {
	if (!detailOrder) return baseOrder;

	const baseTracking = extractTracking(baseOrder);
	const detailTracking = extractTracking(detailOrder);

	return {
		...detailOrder,
		// conservar fulfillments ricos del listado si el detalle trae solo IDs
		fulfillments:
			Array.isArray(detailOrder?.fulfillments) &&
			detailOrder.fulfillments.length > 0 &&
			typeof detailOrder.fulfillments[0] === 'object'
				? detailOrder.fulfillments
				: baseOrder?.fulfillments ?? detailOrder?.fulfillments,
		fulfillment_orders:
			Array.isArray(detailOrder?.fulfillment_orders) &&
			detailOrder.fulfillment_orders.length > 0 &&
			typeof detailOrder.fulfillment_orders[0] === 'object'
				? detailOrder.fulfillment_orders
				: baseOrder?.fulfillment_orders ?? detailOrder?.fulfillment_orders,

		// conservar tracking del listado si el detalle no lo trae
		shipping_tracking_number:
			detailTracking.trackingNumber || baseTracking.trackingNumber || null,
		shipping_tracking_url:
			detailTracking.trackingUrl || baseTracking.trackingUrl || null,

		_shippingCarrierName:
			detailTracking.carrierName || baseTracking.carrierName || null,
		_fulfillmentStatus:
			detailTracking.fulfillmentStatus || baseTracking.fulfillmentStatus || null
	};
}

function matchesOrder(order, wanted) {
	const target = normalizeString(wanted);

	return (
		normalizeString(order?.number) === target ||
		normalizeString(order?.id) === target ||
		normalizeString(order?.token) === target
	);
}

function normalizeOrderContext(order) {
	const tracking = extractTracking(order);

	return {
		orderId: order.id,
		orderNumber: order.number,
		customerName: order.customer?.name || order.contact_name || order.name || null,
		contactEmail: order.contact_email || null,
		contactPhone: order.contact_phone || null,
		total: order.total,
		currency: order.currency,
		paymentStatus: humanizePaymentStatus(order.payment_status),
		shippingStatus: humanizeShippingStatus(order.shipping_status),
		orderStatus: humanizeOrderStatus(order.status),
		trackingNumber: tracking.trackingNumber,
		trackingUrl: tracking.trackingUrl,
		shippingCarrier:
			tracking.carrierName ||
			safeString(order?._shippingCarrierName) ||
			safeString(order?.shipping_option?.name) ||
			null,
		fulfillmentStatus:
			tracking.fulfillmentStatus ||
			safeString(order?._fulfillmentStatus) ||
			null,
		createdAt: order.created_at || null,
		raw: order
	};
}

async function fetchOrdersPage(client, { q, page = 1, perPage = 50 }) {
	const response = await client.get('/orders', {
		params: {
			q,
			page,
			per_page: perPage
		}
	});

	return Array.isArray(response.data) ? response.data : [];
}

async function fetchOrderDetail(client, orderId) {
	try {
		const response = await client.get(`/orders/${orderId}`);
		return response?.data || null;
	} catch (error) {
		console.error(
			'Error obteniendo detalle de orden en Tiendanube:',
			error.response?.data || error.message
		);
		return null;
	}
}

export async function buildOrderContextByNumber(orderNumber) {
	const wanted = normalizeString(orderNumber);

	if (!wanted) return null;

	const { client } = await getTiendanubeClient();

	let match = null;

	for (let page = 1; page <= 4; page += 1) {
		const orders = await fetchOrdersPage(client, {
			q: wanted,
			page,
			perPage: 50
		});

		if (!orders.length) break;

		match = orders.find((order) => matchesOrder(order, wanted));

		if (match) break;
	}

	if (!match) {
		return null;
	}

	const fullOrder = await fetchOrderDetail(client, match.id);
	const mergedOrder = mergeOrderData(match, fullOrder);

	return normalizeOrderContext(mergedOrder);
}

export async function getOrderByNumber(orderNumber) {
	return buildOrderContextByNumber(orderNumber);
}