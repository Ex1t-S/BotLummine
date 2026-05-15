import { getOrderByNumber } from '../commerce/orders.service.js';
import { resolveEnboxTracking } from '../enbox/enbox.service.js';
import { findCachedEnboxShipment } from '../enbox/enbox-sync.service.js';
import { getShippingStatusMeta } from '../common/shipping-status.js';
import { logger } from '../../lib/logger.js';

function formatMoney(value, currency = 'ARS') {
	const num = Number(value || 0);

	try {
		return new Intl.NumberFormat('es-AR', {
			style: 'currency',
			currency,
			maximumFractionDigits: 0
		}).format(num);
	} catch {
		return `${currency} ${num}`;
	}
}

export function buildFixedOrderReply(order) {
	if (!order) {
		return 'No encontre un pedido con ese numero. Si queres, revisalo y mandamelo de nuevo.';
	}

	const parts = [];
	const shippingMeta = getShippingStatusMeta(order.shippingStatus || order.fulfillmentStatus || '');
	const shippingCategory = shippingMeta.category;
	const carrier = String(order.shippingCarrier || '').trim();
	const isEnbox = /enbox/i.test(carrier);
	const statusLabel =
		shippingCategory && shippingCategory !== 'unknown'
			? shippingMeta.label
			: order.shippingStatus || 'Sin dato de envio';

	parts.push(`Encontre tu pedido #${order.orderNumber}.`);

	if (order.paymentStatus) {
		parts.push(`El pago figura como: ${order.paymentStatus}.`);
	}

	if (statusLabel) {
		parts.push(`El envio esta: ${statusLabel}.`);
	}

	if (order.orderStatus) {
		parts.push(`Estado general: ${order.orderStatus}.`);
	}

	if (carrier) {
		parts.push(
			isEnbox
				? 'Lo gestiona Enbox, nuestra logistica privada.'
				: `Correo/logistica: ${carrier}.`
		);
	}

	if (order.total) {
		parts.push(`Total del pedido: ${formatMoney(order.total, order.currency)}.`);
	}

	if (order.trackingUrl) {
		parts.push(
			isEnbox
				? `Podes ver el seguimiento de Enbox aca: ${order.trackingUrl}`
				: `Podes seguirlo desde este link: ${order.trackingUrl}`
		);
	} else if (order.trackingNumber) {
		parts.push(
			isEnbox
				? `Codigo interno de Enbox: ${order.trackingNumber}.`
				: `Codigo de seguimiento: ${order.trackingNumber}.`
		);
	} else if (shippingCategory === 'delivered') {
		parts.push('Ya figura como entregado. En este caso no tengo un link de seguimiento para compartirte por aca.');
	} else if (isEnbox) {
		parts.push('Todavia no tengo un link de seguimiento de Enbox cargado para compartirte. Si el estado no cambia o necesitas revisarlo puntual, lo toma una asesora.');
	} else {
		parts.push('Todavia no tengo un link o codigo de seguimiento cargado. Cuando el correo lo informe, deberia aparecer actualizado en el pedido.');
	}

	return parts.join(' ');
}

export async function handleOrderStatusIntent({ explicitOrderNumber, currentState = {}, workspaceId }) {
	const orderNumber =
		String(explicitOrderNumber || currentState?.lastOrderNumber || '').trim() || null;

	if (!orderNumber) {
		return {
			handled: true,
			forcedReply: 'Pasame tu numero de pedido y te reviso el estado por aca.',
			liveOrderContext: null,
			aiGuidance: {
				type: 'order_status',
				missing: ['order_number']
			}
		};
	}

	const liveOrderContext = await getOrderByNumber(orderNumber, { workspaceId }).catch((err) => {
		logger.warn('order_status.ecommerce_lookup_failed', {
			workspaceId,
			orderNumber,
			error: err,
		});
		return null;
	});

	if (!liveOrderContext) {
		return {
			handled: true,
			forcedReply: `No encontre un pedido con el numero ${orderNumber}. Si queres, revisalo y mandamelo de nuevo.`,
			liveOrderContext: null,
			aiGuidance: {
				type: 'order_status',
				orderNumber,
				found: false
			}
		};
	}

	if (
		!liveOrderContext.trackingUrl &&
		String(liveOrderContext.shippingCarrier || '').toLowerCase().includes('enbox')
	) {
		try {
			const cachedShipment = await findCachedEnboxShipment(orderNumber, { workspaceId });
			if (cachedShipment?.trackingUrl || cachedShipment?.trackingNumber) {
				liveOrderContext.trackingUrl = cachedShipment.trackingUrl || liveOrderContext.trackingUrl;
				liveOrderContext.trackingNumber = cachedShipment.trackingNumber || liveOrderContext.trackingNumber;
				liveOrderContext.shippingStatus = cachedShipment.shippingStatus || liveOrderContext.shippingStatus;
				liveOrderContext.enboxTracking = cachedShipment;
			}
		} catch (error) {
			logger.warn('order_status.enbox_cache_lookup_failed', {
				workspaceId,
				orderNumber,
				error,
			});
		}

		if (liveOrderContext.trackingUrl || liveOrderContext.trackingNumber) {
			return {
				handled: true,
				forcedReply: buildFixedOrderReply(liveOrderContext),
				liveOrderContext,
				aiGuidance: {
					type: 'order_status',
					orderNumber,
					found: true,
					hasTracking: true,
					shippingCarrier: liveOrderContext.shippingCarrier || null
				}
			};
		}

		try {
			const enboxTracking = await resolveEnboxTracking(liveOrderContext, { workspaceId });
			if (enboxTracking?.trackingUrl || enboxTracking?.trackingNumber) {
				liveOrderContext.trackingUrl =
					enboxTracking.trackingUrl || liveOrderContext.trackingUrl;
				liveOrderContext.trackingNumber =
					enboxTracking.trackingNumber || liveOrderContext.trackingNumber;
				liveOrderContext.shippingStatus =
					enboxTracking.shippingStatus || liveOrderContext.shippingStatus;
				liveOrderContext.enboxTracking = enboxTracking;
			}
		} catch (error) {
			logger.warn('order_status.enbox_tracking_lookup_failed', {
				workspaceId,
				orderNumber,
				error,
			});
		}
	}

	return {
		handled: true,
		forcedReply: buildFixedOrderReply(liveOrderContext),
		liveOrderContext,
		aiGuidance: {
			type: 'order_status',
			orderNumber,
			found: true,
			hasTracking: Boolean(liveOrderContext.trackingUrl || liveOrderContext.trackingNumber),
			shippingCarrier: liveOrderContext.shippingCarrier || null
		}
	};
}
