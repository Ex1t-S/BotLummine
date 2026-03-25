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
    default:
      return status || 'Sin información';
  }
}

function humanizeShippingStatus(status) {
  switch (status) {
    case 'unpacked':
      return 'Estamos preparando tu pedido';
    case 'packed':
      return 'Tu pedido ya fue embalado';
    case 'shipped':
      return 'Tu pedido fue despachado';
    case 'delivered':
      return 'Tu pedido fue entregado';
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

export async function buildOrderContextByNumber(orderNumber) {
  const storeId = process.env.TIENDANUBE_STORE_ID;
  const accessToken = process.env.TIENDANUBE_ACCESS_TOKEN;
  const userAgent =
    process.env.TIENDANUBE_USER_AGENT ||
    'Lummine IA Assistant (germanarroyo016@gmail.com)';

  if (!storeId || !accessToken) {
    throw new Error('Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN en el .env');
  }

  const response = await fetch(
    `https://api.tiendanube.com/v1/${storeId}/orders?q=${encodeURIComponent(orderNumber)}`,
    {
      method: 'GET',
      headers: {
        Authentication: `bearer ${accessToken}`,
        'User-Agent': userAgent,
        'Content-Type': 'application/json'
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Error consultando Tiendanube: ${JSON.stringify(data)}`);
  }

  const order = Array.isArray(data)
    ? data.find((o) => String(o.number) === String(orderNumber))
    : null;

  if (!order) {
    return null;
  }

  return {
    orderId: order.id,
    orderNumber: order.number,
    customerName: order.customer?.name || order.name || null,
    contactEmail: order.contact_email || null,
    contactPhone: order.contact_phone || null,
    total: order.total,
    currency: order.currency,
    paymentStatus: humanizePaymentStatus(order.payment_status),
    shippingStatus: humanizeShippingStatus(order.shipping_status),
    orderStatus: humanizeOrderStatus(order.status),
    trackingNumber: order.shipping_tracking_number || null,
    trackingUrl: order.shipping_tracking_url || null,
    createdAt: order.created_at,
    raw: order
  };
}