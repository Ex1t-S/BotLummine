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
	if (!liveOrderContext) return 'No hay datos operativos en tiempo real para este mensaje.';

	return [
		`- Número de pedido: ${liveOrderContext.orderNumber}`,
		`- ID interno: ${liveOrderContext.orderId}`,
		`- Cliente: ${liveOrderContext.customerName || 'No informado'}`,
		`- Email: ${liveOrderContext.contactEmail || 'No informado'}`,
		`- WhatsApp/Teléfono: ${liveOrderContext.contactPhone || 'No informado'}`,
		`- Pago: ${liveOrderContext.paymentStatus || 'No informado'}`,
		`- Envío: ${liveOrderContext.shippingStatus || 'No informado'}`,
		`- Estado general: ${liveOrderContext.orderStatus || 'No informado'}`,
		`- Total: ${liveOrderContext.total || 'No informado'} ${liveOrderContext.currency || ''}`,
		liveOrderContext.trackingNumber
			? `- Código de seguimiento: ${liveOrderContext.trackingNumber}`
			: '- Código de seguimiento: no informado',
		liveOrderContext.trackingUrl
			? `- URL de seguimiento: ${liveOrderContext.trackingUrl}`
			: '- URL de seguimiento: no informada'
	].join('\n');
}

function formatArrayField(value = [], fallback = 'ninguno') {
	return Array.isArray(value) && value.length ? value.join(', ') : fallback;
}

function buildToneInstruction(conversationState = {}) {
	const tone = conversationState.preferredTone || 'amigable_directo';

	const map = {
		amigable_directo: 'Respondé natural, clara, cercana y sin dar demasiadas vueltas.',
		venta_calida: 'Respondé cálida, comercial y útil, guiando suavemente hacia la compra.',
		asesoramiento_calido: 'Respondé como asesora paciente, explicando sin sonar técnica.',
		postventa_clara: 'Respondé clara, ordenada y tranquilizadora.',
		calmo_resolutivo: 'Respondé con empatía, calma y foco en resolver. No discutas ni minimices el problema.',
		empatico_concreto: 'Respondé con empatía y precisión. Validá la situación y explicá el siguiente paso.',
		cierre_comercial: 'Respondé breve, segura y orientada a cerrar la compra con CTA claro.'
	};

	return map[tone] || map.amigable_directo;
}

function buildMoodInstruction(conversationState = {}) {
	const mood = conversationState.customerMood || 'neutral';

	const map = {
		molesta: 'La clienta parece molesta. Validá su situación y evitá sonar fría o automática.',
		confundida: 'La clienta parece confundida. Explicá simple y con seguridad.',
		apurada: 'La clienta parece apurada. Respondé corto, claro y accionable.',
		lista_para_comprar: 'La clienta parece lista para comprar. Ayudá a avanzar sin fricción.',
		neutral: 'Mantené un tono natural y útil.'
	};

	return map[mood] || map.neutral;
}

function buildUrgencyInstruction(conversationState = {}) {
	const urgency = conversationState.urgencyLevel || 'baja';

	if (urgency === 'alta') return 'Hay urgencia alta: priorizá resolver o destrabar el siguiente paso.';
	if (urgency === 'media') return 'Hay urgencia media: respondé ágil y concreta.';
	return 'No hace falta apurar la conversación; priorizá claridad.';
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
	commercialHints = []
}) {
	const systemPrompt = process.env.SYSTEM_PROMPT || 'Respondé como asesora humana.';
	const businessContext = process.env.BUSINESS_CONTEXT || '';
	const agentName = process.env.BUSINESS_AGENT_NAME || 'Sofi';

	const lastUserText = [...recentMessages].reverse().find((m) => m.role === 'user')?.text || '';
	const transcript = formatTranscript({ businessName, contactName, recentMessages });
	const facts = getRelevantStoreFacts(recentMessages);
	const examples = getRelevantStyleExamples(recentMessages, 4);
	const firstContact = isFirstContact(recentMessages);
	const businessData = buildRelevantBusinessData(lastUserText);

	const paymentBlock = businessData.intent === 'payment'
		? `DATOS DE PAGO / TRANSFERENCIA:
- Alias: ${businessData.paymentRules.transfer.alias}
- CBU: ${businessData.paymentRules.transfer.cbu}
- Titular: ${businessData.paymentRules.transfer.holder}
- Banco: ${businessData.paymentRules.transfer.bank}
- Instrucción extra: ${businessData.paymentRules.transfer.extraInstructions}`
		: `DATOS DE PAGO / TRANSFERENCIA:
- No compartir alias/CBU salvo que la clienta lo pida, pregunte por transferencia o esté lista para pagar.`;

	const handoffBlock = conversationState.needsHuman
		? `DERIVACIÓN:
- Esta conversación está marcada para humano.
- No intentes seguir resolviendo con IA.
- Solo respondé si el sistema igualmente te pidió texto, y en ese caso decí algo breve indicando que una asesora seguirá el caso.`
		: `DERIVACIÓN:
- Solo sugerí derivación a humano si el caso es sensible, ambiguo o requiere excepción.`;

	const catalogBlock = catalogContext || 'No se encontraron productos relevantes del catálogo local para este mensaje.';
	const commercialHintsBlock = Array.isArray(commercialHints) && commercialHints.length
		? commercialHints.map((hint) => `- ${hint}`).join('\n')
		: '- Priorizá ayudar con claridad antes que vender por vender.';

	return [
		`SISTEMA: ${systemPrompt}`,
		`NEGOCIO: ${businessName}`,
		`ASESORA: ${agentName}`,
		businessContext ? `CONTEXTO DEL NEGOCIO:\n${businessContext}` : '',
		`DATOS DEL CLIENTE:
- Nombre: ${customerContext.name || contactName || 'Cliente'}
- WhatsApp: ${customerContext.waId || 'No informado'}
- Email: ${conversationState.customerEmail || 'No informado'}`,
		conversationSummary ? `RESUMEN DEL CHAT:\n${conversationSummary}` : '',
		`ESTADO ESTRUCTURADO:
- Última intención: ${conversationState.lastIntent || 'general'}
- Intención detectada fina: ${conversationState.lastDetectedIntent || 'general'}
- Objetivo detectado: ${conversationState.lastUserGoal || 'consulta_general'}
- Ánimo del cliente: ${conversationState.customerMood || 'neutral'}
- Urgencia: ${conversationState.urgencyLevel || 'baja'}
- Tono recomendado: ${conversationState.preferredTone || 'amigable_directo'}
- Último pedido consultado: ${conversationState.lastOrderNumber || 'ninguno'}
- Talle frecuente detectado: ${conversationState.frequentSize || 'no detectado'}
- Preferencia de pago: ${conversationState.paymentPreference || 'no detectada'}
- Preferencia de entrega: ${conversationState.deliveryPreference || 'no detectada'}
- Productos de interés: ${formatArrayField(conversationState.interestedProducts)}
- Objeciones detectadas: ${formatArrayField(conversationState.objections)}
- ¿Lista para compra?: ${conversationState.lastUserGoal === 'comprar' ? 'Sí' : 'No'}
- ¿Derivar a humano?: ${conversationState.needsHuman ? 'Sí' : 'No'}
- Motivo de derivación: ${conversationState.handoffReason || 'ninguno'}`,
		`PEDIDO REAL / TRACKING:
${formatLiveOrderContext(liveOrderContext)}`,
		`HECHOS ÚTILES:
${facts.map((fact) => `- ${fact}`).join('\n')}`,
		`CATÁLOGO LOCAL RELEVANTE:
${catalogBlock}`,
		`PISTAS COMERCIALES:
${commercialHintsBlock}`,
		`POLÍTICAS RESUMIDAS:
- Envíos: ${businessData.policySummary.shipping.join(' ')}
- Cambios/devoluciones: ${businessData.policySummary.returns.join(' ')}`,
		paymentBlock,
		`LINKS FIJOS DEL NEGOCIO:
- Home: ${businessData.links.home}
- Contacto: ${businessData.links.contacto}
- Política de envío: ${businessData.links.politicaEnvio}
- Política de devolución: ${businessData.links.politicaDevolucion}`,
		`EJEMPLOS DE ESTILO:
${formatExamples({ businessName, examples })}`,
		`ESTILO Y ENFOQUE:
- ${buildToneInstruction(conversationState)}
- ${buildMoodInstruction(conversationState)}
- ${buildUrgencyInstruction(conversationState)}
- Variá levemente la forma de responder para no sonar repetitiva.
- Si la clienta está lista para comprar, cerrá con un siguiente paso claro.`,
		handoffBlock,
		`REGLAS DE CATÁLOGO:
- Si hay productos en CATÁLOGO LOCAL RELEVANTE, priorizalos por sobre conocimiento general.
- No inventes productos que no estén ahí cuando la consulta sea específica.
- No inventes talles, colores, variantes, promociones ni stock.
- Si hay link real del producto, podés compartirlo.
- Si no alcanza la info, pedí una aclaración corta.`,
		`REGLAS FINALES:
- Soná humana, cálida y breve.
- ${firstContact ? `Si es el primer mensaje, presentate como ${agentName} de ${businessName}.` : 'Si no es el primer mensaje, no te vuelvas a presentar.'}
- Si hay datos en PEDIDO REAL / TRACKING, usalos tal cual y no inventes nada.
- Si no hay número de pedido o faltan datos operativos, pedilos.
- Si pide transferencia o pago, ahí sí podés compartir los datos de pago.
- Máximo ideal: 350 caracteres.`,
		`CONVERSACIÓN RECIENTE:
${transcript}`,
		'Respondé ahora al último mensaje del cliente.'
	]
		.filter(Boolean)
		.join('\n\n');
}