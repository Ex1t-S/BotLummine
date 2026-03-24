import { prisma } from '../lib/prisma.js'; // Importamos la instancia única
import { runAssistantReply } from './ai/index.js';
import { sendWhatsAppText } from './whatsapp.service.js';
import { normalizeThreadPhone } from '../lib/conversation-threads.js';

/**
 * Busca o crea un contacto y su respectiva conversación.
 */
export async function getOrCreateConversation({ waId, contactName }) {
  const normalizedWaId = normalizeThreadPhone(waId);

  // 1. Asegurar la existencia del contacto
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

  // 2. Buscar conversación existente
  let conversation = await prisma.conversation.findFirst({
    where: { contactId: contact.id },
    include: { contact: true }
  });

  // 3. Si no existe, crearla
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        contactId: contact.id,
        aiEnabled: true,
        lastMessageAt: new Date()
      },
      include: { contact: true }
    });
  }

  return conversation;
}

/**
 * Procesa el mensaje entrante, lo guarda y genera una respuesta de IA si corresponde.
 */
export async function processInboundMessage({ waId, contactName, messageBody, rawPayload, metaMessageId = null }) {
  const normalizedWaId = normalizeThreadPhone(waId);
  
  // Obtenemos la conversación (usando la instancia única de prisma)
  const conversation = await getOrCreateConversation({ waId: normalizedWaId, contactName });

  // Guardar mensaje entrante (INBOUND)
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

  // Actualizar timestamp de la conversación
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() }
  });

  // Re-obtener la conversación con mensajes para el contexto de la IA
  const freshConversation = await prisma.conversation.findUnique({
    where: { id: conversation.id },
    include: {
      contact: true,
      messages: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!freshConversation) return { conversation };

  // Lógica de auto-respuesta
  const isAiEnabledGlobal = String(process.env.AI_AUTOREPLY_ENABLED || 'true').toLowerCase() === 'true';
  const shouldReply = isAiEnabledGlobal && freshConversation.aiEnabled;

  if (shouldReply) {
    // Preparar contexto para la IA
    const maxContext = Number(process.env.MAX_CONTEXT_MESSAGES || 12);
    const recentMessages = freshConversation.messages
      .slice(-maxContext)
      .map((msg) => ({
        role: msg.direction === 'INBOUND' ? 'user' : 'assistant',
        text: msg.body
      }));

    try {
      // 1. Llamada a Gemini (usando el servicio corregido anteriormente)
      const aiResult = await runAssistantReply({
        businessName: process.env.BUSINESS_NAME || 'Lummine',
        contactName: freshConversation.contact.name || freshConversation.contact.waId,
        recentMessages
      });

      // 2. Enviar respuesta por WhatsApp
      const waResult = await sendWhatsAppText({
        to: freshConversation.contact.waId,
        body: aiResult.text
      });

      // 3. Guardar mensaje de salida (OUTBOUND)
      await prisma.message.create({
        data: {
          conversationId: freshConversation.id,
          direction: 'OUTBOUND',
          senderName: process.env.BUSINESS_NAME || 'Lummine',
          body: aiResult.text,
          provider: aiResult.provider,
          model: aiResult.model,
          tokenPrompt: aiResult.usage?.inputTokens ?? null,
          tokenCompletion: aiResult.usage?.outputTokens ?? null,
          tokenTotal: aiResult.usage?.totalTokens ?? null,
          rawPayload: {
            ai: aiResult.raw,
            whatsapp: waResult?.rawPayload || {}
          }
        }
      });

      // Actualizar timestamp final
      await prisma.conversation.update({
        where: { id: freshConversation.id },
        data: { lastMessageAt: new Date() }
      });

    } catch (aiError) {
      console.error("Error en flujo de respuesta automática:", aiError.message);
      // No bloqueamos el proceso principal si falla la IA
    }
  }

  return { conversation: freshConversation };
}