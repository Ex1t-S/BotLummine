import { inferCommercialFamily } from '../../data/catalog-commercial-map.js';

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
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

	if (/(110 de corpiño|110 de corpino)/.test(text)) return '110';

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
		{ key: 'corpinio', patterns: [/corpiño/, /corpinio/, /corpiños/] },
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

function extractRequestedOfferType(text, currentState = {}) {
	if (/(5x2|cinco por dos)/.test(text)) return '5x2';
	if (/(3x1|tres por uno)/.test(text)) return '3x1';
	if (/(2x1|dos por uno)/.test(text)) return '2x1';
	if (/(pack|combo|promo|promocion|promoción|oferta)/.test(text)) return 'pack';
	return currentState?.requestedOfferType || null;
}

function sanitizeExcludedKeyword(raw = '') {
	return String(raw || '')
		.toLowerCase()
		.replace(/^[\s,.;:!?-]+/, '')
		.replace(/^(el|la|los|las|un|una)\s+/, '')
		.split(/(?:\s+pero\s+|\s+y\s+|\s+porque\s+|\s+que\s+trae\s+|\s+que\s+tenga\s+)/i)[0]
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function extractImplicitExclusions(text, currentProductFamily = null) {
	const detected = [];
	const normalizedFamily = currentProductFamily || inferCommercialFamily(text) || null;

	if (
		/\bsolo\s+(body|bodys|bodies)\b/.test(text) ||
		/\b(body|bodys|bodies)\s+solos?\b/.test(text)
	) {
		detected.push('pantymedia', 'pantymedias', 'media termica', 'medias termicas', 'boob tape');
	}

	if (
		normalizedFamily === 'body_modelador' &&
		/\bsolo\b/.test(text) &&
		/\b(body|bodys|bodies)\b/.test(text)
	) {
		detected.push('pantymedia', 'pantymedias', 'media termica', 'medias termicas', 'boob tape');
	}

	if (/\bsin\s+pantymedias?\b|\bsin\s+medias?\b/.test(text)) {
		detected.push('pantymedia', 'pantymedias', 'media termica', 'medias termicas');
	}

	if (/\bsin\s+boob\s+tape\b/.test(text)) {
		detected.push('boob tape');
	}

	return uniqStrings(detected);
}

function extractExcludedProductKeywords(text, currentState = {}, currentProductFamily = null) {
	const existing = Array.isArray(currentState?.excludedProductKeywords)
		? currentState.excludedProductKeywords
		: [];
	const patterns = [
		/que no sea\s+([^,.!?]+)/gi,
		/no quiero(?:\s+(?:el|la|los|las))?\s+([^,.!?]+)/gi,
		/sin\s+([^,.!?]+)/gi,
		/excepto\s+([^,.!?]+)/gi,
		/menos\s+([^,.!?]+)/gi
	];
	const detected = [];
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			const cleaned = sanitizeExcludedKeyword(match?.[1] || '');
			if (cleaned && cleaned.length >= 3) detected.push(cleaned);
		}
	}

	return uniqStrings([
		...existing,
		...detected,
		...extractImplicitExclusions(text, currentProductFamily),
	]);
}

function inferCurrentProductFamily(text, currentState = {}) {
	return (
		inferCommercialFamily(text) ||
		currentState?.currentProductFamily ||
		inferCommercialFamily(currentState?.currentProductFocus || '') ||
		inferCommercialFamily((Array.isArray(currentState?.interestedProducts) ? currentState.interestedProducts : []).join(' ')) ||
		null
	);
}

function shouldLockCategory({ intent, text, currentState = {}, currentProductFamily = null }) {
	if (intent !== 'product') return Boolean(currentState?.categoryLocked && currentState?.currentProductFamily);
	if (inferCommercialFamily(text)) return true;
	if (/(estabamos hablando de|estábamos hablando de|veniamos hablando de|veníamos hablando de)/.test(text) && (currentProductFamily || currentState?.currentProductFamily)) {
		return true;
	}
	return Boolean(currentState?.categoryLocked && (currentState?.currentProductFamily || currentProductFamily));
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

	return objections;
}

function detectMood(text, intent) {
	if (
		/(estoy enojad|malisimo|malísimo|pesimo|pésimo|horrible|me molesta|me enoja|un desastre|no me responden|quiero reclamar|reclamo|me llego mal|me vino mal)/.test(
			text
		)
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
		/(quiero|me interesa|lo quiero|pasame el link|como compro|me lo llevo|quiero comprar|armar el pedido|armo el pedido|te quiero transferir)/.test(
			text
		)
	) {
		return 'lista_para_comprar';
	}

	return 'neutral';
}

function detectUrgency(text, mood) {
	if (mood === 'molesta') return 'alta';
	if (/(urgente|ya|ahora|hoy|cuanto antes|cuánto antes|lo antes posible|rapido|rápido)/.test(text)) {
		return 'alta';
	}
	if (/(mañana|manana|cuando puedas|después|despues)/.test(text)) {
		return 'media';
	}
	return 'baja';
}

function detectPreferredTone({ mood, intent, isReadyToBuy }) {
	if (mood === 'molesta') return 'calmo_resolutivo';
	if (intent === 'complaint' || intent === 'return_exchange') return 'empatico_concreto';
	if (intent === 'order_status') return 'postventa_clara';
	if (isReadyToBuy) return 'guia_comercial';
	return 'amigable_directo';
}

function inferLastUserGoal(intent, text, isReadyToBuy) {
	if (
		/(armar el pedido|armo el pedido|puedo hacer el pedido|puedo armar el pedido|por aca puedo comprar|por whatsapp puedo comprar|cerrar la compra|avanzar con la compra|te lo compro|te compro|te quiero transferir|pasame alias)/.test(
			text
		)
	) {
		return 'comprar';
	}

	if (intent === 'order_status') return 'seguir_pedido';
	if (intent === 'payment') return 'resolver_pago';
	if (intent === 'shipping') return 'resolver_envio';
	if (intent === 'size_help') return 'elegir_talle';
	if (intent === 'product') return isReadyToBuy ? 'comprar' : 'evaluar_producto';
	if (intent === 'complaint') return 'resolver_reclamo';
	if (intent === 'return_exchange') return 'gestionar_cambio_devolucion';
	if (intent === 'human_handoff') return 'hablar_con_humano';

	return 'consulta_general';
}

function assistantAskedForHumanRecently(recentMessages = []) {
	return recentMessages
		.filter((m) => m.role === 'assistant')
		.slice(-3)
		.some((m) =>
			/(asesora|asesor|persona del equipo|atencion humana|atención humana|te paso con)/i.test(
				String(m.text || '')
			)
		);
}

function wasLoopingRecentMessages(recentMessages = []) {
	const assistantMessages = recentMessages
		.filter((m) => m.role === 'assistant')
		.slice(-3)
		.map((m) => String(m.text || '').trim().toLowerCase());

	if (assistantMessages.length < 3) return false;

	return new Set(assistantMessages).size <= 1;
}

function shouldEscalateToHuman({ text, intent, mood, urgencyLevel, currentState = {}, recentMessages = [] }) {
	const explicitHumanRequest =
		/(quiero hablar con una persona|quiero hablar con alguien|quiero hablar con un humano|humano|asesor|asesora|persona real|atencion humana|atención humana|operador|agente|alguien del equipo)/.test(
			text
		);

	if (explicitHumanRequest || intent === 'human_handoff') {
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

	if (intent === 'order_status') {
		const repeatedPostSaleFriction =
			Number(currentState?.interactionCount || 0) >= 4 &&
			/(no me aparece|no llego|no llegó|pero|seguro|revisalo|revisalo bien|estas segura|estás segura|quiero que lo vea alguien|no me sirve)/.test(
				text
			);

		if (repeatedPostSaleFriction) {
			return {
				needsHuman: true,
				handoffReason: 'postsale_operational_gap'
			};
		}
	}

	if (currentState?.needsHuman === true && assistantAskedForHumanRecently(recentMessages)) {
		return {
			needsHuman: true,
			handoffReason: currentState?.handoffReason || 'assistant_already_offered_handoff'
		};
	}

	if (currentState?.interactionCount >= 8 && wasLoopingRecentMessages(recentMessages)) {
		return {
			needsHuman: true,
			handoffReason: 'too_many_turns_without_resolution'
		};
	}

	if (/(excepcion|excepción|caso especial|se puede hacer una excepcion|se puede hacer una excepción)/.test(text)) {
		return {
			needsHuman: true,
			handoffReason: 'exception_request'
		};
	}

	return {
		needsHuman: false,
		handoffReason: null
	};
}

export function buildHandoffReply({ contactName = '', reason = '' } = {}) {
	const safeName = String(contactName || '').trim();
	const prefix = safeName ? `${safeName}, ` : '';

	const variantsByReason = {
		requested_human: [
			`${prefix}perfecto, te paso con una asesora del equipo para seguir mejor tu consulta 😊`,
			`${prefix}dale, ahora lo toma una asesora así seguimos con atención humana.`,
			`${prefix}ya lo toma una persona del equipo para ayudarte mejor.`
		],
		sensitive_complaint: [
			`${prefix}quiero ayudarte bien con esto, así que te derivo con una asesora para revisarlo en detalle.`,
			`${prefix}para resolverlo mejor te paso con una persona del equipo.`,
			`${prefix}esto conviene verlo con una asesora para darte una respuesta más precisa.`
		],
		urgent_return_exchange: [
			`${prefix}te derivo con una asesora para resolver el cambio o devolución lo antes posible.`,
			`${prefix}esto te lo va a tomar una persona del equipo para verlo mejor.`,
			`${prefix}te paso con una asesora así lo resolvemos sin vueltas.`
		],
		postsale_operational_gap: [
			`${prefix}para revisarlo bien te paso con una asesora del equipo.`,
			`${prefix}esto conviene verlo con una persona del equipo para confirmártelo bien.`,
			`${prefix}te paso con una asesora para que lo revise en detalle.`
		],
		too_many_turns_without_resolution: [
			`${prefix}para no hacerte dar más vueltas, te paso con una asesora 🙌`,
			`${prefix}así avanzamos mejor, ahora lo toma una persona del equipo.`,
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
	const currentProductFamily = inferCurrentProductFamily(text, currentState);

	const isReadyToBuy =
		/(quiero comprar|como compro|pasame el link|me interesa comprar|lo quiero|me lo llevo|quiero ese|armar el pedido|armo el pedido|puedo hacer el pedido|puedo armar el pedido|por aca puedo comprar|por whatsapp puedo comprar|cerrar la compra|avanzar con la compra|te lo compro|te compro|te quiero transferir|te pago por transferencia|pasame alias)/.test(
			text
		);

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

	const objections = mergeStringArrays(currentState.objections, extractObjections(text));
	const requestedOfferType =
		intent === 'product'
			? extractRequestedOfferType(text, currentState)
			: currentState?.requestedOfferType || null;
	const excludedProductKeywords =
		intent === 'product'
			? extractExcludedProductKeywords(text, currentState, currentProductFamily)
			: Array.isArray(currentState?.excludedProductKeywords)
				? currentState.excludedProductKeywords
				: [];
	const categoryLocked = shouldLockCategory({
		intent,
		text,
		currentState,
		currentProductFamily,
	});

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
		currentProductFamily,
		requestedOfferType,
		excludedProductKeywords,
		categoryLocked,
		needsHuman: escalation.needsHuman,
		handoffReason: escalation.handoffReason,
		interactionCount: Number(currentState.interactionCount || 0) + 1,
		isReadyToBuy
	};
}
