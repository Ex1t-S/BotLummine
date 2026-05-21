export const AI_VERTICALS = {
	ECOMMERCE: 'ECOMMERCE',
	INSURANCE: 'INSURANCE',
};

const INSURANCE_WORKSPACE_IDS = new Set(['cmpevb0oq0000pd0pgp66xq6k']);

const ECOMMERCE_PROFILE = {
	vertical: AI_VERTICALS.ECOMMERCE,
	label: 'Ecommerce',
	usesCommerceEngine: true,
	basePolicy: [
		'Responde como asesora humana de ventas por WhatsApp.',
		'Usa solo datos confirmados por el catalogo, pedidos, pagos y contexto operativo disponible.',
		'No inventes productos, precios, promos, stock, links, estados de pago, envios ni tracking.',
		'Diferencia soporte de venta: si el cliente pregunta por pedido, pago o envio, resolvelo sin abrir promociones salvo pedido explicito.',
		'Se breve, natural y comercial; no uses listas largas ni repitas saludos, links o precios ya dados.'
	].join(' '),
	relevantInfoTitle: 'CATALOGO RELEVANTE',
	hintsTitle: 'PISTAS COMERCIALES',
	defaultHint: 'Guia una sola opcion principal y no abras todo el catalogo.',
	greetingHints: [
		'Es solo un saludo inicial.',
		'No ofrezcas productos ni promos todavia.',
		'Responde breve y natural, invitando a contar que esta buscando.'
	],
	catalogUnavailableContext: 'Catalogo local no disponible en esta base. No hay productos confirmados para ofrecer.',
	catalogUnavailableHints: [
		'El catalogo local no esta disponible en esta base.',
		'No inventes productos, promos, precios ni links.',
		'Pedi una aclaracion corta o ofrece pasar con una asesora.'
	],
	genericMenuOptions: ['Catalogo general', 'Medios de pago', 'Envios', 'Talles'],
	bannedReplyTerms: [],
};

const INSURANCE_PROFILE = {
	vertical: AI_VERTICALS.INSURANCE,
	label: 'Seguros',
	usesCommerceEngine: false,
	basePolicy: [
		'Responde como asistente de una oficina de seguros por WhatsApp.',
		'Orienta sobre seguros, citas, datos de oficina y gestiones generales usando solo informacion confirmada.',
		'No inventes precios, coberturas, autorizaciones, tramites completados ni estados de poliza.',
		'Si la consulta requiere datos personales, poliza, autorizacion, reembolso o una decision operativa, deriva a un asesor.',
		'Se breve, claro y formal.'
	].join(' '),
	relevantInfoTitle: 'INFORMACION RELEVANTE',
	hintsTitle: 'PISTAS DE ATENCION',
	defaultHint: 'Orienta segun el seguro o gestion solicitada y deriva si requiere asesor.',
	greetingHints: [
		'Es solo un saludo inicial.',
		'No menciones catalogo, stock, talles, carrito ni promos.',
		'Responde breve, presenta la oficina y pregunta que seguro o gestion necesita.'
	],
	serviceHints: [
		'Orienta por tipo de seguro: salud particular, empresa, autonomo, dental, decesos, hogar, vida o renta.',
		'Para contratar, pide datos minimos para que un asesor prepare la propuesta.',
		'No cierres precio, cobertura, alta, autorizacion ni estado de poliza desde la IA.',
		'Para clientes actuales, polizas, autorizaciones, reembolsos o datos personales, deriva a asesor.'
	],
	genericMenuOptions: ['Seguros', 'Citas y oficina', 'Gestiones de cliente', 'Hablar con un asesor'],
	bannedReplyTerms: [
		'stock',
		'talle',
		'talles',
		'carrito',
		'checkout',
		'tienda online',
		'envio',
		'envios',
		'promo',
		'promos',
		'pack',
	],
};

const PROFILES = {
	[AI_VERTICALS.ECOMMERCE]: ECOMMERCE_PROFILE,
	[AI_VERTICALS.INSURANCE]: INSURANCE_PROFILE,
};

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

export function normalizeAiVertical(value = '') {
	const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
	if (['insurance', 'seguros', 'seguro', 'aseguradora'].includes(normalized)) return AI_VERTICALS.INSURANCE;
	if (['ecommerce', 'e_commerce', 'commerce', 'tienda', 'retail', 'moda'].includes(normalized)) return AI_VERTICALS.ECOMMERCE;
	return null;
}

export function resolveAiVertical({
	workspaceConfig = null,
	workspaceId = '',
	workspaceName = '',
	businessName = '',
	businessContext = '',
} = {}) {
	const aiConfig = workspaceConfig?.ai || workspaceConfig?.aiConfig || {};
	const configured = normalizeAiVertical(aiConfig?.catalogConfig?.vertical);
	if (configured) return configured;

	const resolvedWorkspaceId = String(workspaceId || workspaceConfig?.workspaceId || '').trim();
	if (INSURANCE_WORKSPACE_IDS.has(resolvedWorkspaceId)) return AI_VERTICALS.INSURANCE;

	const text = normalizeText([
		workspaceName,
		workspaceConfig?.workspaceName,
		businessName,
		aiConfig?.businessName,
		businessContext,
		aiConfig?.businessContext,
	].filter(Boolean).join(' '));

	if (/\b(dkv|seguros?|polizas?|aseguradora|vecindario|las palmas)\b/.test(text)) {
		return AI_VERTICALS.INSURANCE;
	}

	return AI_VERTICALS.ECOMMERCE;
}

export function getAiVerticalProfile(verticalOrOptions = AI_VERTICALS.ECOMMERCE) {
	const vertical = typeof verticalOrOptions === 'string'
		? normalizeAiVertical(verticalOrOptions) || verticalOrOptions
		: resolveAiVertical(verticalOrOptions);
	return PROFILES[vertical] || ECOMMERCE_PROFILE;
}

export function usesCommerceEngine(verticalOrOptions = AI_VERTICALS.ECOMMERCE) {
	return getAiVerticalProfile(verticalOrOptions).usesCommerceEngine === true;
}

export function isInsuranceVertical(verticalOrOptions = AI_VERTICALS.ECOMMERCE) {
	return getAiVerticalProfile(verticalOrOptions).vertical === AI_VERTICALS.INSURANCE;
}

export function isInsuranceWorkspaceId(workspaceId = '') {
	return INSURANCE_WORKSPACE_IDS.has(String(workspaceId || '').trim());
}

export function buildVerticalNonCommercePlan({
	vertical = AI_VERTICALS.INSURANCE,
	messageBody = '',
	currentState = {},
	intent = 'general',
} = {}) {
	const profile = getAiVerticalProfile(vertical);
	const normalized = normalizeText(messageBody);
	const greetingOnly = /^(hola|holi|buenas|buen dia|buenas tardes|buenas noches|hello|hi)[!.,\s]*$/.test(normalized);
	const sensitive = /\b(ya soy cliente|soy cliente|mi poliza|autorizacion|reembolso|recibo|certificado|duplicado|tarjeta sanitaria|cuadro medico|incidencia|datos personales)\b/.test(normalized);
	const hiring = /\b(contratar|alta|cotizar|presupuesto|quiero un seguro|me interesa|asegurar|seguro|poliza|salud|dental|decesos|hogar|vida|renta|autonomo|empresa|pyme)\b/.test(normalized);

	return {
		vertical: profile.vertical,
		stage: sensitive ? 'NEEDS_HUMAN' : hiring ? 'SERVICE_DISCOVERY' : 'DISCOVERY',
		mood: currentState?.customerMood || 'neutral',
		buyingIntentLevel: null,
		requestedAction: greetingOnly ? 'GREETING' : sensitive ? 'SENSITIVE_SERVICE' : hiring ? 'ASK_SERVICE' : 'GENERAL',
		productFocus: null,
		productFocusLabel: null,
		productFamily: null,
		productFamilyLabel: null,
		categoryLocked: false,
		rankedProducts: [],
		bestOffer: null,
		fallbackOffer: null,
		offerOptions: [],
		offerCandidates: [],
		alreadyShared: { sharedLinks: [], shownPrices: [], shownOffers: [] },
		shareLinkNow: false,
		repeatPriceNow: false,
		shouldEscalate: Boolean(currentState?.needsHuman || sensitive),
		handoffReason: currentState?.handoffReason || (sensitive ? 'sensitive_support' : null),
		recommendedAction: sensitive ? 'handoff_human' : hiring ? 'service_guidance' : 'answer_and_guide',
		responseRules: profile.serviceHints || [],
		greetingOnly,
		intent,
	};
}
