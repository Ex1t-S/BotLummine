export async function getTiendanubeOrderByNumber(number) {
  const storeId = process.env.TIENDANUBE_STORE_ID;
  const accessToken = process.env.TIENDANUBE_ACCESS_TOKEN;
  const userAgent =
    process.env.TIENDANUBE_USER_AGENT ||
    'Lummine IA Assistant (germanarroyo016@gmail.com)';

  if (!storeId || !accessToken) {
    throw new Error('Faltan credenciales de Tiendanube en el .env');
  }

  const response = await fetch(
    `https://api.tiendanube.com/v1/${storeId}/orders?q=${encodeURIComponent(number)}`,
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
    throw new Error(`Error Tiendanube: ${JSON.stringify(data)}`);
  }

  const order = Array.isArray(data)
    ? data.find((o) => String(o.number) === String(number))
    : null;

  if (!order) {
    return null;
  }

  return {
    id: order.id,
    number: order.number,
    customer_name: order.customer?.name || order.name || null,
    contact_email: order.contact_email || null,
    contact_phone: order.contact_phone || null,
    total: order.total,
    currency: order.currency,
    payment_status: order.payment_status,
    shipping_status: order.shipping_status,
    status: order.status,
    tracking_number: order.shipping_tracking_number || null,
    tracking_url: order.shipping_tracking_url || null,
    created_at: order.created_at
  };
}