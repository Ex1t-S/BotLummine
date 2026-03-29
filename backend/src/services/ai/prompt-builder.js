import { getRelevantStoreFacts } from '../../data/lummine-style.js';
import { buildRelevantBusinessData } from '../../data/lummine-business.js';

function formatHistoryForReference({ businessName, contactName, recentMessages = [] }) {
	return recentMessages
		.slice(-10)
		.map((item, index) => {
			const speaker = item.role === 'assistant' ? businessName : contactName;
			return `${index + 1}. ${speaker}: ${String(item.text || '').replace(/\s+/g, ' ').trim()}`;
		})
		.join('\n');
}

function lastUserMessage(recentMessages = []) {
	return [...recentMessages].reverse().find((msg) => msg.role === 'user')?.text || '';
}

function isFirstContact(recentMessages = []) {
	return recentMessages.filter((msg) => msg.role === 'assistant').length === 0;
}

function formatLiveOrderContext(liveOrderContext) {
	if (!liveOrderContext) return 'No hay pedido operativo cargado.';

	return [
		`- Número: ${liveOrderContext.orderNumber}`,
		`- Cliente: ${liveOrderContext.customerName || 'No informado'}`,
		`- Pago: ${liveOrderContext.paymentStatus || 'No informado'}`,
		`- Envío: ${liveOrderContext.shippingStatus || 'No informado'}`,
		`- Estado general: ${liveOrderContext.orderStatus || 'No informado'}`,
		liveOrderContext.shippingCarrier ? `- Carrier: ${liveOrderContext.shippingCarrier}` : '- Carrier: no informado',
		liveOrderContext.trackingNumber ? `- Tracking: ${liveOrderContext.trackingNumber}` : '- Tracking: no informado',
		liveOrderContext.trackingUrl ? `- URL tracking: ${liveOrderContext.trackingUrl}` : '- URL tracking: no informada'
	].join('\n');
}

function formatArrayField(value = [], fallback = 'ninguno') {
	return Array.isArray(value) && value.length ? value.join(', ') : fallback;
}

function buildPolicyBlock(responsePolicy = {}) {
	return [
		`- Acción permitida: ${responsePolicy.action || 'general_help'}`,
		`- Tono: ${responsePolicy.tone || 'amigable_directo'}`,
		`- Máximo ideal: ${responsePolicy.maxChars || 220} caracteres`,
		`- ¿Puede mencionar derivación humana?: ${responsePolicy.allowHandoffMention ? 'Sí' : 'No'}`,
		'- No inventes acciones operativas.',
		'- No prometas seguimiento humano salvo que la acción sea handoff_human.',
		'- Si no hay tracking, no inventes tracking.',
		'- No repitas saludo si la conversación ya empezó.',
		'- No uses fórmulas comerciales exageradas ni festejos.',
		'- Respondé como continuidad natural del chat.'
	].join('\n');
}

function buildCommercialPlanBlock(commercialPlan = {}) {
	const offerCandidates = Array.isArray(commercialPlan.offerCandidates)
		? commercialPlan.offerCandidates
			.slice(0, 3)
			.map((item) => `${item.offerType || 'single'} · ${item.name}${item.price ? ` · ${item.price}` : ''}`)
			.join(' | ')
		: 'ninguna';

	return [
		`- Etapa comercial: ${commercialPlan.stage || 'DISCOVERY'}`,
		`- Acción detectada del cliente: ${commercialPlan.requestedAction || 'GENERAL'}`,
		`- Producto foco: ${commercialPlan.productFocus || 'no claro'}`,
		`- Oferta principal: ${commercialPlan.bestOffer?.name || 'todavía no cierres una promo'}`,
		`- Precio principal: ${commercialPlan.bestOffer?.price || 'todavía no lo abras si no lo pidió'}`,
		`- Opciones candidatas: ${offerCandidates}`,
		`- ¿Compartir link ahora?: ${commercialPlan.shareLinkNow ? 'Sí' : 'No'}`,
		`- ¿Repetir precio ahora?: ${commercialPlan.repeatPriceNow ? 'Sí' : 'No'}`,
		`- Links ya compartidos: ${formatArrayField(commercialPlan.alreadyShared?.sharedLinks, 'ninguno')}`,
		`- Precios ya mostrados: ${formatArrayField(commercialPlan.alreadyShared?.shownPrices, 'ninguno')}`,
		`- Promos ya mencionadas: ${formatArrayField(commercialPlan.alreadyShared?.shownOffers, 'ninguna')}`,
		`- Acción recomendada: ${commercialPlan.recommendedAction || 'answer_and_guide'}`
	].join('\n');
}

function buildCatalogBlock(catalogProducts = [], commercialPlan = {}) {
	if (!Array.isArray(catalogProducts) || !catalogProducts.length) {
		return 'No se encontraron productos relevantes.';
	}

	return catalogProducts
		.slice(0, 3)
		.map((item) => {
			return [
				`- ${item.name}`,
				`  familia: ${item.family || 'no detectada'}`,
				`  precio: ${item.price || 'no cargado'}`,
				`  oferta: ${item.offerType || 'single'}`,
				item.colors?.length ? `  colores: ${item.colors.join(', ')}` : '',
				item.sizes?.length ? `  talles: ${item.sizes.join(', ')}` : '',
				commercialPlan.shareLinkNow && item.productUrl ? `  link: ${item.productUrl}` : ''
			].filter(Boolean).join('\n');
		})
		.join('\n');
}

export function buildPrompt({
	businessName,
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
	responsePolicy = {}
}) {
	const systemPrompt = process.env.SYSTEM_PROMPT || 'Respondé como asesora humana de ventas por WhatsApp. Soná natural, directa y comercial.';
	const businessContext = process.env.BUSINESS_CONTEXT || '';
	const agentName = process.env.BUSINESS_AGENT_NAME || 'Sofi';
	const customerName = customerContext.name || contactName || 'Cliente';
	const lastCustomerMessage = lastUserMessage(recentMessages);
	const history = formatHistoryForReference({ businessName, contactName, recentMessages });
	const facts = getRelevantStoreFacts(recentMessages);
	const firstContact = isFirstContact(recentMessages);
	const businessData = buildRelevantBusinessData(lastCustomerMessage || '');
	const compactCatalog = buildCatalogBlock(catalogProducts, commercialPlan) || catalogContext;
	const hintsBlock = Array.isArray(commercialHints) && commercialHints.length
		? commercialHints.slice(0, 8).map((hint) => `- ${hint}`).join('\n')
		: '- Mantené una sola línea comercial y no impongas promo demasiado pronto.';

	return [
		`SISTEMA: ${systemPrompt}`,
		`NEGOCIO: ${businessName}`,
		`ASESORA: ${agentName}`,
		'OBJETIVO: acompañar la venta con tono humano y claro, sin sonar automática ni apurada.',
		businessContext ? `CONTEXTO DEL NEGOCIO:\n${businessContext}` : '',
		`DATOS DEL CLIENTE:\n- Nombre: ${customerName}\n- WhatsApp: ${customerContext.waId || 'No informado'}`,
		conversationSummary ? `RESUMEN DEL CHAT:\n${conversationSummary}` : '',
		`ESTADO ACTUAL:\n- Última intención: ${conversationState.lastIntent || 'general'}\n- Objetivo: ${conversationState.lastUserGoal || 'consulta_general'}\n- Ánimo: ${conversationState.customerMood || 'neutral'}\n- Talle detectado: ${conversationState.frequentSize || 'no detectado'}\n- Pago preferido: ${conversationState.paymentPreference || 'no detectado'}\n- Productos de interés: ${formatArrayField(conversationState.interestedProducts)}\n- ¿Necesita humano?: ${conversationState.needsHuman ? 'Sí' : 'No'}`,
		`POLÍTICA DE RESPUESTA:\n${buildPolicyBlock(responsePolicy)}`,
		`PLAN COMERCIAL:\n${buildCommercialPlanBlock(commercialPlan)}`,
		`PEDIDO REAL / TRACKING:\n${formatLiveOrderContext(liveOrderContext)}`,
		`HECHOS ÚTILES:\n${facts.map((fact) => `- ${fact}`).join('\n')}`,
		`CATÁLOGO RELEVANTE:\n${compactCatalog}`,
		`PISTAS COMERCIALES:\n${hintsBlock}`,
		`POLÍTICAS RESUMIDAS:\n- Envíos: ${businessData.policySummary.shipping.join(' ')}\n- Cambios/devoluciones: ${businessData.policySummary.returns.join(' ')}`,
		`HISTORIAL DE REFERENCIA (SOLO CONTEXTO, NO COPIAR NI REESCRIBIR):\n${history || 'Sin historial relevante.'}`,
		`ÚLTIMO MENSAJE DEL CLIENTE (RESPONDÉ SOLO A ESTO):\n${lastCustomerMessage || 'Sin mensaje detectado.'}`,
		`REGLAS DE SALIDA OBLIGATORIAS:\n- ${firstContact ? `Si es el primer mensaje, presentate una sola vez como ${agentName} de ${businessName}.` : 'No saludes de nuevo.'}\n- No vuelvas a decir “Hola ${customerName}” si la conversación ya empezó.\n- No arranques con muletillas como “claro”, “perfecto”, “buenísimo”, “genial”, “dale”.\n- Si el cliente pregunta algo general como body modelador, orientá primero y no elijas una promo cerrada de entrada.\n- Si preguntan por promos, mencioná como máximo dos opciones y en lenguaje simple.\n- No recites nombres largos de productos salvo que haga falta.\n- No mandes link salvo que el cliente lo pida o ya esté cerrando compra.\n- Si el cliente ya eligió color/talle o una promo, mantené ese foco y no mezcles otra.\n- No repitas precio ni link si ya fueron dados, salvo pedido explícito.\n- Nunca copies ni reescribas el historial.\n- Nunca devuelvas prefijos como CLIENTE:, ASESORA:, ${customerName}: o ${businessName}:.\n- Entregá una sola respuesta final, lista para WhatsApp.`
	]
		.filter(Boolean)
		.join('\n\n');
}
