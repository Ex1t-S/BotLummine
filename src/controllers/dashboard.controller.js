import { prisma } from '../lib/prisma.js';
import { runAssistantReply } from '../services/ai/index.js';
import { sendWhatsAppText } from '../services/whatsapp.service.js';
import { processInboundMessage } from '../services/chat.service.js';
import {
	buildConversationThreads,
	findThreadByConversationId,
	normalizeThreadPhone
} from '../lib/conversation-threads.js';

async function fetchThreads(withFullMessages = false) {
	const conversations = await prisma.conversation.findMany({
		include: {
			contact: true,
			messages: {
				orderBy: { createdAt: withFullMessages ? 'asc' : 'desc' },
				take: withFullMessages ? undefined : 1
			}
		},
		orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }]
	});

	return buildConversationThreads(conversations);
}

function renderChatView(res, payload = {}) {
	return res.render('dashboard', {
		title: 'Chats',
		threads: payload.threads || [],
		selectedThread: payload.selectedThread || null,
		page: 'chats'
	});
}

export async function getDashboard(_req, res) {
	const threads = await fetchThreads(true);
	const selectedThread = threads[0] || null;
	return renderChatView(res, { threads, selectedThread });
}

export async function getConversation(req, res) {
	const threads = await fetchThreads(true);
	const selectedThread = findThreadByConversationId(threads, req.params.id) || threads[0] || null;

	if (!selectedThread) {
		return res.status(404).render('error', {
			title: 'Chat no encontrado',
			message: 'No existe esa conversación.'
		});
	}

	return renderChatView(res, { threads, selectedThread });
}

export async function sendManualReply(req, res) {
	const conversation = await prisma.conversation.findUnique({
		where: { id: req.params.id },
		include: { contact: true }
	});

	if (!conversation) {
		return res.status(404).render('error', {
			title: 'Chat no encontrado',
			message: 'No existe esa conversación.'
		});
	}

	const body = String(req.body.body || '').trim();
	if (!body) return res.redirect(`/dashboard/conversations/${conversation.id}`);

	const waResult = await sendWhatsAppText({
		to: conversation.contact.waId,
		body
	});

	await prisma.message.create({
		data: {
			conversationId: conversation.id,
			direction: 'OUTBOUND',
			senderName: process.env.BUSINESS_AGENT_NAME || process.env.BUSINESS_NAME || 'Lummine',
			body,
			provider: waResult.provider,
			model: waResult.model,
			rawPayload: waResult.rawPayload || waResult.error || null
		}
	});

	await prisma.conversation.update({
		where: { id: conversation.id },
		data: { lastMessageAt: new Date() }
	});

	return res.redirect(`/dashboard/conversations/${conversation.id}`);
}

export async function toggleConversationAi(req, res) {
	const threads = await fetchThreads(false);
	const selectedThread = findThreadByConversationId(threads, req.params.id);

	if (!selectedThread) {
		return res.status(404).render('error', {
			title: 'Chat no encontrado',
			message: 'No existe esa conversación.'
		});
	}

	await prisma.conversation.updateMany({
		where: { id: { in: selectedThread.conversationIds } },
		data: { aiEnabled: !selectedThread.aiEnabled }
	});

	return res.redirect(`/dashboard/conversations/${selectedThread.latestConversationId}`);
}

export async function getAiLab(_req, res) {
	return res.render('ai-lab', {
		title: 'IA Lab',
		page: 'ai-lab',
		aiTestResult: null
	});
}

export async function testAi(req, res) {
	const prompt = String(req.body.prompt || '').trim();

	if (!prompt) {
		return res.render('ai-lab', {
			title: 'IA Lab',
			page: 'ai-lab',
			aiTestResult: {
				ok: false,
				text: 'Escribí un prompt de prueba.'
			}
		});
	}

	try {
		const result = await runAssistantReply({
			businessName: process.env.BUSINESS_NAME || 'Lummine',
			contactName: 'Cliente de prueba',
			recentMessages: [{ role: 'user', text: prompt }]
		});

		return res.render('ai-lab', {
			title: 'IA Lab',
			page: 'ai-lab',
			aiTestResult: {
				ok: true,
				text: result.text,
				usage: result.usage
			}
		});
	} catch (error) {
		return res.render('ai-lab', {
			title: 'IA Lab',
			page: 'ai-lab',
			aiTestResult: {
				ok: false,
				text: error.message || 'No se pudo probar la IA.'
			}
		});
	}
}

export async function simulateInbound(req, res) {
	const name = String(req.body.name || 'Cliente Demo').trim();
	const waId = normalizeThreadPhone(req.body.waId || '+5492210000000');
	const body = String(req.body.body || '').trim();

	if (!waId || !body) {
		return res.redirect('/dashboard');
	}

	const result = await processInboundMessage({
		waId,
		contactName: name,
		messageBody: body,
		rawPayload: { simulated: true }
	});

	return res.redirect(`/dashboard/conversations/${result.conversation.id}`);
}