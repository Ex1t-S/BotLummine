export function normalizeDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

export function extractOrderNumber(text = '') {
  const match = String(text || '').match(/\b\d{4,10}\b/);
  return match ? match[0] : null;
}

export function detectIntent(text = '', currentState = {}) {
  const q = String(text || '').toLowerCase().trim();
  const orderNumber = extractOrderNumber(text);

  // Si venimos de una conversación sobre pedido y ahora manda un número,
  // interpretarlo como respuesta al número de orden.
  if (currentState?.lastIntent === 'order_status' && orderNumber) {
    return 'order_status';
  }

  if (/(pedido|orden|seguimiento|estado de mi pedido|mi compra|despachado|lleg[oó]|demora)/.test(q)) {
    return 'order_status';
  }

  if (/(transferencia|alias|cbu|banco|comprobante|pago)/.test(q)) {
    return 'payment';
  }

  if (/(env[ií]o|enviar|correo|oca|andreani|interior|provincia|llega|demora)/.test(q)) {
    return 'shipping';
  }

  if (/(talle|medida|medidas)/.test(q)) {
    return 'size_help';
  }

  if (/(stock|disponible|queda|color|colores)/.test(q)) {
    return 'stock_check';
  }

  if (/(body|bodies|faja|short|corpi|bombacha|musculosa|calza|conjunto|morley)/.test(q)) {
    return 'product';
  }

  return 'general';
}