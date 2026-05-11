import { prisma } from '../../lib/prisma.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import { getOrderByNumber as getTiendanubeOrderByNumber } from '../tiendanube/orders.service.js';
import { getShopifyClient } from '../shopify/client.js';

function cleanString(value = '') {
	return String(value || '').trim();
}

function humanizePaymentStatus(status) {
	switch (String(status || '').toLowerCase()) {
		case 'paid':
			return 'Pago aprobado';
		case 'pending':
			return 'Pago pendiente';
		case 'authorized':
			return 'Pago autorizado';
		case 'partially_paid':
			return 'Pago parcialmente aprobado';
		case 'refunded':
			return 'Pago reembolsado';
		case 'partially_refunded':
			return 'Pago parcialmente reembolsado';
		case 'voided':
			return 'Pago anulado';
		default:
			return status || 'Sin informacion';
	}
}

function humanizeShippingStatus(status) {
	switch (String(status || '').toLowerCase()) {
		case 'fulfilled':
			return 'Tu pedido fue despachado';
		case 'partial':
		case 'partially_fulfilled':
			return 'Tu pedido fue parcialmente despachado';
		case 'unfulfilled':
		case '':
			return 'Tu pedido todavia no fue despachado';
		default:
			return status || 'Sin informacion';
	}
}

function normalizeShopifyOrderContext(order = {}) {
	const fulfillment = Array.isArray(order.fulfillments)
		? order.fulfillments.find((item) => item?.tracking_number || item?.tracking_url || item?.tracking_company)
		: null;

	return {
		orderId: order.id,
		orderNumber: order.order_number || order.name,
		customerName:
			[order.customer?.first_name, order.customer?.last_name].map(cleanString).filter(Boolean).join(' ') ||
			order.name ||
			null,
		contactEmail: order.email || order.customer?.email || null,
		contactPhone: order.phone || order.customer?.phone || order.shipping_address?.phone || null,
		total: order.total_price,
		currency: order.currency,
		paymentStatus: humanizePaymentStatus(order.financial_status),
		shippingStatus: humanizeShippingStatus(order.fulfillment_status || 'unfulfilled'),
		orderStatus: order.cancelled_at ? 'Pedido cancelado' : order.closed_at ? 'Pedido cerrado' : 'Pedido activo',
		trackingNumber: fulfillment?.tracking_number || null,
		trackingUrl: fulfillment?.tracking_url || null,
		shippingCarrier: fulfillment?.tracking_company || null,
		fulfillmentStatus: fulfillment?.status || order.fulfillment_status || null,
		createdAt: order.created_at || null,
		raw: order
	};
}

async function getActiveCommerceProvider(workspaceId = DEFAULT_WORKSPACE_ID) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const connection = await prisma.commerceConnection.findFirst({
		where: {
			workspaceId: resolvedWorkspaceId,
			status: 'ACTIVE'
		},
		orderBy: [
			{ provider: 'asc' },
			{ updatedAt: 'desc' }
		],
		select: { provider: true }
	});
	return connection?.provider || 'TIENDANUBE';
}

async function getShopifyOrderByNumber(orderNumber, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const wanted = cleanString(orderNumber);
	if (!wanted) return null;

	const { client } = await getShopifyClient({ workspaceId });
	const response = await client.get('/orders.json', {
		params: {
			status: 'any',
			name: wanted.startsWith('#') ? wanted : `#${wanted}`,
			limit: 10,
			fields: [
				'id',
				'name',
				'order_number',
				'created_at',
				'total_price',
				'currency',
				'financial_status',
				'fulfillment_status',
				'cancelled_at',
				'closed_at',
				'email',
				'phone',
				'customer',
				'shipping_address',
				'fulfillments'
			].join(',')
		}
	});
	const orders = Array.isArray(response.data?.orders) ? response.data.orders : [];
	const match = orders.find((order) =>
		cleanString(order.name).replace(/^#/, '') === wanted.replace(/^#/, '') ||
		cleanString(order.order_number) === wanted.replace(/^#/, '') ||
		cleanString(order.id) === wanted
	);
	return match ? normalizeShopifyOrderContext(match) : null;
}

export async function getOrderByNumber(orderNumber, options = {}) {
	const provider = String(options.provider || await getActiveCommerceProvider(options.workspaceId)).toUpperCase();
	if (provider === 'SHOPIFY') {
		return getShopifyOrderByNumber(orderNumber, options);
	}
	return getTiendanubeOrderByNumber(orderNumber, options);
}
