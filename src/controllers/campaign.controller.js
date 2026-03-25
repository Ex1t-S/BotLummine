import { prisma } from '../lib/prisma.js';
import { sendTemplateCampaign } from '../services/whatsapp-campaign.service.js';

function parseRecipients(body) {
  if (Array.isArray(body.recipients)) return body.recipients;

  if (typeof body.recipients === 'string') {
    return body.recipients
      .split(/\n|,|;/g)
      .map((phone) => ({ phone: phone.trim() }))
      .filter((item) => item.phone);
  }

  return [];
}

export async function createCampaign(req, res) {
  try {
    const recipients =
      parseRecipients(req.body).length > 0
        ? parseRecipients(req.body)
        : await prisma.contact.findMany({
            select: {
              waId: true,
              name: true
            }
          });

    const result = await sendTemplateCampaign({
      name: String(req.body.name || 'Campaña WhatsApp').trim(),
      templateName: String(req.body.templateName || '').trim(),
      languageCode: String(req.body.languageCode || 'es_AR').trim(),
      recipients,
      components: Array.isArray(req.body.components) ? req.body.components : [],
      createdByUserId: req.user?.id || null
    });

    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
}

export async function listCampaigns(_req, res) {
  const campaigns = await prisma.campaign.findMany({
    include: {
      recipients: {
        orderBy: { createdAt: 'desc' },
        take: 20
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  return res.json({ ok: true, campaigns });
}
