import { getRelevantStoreFacts } from '../../data/store-style.js';
import { buildRelevantBusinessData } from '../../data/store-business.js';
import {
	getAiVerticalProfile,
	isInsuranceVertical,
	resolveAiVertical,
	usesCommerceEngine,
} from '../ai/vertical-profile.service.js';

function formatTranscript({ businessName, contactName, recentMessages }) {
	return recentMessages
		.slice(-10)
		.map((item) => `${item.role === 'assistant' ? businessName : contactName}: ${item.text}`)
		.join('\n');
}

function isFirstContact(recentMessages) {
	return recentMessages.filter((msg) => msg.role === 'assistant').length === 0;
}

function formatLiveOrderContext(liveOrderContext) {
	if (!liveOrderContext) return 'No hay pedido operativo cargado.';
	return [
		`- Numero: ${liveOrderContext.orderNumber}`,
		`- Cliente: ${liveOrderContext.customerName || 'No informado'}`,
		`- Pago: ${liveOrderContext.paymentStatus || 'No informado'}`,
		`- Envio: ${liveOrderContext.shippingStatus || 'No informado'}`,
		`- Estado general: ${liveOrderContext.orderStatus || 'No informado'}`,
		liveOrderContext.shippingCarrier ? `- Carrier: ${liveOrderContext.shippingCarrier}` : '- Carrier: no informado',
		liveOrderContext.trackingNumber ? `- Tracking: ${liveOrderContext.trackingNumber}` : '- Tracking: no informado',
		liveOrderContext.trackingUrl ? `- URL tracking: ${liveOrderContext.trackingUrl}` : '- URL tracking: no informada'
	].join('\n');
}

function formatArrayField(value = [], fallback = 'ninguno') {
	return Array.isArray(value) && value.length ? value.join(', ') : fallback;
}

function buildPolicyBlock(responsePolicy = {}, { agentName = 'la asesora', businessName = 'la marca', profile = null } = {}) {
	const insurance = isInsuranceVertical(profile?.vertical);
	const lines = [
		`- Accion permitida: ${responsePolicy.action || 'general_help'}`,
		`- Tono: ${responsePolicy.tone || 'amigable_directo'}`,
		`- Maximo ideal: ${responsePolicy.maxChars || 220} caracteres`,
		`- Puede mencionar derivacion humana: ${responsePolicy.allowHandoffMention ? 'Si' : 'No'}`,
		'- Responde solo con lo confirmado.',
		'- Si la conversacion ya esta empezada, segui el hilo sin saludar de nuevo, salvo que el cliente retome solo con hola o buenas.',
		`- Si el mensaje es solo un saludo, presenta de forma breve a ${agentName} de ${businessName} y pregunta que esta buscando.`,
		'- Evita abrir con muletillas como claro, perfecto, genial, buenisimo o dale.',
	];

	if (insurance) {
		lines.push(
			'- No hables de stock, talles, carrito, envios, promos de ecommerce ni productos de indumentaria.',
			'- Si preguntan por contratar, orienta sobre el tipo de seguro y pide datos minimos para que un asesor prepare la propuesta.',
			'- Para clientes actuales o gestiones sensibles, indica que lo revisa un asesor de la oficina.'
		);
	} else {
		lines.push(
			'- Si no hay tracking, decilo sin inventar.',
			'- Si la intencion no es producto, no abras promociones ni upsell salvo pedido explicito del cliente.'
		);
	}

	return lines.join('\n');
}

function buildCommercialPlanBlock(commercialPlan = {}) {
	const offerCandidates = Array.isArray(commercialPlan?.offerCandidates) && commercialPlan.offerCandidates.length
		? commercialPlan.offerCandidates
			.slice(0, 4)
			.map((item) => item.label || item.name)
			.filter(Boolean)
			.join(', ')
		: 'no claras';

	return [
		`- Catalogo local disponible: ${commercialPlan.catalogAvailable === false ? 'No' : 'Si'}`,
		`- Etapa comercial: ${commercialPlan.stage || 'DISCOVERY'}`,
		`- Accion detectada del cliente: ${commercialPlan.requestedAction || 'GENERAL'}`,
		`- Familia foco: ${commercialPlan.productFamilyLabel || commercialPlan.productFamily || 'no clara'}`,
		`- Familia bloqueada: ${commercialPlan.categoryLocked ? 'Si' : 'No'}`,
		`- Producto foco: ${commercialPlan.productFocus || 'no claro'}`,
		`- Promo solicitada: ${commercialPlan.requestedOfferType || 'no especifica'}`,
		`- Promo exacta disponible: ${commercialPlan.requestedOfferAvailable == null ? 'no aplica' : commercialPlan.requestedOfferAvailable ? 'Si' : 'No'}`,
		`- Restricciones / exclusiones: ${formatArrayField(commercialPlan.excludedKeywords, 'ninguna')}`,
		`- Oferta principal: ${commercialPlan.bestOffer?.name || 'no clara'}`,
		`- Opciones candidatas: ${offerCandidates}`,
		`- Precio principal: ${commercialPlan.bestOffer?.price || 'no cargado'}`,
		`- Alternativa dentro de la misma familia: ${commercialPlan.fallbackOffer?.name || 'ninguna'}`,
		`- Compartir link ahora: ${commercialPlan.shareLinkNow ? 'Si' : 'No'}`,
		`- Repetir precio ahora: ${commercialPlan.repeatPriceNow ? 'Si' : 'No'}`,
		`- Links ya compartidos: ${formatArrayField(commercialPlan.alreadyShared?.sharedLinks, 'ninguno')}`,
		`- Precios ya mostrados: ${formatArrayField(commercialPlan.alreadyShared?.shownPrices, 'ninguno')}`,
		`- Promos ya mencionadas: ${formatArrayField(commercialPlan.alreadyShared?.shownOffers, 'ninguna')}`,
		`- Accion recomendada: ${commercialPlan.recommendedAction || 'answer_and_guide'}`,
		`- Es solo saludo: ${commercialPlan.greetingOnly ? 'Si' : 'No'}`
	].join('\n');
}

function shouldUseStoreCommerceContext({ catalogProducts = [], commercialPlan = {} } = {}) {
	if (commercialPlan?.stage === 'SUPPORT') return false;
	if (commercialPlan?.catalogAvailable === false) return false;
	return Array.isArray(catalogProducts) && catalogProducts.length > 0;
}

function buildStateBlock(conversationState = {}, { useStoreCommerceContext = false } = {}) {
	const lines = [
		`- Ultima intencion: ${conversationState.lastIntent || 'general'}`,
		`- Objetivo: ${conversationState.lastUserGoal || 'consulta_general'}`,
		`- Animo: ${conversationState.customerMood || 'neutral'}`
	];

	if (useStoreCommerceContext) {
		lines.push(
			`- Familia actual: ${conversationState.currentProductFamily || 'no detectada'}`,
			`- Producto foco: ${conversationState.currentProductFocus || 'no detectado'}`,
			`- Promo pedida: ${conversationState.requestedOfferType || 'no detectada'}`,
			`- Exclusiones: ${formatArrayField(conversationState.excludedProductKeywords, 'ninguna')}`,
			`- Familia bloqueada: ${conversationState.categoryLocked ? 'Si' : 'No'}`,
			`- Talle detectado: ${conversationState.frequentSize || 'no detectado'}`,
			`- Pago preferido: ${conversationState.paymentPreference || 'no detectado'}`,
			`- Productos de interes: ${formatArrayField(conversationState.interestedProducts)}`
		);
	} else {
		lines.push(
			`- Tema actual: ${conversationState.currentProductFocus || conversationState.lastUserGoal || 'no detectado'}`,
			`- Gestion sensible: ${conversationState.needsHuman ? 'Si' : 'No'}`
		);
	}

	lines.push(
		`- Resumen comercial: ${conversationState.commercialSummary || 'sin resumen especial'}`,
		`- Necesita humano: ${conversationState.needsHuman ? 'Si' : 'No'}`
	);

	return `ESTADO ACTUAL:\n${lines.join('\n')}`;
}

function shouldIncludeLiveOrderContext({ liveOrderContext, responsePolicy }) {
	if (!liveOrderContext) return false;
	return /^order_status/.test(String(responsePolicy?.action || ''));
}

function buildRegionalLanguageRule({ businessName = '', businessContext = '' } = {}) {
	const text = `${businessName} ${businessContext}`.toLowerCase();
	if (!/(dkv|vecindario|las palmas|espaÃ±a|espana)/i.test(text)) return '';
	return '- Usa espanol de Espana: tuteo con "tu/te", no voseo argentino y no expresiones como "vos"; evita expresiones demasiado coloquiales como genial o buenisimo.';
}

function formatCatalogProducts({ catalogProducts = [], catalogContext = '', profile = null } = {}) {
	if (!Array.isArray(catalogProducts) || !catalogProducts.length) {
		return catalogContext || 'No se encontraron datos relevantes.';
	}

	const insurance = isInsuranceVertical(profile?.vertical);
	return catalogProducts.slice(0, 3).map((item) => {
		const lines = [
			`- ${item.name}`,
			`  familia: ${item.family || 'sin clasificar'}`,
		];

		if (insurance) {
			if (item.shortDescription) lines.push(`  detalle: ${item.shortDescription}`);
			if (item.productUrl) lines.push(`  link: ${item.productUrl}`);
			return lines.join('\n');
		}

		lines.push(
			`  oferta: ${item.offerType || 'single'}`,
			`  precio: ${item.price || 'no cargado'}`
		);
		if (item.productUrl) lines.push(`  link: ${item.productUrl}`);
		if (item.colors?.length) lines.push(`  colores: ${item.colors.join(', ')}`);
		if (item.sizes?.length) lines.push(`  talles: ${item.sizes.join(', ')}`);
		return lines.join('\n');
	}).join('\n');
}

function formatCommercialHints(commercialHints = [], { isDkv = false } = {}) {
	if (!Array.isArray(commercialHints) || !commercialHints.length) {
		return isDkv
			? '- Orienta segun el seguro o gestion solicitada y deriva si requiere asesor.'
			: '- Guia una sola opcion principal y no abras todo el catalogo.';
	}

	const bannedForDkv = /(talle|stock|promo|promocion|carrito|envio|producto puntual|link|cat[aá]logo)/i;
	const hints = isDkv
		? commercialHints.filter((hint) => !bannedForDkv.test(String(hint || '')))
		: commercialHints;

	return (hints.length ? hints : ['Orienta segun el seguro o gestion solicitada y deriva si requiere asesor.'])
		.slice(0, 8)
		.map((hint) => `- ${hint}`)
		.join('\n');
}

function formatVerticalHints(commercialHints = [], { profile = null } = {}) {
	if (!Array.isArray(commercialHints) || !commercialHints.length) {
		return `- ${profile?.defaultHint || 'Guia una sola opcion principal y no abras todo el catalogo.'}`;
	}

	const bannedPattern = profile?.bannedReplyTerms?.length
		? new RegExp(`(${profile.bannedReplyTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i')
		: null;
	const hints = bannedPattern
		? commercialHints.filter((hint) => !bannedPattern.test(String(hint || '')))
		: commercialHints;

	return (hints.length ? hints : [profile?.defaultHint || 'Orienta segun la consulta y deriva si requiere asesor.'])
		.slice(0, 8)
		.map((hint) => `- ${hint}`)
		.join('\n');
}

export function buildPrompt({
	businessName,
	workspaceConfig = null,
	contactName,
	recentMessages,
	conversationSummary = '',
	customerContext = {},
	conversationState = {},
	liveOrderContext = null,
	catalogProducts = [],
	catalogContext = '',
	commercialHints = [],
	commercialPlan = {},
	responsePolicy = {},
	menuAssistantContext = null,
	campaignAssistantContext = null
}) {
	const aiConfig = workspaceConfig?.ai || {};
	const systemPromptExtra = aiConfig.systemPrompt || '';
	const businessContext = aiConfig.businessContext || process.env.BUSINESS_CONTEXT || '';
	const agentName = aiConfig.agentName || process.env.BUSINESS_AGENT_NAME || 'Sofi';
	const tone = aiConfig.tone || 'amigable_directo';
	const vertical = resolveAiVertical({ workspaceConfig, businessName, businessContext });
	const verticalProfile = getAiVerticalProfile(vertical);
	const isInsurance = isInsuranceVertical(vertical);
	const useCommerceContext = usesCommerceEngine(vertical);
	const systemPrompt = useCommerceContext
		? (process.env.GLOBAL_SYSTEM_PROMPT || process.env.SYSTEM_PROMPT || verticalProfile.basePolicy)
		: verticalProfile.basePolicy;
	const transcript = formatTranscript({ businessName, contactName, recentMessages });
	const safeSystemPromptExtra =
		isInsurance && /(stock|talle|carrito|ecommerce|tiendanube|lummine|indumentaria|prenda)/i.test(systemPromptExtra)
			? ''
			: systemPromptExtra;
	const useStoreCommerceContext = useCommerceContext && shouldUseStoreCommerceContext({ catalogProducts, commercialPlan });
	const facts = useStoreCommerceContext ? getRelevantStoreFacts(recentMessages) : [];
	const firstContact = isFirstContact(recentMessages);
	const businessData = useStoreCommerceContext
		? buildRelevantBusinessData([...recentMessages].reverse().find((m) => m.role === 'user')?.text || '')
		: null;
	const commercialHintsBlock = formatVerticalHints(commercialHints, { profile: verticalProfile });
	const liveOrderContextEnabled = shouldIncludeLiveOrderContext({
		liveOrderContext,
		responsePolicy,
	});
	const regionalLanguageRule = buildRegionalLanguageRule({ businessName, businessContext });
	const compactCatalog = formatCatalogProducts({ catalogProducts, catalogContext, profile: verticalProfile });

	return [
		`SISTEMA: ${systemPrompt}`,
		safeSystemPromptExtra ? `REGLAS EXTRA DE PLATAFORMA:\n${safeSystemPromptExtra}` : '',
		`NEGOCIO: ${businessName}`,
		`ASESORA: ${agentName}`,
		`TONO DE MARCA: ${tone}`,
		businessContext ? `CONTEXTO DEL NEGOCIO:\n${businessContext}` : '',
		`DATOS DEL CLIENTE:\n- Nombre: ${customerContext.name || contactName || 'Cliente'}\n- WhatsApp: ${customerContext.waId || 'No informado'}`,
		conversationSummary ? `RESUMEN DEL CHAT:\n${conversationSummary}` : '',
		buildStateBlock(conversationState, { useStoreCommerceContext }),
		`VERTICAL: ${verticalProfile.label}`,
		`POLITICA DE RESPUESTA:\n${buildPolicyBlock(responsePolicy, { agentName, businessName, profile: verticalProfile })}`,
		useCommerceContext ? `PLAN COMERCIAL:\n${buildCommercialPlanBlock(commercialPlan)}` : '',
		liveOrderContextEnabled
			? `PEDIDO REAL / TRACKING:\n${formatLiveOrderContext(liveOrderContext)}`
			: 'REGLA DE PEDIDO:\n- Ignora cualquier pedido previo salvo que la accion permitida sea de seguimiento de pedido.',
		useStoreCommerceContext && facts.length ? `HECHOS UTILES:\n${facts.map((fact) => `- ${fact}`).join('\n')}` : '',
		`${verticalProfile.relevantInfoTitle}:\n${compactCatalog}`,
		`${verticalProfile.hintsTitle}:\n${commercialHintsBlock}`,
		campaignAssistantContext?.promptBlock ? `CONTEXTO DE CAMPAÑA:\n${campaignAssistantContext.promptBlock}` : '',
		menuAssistantContext?.promptBlock ? `GUIA DE MENU:\n${menuAssistantContext.promptBlock}` : '',
		useStoreCommerceContext && businessData ? `POLITICAS RESUMIDAS:\n- Envios: ${businessData.policySummary.shipping.join(' ')}\n- Cambios/devoluciones: ${businessData.policySummary.returns.join(' ')}` : '',
		`REGLAS DE SALIDA:\n- ${firstContact ? `Si es el primer mensaje y no es solo un saludo corto, podes presentarte una sola vez como ${agentName} de ${businessName}.` : `Si el cliente solo retoma con hola o buenas, podes volver a presentarte breve como ${agentName} de ${businessName}. Si no, segui el hilo sin saludar de nuevo.`}\n${regionalLanguageRule ? `${regionalLanguageRule}\n` : ''}- Si el mensaje del cliente es solo un saludo, responde breve, presentate como ${agentName} de ${businessName} y pregunta que esta buscando.\n${isInsurance ? '- No uses lenguaje de tienda online: stock, talles, carrito, envio, promo, pack o checkout.\n- Si falta informacion para contratar, pide tipo de seguro y datos minimos de contacto, sin cerrar precio ni cobertura.\n- Si es cliente actual o gestion de poliza, deriva a asesor de la oficina.' : '- Si la intencion es soporte (pedido, pago, envio o comprobante), no metas promociones ni cambies a modo venta salvo que el cliente cambie de tema.\n- Si el catalogo local no esta disponible o no hay productos confirmados, no inventes nombres de productos, promos, precios, links ni stock.\n- Si el catalogo local no esta disponible o no hay productos confirmados, pedi una aclaracion breve o ofrece derivar con una asesora.\n- Si el cliente ya fijo familia o promo, respetala y no cambies de producto por tu cuenta.\n- Si el cliente excluyo una opcion, no la vuelvas a mencionar como recomendacion.\n- Si la promo exacta no existe dentro de esa familia, decilo explicitamente y ofrece la mejor alternativa dentro de la misma familia.\n- Si mostras opciones, prioriza una sola principal segun el plan comercial, salvo que este comparando.\n- Si ya se venia hablando de otro producto mas reciente, el link tiene que seguir ese producto reciente.\n- No repitas promo, precio ni link si ya fueron dados, salvo pedido explicito.'}\n- Si usas el menu como guia, integralo natural solo cuando el cliente este abierto o desorientado.\n- No pegues una coletilla fija de menu al final de respuestas concretas.\n- No uses listas largas.\n- No arranques con claro, perfecto, genial, buenisimo o dale.\n- Si la respuesta es continuidad y no es un saludo nuevo, no repitas nombre ni saludo.`,
		`CONVERSACION RECIENTE:\n${transcript}`,
		'Responde ahora al ultimo mensaje del cliente.'
	].filter(Boolean).join('\n\n');
}
