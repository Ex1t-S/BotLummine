import { prisma } from '../lib/prisma.js';
import { runAssistantReply } from './ai/index.js';
import { sendWhatsAppText } from './whatsapp.service.js';
import { normalizeThreadPhone } from '../lib/conversation-threads.js';
import { detectIntent, extractOrderNumber } from '../lib/intent.js';
import {
  handleOrderStatusIntent,
  buildFixedOrderReply
} from './intents/order-status.service.js';
import { handlePaymentIntent } from './intents/payment.service.js';
import { handleShippingIntent } from './intents/shipping.service.js';
import { handleSizeHelpIntent } from './intents/size-help.service.js';
import { handleProductRecommendationIntent } from './intents/product-recommendation.service.js';

export async function getOrCreateConversation({ waId, contactName }) {
  const normalizedWaId = normalizeThreadPhone(waId);

  const contact = await prisma.contact.upsert({
    where: { waId: normalizedWaId },
    update: {
      name: contactName || undefined,
      phone: normalizedWaId
    },
    create: {
      waId: normalizedWaId,
      phone: normalizedWaId,
      name: contactName || normalizedWaId
    }
  });

  let conversation = await prisma.conversation.findFirst({
    where: { contactId: contact.id },
    include: { contact: true, state: true }
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        contactId: contact.id,
        aiEnabled: true,
        lastMessageAt: new Date(),
        state: {
          create: {
            customerName: contactName || normalizedWaId
          }
        }
      },
      include: { contact: true, state: true }
    });
  }

  if (!conversation.state) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        state: {
          create: {
            customerName: contactName || normalizedWaId
          }
        }
      },
      include: { contact: true, state: true }
    });
  }

  return conversation;
}

async function sendAndPersistOutbound({ conversationId, waId, body, aiMeta = null }) {
  const waResult = await sendWhatsAppText({ to: waId, body });

  await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderName: process.env.BUSINESS_NAME || 'Lummine',
      body,
      provider: aiMeta?.provider || waResult?.provider || 'whatsapp-cloud-api',
      model: aiMeta?.model || waResult?.model || null,
      tokenPrompt: aiMeta?.usage?.inputTokens ?? null,
      tokenCompletion: aiMeta?.usage?.outputTokens ?? null,
      tokenTotal: aiMeta?.usage?.totalTokens ?? null,
      rawPayload: {
        ai: aiMeta?.raw || null,
        whatsapp: waResult?.rawPayload || waResult?.error || waResult || {}
      }
    }
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() }
  });

  if (waResult?.ok === false) {
    console.error('Error enviando WhatsApp:', waResult.error || waResult);
  }

  return waResult;
}

async function resolveIntentAction({ intent, messageBody, explicitOrderNumber }) {
  if (intent === 'order_status') {
    return handleOrderStatusIntent({ explicitOrderNumber });
  }

  if (intent === 'payment') {
    return handlePaymentIntent();
  }

  if (intent === 'shipping') {
    return handleShippingIntent();
  }

  if (intent === 'size_help') {
    return handleSizeHelpIntent();
  }

  if (intent === 'product') {
    return handleProductRecommendationIntent({ messageBody });
  }

  return {
    handled: false,
    forcedReply: null,
    liveOrderContext: null
  };
}

export async function processInboundMessage({
  waId,
  contactName,
  messageBody,
  rawPayload,
  metaMessageId = null
}) {
  const normalizedWaId = normalizeThreadPhone(waId);

  const conversation = await getOrCreateConversation({
    waId: normalizedWaId,
    contactName
  });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      metaMessageId,
      senderName: contactName || normalizedWaId,
      direction: 'INBOUND',
      body: messageBody,
      rawPayload
    }
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() }
  });

  const freshConversation = await prisma.conversation.findUnique({
    where: { id: conversation.id },
    include: {
      contact: true,
      state: true,
      messages: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!freshConversation) {
    return { conversation };
  }

  const isAiEnabledGlobal =
    String(process.env.AI_AUTOREPLY_ENABLED || 'true').toLowerCase() === 'true';

  const shouldReply = isAiEnabledGlobal && freshConversation.aiEnabled;

  if (!shouldReply) {
    return { conversation: freshConversation };
  }

  const currentState = freshConversation.state || {};
  const intent = detectIntent(messageBody, currentState);
  const explicitOrderNumber = extractOrderNumber(messageBody);

  const intentResult = await resolveIntentAction({
    intent,
    messageBody,
    explicitOrderNumber
  });

  const liveOrderContext = intentResult.liveOrderContext || null;
  const forcedReply = intentResult.forcedReply || null;

const shouldKeepOrderContext =
  intent === 'order_status' ||
  (currentState?.lastIntent === 'order_status' && explicitOrderNumber);

await prisma.conversationState.upsert({
  where: { conversationId: freshConversation.id },
  update: {
    customerName: contactName || freshConversation.contact.name || normalizedWaId,
    lastIntent: shouldKeepOrderContext ? 'order_status' : intent,
    lastOrderNumber: shouldKeepOrderContext
      ? explicitOrderNumber || currentState.lastOrderNumber || null
      : null,
    lastOrderId: shouldKeepOrderContext
      ? (
          liveOrderContext?.orderId
            ? String(liveOrderContext.orderId)
            : currentState.lastOrderId || null
        )
      : null
  },
  create: {
    conversationId: freshConversation.id,
    customerName: contactName || freshConversation.contact.name || normalizedWaId,
    lastIntent: shouldKeepOrderContext ? 'order_status' : intent,
    lastOrderNumber: shouldKeepOrderContext
      ? explicitOrderNumber || null
      : null,
    lastOrderId: shouldKeepOrderContext
      ? (
          liveOrderContext?.orderId
            ? String(liveOrderContext.orderId)
            : null
        )
      : null
  }
});

  if (forcedReply) {
    await sendAndPersistOutbound({
      conversationId: freshConversation.id,
      waId: freshConversation.contact.waId,
      body: forcedReply
    });

    return { conversation: freshConversation };
  }

  const maxContext = Number(process.env.MAX_CONTEXT_MESSAGES || 12);

  const recentMessages = freshConversation.messages
    .slice(-maxContext)
    .map((msg) => ({
      role: msg.direction === 'INBOUND' ? 'user' : 'assistant',
      text: msg.body
    }));

  if (intent === 'order_status' && liveOrderContext) {
    try {
      const aiOrderResult = await runAssistantReply({
        businessName: process.env.BUSINESS_NAME || 'Lummine',
        contactName: freshConversation.contact.name || freshConversation.contact.waId,
        recentMessages,
        conversationSummary: freshConversation.lastSummary || '',
        customerContext: {
          name: freshConversation.contact.name || freshConversation.contact.waId,
          waId: freshConversation.contact.waId
        },
        conversationState: {
          ...currentState,
          lastIntent: intent,
          lastOrderNumber: explicitOrderNumber || currentState.lastOrderNumber || null,
          lastOrderId: liveOrderContext?.orderId
            ? String(liveOrderContext.orderId)
            : currentState.lastOrderId || null
        },
        liveOrderContext
      });

      const finalOrderReply =
        String(aiOrderResult?.text || '').trim() || buildFixedOrderReply(liveOrderContext);

      await sendAndPersistOutbound({
        conversationId: freshConversation.id,
        waId: freshConversation.contact.waId,
        body: finalOrderReply,
        aiMeta: aiOrderResult
      });

      return { conversation: freshConversation };
    } catch (orderAiError) {
      console.error('Error redactando respuesta de pedido con IA:', orderAiError);

      await sendAndPersistOutbound({
        conversationId: freshConversation.id,
        waId: freshConversation.contact.waId,
        body: buildFixedOrderReply(liveOrderContext)
      });

      return { conversation: freshConversation };
    }
  }

  try {
    const aiResult = await runAssistantReply({
      businessName: process.env.BUSINESS_NAME || 'Lummine',
      contactName: freshConversation.contact.name || freshConversation.contact.waId,
      recentMessages,
      conversationSummary: freshConversation.lastSummary || '',
      customerContext: {
        name: freshConversation.contact.name || freshConversation.contact.waId,
        waId: freshConversation.contact.waId
      },
      conversationState: {
        ...currentState,
        lastIntent: intent,
        lastOrderNumber: explicitOrderNumber || currentState.lastOrderNumber || null,
        lastOrderId: liveOrderContext?.orderId
          ? String(liveOrderContext.orderId)
          : currentState.lastOrderId || null
      },
      liveOrderContext
    });

    await sendAndPersistOutbound({
      conversationId: freshConversation.id,
      waId: freshConversation.contact.waId,
      body: aiResult.text,
      aiMeta: aiResult
    });
  } catch (aiError) {
    console.error('Error en flujo de respuesta automática:', aiError);
  }

  return { conversation: freshConversation };
}