import axios from 'axios';

export function normalizeWhatsAppNumber(input) {
  return String(input || '').replace(/\D/g, '');
}

export async function sendWhatsAppText({ to, body }) {
  const cleanBody = String(body || '').trim();
  const forcedTo = normalizeWhatsAppNumber(process.env.WHATSAPP_FORCE_TO || to);

  if (!forcedTo || !cleanBody) {
    return {
      ok: false,
      provider: 'whatsapp-cloud-api',
      model: null,
      error: { message: 'Falta número o mensaje para enviar por WhatsApp.' }
    };
  }

  const url = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v25.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: forcedTo,
    type: 'text',
    text: { body: cleanBody }
  };

  console.log('[WHATSAPP TEST] URL:', url);
  console.log('[WHATSAPP TEST] TO:', forcedTo);
  console.log('[WHATSAPP TEST] TOKEN first chars:', (process.env.WHATSAPP_ACCESS_TOKEN || '').slice(0, 20));
  console.log('[WHATSAPP TEST] PAYLOAD:', JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('[WHATSAPP TEST] RESPONSE:', response.data);

    return {
      ok: true,
      provider: 'whatsapp-cloud-api',
      model: null,
      rawPayload: response.data
    };
  } catch (error) {
    console.error('[WHATSAPP TEST] ERROR:', error.response?.data || error.message);

    return {
      ok: false,
      provider: 'whatsapp-cloud-api',
      model: null,
      error: error.response?.data || { message: error.message }
    };
  }
}

export async function sendWhatsAppTemplate({
  to,
  templateName,
  languageCode = 'es_AR',
  components = []
}) {
  const forcedTo = normalizeWhatsAppNumber(process.env.WHATSAPP_FORCE_TO || to);

  const url = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v25.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: forcedTo,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components
    }
  };

  console.log('[WHATSAPP TEMPLATE TEST] URL:', url);
  console.log('[WHATSAPP TEMPLATE TEST] TO:', forcedTo);
  console.log('[WHATSAPP TEMPLATE TEST] PAYLOAD:', JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('[WHATSAPP TEMPLATE TEST] RESPONSE:', response.data);

    return {
      ok: true,
      provider: 'whatsapp-cloud-api',
      model: null,
      rawPayload: response.data
    };
  } catch (error) {
    console.error('[WHATSAPP TEMPLATE TEST] ERROR:', error.response?.data || error.message);

    return {
      ok: false,
      provider: 'whatsapp-cloud-api',
      model: null,
      error: error.response?.data || { message: error.message }
    };
  }
}