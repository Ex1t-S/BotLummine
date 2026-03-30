import { getRelevantStoreFacts } from '../../data/lummine-style.js';
import { buildRelevantBusinessData } from '../../data/lummine-business.js';

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
		`- Número: ${liveOrderContext.orderNumber}`,
		`- Cliente: ${liveOrderContext.customerName || 'No informado'}`,
		`- Pago: ${liveOrderContext.paymentStatus || 'No informado'}`,
		`- Envío: ${liveOrderContext.shippingStatus || 'No informado'}`,
		`- Estado general: ${liveOrderContext.orderStatus || 'No informado'}`,
		liveOrderContext.shippingCarrier
			? `- Carrier: ${liveOrderContext.shippingCarrier}`
			: '- Carrier: no informado',
		liveOrderContext.trackingNumber
			? `- Tracking: ${liveOrderContext.trackingNumber}`
			: '- Tracking: no informado',
		liveOrderContext.trackingUrl
			? `- URL tracking: ${liveOrderContext.trackingUrl}`
			: '- URL tracking: no informada'
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
		'- Respondé solo con lo confirmado.',
		'- Si no hay tracking, decilo sin inventar.',
		'- Si la conversación ya está empezada, seguí el hilo sin saludar de nuevo.',
		'- Si el mensaje es solo un saludo, contestá breve y preguntá qué está buscando.',
		'- Evitá abrir con muletillas como claro, perfecto, genial, buenísimo o dale.'
	].join('\n');
}

function buildCommercialPlanBlock(commercialPlan = {}) {
	return [
		`- Etapa comercial: ${commercialPlan.stage || 'DISCOVERY'}`,
		`- Acción detectada del cliente: ${commercialPlan.requestedAction || 'GENERAL'}`,
		`- Familia foco: ${commercialPlan.productFamily || 'no clara'}`,
		`- ¿Familia bloqueada?: ${commercialPlan.familyLocked ? 'Sí' : 'No'}`,
		`- Producto foco: ${commercialPlan.productFocus || 'no claro'}`,
		`- Oferta principal: ${commercialPlan.bestOffer?.name || 'no clara'}`,
		`- Precio principal: ${commercialPlan.bestOffer?.price || 'no cargado'}`,
		`- Colores pedidos: ${formatArrayField(commercialPlan.requestedColors, 'ninguno')}`,
		`- Talles pedidos: ${formatArrayField(commercialPlan.requestedSizes, 'ninguno')}`,
		`- ¿Compartir link ahora?: ${commercialPlan.shareLinkNow ? 'Sí' : 'No'}`,
		`- ¿Repetir precio ahora?: ${commercialPlan.repeatPriceNow ? 'Sí' : 'No'}`,
		`- Links ya compartidos: ${formatArrayField(commercialPlan.alreadyShared?.sharedLinks, 'ninguno')}`,
		`- Precios ya mostrados: ${formatArrayField(commercialPlan.alreadyShared?.shownPrices, 'ninguno')}`,
		`- Promos ya mencionadas: ${formatArrayField(commercialPlan.alreadyShared?.shownOffers, 'ninguna')}`,
		`- Acción recomendada: ${commercialPlan.recommendedAction || 'answer_and_guide'}`,
		`- ¿Es solo saludo?: ${commercialPlan.greetingOnly ? 'Sí' : 'No'}`
	].join('\n');
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
	const systemPrompt =
		process.env.SYSTEM_PROMPT ||
		'Respondé como asesora humana de ventas por WhatsApp. Soná natural, directa y comercial.';
	const businessContext = process.env.BUSINESS_CONTEXT || '';
	const agentName = process.env.BUSINESS_AGENT_NAME || 'Sofi';
	const transcript = formatTranscript({ businessName, contactName, recentMessages });
	const facts = getRelevantStoreFacts(recentMessages);
	const firstContact = isFirstContact(recentMessages);
	const businessData = buildRelevantBusinessData(
		[...recentMessages].reverse().find((m) => m.role === 'user')?.text || ''
	);
	const commercialHintsBlock =
		Array.isArray(commercialHints) && commercialHints.length
			? commercialHints.slice(0, 10).map((hint) => `- ${hint}`).join('\n')
			: '- Guiá una sola opción principal y no abras todo el catálogo.';
	const compactCatalog =
		Array.isArray(catalogProducts) && catalogProducts.length
			? catalogProducts
					.slice(0, 3)
					.map((item) =>
						[
							`- ${item.name}`,
							`  familia: ${item.family || 'sin clasificar'}`,
							`  oferta: ${item.offerType || 'single'}`,
							`  precio: ${item.price || 'no cargado'}`,
							item.productUrl ? `  link: ${item.productUrl}` : '',
							item.colors?.length ? `  colores: ${item.colors.join(', ')}` : '',
							item.sizes?.length ? `  talles: ${item.sizes.join(', ')}` : ''
						]
							.filter(Boolean)
							.join('\n')
					)
					.join('\n')
			: catalogContext || 'No se encontraron productos relevantes.';

	return [
		`SISTEMA: ${systemPrompt}`,
		`NEGOCIO: ${businessName}`,
		`ASESORA: ${agentName}`,
		businessContext ? `CONTEXTO DEL NEGOCIO:\n${businessContext}` : '',
		`DATOS DEL CLIENTE:\n- Nombre: ${customerContext.name || contactName || 'Cliente'}\n- WhatsApp: ${customerContext.waId || 'No informado'}`,
		conversationSummary ? `RESUMEN DEL CHAT:\n${conversationSummary}` : '',
		`ESTADO ACTUAL:\n- Última intención: ${conversationState.lastIntent || 'general'}\n- Objetivo: ${conversationState.lastUserGoal || 'consulta_general'}\n- Ánimo: ${conversationState.customerMood || 'neutral'}\n- Talle detectado: ${conversationState.frequentSize || 'no detectado'}\n- Pago preferido: ${conversationState.paymentPreference || 'no detectado'}\n- Productos de interés: ${formatArrayField(conversationState.interestedProducts)}\n- ¿Necesita humano?: ${conversationState.needsHuman ? 'Sí' : 'No'}`,
		`POLÍTICA DE RESPUESTA:\n${buildPolicyBlock(responsePolicy)}`,
		`PLAN COMERCIAL:\n${buildCommercialPlanBlock(commercialPlan)}`,
		`PEDIDO REAL / TRACKING:\n${formatLiveOrderContext(liveOrderContext)}`,
		`HECHOS ÚTILES:\n${facts.map((fact) => `- ${fact}`).join('\n')}`,
		`CATÁLOGO RELEVANTE:\n${compactCatalog}`,
		`PISTAS COMERCIALES:\n${commercialHintsBlock}`,
		`POLÍTICAS RESUMIDAS:\n- Envíos: ${businessData.policySummary.shipping.join(' ')}\n- Cambios/devoluciones: ${businessData.policySummary.returns.join(' ')}`,
		`REGLAS DE SALIDA:\n- ${firstContact ? `Si es el primer mensaje y no es solo un saludo corto, podés presentarte una sola vez como ${agentName} de ${businessName}.` : 'No saludes de nuevo.'}\n- Si el mensaje del cliente es solo un saludo, respondé breve y preguntá qué está buscando.\n- Si la familia foco es body, calzas, faja o short, no salgas de esa familia salvo pedido explícito.\n- Si habla de una familia general, primero orientá la familia y recién después bajá a una promo o SKU.\n- Si mostrás opciones, priorizá una sola principal según el plan comercial.\n- Si pidió color o talle, tratá eso como continuidad del producto actual.\n- No confirmes talle o color si no está claro en catálogo.\n- Si ya se venía hablando de otro producto más reciente, el link tiene que seguir ese producto reciente.\n- No repitas promo, precio ni link si ya fueron dados, salvo pedido explícito.\n- No uses listas largas.\n- No arranques con claro, perfecto, genial, buenísimo o dale.\n- Si la respuesta es continuidad, no repitas nombre ni saludo.`,
		`CONVERSACIÓN RECIENTE:\n${transcript}`,
		'Respondé ahora al último mensaje del cliente.'
	]
		.filter(Boolean)
		.join('\n\n');
}
