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

	if (currentState?.lastIntent === 'order_status' && orderNumber) {
		return 'order_status';
	}

	if (
		/(quiero hablar con una persona|quiero hablar con alguien|humano|asesor|persona real|operador)/.test(q)
	) {
		return 'human_handoff';
	}

	if (
		/(reclamo|queja|me llego mal|me llegó mal|vino fallado|vino roto|no me gusto|no me gustó|estoy disconforme|estoy desconforme|muy mala atencion|muy mala atención)/.test(q)
	) {
		return 'complaint';
	}

	if (
		/(cambio|devolucion|devolución|devolver|quiero cambiar|quiero devolver|me quedo chico|me quedó chico|me quedo grande|me quedó grande)/.test(q)
	) {
		return 'return_exchange';
	}

	if (/(pedido|orden|seguimiento|estado de mi pedido|mi compra|despachado|lleg[oó]|demora)/.test(q)) {
		return 'order_status';
	}

	if (/(transferencia|alias|cbu|banco|comprobante|pago|cuotas|tarjeta|mercado pago)/.test(q)) {
		return 'payment';
	}

	if (/(env[ií]o|enviar|correo|oca|andreani|interior|provincia|llega|demora|retiro|retirar)/.test(q)) {
		return 'shipping';
	}

	if (/(talle|medida|medidas|tabla de talles|que talle|qué talle)/.test(q)) {
		return 'size_help';
	}

	if (/(stock|disponible|queda|color|colores)/.test(q)) {
		return 'stock_check';
	}

	if (
		/(body|bodies|faja|short|corpi|bombacha|musculosa|calza|conjunto|morley|legging|leggings|pack|combo|corset|modelador)/.test(q)
	) {
		return 'product';
	}

	return 'general';
}