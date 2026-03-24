import { processInboundMessage } from '../services/chat.service.js';

export function verifyWhatsappWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (
    mode === 'subscribe' &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
}

export async function receiveWhatsappWebhook(req, res) {
  try {
    res.sendStatus(200);

    const entries = req.body?.entry || [];

    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        for (const message of value.messages || []) {
          if (message.type !== 'text') continue;

          const contactInfo = (value.contacts || []).find((c) => c.wa_id === message.from);

          await processInboundMessage({
            waId: message.from,
            contactName: contactInfo?.profile?.name || message.from,
            messageBody: message.text?.body || '',
            rawPayload: req.body,
            metaMessageId: message.id || null
          });
        }
      }
    }
  } catch (error) {
    console.error('Error webhook WhatsApp:', error);
  }
}
