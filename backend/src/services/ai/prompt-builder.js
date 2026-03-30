import {
	getRelevantStoreFacts,
	getRelevantStyleExamples
} from '../../data/lummine-style.js';
import { buildRelevantBusinessData } from '../../data/lummine-business.js';

function formatTranscript({ businessName, contactName, recentMessages }) {
	return recentMessages
		.slice(-8)
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
		'- Avanzá con el siguiente paso natural de la charla.',
		'- Cuando algo ya quedó claro, no lo vuelvas a vender.',
		'- Si no está confirmado, respondé solo con lo comprobable.'
	].join('\n');
}

function buildCommercialPlanBlock(commercialPlan = {}) {
	const options = Array.isArray(commercialPlan.offerOptions) && commercialPlan.offerOptions.length
		? commercialPlan.offerOptions
				.slice(0, 3)
				.map((option) => `${option.label}${option.price ? ` (${option.price})` : ''}`)
				.join(' | ')
		: 'no cargadas';

	return [
		`- Etapa comercial: ${commercialPlan.stage || 'DISCOVERY'}`,
		`- Acción detectada del cliente: ${commercialPlan.requestedAction || 'GENERAL'}`,
		`- Producto foco: ${commercialPlan.productFocus || 'no claro'}`,
		`- Oferta principal: ${commercialPlan.bestOffer?.name || 'no clara'}`,
		`- Precio principal: ${commercialPlan.bestOffer?.price || 'no cargado'}`,
		`- Opciones breves disponibles: ${options}`,
		`- Si el cliente está explorando, priorizá primero la opción comercial principal de esa familia y después, si hace falta, mencioná la alternativa.`,
		`- ¿Compartir link ahora?: ${commercialPlan.shareLinkNow ? 'Sí' : 'No'}`,
		`- ¿Repetir precio ahora?: ${commercialPlan.repeatPriceNow ? 'Sí' : 'No'}`,
		`- Links ya compartidos: ${formatArrayField(commercialPlan.alreadyShared?.sharedLinks, 'ninguno')}`,
		`- Precios ya mostrados: ${formatArrayField(commercialPlan.alreadyShared?.shownPrices, 'ninguno')}`,
		`- Promos ya mencionadas: ${formatArrayField(commercialPlan.alreadyShared?.shownOffers, 'ninguna')}`,
		`- Acción recomendada: ${commercialPlan.recommendedAction || 'answer_and_guide'}`
	].join('\n');
}

function buildAdaptivePolicySummary(businessData = {}, recentMessages = []) {
	const lastUserText = [...recentMessages].reverse().find((m) => m.role === 'user')?.text || '';
	const joined = lastUserText.toLowerCase();
	const lines = [];

	if (/transferencia|alias|cbu|banco|cuotas|comprobante|pago/.test(joined)) {
		lines.push(`- Pagos: ${businessData?.paymentRules?.publicInfo?.join(' ') || ''}`);
	}

	if (/envio|enviar|correo|llega|demora|bahia|bahía|provincia|interior/.test(joined)) {
		lines.push(`- Envíos: ${businessData?.policySummary?.shipping?.join(' ') || ''}`);
	}

	if (/cambio|devolucion|devolución|defecto|dañado|danado/.test(joined)) {
		lines.push(`- Cambios/devoluciones: ${businessData?.policySummary?.returns?.join(' ') || ''}`);
	}

	return lines.join('\n') || '- No hace falta sumar políticas extra en este turno.';
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
	const lastUserMessage = [...recentMessages].reverse().find((m) => m.role === 'user')?.text || '';
	const facts = getRelevantStoreFacts(recentMessages);
	const styleExamples = getRelevantStyleExamples(recentMessages, 4);
	const firstContact = isFirstContact(recentMessages);
	const businessData = buildRelevantBusinessData(lastUserMessage);

	const commercialHintsBlock =
		Array.isArray(commercialHints) && commercialHints.length
			? commercialHints.slice(0, 8).map((hint) => `- ${hint}`).join('\n')
			: '- Respondé con una orientación simple y útil.';

	const compactCatalog =
		Array.isArray(catalogProducts) && catalogProducts.length
			? catalogProducts
					.slice(0, 3)
					.map((item) => {
						return [
							`- ${item.name}`,
							`  familia: ${item.family || 'general'}`,
							`  oferta: ${item.offerLabel || 'individual'}`,
							`  precio: ${item.price || 'no cargado'}`,
							item.colors?.length ? `  colores: ${item.colors.join(', ')}` : '',
							item.sizes?.length ? `  talles: ${item.sizes.join(', ')}` : '',
							commercialPlan?.shareLinkNow && item.productUrl ? `  link: ${item.productUrl}` : ''
						]
							.filter(Boolean)
							.join('\n');
					})
					.join('\n')
			: catalogContext || 'No se encontraron productos relevantes.';

	const styleBlock = styleExamples
		.map((example) => `Cliente: ${example.customer}\nSofi: ${example.agent}`)
		.join('\n\n');

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
		`EJEMPLOS DE TONO:\n${styleBlock}`,
		`CATÁLOGO RELEVANTE:\n${compactCatalog}`,
		`PISTAS COMERCIALES:\n${commercialHintsBlock}`,
		`POLÍTICAS RELEVANTES DEL NEGOCIO:\n${buildAdaptivePolicySummary(businessData, recentMessages)}`,
		`REGLAS DE SALIDA:\n- ${firstContact ? `Si es el primer mensaje, presentate una sola vez como ${agentName} de ${businessName}.` : 'Continuá la charla sin volver a saludar.'}\n- Abrí directo con información útil.\n- Usá una primera línea sobria, sin muletillas como claro, perfecto, genial, buenísimo o dale.\n- Si el cliente pide opciones, contá 2 o 3 como máximo y en tono conversado.\n- Si el cliente todavía está explorando, podés invitar a mirar la web o catálogo y ofrecer ayuda para elegir.\n- Si el precio ya apareció hace poco, avanzá al siguiente paso natural.\n- Si ya hay un color o talle pedido, respetalo antes que empujar otra promo.\n- Compartí link solo cuando toque.\n- Escribí una sola respuesta, breve y natural.`,
		`CONVERSACIÓN RECIENTE:\n${transcript}`,
		`ÚLTIMO MENSAJE DEL CLIENTE:\n${lastUserMessage}`,
		'Redactá ahora solo la respuesta final de Sofi.'
	]
		.filter(Boolean)
		.join('\n\n');
}
