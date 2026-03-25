import { prisma } from '../lib/prisma.js';
import { processInboundMessage } from '../services/chat.service.js';
import { sendWhatsAppText } from '../services/whatsapp.service.js';

function formatTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function formatDateTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('es-AR');
  } catch {
    return '';
  }
}

function buildAvatar(name = '', phone = '') {
  const base = (name || phone || '?').trim();
  const parts = base.split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.length
    ? parts.map((p) => p[0]?.toUpperCase() || '').join('')
    : '?';

  const palette = [
    'linear-gradient(135deg,#22c55e,#16a34a)',
    'linear-gradient(135deg,#06b6d4,#2563eb)',
    'linear-gradient(135deg,#f97316,#ef4444)',
    'linear-gradient(135deg,#a855f7,#ec4899)',
    'linear-gradient(135deg,#eab308,#84cc16)'
  ];

  const index = Math.abs(
    base.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  ) % palette.length;

  return {
    initials,
    style: `background:${palette[index]};`
  };
}

function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function buildContactCard(conversation) {
  const contact = conversation.contact || {};
  const lastMessage =
    Array.isArray(conversation.messages) && conversation.messages.length
      ? conversation.messages[conversation.messages.length - 1]
      : null;

  const phone = normalizePhone(contact.phone || contact.waId || '');
  const displayName = contact.name || phone || 'Sin nombre';

  return {
    key: contact.waId || conversation.id,
    conversationId: conversation.id,
    displayName,
    phoneDisplay: phone,
    preview: lastMessage?.body || '',
    lastMessageAt: conversation.lastMessageAt || lastMessage?.createdAt || null,
    lastMessageTime: formatTime(conversation.lastMessageAt || lastMessage?.createdAt || null),
    lastMessageLabel: formatDateTime(conversation.lastMessageAt || lastMessage?.createdAt || null),
    aiEnabled: !!conversation.aiEnabled,
    avatar: buildAvatar(displayName, phone),
    lastSummary: conversation.lastSummary || '',
    messages: (conversation.messages || []).map((msg) => ({
      ...msg,
      createdAtLabel: formatDateTime(msg.createdAt)
    }))
  };
}

async function fetchInboxData(selectedConversationId = null) {
  const conversations = await prisma.conversation.findMany({
    include: {
      contact: true,
      messages: {
        orderBy: { createdAt: 'asc' }
      }
    },
    orderBy: {
      lastMessageAt: 'desc'
    }
  });

  const contacts = conversations.map(buildContactCard);

  let selectedContact = null;

  if (selectedConversationId) {
    selectedContact =
      contacts.find((item) => item.conversationId === selectedConversationId) || null;
  }

  if (!selectedContact && contacts.length) {
    selectedContact = contacts[0];
  }

  return { contacts, selectedContact };
}

export async function renderInbox(req, res, next) {
  try {
    const { contacts, selectedContact } = await fetchInboxData(
      req.params.conversationId || null
    );

    res.render('dashboard/inbox', {
      title: 'Inbox',
      appName: process.env.BUSINESS_NAME || 'Lummine',
      page: 'inbox',
      contacts,
      selectedContact
    });
  } catch (error) {
    next(error);
  }
}

export async function renderCampaigns(req, res, next) {
  try {
    res.render('dashboard/campaigns', {
      title: 'Campañas',
      appName: process.env.BUSINESS_NAME || 'Lummine',
      page: 'campaigns'
    });
  } catch (error) {
    next(error);
  }
}

export async function getAiLab(req, res, next) {
  try {
    res.render('ai-lab', {
      title: 'IA Lab',
      appName: process.env.BUSINESS_NAME || 'Lummine',
      page: 'ai-lab'
    });
  } catch (error) {
    next(error);
  }
}

export async function postSimulateInbound(req, res, next) {
  try {
    const { name, waId, body } = req.body || {};

    if (!waId || !body) {
      return res.redirect('/dashboard');
    }

    await processInboundMessage({
      waId,
      contactName: name || waId,
      messageBody: body,
      rawPayload: {
        simulated: true,
        source: 'dashboard'
      },
      metaMessageId: null
    });

    return res.redirect('/dashboard');
  } catch (error) {
    next(error);
  }
}

export async function postManualReply(req, res, next) {
  try {
    const { conversationId } = req.params;
    const { body } = req.body || {};

    if (!conversationId || !body?.trim()) {
      return res.redirect('/dashboard');
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true }
    });

    if (!conversation || !conversation.contact) {
      return res.redirect('/dashboard');
    }

    await sendWhatsAppText({
      to: conversation.contact.waId,
      body: body.trim()
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        senderName: process.env.BUSINESS_NAME || 'Lummine',
        body: body.trim(),
        provider: 'manual',
        model: null,
        rawPayload: {
          source: 'dashboard-manual-reply'
        }
      }
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() }
    });

    return res.redirect(`/dashboard/conversations/${conversationId}`);
  } catch (error) {
    next(error);
  }
}

export async function postToggleAi(req, res, next) {
  try {
    const { conversationId } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });

    if (!conversation) {
      return res.redirect('/dashboard');
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        aiEnabled: !conversation.aiEnabled
      }
    });

    return res.redirect(`/dashboard/conversations/${conversationId}`);
  } catch (error) {
    next(error);
  }
}

export async function postSendCampaign(req, res, next) {
  try {
    return res.redirect('/dashboard/campaigns');
  } catch (error) {
    next(error);
  }
}