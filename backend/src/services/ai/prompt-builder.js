import { getRelevantStoreFacts } from '../../data/lummine-style.js';
import { buildRelevantBusinessData } from '../../data/lummine-business.js';

function formatTranscript({ businessName, contactName, recentMessages }) {
	return recentMessages
		.slice(-10)
		.map((item) => `${item.role === 'assistant' ? businessName : contactName}: ${item.text}`)
		.join('\n');
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
		'- No inventes acciones operativas.',
		'- No prometas que una asesora va a tomar el caso salvo que la acción permitida sea handoff_human.',
		'- Si no hay tracking, no inventes tracking.',
		'- Si no sabés algo, respondé solo con lo confirmado.',
		'- No repitas saludo si la conversación ya empezó.',
		'- No felicites cada acción del cliente.',
		'- No metas relleno ni cierres decorativos.',
		'- Respondé como continuidad natural del chat.'
	].join('\n');
}

function buildCommercialPlanBlock(commercialPlan = {}) {
	const shouldHoldOffer = commercialPlan?.recommendedAction === 'qualify_before_offer';

	return [
		`- Etapa comercial: ${commercialPlan.stage || 'DISCOVERY'}`,
		`- Acción detectada del cliente: ${commercialPlan.requestedAction || 'GENERAL'}`,
		`- Producto foco: ${commercialPlan.productFocus || 'no claro'}`,
		`- Oferta principal: ${shouldHoldOffer ? 'todavía no cierres una promo' : commercialPlan.bestOffer?.name || 'no clara'}`,
		`- Precio principal: ${shouldHoldOffer ? 'todavía no lo abras si no lo pidió' : commercialPlan.bestOffer?.price || 'no cargado'}`,
		`- ¿Compartir link ahora?: ${commercialPlan.shareLinkNow ? 'Sí' : 'No'}`,
		`- ¿Repetir precio ahora?: ${commercialPlan.repeatPriceNow ? 'Sí' : 'No'}`,
		`- Links ya compartidos: ${formatArrayField(commercialPlan.alreadyShared?.sharedLinks, 'ninguno')}`,
		`- Precios ya mostrados: ${formatArrayField(commercialPlan.alreadyShared?.shownPrices, 'ninguno')}`,
		`- Promos ya mencionadas: ${formatArrayField(commercialPlan.alreadyShared?.shownOffers, 'ninguna')}`,
		`- Acción recomendada: ${commercialPlan.recommendedAction || 'answer_and_guide'}`
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
			? commercialHints.slice(0, 8).map((hint) => `- ${hint}`).join('\n')
			: '- Priorizá una sola oferta principal.';

	const compactCatalog =
		Array.isArray(catalogProducts) && catalogProducts.length
			? catalogProducts
					.slice(0, 3)
					.map((item) => {
						return [
							`- ${item.name}`,
							`  precio: ${item.price || 'no cargado'}`,
							item.productUrl ? `  link: ${item.productUrl}` : '',
							item.colors?.length ? `  colores: ${item.colors.join(', ')}` : '',
							item.sizes?.length ? `  talles: ${item.sizes.join(', ')}` : ''
						]
							.filter(Boolean)
							.join('\n');
					})
					.join('\n')
			: catalogContext || 'No se encontraron productos relevantes.';

	return [
		`SISTEMA: ${systemPrompt}`,
		`NEGOCIO: ${businessName}`,
		`ASESORA: ${agentName}`,
		businessContext ? `CONTEXTO DEL NEGOCIO:\n${businessContext}` : '',
		`DATOS DEL CLIENTE:
- Nombre: ${customerContext.name || contactName || 'Cliente'}
- WhatsApp: ${customerContext.waId || 'No informado'}`,
		conversationSummary ? `RESUMEN DEL CHAT:\n${conversationSummary}` : '',
		`ESTADO ACTUAL:
- Última intención: ${conversationState.lastIntent || 'general'}
- Objetivo: ${conversationState.lastUserGoal || 'consulta_general'}
- Ánimo: ${conversationState.customerMood || 'neutral'}
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
- ${firstContact ? `Si es el primer mensaje, podés presentarte una sola vez como ${agentName} de ${businessName}.` : 'No saludes de nuevo.'}
- Respondé solo al último mensaje.
- Una sola respuesta.
- Soná humana, clara, breve y comercial.
- No uses listas largas ni dos links juntos.
- No repitas promo, precio ni link si ya fueron dados, salvo pedido explícito.
- Si el cliente ya eligió una promo, seguí solo con esa.
- Si preguntan por talle o color, respondé como continuidad del producto foco.
- Si la acción es handoff_human, avisalo con calidez y sin prometer tiempos exactos.
- Si la acción NO es handoff_human, no menciones equipo, asesora ni derivación.
- Si hay una oferta principal clara, priorizala antes que listar otras.`,
		`CONVERSACIÓN RECIENTE:
${transcript}`,
		'Respondé ahora al último mensaje del cliente.'
	]
		.filter(Boolean)
		.join('\n\n');
}