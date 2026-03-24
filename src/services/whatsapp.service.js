import axios from 'axios';

export function normalizeWhatsAppNumber(input) {
  let n = String(input || '').replace(/[^\d]/g, '');

  if (!n) return '';

  if (!n.startsWith('54')) {
    return n;
  }

  // Buenos Aires: 54911XXXXXXXX -> 541115XXXXXXXX
  if (n.startsWith('54911') && n.length === 13) {
    return `541115${n.slice(5)}`;
  }

  // Buenos Aires sin 15: 5411XXXXXXXX -> 541115XXXXXXXX
  if (n.startsWith('5411') && n.length === 12) {
    return `541115${n.slice(4)}`;
  }

  // Ya está en formato correcto, ej 54292315562286
  if (n.startsWith('54') && !n.startsWith('549') && n.length === 14) {
    return n;
  }

  // Caso AR típico como el tuyo:
  // 5492923562286 -> 54292315562286
  if (n.startsWith('549') && n.length === 13) {
    const national = n.slice(3); // 2923562286
    const areaCode = national.slice(0, 4); // 2923
    const localNumber = national.slice(4); // 562286
    return `54${areaCode}15${localNumber}`;
  }

  // Caso AR sin 9 ni 15: 542923562286 -> 54292315562286
  if (n.startsWith('54') && !n.startsWith('549') && n.length === 12) {
    const national = n.slice(2); // 2923562286
    const areaCode = national.slice(0, 4);
    const localNumber = national.slice(4);
    return `54${areaCode}15${localNumber}`;
  }

  return n;
}

export async function sendWhatsAppText({ to, body }) {
  const dryRun = String(process.env.WHATSAPP_DRY_RUN || 'true').toLowerCase() === 'true';

  const cleanTo = normalizeWhatsAppNumber(to);
  const cleanBody = String(body || '').trim();

  if (!cleanTo || !cleanBody) {
    return {
      ok: false,
      provider: 'whatsapp-cloud-api',
      model: null,
      error: {
        message: 'Falta número o mensaje para enviar por WhatsApp.'
      }
    };
  }

  if (dryRun) {
    return {
      ok: true,
      provider: 'whatsapp-dry-run',
      model: null,
      rawPayload: {
        simulated: true,
        to: cleanTo,
        body: cleanBody
      }
    };
  }

  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanTo,
    type: 'text',
    text: { body: cleanBody }
  };

  console.log('===== WHATSAPP DEBUG =====');
  console.log('URL:', url);
  console.log('PHONE_NUMBER_ID:', phoneNumberId);
  console.log('TO ORIGINAL:', to);
  console.log('TO CLEAN:', cleanTo);
  console.log('BODY:', cleanBody);
  console.log('PAYLOAD:', JSON.stringify(payload, null, 2));
  console.log('==========================');

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('WHATSAPP OK:', JSON.stringify(response.data, null, 2));

    return {
      ok: true,
      provider: 'whatsapp-cloud-api',
      model: null,
      rawPayload: response.data
    };
  } catch (error) {
    console.error('===== WHATSAPP ERROR =====');
    console.error('STATUS:', error.response?.status);
    console.error('DATA:', JSON.stringify(error.response?.data, null, 2));
    console.error('TO ORIGINAL:', to);
    console.error('TO CLEAN:', cleanTo);
    console.error('URL:', url);
    console.error('==========================');

    return {
      ok: false,
      provider: 'whatsapp-cloud-api',
      model: null,
      error: error.response?.data || { message: error.message }
    };
  }
}