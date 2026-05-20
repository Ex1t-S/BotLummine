export function normalizeSignalText(value = '') {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

export function looksLikeExplicitHumanRequest(text = '') {
	const q = normalizeSignalText(text);
	return /(humano|persona|asesor|asesora|atencion humana|quiero hablar con alguien|no quiero hablar con ia|no me gusta hablar con ia|me atiende una persona|pasame con alguien|operador|agente|alguien del equipo)/i.test(q);
}

export function looksLikeCustomerFrustration(text = '') {
	const q = normalizeSignalText(text);
	return /(no me entendes|no entiendes|no funciona|no sirve|no explica nada|no tengo idea|creo que no vuelvo|no vuelvo a comprar|malisimo|pesimo|\?\?\?)/i.test(q);
}

export function looksLikeThirdPartyAutoReply(text = '') {
	const q = normalizeSignalText(text);
	if (!q) return false;
	return /(gracias\s+por\s+tu\s+mensaje|no\s+atendemos\s+llamadas|no\s+hacemos\s+ventas\s+online|dejanos\s+tu\s+mensaje|horarios?:|lunes\s+a\s+viernes|gracias\s+por\s+(comunicarte|escribir)\s+(con|a)|te\s+comunicaste\s+con|servicio\s+de\s+guardia|solo\s+llamadas\s+por\s+whatsapp|departamento\s+comercial|por\s+consultas\s+o\s+turnos|estudio\s+juridico|mi\s+nombre\s+es\s+.+\s+en\s+que\s+puedo\s+ayudarte|en\s+un\s+momento\s+te\s+respondo|dejame\s+tu\s+consulta|te\s+respondo\s+para\s+ayudarte\s+con\s+tu\s+pedido|espero?\s+tenga\s+un\s+buen\s+dia)/i.test(q);
}

export function looksLikePreSaleObjection(text = '') {
	const q = normalizeSignalText(text);
	if (!q) return false;
	return /(si\s+no\s+me\s+queda|no\s+me\s+queda|hay\s+cambio|cambios?|garantia|devolucion|devolver|se\s+enrolla|se\s+baja|transparenta|marca|incomoda|incomodo|aprieta|talle|medida|tabla\s+de\s+talles|que\s+talle|soy\s+(xs|s|m|l|xl|xxl|xxxl)|uso\s+(xs|s|m|l|xl|xxl|xxxl)|tela|lycra|morley|algodon|calidad|miedo\s+de\s+comprar|comprar\s+online|es\s+caro|muy\s+caro|mas\s+barato|cuanto\s+tarda|envio|llega)/i.test(q);
}

export function looksLikePostSaleIssue(text = '') {
	const q = normalizeSignalText(text);
	if (!q) return false;
	return /(me\s+llego\s+mal|vino\s+mal|vino\s+fallado|vino\s+roto|me\s+mandaron\s+otro|no\s+coincide|talle\s+equivocado|color\s+equivocado|quiero\s+devolver|quiero\s+cambiar|reembolso|reintegro|arrepentimiento|mi\s+pedido|pedido\s+#?\d|orden\s+#?\d|no\s+llego|no\s+me\s+llego|seguimiento|tracking|reclamo|estafa|denuncia)/i.test(q);
}

export function looksLikeSimpleClosing(text = '') {
	const q = normalizeSignalText(text);
	if (!q) return false;
	return /^(ok|okay|oka|oki|dale|listo|gracias|muchas gracias|mil gracias|perfecto|genial|buenisimo|bueno gracias|de nada|joya)[\s!.]*$/i.test(q);
}

export function looksLikeActionableShortConfirmation(text = '') {
	const q = normalizeSignalText(text);
	if (!q) return false;
	return /^(si|sisi|sip|dale|ok|oka|perfecto|listo)\b.*\b(pasame|mandame|enviame|link|comprar|quiero|lo hago|avanzo|pago|transfer|alias|comprobante)\b/i.test(q);
}

export function looksLikeCancellationRequest(text = '') {
	const q = normalizeSignalText(text);
	return /(cancelar|cancelen|anular|anulen|dar de baja).*(compra|pedido|orden|carrito)|(?:compra|pedido|orden).*(cancelar|cancelen|anular|anulen|dar de baja)/i.test(q);
}

export function looksLikeReturnOrWrongItemRequest(text = '') {
	const q = normalizeSignalText(text);
	return /(devolucion|devolver|devuelvan|devolv|reembolso|reintegro|arrepentimiento|cambio|cambiar|me quedo chico|me quedo grande|me llego mal|vino mal|vino fallado|vino roto|me mandaron otro|no coincide|sin color|talle equivocado|color equivocado|envien.*(?:calza|producto)|dinero)/i.test(q);
}

export function looksLikeSensitiveSupport(text = '') {
	const q = normalizeSignalText(text);
	return /(estafa|defensa del consumidor|denuncia|reclamo|verguenza|me bloquearon|bloquearon|no responden|nadie responde|se borran|me llego mal|vino mal|devolucion|devolver|arrepentimiento)/i.test(q);
}

export function looksLikeRapidContinuation(text = '') {
	const q = normalizeSignalText(text);
	if (!q) return false;
	if (looksLikeExplicitHumanRequest(q) || looksLikeCustomerFrustration(q)) return false;
	if (looksLikeActionableShortConfirmation(q)) return false;
	if (/\d/.test(q) || /\b(quiero|necesito|talle|foto|imagen|cuando|hay|tenes|tienes|stock|precio)\b/i.test(q)) return false;
	if (String(text || '').includes('?')) return false;
	return q.length <= 80 || /^(tambien|ademas|y |ah |me |yo |pero |igual |ya |es que|xq|porque)/i.test(q);
}

export function shouldTreatAsPreSaleObjection({ text = '', campaignContext = null, currentState = {} } = {}) {
	const category = String(campaignContext?.category || currentState?.campaignContext?.category || '').toLowerCase();
	if (!['cart_recovery', 'sales', 'marketing'].includes(category)) return false;
	if (!looksLikePreSaleObjection(text)) return false;
	if (looksLikeExplicitHumanRequest(text) || looksLikeCustomerFrustration(text)) return false;
	if (looksLikePostSaleIssue(text)) return false;
	return true;
}
