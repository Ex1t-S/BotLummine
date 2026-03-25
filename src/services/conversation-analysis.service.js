function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

function uniqStrings(values = []) {
	return [...new Set(values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))];
}

function mergeStringArrays(existing, incoming) {
	const current = Array.isArray(existing) ? existing : [];
	const next = Array.isArray(incoming) ? incoming : [];
	return uniqStrings([...current, ...next]);
}

function extractFrequentSize(text) {
	const rangeMatch = text.match(/\b(\d{2}\s*\/\s*\d{2})\b/);
	if (rangeMatch?.[1]) return rangeMatch[1].replace(/\s+/g, '');

	const sizePatterns = [
		/\b(xxxl|3xl)\b/i,
		/\b(xxl|2xl)\b/i,
		/\b(xl)\b/i,
		/\b(l)\b/i,
		/\b(m)\b/i,
		/\b(s)\b/i,
		/\b(xs)\b/i
	];

	for (const pattern of sizePatterns) {
		const match = text.match(pattern);
		if (match?.[1]) return match[1].toUpperCase();
	}

	return null;
}

function detectPaymentPreference(text) {
	if (/(mercado pago|mercadopago)/.test(text)) return 'mercadopago';
	if (/(transferencia|transferir|cbu|alias)/.test(text)) return 'transferencia';
	if (/(tarjeta|credito|crédito|debito|débito|cuotas)/.test(text)) return 'tarjeta';
	if (/(efectivo)/.test(text)) return 'efectivo';
	return null;
}

function detectDeliveryPreference(text) {
	if (/(retiro|retirar|paso a buscar|buscarlo|busco yo)/.test(text)) return 'retiro';
	if (/(envio|envío|correo|domicilio|mandar|despachar)/.test(text)) return 'envio';
	return null;
}

function extractInterestedProducts(text) {
	const dictionary = [
		{ key: 'body', patterns: [/body/, /bodies/] },
		{ key: 'calza', patterns: [/calza/, /calzas/] },
		{ key: 'legging', patterns: [/legging/, /leggings/] },
		{ key: 'corset', patterns: [/corset/] },
		{ key: 'faja', patterns: [/faja/, /fajas/] },
		{ key: 'corpinio', patterns: [/corpiño/, /corpinio/, /corpiños/, /corpinhos/] },
		{ key: 'pack', patterns: [/pack/, /combo/, /conjunto/] },
		{ key: 'modelador', patterns: [/modelador/, /modeladora/, /moldeador/] },
		{ key: 'bombacha', patterns: [/bombacha/, /bombachas/] },
		{ key: 'musculosa', patterns: [/musculosa/, /musculosas/] },
		{ key: 'short', patterns: [/short/, /shorts/] }
	];

	return dictionary
		.filter((item) => item.patterns.some((pattern) => pattern.test(text)))
		.map((item) => item.key);
}

function extractObjections(text) {
	const objections = [];

	if (/(caro|precio|sale mucho|muy caro|tenes algo mas barato|más barato|mucho dinero)/.test(text)) {
		objections.push('precio');
	}

	if (/(talle|tallas|medida|medidas|no se que talle|no sé que talle)/.test(text)) {
		objections.push('talle');
	}

	if (/(envio|envío|demora|cuando llega|cuanto tarda|cuánto tarda)/.test(text)) {
		objections.push('envio');
	}

	if (/(pago|tarjeta|transferencia|cuotas|alias|cbu)/.test(text)) {
		objections.push('pago');
	}

	if (/(calidad|material|tela|transparente|se marca)/.test(text)) {
		objections.push('calidad');
	}

	return objections;
}

function detectMood(text, intent) {
	if (
		/(estoy enojad|malisimo|malísimo|pesimo|pésimo|horrible|me molesta|me enoja|un desastre|no me responden|quiero reclamar|reclamo|me llego mal|me llegó mal|me vino mal)/.test(text)
	) {
		return 'molesta';
	}

	if (/(urgente|ya|ahora|cuanto antes|necesito hoy|rapid[oa]|apurad[oa]|para hoy)/.test(text)) {
		return 'apurada';
	}

	if (/(no se|no sé|no entiendo|estoy confundid|cual me conviene|cuál me conviene|me ayudas|tengo dudas)/.test(text)) {
		return 'confundida';
	}

	if (
		(intent === 'product' || intent === 'payment') &&
		/(quiero|me interesa|lo quiero|pasame el link|pásame el link|como compro|cómo compro|me lo llevo|lo compro|quiero comprar)/.test(text)
	) {
		return 'lista_para_comprar';
	}

	return 'neutral';
}

function detectUrgency(text, mood) {
	if (mood === 'molesta') return 'alta';

	if (/(urgente|ya|ahora|hoy|cuanto antes|cuánto antes|lo antes posible|rapido|rápido|rapid[oa])/.test(text)) {
		return 'alta';
	}

	if (/(cuando puedas|en un rato|despues|después|para hoy|mañana|manana)/.test(text)) {
		return 'media';
	}

	return 'baja';
}

function detectPreferredTone({ mood, intent, isReadyToBuy }) {
	if (mood === 'molesta') return 'calmo_resolutivo';
	if (intent === 'complaint' || intent === 'return_exchange') return 'empatico_concreto';
	if (intent === 'order_status') return 'postventa_clara';
	if (intent === 'size_help') return 'asesoramiento_calido';
	if (isReadyToBuy) return 'cierre_comercial';
	if (intent === 'product') return 'venta_calida';
	return 'amigable_directo';
}

function inferLastUserGoal(intent, text, isReadyToBuy) {
	if (intent === 'order_status') return 'seguir_pedido';
	if (intent === 'payment') return 'resolver_pago';
	if (intent === 'shipping') return 'resolver_envio';
	if (intent === 'size_help') return 'elegir_talle';
	if (intent === 'product') return isReadyToBuy ? 'comprar' : 'evaluar_producto';
	if (intent === 'complaint') return 'resolver_reclamo';
	if (intent === 'return_exchange') return 'gestionar_cambio_devolucion';
	if (intent === 'human_handoff') return 'hablar_con_humano';

	if (/(quiero comprar|como compro|cómo compro|pasame el link|pásame el link|me interesa)/.test(text)) {
		return 'comprar';
	}

	return 'consulta_general';
}

function wasLoopingRecentMessages(recentMessages = []) {
	const assistantMessages = recentMessages
		.filter((m) => m.role === 'assistant')
		.slice(-3)
		.map((m) => String(m.text || '').trim().toLowerCase());

	if (assistantMessages.length < 3) return false;

	return new Set(assistantMessages).size <= 2;
}

function shouldEscalateToHuman({ text, intent, mood, urgencyLevel, currentState = {}, recentMessages = [] }) {
	const explicitHumanRequest =
		/(quiero hablar con una persona|quiero hablar con alguien|asesor|humano|persona real|atencion humana|atención humana|operador)/.test(text);

	if (explicitHumanRequest) {
		return {
			needsHuman: true,
			handoffReason: 'requested_human'
		};
	}

	if (intent === 'complaint' && mood === 'molesta') {
		return {
			needsHuman: true,
			handoffReason: 'sensitive_complaint'
		};
	}

	if (intent === 'return_exchange' && urgencyLevel === 'alta') {
		return {
			needsHuman: true,
			handoffReason: 'urgent_return_exchange'
		};
	}

	if (currentState?.interactionCount >= 6 && wasLoopingRecentMessages(recentMessages)) {
		return {
			needsHuman: true,
			handoffReason: 'too_many_turns_without_resolution'
		};
	}

	if (
		/(excepcion|excepción|caso especial|se puede hacer una excepcion|se puede hacer una excepción)/.test(text)
	) {
		return {
			needsHuman: true,
			handoffReason: 'exception_request'
		};
	}

	return {
		needsHuman: Boolean(currentState?.needsHuman),
		handoffReason: currentState?.handoffReason || null
	};
}

export function buildHandoffReply({ contactName = '', reason = '' } = {}) {
	const safeName = String(contactName || '').trim();
	const prefix = safeName ? `${safeName}, ` : '';

	const variantsByReason = {
		requested_human: [
			`${prefix}perfecto. Te derivo con una asesora para que te ayude mejor 😊`,
			`${prefix}dale, te paso con una persona del equipo para seguir mejor tu caso.`,
			`${prefix}ya te toma una asesora así lo vemos bien con vos.`
		],
		sensitive_complaint: [
			`${prefix}quiero ayudarte bien con esto, así que te derivo con una asesora para revisarlo en detalle.`,
			`${prefix}para resolverlo mejor te paso con una persona del equipo ahora.`,
			`${prefix}esto conviene verlo con una asesora para darte una solución más precisa.`
		],
		urgent_return_exchange: [
			`${prefix}te derivo con una asesora para resolver el cambio/devolución lo antes posible.`,
			`${prefix}esto te lo va a tomar una persona del equipo para verlo más rápido.`,
			`${prefix}te paso con una asesora así lo resolvemos mejor y sin vueltas.`
		],
		too_many_turns_without_resolution: [
			`${prefix}para no hacerte dar más vueltas, te paso con una asesora 🙌`,
			`${prefix}así avanzamos mejor, te derivo con una persona del equipo.`,
			`${prefix}prefiero que lo tome una asesora para resolverlo bien.`
		],
		exception_request: [
			`${prefix}como es un caso especial, te derivo con una asesora para revisarlo.`,
			`${prefix}esto conviene verlo con una persona del equipo para confirmártelo bien.`,
			`${prefix}te paso con una asesora así te da una respuesta segura sobre este caso.`
		],
		default: [
			`${prefix}te derivo con una asesora para seguir mejor con tu consulta.`,
			`${prefix}ya te toma una persona del equipo para ayudarte.`,
			`${prefix}te paso con una asesora así seguimos mejor.`
		]
	};

	const variants = variantsByReason[reason] || variantsByReason.default;
	return variants[Math.floor(Math.random() * variants.length)];
}

export function analyzeConversationTurn({
	messageBody,
	intent,
	currentState = {},
	recentMessages = []
}) {
	const text = normalizeText(messageBody);

	const isReadyToBuy =
		/(quiero comprar|como compro|cómo compro|pasame el link|pásame el link|me interesa comprar|lo quiero|me lo llevo|quiero ese)/.test(text);

	const mood = detectMood(text, intent);
	const urgencyLevel = detectUrgency(text, mood);

	const escalation = shouldEscalateToHuman({
		text,
		intent,
		mood,
		urgencyLevel,
		currentState,
		recentMessages
	});

	const preferredTone = detectPreferredTone({
		mood,
		intent,
		isReadyToBuy
	});

	const frequentSize = extractFrequentSize(text) || currentState.frequentSize || null;
	const paymentPreference = detectPaymentPreference(text) || currentState.paymentPreference || null;
	const deliveryPreference = detectDeliveryPreference(text) || currentState.deliveryPreference || null;

	const interestedProducts = mergeStringArrays(
		currentState.interestedProducts,
		extractInterestedProducts(text)
	);

	const objections = mergeStringArrays(
		currentState.objections,
		extractObjections(text)
	);

	return {
		customerMood: mood,
		urgencyLevel,
		preferredTone,
		frequentSize,
		paymentPreference,
		deliveryPreference,
		interestedProducts,
		objections,
		lastDetectedIntent: intent,
		lastUserGoal: inferLastUserGoal(intent, text, isReadyToBuy),
		needsHuman: escalation.needsHuman,
		handoffReason: escalation.handoffReason,
		interactionCount: Number(currentState.interactionCount || 0) + 1,
		isReadyToBuy
	};
}