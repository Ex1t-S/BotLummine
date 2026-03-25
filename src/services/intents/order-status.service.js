import { buildOrderContextByNumber } from '../tiendanube/orders.service.js';

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
  const lines = [];

  lines.push(`¡Ya encontré tu pedido #${order.orderNumber}! 😊`);
  lines.push('');
  lines.push(`✅ Pago: ${order.paymentStatus}`);
  lines.push(`📦 Estado: ${order.shippingStatus}`);

  if (order.orderStatus) {
    lines.push(`🧾 Pedido: ${order.orderStatus}`);
  }

  lines.push(`💰 Total: ${formatMoney(order.total, order.currency)}`);

  if (order.trackingNumber) {
    lines.push(`🔎 Seguimiento: ${order.trackingNumber}`);
  }

  if (order.trackingUrl) {
    lines.push(`📍 Podés seguirlo acá: ${order.trackingUrl}`);
  } else if (
    String(order.shippingStatus || '').toLowerCase().includes('preparando') ||
    String(order.shippingStatus || '').toLowerCase().includes('embalado')
  ) {
    lines.push('Apenas tengamos seguimiento cargado, te lo compartimos por acá.');
  }

  return lines.join('\n');
}

export async function handleOrderStatusIntent({ explicitOrderNumber }) {
  if (!explicitOrderNumber) {
    return {
      handled: true,
      forcedReply: '¡Claro! Pasame tu número de pedido y te digo el estado o el seguimiento.',
      liveOrderContext: null
    };
  }

  const liveOrderContext = await buildOrderContextByNumber(explicitOrderNumber).catch((err) => {
    console.error('Error consultando pedido en Tiendanube:', err);
    return null;
  });

  if (!liveOrderContext) {
    return {
      handled: true,
      forcedReply: `No encontré un pedido con el número ${explicitOrderNumber}. Revisalo y, si querés, mandamelo de nuevo.`,
      liveOrderContext: null
    };
  }

  return {
    handled: true,
    forcedReply: null,
    liveOrderContext
  };
}