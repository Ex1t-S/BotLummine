import { getRelevantStoreFacts, getRelevantStyleExamples } from '../../data/lummine-style.js';
import { buildRelevantBusinessData } from '../../data/lummine-business.js';

function formatTranscript({ businessName, contactName, recentMessages }) {
	return recentMessages
		.map((item) => `${item.role === 'assistant' ? businessName : contactName}: ${item.text}`)
		.join('\n');
}

function formatExamples({ businessName, examples }) {
	return examples
		.map((example, index) => {
			return [
				`EJEMPLO ${index + 1}`,
				`Cliente: ${example.customer}`,
				`${businessName}: ${example.agent}`
			].join('\n');
		})
		.join('\n\n');
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
		`- Máximo ideal: ${responsePolicy.maxChars || 260} caracteres`,
		`- ¿Puede mencionar derivación humana?: ${responsePolicy.allowHandoffMention ? 'Sí' : 'No'}`,
		'- No inventes acciones operativas.',
		'- No prometas que una asesora va a tomar el caso salvo que la acción permitida sea handoff_human.',
		'- Si no hay tracking, no inventes tracking.',
		'- Si no sabés algo, respondé solo con lo que sí está confirmado.',
		'- No repitas saludo si la conversación ya empezó.',
		'- Respondé como continuidad natural del chat.',
		'- No uses párrafos largos.',
		'- No metas relleno.'
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
	responsePolicy = {}
}) {
	const systemPrompt = process.env.SYSTEM_PROMPT || 'Respondé como asesora humana.';
	const businessContext = process.env.BUSINESS_CONTEXT || '';
	const agentName = process.env.BUSINESS_AGENT_NAME || 'Sofi';

	const transcript = formatTranscript({ businessName, contactName, recentMessages });
	const facts = getRelevantStoreFacts(recentMessages);
	const examples = getRelevantStyleExamples(recentMessages, 3);
	const firstContact = isFirstContact(recentMessages);
	const businessData = buildRelevantBusinessData(
		[...recentMessages].reverse().find((m) => m.role === 'user')?.text || ''
	);

	const commercialHintsBlock =
		Array.isArray(commercialHints) && commercialHints.length
			? commercialHints.slice(0, 8).map((hint) => `- ${hint}`).join('\n')
			: '- Priorizá ayudar con claridad.';

	const compactCatalog =
		Array.isArray(catalogProducts) && catalogProducts.length
			? catalogProducts
					.slice(0, 4)
					.map((item) => {
						const price = item.price ? `$${item.price}` : 'precio no cargado';
						return `- ${item.name} | ${price}${item.productUrl ? ` | ${item.productUrl}` : ''}`;
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
- Urgencia: ${conversationState.urgencyLevel || 'baja'}
- Talle detectado: ${conversationState.frequentSize || 'no detectado'}
- Pago preferido: ${conversationState.paymentPreference || 'no detectado'}
- Entrega preferida: ${conversationState.deliveryPreference || 'no detectada'}
- Productos de interés: ${formatArrayField(conversationState.interestedProducts)}
- ¿Necesita humano?: ${conversationState.needsHuman ? 'Sí' : 'No'}`,
		`POLÍTICA DE RESPUESTA:
${buildPolicyBlock(responsePolicy)}`,
		`PEDIDO REAL / TRACKING:
${formatLiveOrderContext(liveOrderContext)}`,
		`HECHOS ÚTILES:
${facts.map((fact) => `- ${fact}`).join('\n')}`,
		`CATÁLOGO RELEVANTE:
${compactCatalog}`,
		`PISTAS:
${commercialHintsBlock}`,
		`POLÍTICAS RESUMIDAS:
- Envíos: ${businessData.policySummary.shipping.join(' ')}
- Cambios/devoluciones: ${businessData.policySummary.returns.join(' ')}`,
		`EJEMPLOS DE ESTILO:
${formatExamples({ businessName, examples })}`,
		`REGLAS DE SALIDA:
- ${firstContact ? `Si es el primer mensaje, podés presentarte como ${agentName} de ${businessName}.` : 'No saludes de nuevo.'}
- Respondé solo al último mensaje.
- Una sola respuesta.
- Soná humana, clara y natural.
- No uses formato raro ni listas largas.
- No repitas datos ya dichos si no hace falta.
- Si la acción es handoff_human, avisalo con calidez y sin prometer tiempos exactos.
- Si la acción NO es handoff_human, no menciones asesora, equipo ni derivación.`,
		`CONVERSACIÓN RECIENTE:
${transcript}`,
		'Respondé ahora al último mensaje del cliente.'
	]
		.filter(Boolean)
		.join('\n\n');
}