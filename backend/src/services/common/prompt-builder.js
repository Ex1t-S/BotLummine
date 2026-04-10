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
		'- Respondé solo con lo confirmado.',
		'- Si no hay tracking, decilo sin inventar.',
		'- Si la conversación ya está empezada, seguí el hilo sin saludar de nuevo.',
		'- Si el mensaje es solo un saludo, contestá breve y preguntá qué está buscando.',
		'- Evitá abrir con muletillas como claro, perfecto, genial, buenísimo o dale.',
		'- Si la intención no es producto, no abras promociones ni upsell salvo pedido explícito del cliente.'
	].join('\n');
}

function buildCommercialPlanBlock(commercialPlan = {}) {
	return [
		`- Catálogo local disponible: ${commercialPlan.catalogAvailable === false ? 'No' : 'Sí'}`,
		`- Etapa comercial: ${commercialPlan.stage || 'DISCOVERY'}`,
		`- Acción detectada del cliente: ${commercialPlan.requestedAction || 'GENERAL'}`,
		`- Familia foco: ${commercialPlan.productFamilyLabel || commercialPlan.productFamily || 'no clara'}`,
		`- ¿Familia bloqueada?: ${commercialPlan.categoryLocked ? 'Sí' : 'No'}`,
		`- Producto foco: ${commercialPlan.productFocus || 'no claro'}`,
		`- Promo solicitada: ${commercialPlan.requestedOfferType || 'no específica'}`,
		`- ¿Promo exacta disponible?: ${commercialPlan.requestedOfferAvailable == null ? 'no aplica' : commercialPlan.requestedOfferAvailable ? 'Sí' : 'No'}`,
		`- Restricciones / exclusiones: ${formatArrayField(commercialPlan.excludedKeywords, 'ninguna')}`,
		`- Oferta principal: ${commercialPlan.bestOffer?.name || 'no clara'}`,
		`- Precio principal: ${commercialPlan.bestOffer?.price || 'no cargado'}`,
		`- Alternativa dentro de la misma familia: ${commercialPlan.fallbackOffer?.name || 'ninguna'}`,
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
	const systemPrompt = process.env.SYSTEM_PROMPT || 'Respondé como asesora humana de ventas por WhatsApp. Soná natural, directa y comercial.';
	const businessContext = process.env.BUSINESS_CONTEXT || '';
	const agentName = process.env.BUSINESS_AGENT_NAME || 'Sofi';
	const transcript = formatTranscript({ businessName, contactName, recentMessages });
	const facts = getRelevantStoreFacts(recentMessages);
	const firstContact = isFirstContact(recentMessages);
	const businessData = buildRelevantBusinessData([...recentMessages].reverse().find((m) => m.role === 'user')?.text || '');
	const commercialHintsBlock = Array.isArray(commercialHints) && commercialHints.length ? commercialHints.slice(0, 8).map((hint) => `- ${hint}`).join('\n') : '- Guiá una sola opción principal y no abras todo el catálogo.';
	const compactCatalog = Array.isArray(catalogProducts) && catalogProducts.length ? catalogProducts.slice(0, 3).map((item) => [
		`- ${item.name}`,
		`  familia: ${item.family || 'sin clasificar'}`,
		`  oferta: ${item.offerType || 'single'}`,
		`  precio: ${item.price || 'no cargado'}`,
		item.productUrl ? `  link: ${item.productUrl}` : '',
		item.colors?.length ? `  colores: ${item.colors.join(', ')}` : '',
		item.sizes?.length ? `  talles: ${item.sizes.join(', ')}` : ''
	].filter(Boolean).join('\n')).join('\n') : catalogContext || 'No se encontraron productos relevantes.';

	return [
		`SISTEMA: ${systemPrompt}`,
		`NEGOCIO: ${businessName}`,
		`ASESORA: ${agentName}`,
		businessContext ? `CONTEXTO DEL NEGOCIO:
${businessContext}` : '',
		`DATOS DEL CLIENTE:
- Nombre: ${customerContext.name || contactName || 'Cliente'}
- WhatsApp: ${customerContext.waId || 'No informado'}`,
		conversationSummary ? `RESUMEN DEL CHAT:
${conversationSummary}` : '',
		`ESTADO ACTUAL:
- Última intención: ${conversationState.lastIntent || 'general'}
- Objetivo: ${conversationState.lastUserGoal || 'consulta_general'}
- Ánimo: ${conversationState.customerMood || 'neutral'}
- Familia actual: ${conversationState.currentProductFamily || 'no detectada'}
- Producto foco: ${conversationState.currentProductFocus || 'no detectado'}
- Promo pedida: ${conversationState.requestedOfferType || 'no detectada'}
- Exclusiones: ${formatArrayField(conversationState.excludedProductKeywords, 'ninguna')}
- ¿Familia bloqueada?: ${conversationState.categoryLocked ? 'Sí' : 'No'}
- Talle detectado: ${conversationState.frequentSize || 'no detectado'}
- Pago preferido: ${conversationState.paymentPreference || 'no detectado'}
- Productos de interés: ${formatArrayField(conversationState.interestedProducts)}
- ¿Necesita humano?: ${conversationState.needsHuman ? 'Sí' : 'No'}`,
		`POLÍTICA DE RESPUESTA:
${buildPolicyBlock(responsePolicy)}`,
		`PLAN COMERCIAL:
${buildCommercialPlanBlock(commercialPlan)}`,
		`PEDIDO REAL / TRACKING:
${formatLiveOrderContext(liveOrderContext)}`,
		`HECHOS ÚTILES:
${facts.map((fact) => `- ${fact}`).join('\n')}`,
		`CATÁLOGO RELEVANTE:
${compactCatalog}`,
		`PISTAS COMERCIALES:
${commercialHintsBlock}`,
		`POLÍTICAS RESUMIDAS:
- Envíos: ${businessData.policySummary.shipping.join(' ')}
- Cambios/devoluciones: ${businessData.policySummary.returns.join(' ')}`,
		`REGLAS DE SALIDA:
- ${firstContact ? `Si es el primer mensaje y no es solo un saludo corto, podés presentarte una sola vez como ${agentName} de ${businessName}.` : 'No saludes de nuevo.'}
- Si el mensaje del cliente es solo un saludo, respondé breve y preguntá qué está buscando.
- Si la intención es soporte (pedido, pago, envío o comprobante), no metas promociones ni cambies a modo venta salvo que el cliente cambie de tema.
- Si el catálogo local no está disponible o no hay productos confirmados, no inventes nombres de productos, promos, precios, links ni stock.
- Si el catálogo local no está disponible o no hay productos confirmados, pedí una aclaración breve o ofrecé derivar con una asesora.
- Si el cliente ya fijó familia o promo, respetala y no cambies de producto por tu cuenta.
- Si el cliente excluyó una opción (por ejemplo "no quiero Total White"), no la vuelvas a mencionar como recomendación.
- Si la promo exacta no existe dentro de esa familia, decilo explícitamente y ofrecé la mejor alternativa dentro de la misma familia.
- Si mostrás opciones, priorizá una sola principal según el plan comercial.
- Si ya se venía hablando de otro producto más reciente, el link tiene que seguir ese producto reciente.
- No repitas promo, precio ni link si ya fueron dados, salvo pedido explícito.
- No uses listas largas.
- No arranques con claro, perfecto, genial, buenísimo o dale.
- Si la respuesta es continuidad, no repitas nombre ni saludo.`,
		`CONVERSACIÓN RECIENTE:
${transcript}`,
		'Respondé ahora al último mensaje del cliente.'
	].filter(Boolean).join('\n\n');
}
