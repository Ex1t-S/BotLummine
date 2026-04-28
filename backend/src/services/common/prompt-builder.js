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

function buildPolicyBlock(responsePolicy = {}, { agentName = 'la asesora', businessName = 'la marca' } = {}) {
	return [
		`- Accion permitida: ${responsePolicy.action || 'general_help'}`,
		`- Tono: ${responsePolicy.tone || 'amigable_directo'}`,
		`- Maximo ideal: ${responsePolicy.maxChars || 220} caracteres`,
		`- Puede mencionar derivacion humana: ${responsePolicy.allowHandoffMention ? 'Si' : 'No'}`,
		'- Responde solo con lo confirmado.',
		'- Si no hay tracking, decilo sin inventar.',
		'- Si la conversacion ya esta empezada, segui el hilo sin saludar de nuevo, salvo que el cliente retome solo con hola o buenas.',
		`- Si el mensaje es solo un saludo, presenta de forma breve a ${agentName} de ${businessName} y pregunta que esta buscando.`,
		'- Evita abrir con muletillas como claro, perfecto, genial, buenisimo o dale.',
		'- Si la intencion no es producto, no abras promociones ni upsell salvo pedido explicito del cliente.'
	].join('\n');
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

function shouldIncludeLiveOrderContext({ liveOrderContext, responsePolicy }) {
	if (!liveOrderContext) return false;
	return /^order_status/.test(String(responsePolicy?.action || ''));
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
	menuAssistantContext = null
}) {
	const aiConfig = workspaceConfig?.ai || {};
	const systemPrompt = aiConfig.systemPrompt || process.env.SYSTEM_PROMPT || 'Responde como asesora humana de ventas por WhatsApp. Sona natural, directa y comercial.';
	const businessContext = aiConfig.businessContext || process.env.BUSINESS_CONTEXT || '';
	const agentName = aiConfig.agentName || process.env.BUSINESS_AGENT_NAME || 'Sofi';
	const tone = aiConfig.tone || 'amigable_directo';
	const transcript = formatTranscript({ businessName, contactName, recentMessages });
	const useLegacyLummineData =
		!workspaceConfig?.workspaceId ||
		workspaceConfig.workspaceId === 'workspace_lummine' ||
		String(businessName || '').toLowerCase().includes('lummine');
	const facts = useLegacyLummineData ? getRelevantStoreFacts(recentMessages) : [];
	const firstContact = isFirstContact(recentMessages);
	const businessData = useLegacyLummineData
		? buildRelevantBusinessData([...recentMessages].reverse().find((m) => m.role === 'user')?.text || '')
		: {
			policySummary: {
				shipping: ['Usa solo las politicas cargadas para este workspace.'],
				returns: ['Usa solo las politicas cargadas para este workspace.']
			}
		};
	const commercialHintsBlock = Array.isArray(commercialHints) && commercialHints.length
		? commercialHints.slice(0, 8).map((hint) => `- ${hint}`).join('\n')
		: '- Guia una sola opcion principal y no abras todo el catalogo.';
	const liveOrderContextEnabled = shouldIncludeLiveOrderContext({
		liveOrderContext,
		responsePolicy,
	});
	const compactCatalog = Array.isArray(catalogProducts) && catalogProducts.length
		? catalogProducts.slice(0, 3).map((item) => [
			`- ${item.name}`,
			`  familia: ${item.family || 'sin clasificar'}`,
			`  oferta: ${item.offerType || 'single'}`,
			`  precio: ${item.price || 'no cargado'}`,
			item.productUrl ? `  link: ${item.productUrl}` : '',
			item.colors?.length ? `  colores: ${item.colors.join(', ')}` : '',
			item.sizes?.length ? `  talles: ${item.sizes.join(', ')}` : ''
		].filter(Boolean).join('\n')).join('\n')
		: catalogContext || 'No se encontraron productos relevantes.';

	return [
		`SISTEMA: ${systemPrompt}`,
		`NEGOCIO: ${businessName}`,
		`ASESORA: ${agentName}`,
		`TONO DE MARCA: ${tone}`,
		businessContext ? `CONTEXTO DEL NEGOCIO:\n${businessContext}` : '',
		`DATOS DEL CLIENTE:\n- Nombre: ${customerContext.name || contactName || 'Cliente'}\n- WhatsApp: ${customerContext.waId || 'No informado'}`,
		conversationSummary ? `RESUMEN DEL CHAT:\n${conversationSummary}` : '',
		`ESTADO ACTUAL:\n- Ultima intencion: ${conversationState.lastIntent || 'general'}\n- Objetivo: ${conversationState.lastUserGoal || 'consulta_general'}\n- Animo: ${conversationState.customerMood || 'neutral'}\n- Familia actual: ${conversationState.currentProductFamily || 'no detectada'}\n- Producto foco: ${conversationState.currentProductFocus || 'no detectado'}\n- Promo pedida: ${conversationState.requestedOfferType || 'no detectada'}\n- Exclusiones: ${formatArrayField(conversationState.excludedProductKeywords, 'ninguna')}\n- Familia bloqueada: ${conversationState.categoryLocked ? 'Si' : 'No'}\n- Talle detectado: ${conversationState.frequentSize || 'no detectado'}\n- Pago preferido: ${conversationState.paymentPreference || 'no detectado'}\n- Productos de interes: ${formatArrayField(conversationState.interestedProducts)}\n- Resumen comercial: ${conversationState.commercialSummary || 'sin resumen especial'}\n- Necesita humano: ${conversationState.needsHuman ? 'Si' : 'No'}`,
		`POLITICA DE RESPUESTA:\n${buildPolicyBlock(responsePolicy, { agentName, businessName })}`,
		`PLAN COMERCIAL:\n${buildCommercialPlanBlock(commercialPlan)}`,
		liveOrderContextEnabled
			? `PEDIDO REAL / TRACKING:\n${formatLiveOrderContext(liveOrderContext)}`
			: 'REGLA DE PEDIDO:\n- Ignora cualquier pedido previo salvo que la accion permitida sea de seguimiento de pedido.',
		`HECHOS UTILES:\n${facts.map((fact) => `- ${fact}`).join('\n')}`,
		`CATALOGO RELEVANTE:\n${compactCatalog}`,
		`PISTAS COMERCIALES:\n${commercialHintsBlock}`,
		menuAssistantContext?.promptBlock ? `GUIA DE MENU:\n${menuAssistantContext.promptBlock}` : '',
		`POLITICAS RESUMIDAS:\n- Envios: ${businessData.policySummary.shipping.join(' ')}\n- Cambios/devoluciones: ${businessData.policySummary.returns.join(' ')}`,
		`REGLAS DE SALIDA:\n- ${firstContact ? `Si es el primer mensaje y no es solo un saludo corto, podes presentarte una sola vez como ${agentName} de ${businessName}.` : `Si el cliente solo retoma con hola o buenas, podes volver a presentarte breve como ${agentName} de ${businessName}. Si no, segui el hilo sin saludar de nuevo.`}\n- Si el mensaje del cliente es solo un saludo, responde breve, presentate como ${agentName} de ${businessName} y pregunta que esta buscando.\n- Si la intencion es soporte (pedido, pago, envio o comprobante), no metas promociones ni cambies a modo venta salvo que el cliente cambie de tema.\n- Si el catalogo local no esta disponible o no hay productos confirmados, no inventes nombres de productos, promos, precios, links ni stock.\n- Si el catalogo local no esta disponible o no hay productos confirmados, pedi una aclaracion breve o ofrece derivar con una asesora.\n- Si el cliente ya fijo familia o promo, respetala y no cambies de producto por tu cuenta.\n- Si el cliente excluyo una opcion, no la vuelvas a mencionar como recomendacion.\n- Si la promo exacta no existe dentro de esa familia, decilo explicitamente y ofrece la mejor alternativa dentro de la misma familia.\n- Si mostras opciones, prioriza una sola principal segun el plan comercial, salvo que este comparando.\n- Si ya se venia hablando de otro producto mas reciente, el link tiene que seguir ese producto reciente.\n- No repitas promo, precio ni link si ya fueron dados, salvo pedido explicito.\n- Si usas el menu como guia, integralo natural solo cuando el cliente este abierto o desorientado.\n- No pegues una coletilla fija de menu al final de respuestas concretas.\n- No uses listas largas.\n- No arranques con claro, perfecto, genial, buenisimo o dale.\n- Si la respuesta es continuidad y no es un saludo nuevo, no repitas nombre ni saludo.`,
		`CONVERSACION RECIENTE:\n${transcript}`,
		'Responde ahora al ultimo mensaje del cliente.'
	].filter(Boolean).join('\n\n');
}
