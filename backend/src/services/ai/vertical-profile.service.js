export const AI_VERTICALS = {
	ECOMMERCE: 'ECOMMERCE',
	INSURANCE: 'INSURANCE',
};

export const AI_PROFILES = {
	GENERIC_ECOMMERCE: 'GENERIC_ECOMMERCE',
	LUMMINE_BODYWEAR: 'LUMMINE_BODYWEAR',
	DKV_INSURANCE: 'DKV_INSURANCE',
};

const INSURANCE_WORKSPACE_IDS = new Set(['cmpevb0oq0000pd0pgp66xq6k']);
const LUMMINE_WORKSPACE_IDS = new Set(['workspace_lummine']);

const GENERIC_ECOMMERCE_PROFILE = {
	aiProfile: AI_PROFILES.GENERIC_ECOMMERCE,
	vertical: AI_VERTICALS.ECOMMERCE,
	label: 'Ecommerce',
	usesCommerceEngine: true,
	commercialFamilyScope: 'generic',
	basePolicy: [
		'Responde como asistente humana de ventas por WhatsApp.',
		'Usa solo datos confirmados por el catalogo, pedidos, pagos y contexto operativo disponible.',
		'No inventes productos, precios, promos, stock, links, estados de pago, envios ni tracking.',
		'No asumas categorias, talles, rubros ni productos especificos si no aparecen en el catalogo o contexto de esta marca.',
		'Diferencia soporte de venta: si el cliente pregunta por pedido, pago o envio, resolvelo sin abrir promociones salvo pedido explicito.',
		'Se breve, natural y comercial; no uses listas largas ni repitas saludos, links o precios ya dados.'
	].join(' '),
	relevantInfoTitle: 'CATALOGO RELEVANTE',
	hintsTitle: 'PISTAS COMERCIALES',
	defaultHint: 'Guia una sola opcion principal usando solo catalogo y contexto real de la marca.',
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
	genericMenuOptions: ['Catalogo general', 'Medios de pago', 'Envios', 'Hablar con una persona'],
	bannedReplyTerms: [],
};

const LUMMINE_BODYWEAR_PROFILE = {
	...GENERIC_ECOMMERCE_PROFILE,
	aiProfile: AI_PROFILES.LUMMINE_BODYWEAR,
	label: 'Ecommerce bodywear',
	commercialFamilyScope: 'lummine_bodywear',
	basePolicy: [
		'Responde como asesora humana de ventas por WhatsApp.',
		'Usa solo datos confirmados por el catalogo, pedidos, pagos y contexto operativo disponible.',
		'No inventes productos, precios, promos, stock, links, estados de pago, envios ni tracking.',
		'Diferencia soporte de venta: si el cliente pregunta por pedido, pago o envio, resolvelo sin abrir promociones salvo pedido explicito.',
		'Se breve, natural y comercial; no uses listas largas ni repitas saludos, links o precios ya dados.'
	].join(' '),
	defaultHint: 'Guia una sola opcion principal y no abras todo el catalogo.',
	genericMenuOptions: ['Catalogo general', 'Medios de pago', 'Envios', 'Talles'],
};

const DKV_INSURANCE_PROFILE = {
	aiProfile: AI_PROFILES.DKV_INSURANCE,
	vertical: AI_VERTICALS.INSURANCE,
	label: 'Seguros',
	usesCommerceEngine: false,
	commercialFamilyScope: 'dkv_insurance',
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
	[AI_PROFILES.GENERIC_ECOMMERCE]: GENERIC_ECOMMERCE_PROFILE,
	[AI_PROFILES.LUMMINE_BODYWEAR]: LUMMINE_BODYWEAR_PROFILE,
	[AI_PROFILES.DKV_INSURANCE]: DKV_INSURANCE_PROFILE,
};

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

function normalizeKey(value = '') {
	return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function normalizeAiVertical(value = '') {
	const normalized = normalizeKey(value);
	if (['insurance', 'seguros', 'seguro', 'aseguradora'].includes(normalized)) return AI_VERTICALS.INSURANCE;
	if (['ecommerce', 'e_commerce', 'commerce', 'tienda', 'retail', 'moda'].includes(normalized)) return AI_VERTICALS.ECOMMERCE;
	return null;
}

export function normalizeAiProfile(value = '') {
	const normalized = normalizeKey(value);
	if (!normalized) return null;
	if (['generic', 'generic_ecommerce', 'ecommerce_generico', 'ecommerce_neutro'].includes(normalized)) {
		return AI_PROFILES.GENERIC_ECOMMERCE;
	}
	if (['lummine', 'lummine_bodywear', 'bodywear', 'lummine_ecommerce', 'modeladora', 'indumentaria_modeladora'].includes(normalized)) {
		return AI_PROFILES.LUMMINE_BODYWEAR;
	}
	if (['dkv', 'dkv_insurance', 'insurance', 'seguros', 'seguro', 'aseguradora'].includes(normalized)) {
		return AI_PROFILES.DKV_INSURANCE;
	}
	return null;
}

export function resolveAiProfile({
	workspaceConfig = null,
	workspaceId = '',
	workspaceName = '',
	businessName = '',
	businessContext = '',
} = {}) {
	const aiConfig = workspaceConfig?.ai || workspaceConfig?.aiConfig || {};
	const configured = normalizeAiProfile(aiConfig?.aiProfile || aiConfig?.catalogConfig?.aiProfile);
	if (configured) return configured;

	const configuredVertical = normalizeAiVertical(aiConfig?.vertical || aiConfig?.catalogConfig?.vertical);
	if (configuredVertical === AI_VERTICALS.INSURANCE) return AI_PROFILES.DKV_INSURANCE;

	const resolvedWorkspaceId = String(workspaceId || workspaceConfig?.workspaceId || '').trim();
	if (INSURANCE_WORKSPACE_IDS.has(resolvedWorkspaceId)) return AI_PROFILES.DKV_INSURANCE;
	if (LUMMINE_WORKSPACE_IDS.has(resolvedWorkspaceId)) return AI_PROFILES.LUMMINE_BODYWEAR;

	const text = normalizeText([
		workspaceName,
		workspaceConfig?.workspaceName,
		businessName,
		aiConfig?.businessName,
		businessContext,
		aiConfig?.businessContext,
	].filter(Boolean).join(' '));

	if (/\b(dkv|seguros?|polizas?|aseguradora|vecindario|las palmas)\b/.test(text)) {
		return AI_PROFILES.DKV_INSURANCE;
	}

	if (/\blummine\b/.test(text)) {
		return AI_PROFILES.LUMMINE_BODYWEAR;
	}

	return AI_PROFILES.GENERIC_ECOMMERCE;
}

export function resolveAiVertical(options = {}) {
	return getAiVerticalProfile(options).vertical;
}

export function getAiVerticalProfile(profileOrOptions = AI_PROFILES.GENERIC_ECOMMERCE) {
	if (typeof profileOrOptions === 'string') {
		const profile = normalizeAiProfile(profileOrOptions);
		if (profile) return PROFILES[profile] || GENERIC_ECOMMERCE_PROFILE;

		const vertical = normalizeAiVertical(profileOrOptions) || profileOrOptions;
		if (vertical === AI_VERTICALS.INSURANCE) return DKV_INSURANCE_PROFILE;
		return GENERIC_ECOMMERCE_PROFILE;
	}

	const profile = resolveAiProfile(profileOrOptions);
	return PROFILES[profile] || GENERIC_ECOMMERCE_PROFILE;
}

export function getAiProfileId(profileOrOptions = AI_PROFILES.GENERIC_ECOMMERCE) {
	return getAiVerticalProfile(profileOrOptions).aiProfile;
}

export function usesCommerceEngine(profileOrOptions = AI_PROFILES.GENERIC_ECOMMERCE) {
	return getAiVerticalProfile(profileOrOptions).usesCommerceEngine === true;
}

export function isInsuranceVertical(profileOrOptions = AI_PROFILES.GENERIC_ECOMMERCE) {
	return getAiVerticalProfile(profileOrOptions).vertical === AI_VERTICALS.INSURANCE;
}

export function isLummineBodywearProfile(profileOrOptions = AI_PROFILES.GENERIC_ECOMMERCE) {
	return getAiVerticalProfile(profileOrOptions).aiProfile === AI_PROFILES.LUMMINE_BODYWEAR;
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
		aiProfile: profile.aiProfile,
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
