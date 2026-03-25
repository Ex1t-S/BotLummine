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

export function buildPrompt({
  businessName,
  contactName,
  recentMessages,
  conversationSummary = '',
  customerContext = {},
  conversationState = {},
  liveOrderContext = null
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

  const relevantProductsText = businessData.products.length
    ? businessData.products.map((p) => {
        return [
          `- ${p.name}`,
          `  Categoría: ${p.category}`,
          `  URL: ${p.url}`,
          `  Resumen: ${p.shortDescription}`
        ].join('\n');
      }).join('\n')
    : '- No se detectaron productos específicos para este mensaje.';

  const paymentBlock = businessData.intent === 'payment'
    ? `DATOS DE PAGO / TRANSFERENCIA:
- Alias: ${businessData.paymentRules.transfer.alias}
- CBU: ${businessData.paymentRules.transfer.cbu}
- Titular: ${businessData.paymentRules.transfer.holder}
- Banco: ${businessData.paymentRules.transfer.bank}
- Instrucción extra: ${businessData.paymentRules.transfer.extraInstructions}`
    : `DATOS DE PAGO / TRANSFERENCIA:
- No compartir alias/CBU salvo que la clienta lo pida, pregunte por transferencia o esté lista para pagar.`;

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
- Último pedido consultado: ${conversationState.lastOrderNumber || 'ninguno'}
- ¿Derivar a humano?: ${conversationState.needsHuman ? 'Sí' : 'No'}`,
    `PEDIDO REAL / TRACKING:
${formatLiveOrderContext(liveOrderContext)}`,
    `HECHOS ÚTILES:
${facts.map((fact) => `- ${fact}`).join('\n')}`,
    `PRODUCTOS / LINKS RELEVANTES:
${relevantProductsText}`,
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
    `ESTADO DE LA CONVERSACIÓN:
- ¿Es el primer mensaje? ${firstContact ? 'Sí' : 'No'}
- Intención detectada: ${businessData.intent}`,
    `REGLAS FINALES:
- Soná humana, cálida y breve.
- Si es el primer mensaje, presentate como ${agentName} de ${businessName}.
- Si no es el primer mensaje, no te vuelvas a presentar.
- Si hay datos en PEDIDO REAL / TRACKING, usalos tal cual y no inventes nada.
- Si no hay número de pedido o faltan datos operativos, pedilos.
- Si el cliente pregunta por un producto, ayudá y, si suma, podés pasarle el link.
- Si pide transferencia o pago, ahí sí podés compartir los datos de pago.
- No inventes stock, talles, precio final ni tiempos exactos si no están confirmados.
- Máximo ideal: 350 caracteres.`,
    `CONVERSACIÓN RECIENTE:
${transcript}`,
    'Respondé ahora al último mensaje del cliente.'
  ]
    .filter(Boolean)
    .join('\n\n');
}