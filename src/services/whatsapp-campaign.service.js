import { prisma } from '../lib/prisma.js';
import { normalizeDigits } from '../lib/intent.js';
import { sendWhatsAppTemplate } from './whatsapp.service.js';

function normalizeRecipients(recipients = []) {
  return recipients
    .map((item) => {
      if (typeof item === 'string') {
        return { phone: normalizeDigits(item), contactName: null };
      }

      return {
        phone: normalizeDigits(item.phone || item.waId || ''),
        contactName: item.contactName || item.name || null
      };
    })
    .filter((item) => item.phone);
}

export async function sendTemplateCampaign({
  name,
  templateName,
  languageCode = 'es_AR',
  recipients = [],
  components = [],
  createdByUserId = null
}) {
  const normalizedRecipients = normalizeRecipients(recipients);

  if (!normalizedRecipients.length) {
    throw new Error('No hay destinatarios válidos para la campaña.');
  }

  const campaign = await prisma.campaign.create({
    data: {
      name,
      templateName,
      languageCode,
      status: 'RUNNING',
      createdByUserId,
      totalRecipients: normalizedRecipients.length,
      recipients: {
        create: normalizedRecipients.map((recipient) => ({
          phone: recipient.phone,
          contactName: recipient.contactName
        }))
      }
    },
    include: { recipients: true }
  });

  let sent = 0;
  let failed = 0;

  for (const recipient of campaign.recipients) {
    const result = await sendWhatsAppTemplate({
      to: recipient.phone,
      templateName,
      languageCode,
      components
    });

    if (result.ok) {
      sent += 1;

      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          waMessageId: result.rawPayload?.messages?.[0]?.id || null
        }
      });
    } else {
      failed += 1;

      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'FAILED',
          errorMessage:
            result.error?.error?.message ||
            result.error?.message ||
            'Error desconocido'
        }
      });
    }
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: failed > 0 ? 'FAILED' : 'FINISHED',
      sentRecipients: sent,
      failedRecipients: failed
    }
  });

  return {
    campaignId: campaign.id,
    total: normalizedRecipients.length,
    sent,
    failed
  };
}
