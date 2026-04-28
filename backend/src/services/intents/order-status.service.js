import { getOrderByNumber } from '../tiendanube/orders.service.js';
import { resolveEnboxTracking } from '../enbox/enbox.service.js';
import { findCachedEnboxShipment } from '../enbox/enbox-sync.service.js';

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
		return 'No encontré un pedido con ese número. Si querés, revisalo y mandamelo de nuevo.';
	}

	const parts = [];
	parts.push(`Ya encontré tu pedido #${order.orderNumber}.`);

	if (order.paymentStatus) {
		parts.push(`Pago: ${order.paymentStatus}.`);
	}

	if (order.shippingStatus) {
		parts.push(`Estado del envío: ${order.shippingStatus}.`);
	}

	if (order.orderStatus) {
		parts.push(`Estado general: ${order.orderStatus}.`);
	}

	if (order.shippingCarrier) {
		parts.push(`Envío: ${order.shippingCarrier}.`);
	}

	if (order.total) {
		parts.push(`Total: ${formatMoney(order.total, order.currency)}.`);
	}

	if (order.trackingUrl) {
		parts.push(`Podés seguirlo acá: ${order.trackingUrl}`);
	} else if (order.trackingNumber) {
		parts.push(`Código de seguimiento: ${order.trackingNumber}.`);
	} else if (String(order.shippingStatus || '').toLowerCase().includes('entregado')) {
		parts.push('Ya figura como entregado. En este caso no tengo un link de seguimiento para compartirte por acá.');
	} else if (order.shippingCarrier && /enbox/i.test(order.shippingCarrier)) {
		parts.push('Este envío figura gestionado por EnBox y por ahora no tengo un código de seguimiento cargado para compartirte.');
	} else {
		parts.push('Por ahora no tengo un código de seguimiento cargado para compartirte.');
	}

	return parts.join(' ');
}

export async function handleOrderStatusIntent({ explicitOrderNumber, currentState = {}, workspaceId }) {
	const orderNumber =
		String(explicitOrderNumber || currentState?.lastOrderNumber || '').trim() || null;

	if (!orderNumber) {
		return {
			handled: true,
			forcedReply: 'Pasame tu número de pedido y te reviso el estado por acá.',
			liveOrderContext: null,
			aiGuidance: {
				type: 'order_status',
				missing: ['order_number']
			}
		};
	}

	const liveOrderContext = await getOrderByNumber(orderNumber, { workspaceId }).catch((err) => {
		console.error('Error consultando pedido en Tiendanube:', err);
		return null;
	});

	if (!liveOrderContext) {
		return {
			handled: true,
			forcedReply: `No encontré un pedido con el número ${orderNumber}. Si querés, revisalo y mandamelo de nuevo.`,
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
			console.error('Error consultando cache de Enbox:', error);
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
			console.error('Error consultando tracking en Enbox:', error);
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
