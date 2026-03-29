import { getRelevantStoreFacts, getRelevantStyleExamples } from '../../data/lummine-style.js';
import { buildRelevantBusinessData } from '../../data/lummine-business.js';

function lastUserMessage(recentMessages = []) {
	const reversed = [...recentMessages].reverse();
	return reversed.find((item) => item.role === 'user')?.text || '';
}

function formatHistoryForReference({ recentMessages = [] }) {
	return recentMessages
		.slice(-8)
		.map((item, index) => {
			const speaker = item.role === 'assistant' ? 'ASESORA' : 'CLIENTE';
			return `${index + 1}. ${speaker}: ${String(item.text || '').replace(/\s+/g, ' ').trim()}`;
		})
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
	return [
		`- Etapa comercial: ${commercialPlan.stage || 'DISCOVERY'}`,
		`- Acción detectada del cliente: ${commercialPlan.requestedAction || 'GENERAL'}`,
		`- Producto foco: ${commercialPlan.productFocus || 'no claro'}`,
		`- Oferta principal: ${commercialPlan.bestOffer?.name || 'no clara'}`,
		`- Precio principal: ${commercialPlan.bestOffer?.price || 'no cargado'}`,
		`- ¿Compartir link ahora?: ${commercialPlan.shareLinkNow ? 'Sí' : 'No'}`,
		`- ¿Repetir precio ahora?: ${commercialPlan.repeatPriceNow ? 'Sí' : 'No'}`,
		`- Links ya compartidos: ${formatArrayField(commercialPlan.alreadyShared?.sharedLinks, 'ninguno')}`,
		`- Precios ya mostrados: ${formatArrayField(commercialPlan.alreadyShared?.shownPrices, 'ninguno')}`,
		`- Promos ya mencionadas: ${formatArrayField(commercialPlan.alreadyShared?.shownOffers, 'ninguna')}`,
		`- Acción recomendada: ${commercialPlan.recommendedAction || 'answer_and_guide'}`
	].join('\n');
}

function buildCatalogBlock(catalogProducts = [], catalogContext = '', commercialPlan = {}) {
	if (Array.isArray(catalogProducts) && catalogProducts.length) {
		return catalogProducts
			.slice(0, 3)
			.map((item) => {
				return [
					`- ${item.name}`,
					`  precio: ${item.price || 'no cargado'}`,
					item.colors?.length ? `  colores: ${item.colors.join(', ')}` : '',
					item.sizes?.length ? `  talles: ${item.sizes.join(', ')}` : '',
					commercialPlan.shareLinkNow && item.productUrl ? `  link: ${item.productUrl}` : ''
				]
					.filter(Boolean)
					.join('\n');
			})
			.join('\n');
	}

	if (!catalogContext) {
		return 'No se encontraron productos relevantes.';
	}

	if (!commercialPlan.shareLinkNow) {
		return catalogContext.replace(/^\s*- Link: .*$/gim, '').trim();
	}

	return catalogContext;
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
	const customerName = customerContext.name || contactName || 'Cliente';
	const lastCustomerMessage = lastUserMessage(recentMessages);
	const facts = getRelevantStoreFacts(recentMessages);
	const styleExamples = getRelevantStyleExamples(recentMessages, 4);
	const firstContact = isFirstContact(recentMessages);
	const businessData = buildRelevantBusinessData(lastCustomerMessage || '');
	const history = formatHistoryForReference({ recentMessages });

	const commercialHintsBlock =
		Array.isArray(commercialHints) && commercialHints.length
			? commercialHints.slice(0, 8).map((hint) => `- ${hint}`).join('\n')
			: '- Priorizá una sola oferta principal.';

	const styleExamplesBlock = styleExamples
		.map((item) => `- Cliente: ${item.customer}\n  Sofi: ${item.agent}`)
		.join('\n');

	const catalogBlock = buildCatalogBlock(catalogProducts, catalogContext, commercialPlan);

	return [
		`SISTEMA: ${systemPrompt}`,
		`NEGOCIO: ${businessName}`,
		`ASESORA: ${agentName}`,
		'OBJETIVO CENTRAL: vender con tono humano, natural y útil, sin sonar automática ni apurada.',
		businessContext ? `CONTEXTO DEL NEGOCIO:\n${businessContext}` : '',
		`DATOS DEL CLIENTE:\n- Nombre: ${customerName}\n- WhatsApp: ${customerContext.waId || 'No informado'}`,
		conversationSummary ? `RESUMEN DEL CHAT:\n${conversationSummary}` : '',
		`ESTADO ACTUAL:\n- Última intención: ${conversationState.lastIntent || 'general'}\n- Objetivo: ${conversationState.lastUserGoal || 'consulta_general'}\n- Ánimo: ${conversationState.customerMood || 'neutral'}\n- Talle detectado: ${conversationState.frequentSize || 'no detectado'}\n- Pago preferido: ${conversationState.paymentPreference || 'no detectado'}\n- Productos de interés: ${formatArrayField(conversationState.interestedProducts)}\n- ¿Necesita humano?: ${conversationState.needsHuman ? 'Sí' : 'No'}`,
		`POLÍTICA DE RESPUESTA:\n${buildPolicyBlock(responsePolicy)}`,
		`PLAN COMERCIAL:\n${buildCommercialPlanBlock(commercialPlan)}`,
		`PEDIDO REAL / TRACKING:\n${formatLiveOrderContext(liveOrderContext)}`,
		`HECHOS ÚTILES:\n${facts.map((fact) => `- ${fact}`).join('\n')}`,
		`CATÁLOGO RELEVANTE:\n${catalogBlock}`,
		`PISTAS COMERCIALES:\n${commercialHintsBlock}`,
		`ESTILO ESPERADO (IMITAR TONO, NO COPIAR TEXTUAL):\n${styleExamplesBlock}`,
		`POLÍTICAS RESUMIDAS:\n- Envíos: ${businessData.policySummary.shipping.join(' ')}\n- Cambios/devoluciones: ${businessData.policySummary.returns.join(' ')}`,
		`HISTORIAL DE REFERENCIA (SOLO CONTEXTO, NO COPIAR NI REESCRIBIR):\n${history || 'Sin historial relevante.'}`,
		`ÚLTIMO MENSAJE DEL CLIENTE (RESPONDÉ SOLO A ESTO):\n${lastCustomerMessage || 'Sin mensaje detectado.'}`,
		`REGLAS DE SALIDA OBLIGATORIAS:\n- ${firstContact ? `Si es el primer mensaje, presentate una sola vez como ${agentName} de ${businessName}.` : 'No saludes de nuevo.'}\n- Nunca copies ni reescribas el historial.\n- Nunca devuelvas prefijos como CLIENTE:, ASESORA:, ${customerName}: o ${businessName}:.\n- No uses muletillas repetidas como “claro”, “perfecto”, “dale”, “genial” al inicio de cada respuesta.\n- Si el cliente recién está explorando, orientá primero y no cierres una promo demasiado rápido.\n- Si todavía no pidió link, no mandes link.\n- Si ya hay una promo o producto foco elegido, seguí solo con ese.\n- No mezcles dos promos distintas en una misma respuesta.\n- No listes nombres largos de productos salvo que haga falta.\n- Soná humana, breve y vendedora, pero sin sonar automática.\n- Entregá una sola respuesta final, lista para WhatsApp.`
	]
		.filter(Boolean)
		.join('\n\n');
}
