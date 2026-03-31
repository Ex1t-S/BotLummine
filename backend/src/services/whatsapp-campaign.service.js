import { randomUUID } from 'node:crypto';

import { prisma } from '../lib/prisma.js';
import { normalizeWhatsAppNumber, sendWhatsAppTemplate } from './whatsapp.service.js';
import { renderTemplatePreviewFromComponents, getTemplateOrThrow } from './whatsapp-template.service.js';

function normalizeString(value, fallback = '') {
	const normalized = String(value ?? '').trim();

	return normalized || fallback;
}

function safeArray(value) {
	return Array.isArray(value) ? value : [];
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRecipientVariables(recipient = {}) {
	const contactName = normalizeString(recipient.contactName || '');
	const firstName = contactName.split(/\s+/).filter(Boolean)[0] || '';

	return {
		contact_name: contactName,
		first_name: firstName,
		wa_id: normalizeString(recipient.waId || recipient.phone || ''),
		phone: normalizeString(recipient.phone || ''),
		...(recipient.variables || {})
	};
}

function dedupeRecipients(recipients = []) {
	const seen = new Map();

	for (const recipient of recipients) {
		const normalizedPhone = normalizeWhatsAppNumber(recipient.phone || recipient.waId || '');

		if (!normalizedPhone) {
			continue;
		}

		const previous = seen.get(normalizedPhone) || {};

		seen.set(normalizedPhone, {
			...previous,
			...recipient,
			phone: normalizedPhone,
			waId: normalizedPhone
		});
	}

	return [...seen.values()];
}

async function resolveRecipientsFromContacts(contactIds = []) {
	if (!Array.isArray(contactIds) || !contactIds.length) {
		return [];
	}

	const contacts = await prisma.contact.findMany({
		where: {
			id: {
				in: contactIds
			}
		},
		select: {
			id: true,
			name: true,
			phone: true,
			waId: true,
			marketingOptIn: true,
			marketingOptedOutAt: true,
			marketingOptOutReason: true
		}
	});

	return contacts.map((contact) => ({
		contactId: contact.id,
		contactName: contact.name || contact.phone || contact.waId || '',
		phone: contact.phone || contact.waId || '',
		waId: contact.waId || contact.phone || '',
		isOptedOut: contact.marketingOptIn === false || Boolean(contact.marketingOptedOutAt),
		optOutReason: contact.marketingOptOutReason || 'opted_out'
	}));
}

async function resolveRecipientsFromAllContacts() {
	const contacts = await prisma.contact.findMany({
		select: {
			id: true,
			name: true,
			phone: true,
			waId: true,
			marketingOptIn: true,
			marketingOptedOutAt: true,
			marketingOptOutReason: true
		},
		orderBy: {
			updatedAt: 'desc'
		}
	});

	return contacts.map((contact) => ({
		contactId: contact.id,
		contactName: contact.name || contact.phone || contact.waId || '',
		phone: contact.phone || contact.waId || '',
		waId: contact.waId || contact.phone || '',
		isOptedOut: contact.marketingOptIn === false || Boolean(contact.marketingOptedOutAt),
		optOutReason: contact.marketingOptOutReason || 'opted_out'
	}));
}

async function resolveCampaignRecipients(input = {}) {
	const manualRecipients = safeArray(input.recipients).map((recipient) => ({
		contactId: recipient.contactId || null,
		contactName: recipient.contactName || recipient.name || '',
		phone: recipient.phone || recipient.waId || '',
		waId: recipient.waId || recipient.phone || '',
		variables: recipient.variables || {},
		externalKey: recipient.externalKey || null,
		isOptedOut: Boolean(recipient.isOptedOut),
		optOutReason: recipient.optOutReason || null
	}));

	const recipientsFromIds = await resolveRecipientsFromContacts(safeArray(input.contactIds));
	const recipientsFromAllContacts = input.includeAllContacts ? await resolveRecipientsFromAllContacts() : [];

	const merged = dedupeRecipients([
		...manualRecipients,
		...recipientsFromIds,
		...recipientsFromAllContacts
	]);

	return merged;
}

async function ensureCampaignConversation({ phone, contactId = null, contactName = null }) {
	const normalizedPhone = normalizeWhatsAppNumber(phone);

	if (!normalizedPhone) {
		return {
			contactId: null,
			conversationId: null
		};
	}

	let contact = null;

	if (contactId) {
		contact = await prisma.contact.findUnique({
			where: { id: contactId }
		});
	}

	if (!contact) {
		contact = await prisma.contact.upsert({
			where: { waId: normalizedPhone },
			update: {
				name: contactName || undefined,
				phone: normalizedPhone
			},
			create: {
				waId: normalizedPhone,
				phone: normalizedPhone,
				name: contactName || normalizedPhone
			}
		});
	}

	let conversation = await prisma.conversation.findUnique({
		where: { contactId: contact.id }
	});

	if (!conversation) {
		conversation = await prisma.conversation.create({
			data: {
				contactId: contact.id,
				queue: 'AUTO',
				aiEnabled: true,
				state: {
					create: {
						customerName: contact.name || normalizedPhone,
						interactionCount: 0,
						interestedProducts: [],
						objections: []
					}
				}
			}
		});
	}

	return {
		contactId: contact.id,
		conversationId: conversation.id
	};
}

function buildCampaignFinalStatus({ pending, accepted, failed, skipped, currentStatus }) {
	if (currentStatus === 'CANCELED') {
		return 'CANCELED';
	}

	if (pending > 0) {
		return 'RUNNING';
	}

	if (accepted === 0 && failed > 0) {
		return 'FAILED';
	}

	if (failed > 0 || skipped > 0) {
		return 'PARTIAL';
	}

	return 'FINISHED';
}

async function refreshCampaignCounters(campaignId) {
	const [
		pending,
		accepted,
		delivered,
		read,
		failed,
		skipped,
		campaign
	] = await Promise.all([
		prisma.campaignRecipient.count({
			where: {
				campaignId,
				status: 'PENDING'
			}
		}),
		prisma.campaignRecipient.count({
			where: {
				campaignId,
				status: {
					in: ['SENT', 'DELIVERED', 'READ']
				}
			}
		}),
		prisma.campaignRecipient.count({
			where: {
				campaignId,
				status: {
					in: ['DELIVERED', 'READ']
				}
			}
		}),
		prisma.campaignRecipient.count({
			where: {
				campaignId,
				status: 'READ'
			}
		}),
		prisma.campaignRecipient.count({
			where: {
				campaignId,
				status: 'FAILED'
			}
		}),
		prisma.campaignRecipient.count({
			where: {
				campaignId,
				status: 'SKIPPED'
			}
		}),
		prisma.campaign.findUnique({
			where: { id: campaignId },
			select: {
				id: true,
				status: true,
				totalRecipients: true
			}
		})
	]);

	if (!campaign) {
		return null;
	}

	const nextStatus = buildCampaignFinalStatus({
		pending,
		accepted,
		failed,
		skipped,
		currentStatus: campaign.status
	});

	return prisma.campaign.update({
		where: { id: campaignId },
		data: {
			pendingRecipients: pending,
			sentRecipients: accepted,
			deliveredRecipients: delivered,
			readRecipients: read,
			failedRecipients: failed,
			skippedRecipients: skipped,
			status: nextStatus,
			finishedAt: pending === 0 ? new Date() : null
		}
	});
}

function normalizeCampaignDelayMs() {
	return Math.max(0, Number(process.env.CAMPAIGN_SEND_DELAY_MS || 350) || 350);
}

function normalizeCampaignBatchSize() {
	return Math.max(1, Math.min(Number(process.env.CAMPAIGN_DISPATCH_BATCH_SIZE || 25) || 25, 200));
}

function normalizeCampaignLockMs() {
	return Math.max(60_000, Number(process.env.CAMPAIGN_DISPATCH_LOCK_MS || 300_000) || 300_000);
}

function ensureApprovedTemplate(template) {
	if (!template) {
		throw new Error('No se encontró la plantilla de la campaña.');
	}

	if (normalizeString(template.status).toUpperCase() !== 'APPROVED') {
		throw new Error('Sólo se pueden lanzar campañas con plantillas APPROVED.');
	}
}

export async function listCampaigns({
	limit = 50
} = {}) {
	return prisma.campaign.findMany({
		orderBy: [
			{ createdAt: 'desc' }
		],
		take: Math.max(1, Math.min(Number(limit) || 50, 200)),
		include: {
			recipients: {
				orderBy: [
					{ createdAt: 'desc' }
				],
				take: 15
			}
		}
	});
}

export async function getCampaignDetail(campaignId, { page = 1, pageSize = 50 } = {}) {
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId }
	});

	if (!campaign) {
		throw new Error('No se encontró la campaña.');
	}

	const currentPage = Math.max(1, Number(page) || 1);
	const currentPageSize = Math.max(1, Math.min(Number(pageSize) || 50, 200));

	const [template, totalRecipients, recipients] = await Promise.all([
		campaign.templateLocalId ? prisma.whatsAppTemplate.findUnique({
			where: {
				id: campaign.templateLocalId
			}
		}) : null,
		prisma.campaignRecipient.count({
			where: {
				campaignId
			}
		}),
		prisma.campaignRecipient.findMany({
			where: {
				campaignId
			},
			orderBy: [
				{ createdAt: 'asc' }
			],
			skip: (currentPage - 1) * currentPageSize,
			take: currentPageSize
		})
	]);

	return {
		campaign,
		template,
		recipients,
		pagination: {
			page: currentPage,
			pageSize: currentPageSize,
			total: totalRecipients,
			totalPages: Math.max(1, Math.ceil(totalRecipients / currentPageSize))
		}
	};
}

export async function createCampaignDraft({
	name,
	templateId,
	templateName,
	languageCode,
	sendComponents = [],
	recipients = [],
	contactIds = [],
	includeAllContacts = false,
	audienceSource = null,
	notes = null,
	launchedByUserId = null
}) {
	const template = templateId
		? await getTemplateOrThrow(templateId)
		: await prisma.whatsAppTemplate.findFirst({
			where: {
				name: normalizeString(templateName).toLowerCase(),
				language: normalizeString(languageCode, 'es_AR'),
				deletedAt: null
			}
		});

	if (!template) {
		throw new Error('No se encontró la plantilla seleccionada.');
	}

	const resolvedRecipients = await resolveCampaignRecipients({
		recipients,
		contactIds,
		includeAllContacts
	});

	if (!resolvedRecipients.length) {
		throw new Error('No hay destinatarios válidos para crear la campaña.');
	}

	const normalizedComponents = safeArray(sendComponents);
	const previewBase = renderTemplatePreviewFromComponents(
		normalizedComponents,
		{}
	);

	const recipientRows = [];

	for (const recipient of resolvedRecipients) {
		const normalizedPhone = normalizeWhatsAppNumber(recipient.phone || recipient.waId || '');

		if (!normalizedPhone) {
			continue;
		}

		const variables = buildRecipientVariables({
			...recipient,
			phone: normalizedPhone,
			waId: normalizedPhone
		});

		const personalized = renderTemplatePreviewFromComponents(normalizedComponents, variables);

		recipientRows.push({
			phone: normalizedPhone,
			waId: normalizedPhone,
			contactId: recipient.contactId || null,
			contactName: normalizeString(recipient.contactName || '') || normalizedPhone,
			externalKey: recipient.externalKey || null,
			variables,
			renderedComponents: personalized.components,
			renderedPreviewText: personalized.previewText,
			status: recipient.isOptedOut ? 'SKIPPED' : 'PENDING',
			errorMessage: recipient.isOptedOut
				? normalizeString(recipient.optOutReason, 'opted_out')
				: null
		});
	}

	if (!recipientRows.length) {
		throw new Error('Después de normalizar los contactos no quedó ningún destinatario usable.');
	}

	const pendingRecipients = recipientRows.filter((recipient) => recipient.status === 'PENDING').length;
	const skippedRecipients = recipientRows.filter((recipient) => recipient.status === 'SKIPPED').length;

	const campaign = await prisma.campaign.create({
		data: {
			name: normalizeString(name, `Campaña ${template.name}`),
			templateLocalId: template.id,
			templateMetaId: template.metaTemplateId,
			templateName: template.name,
			templateLanguage: template.language,
			templateCategory: template.category,
			audienceSource: audienceSource || 'manual',
			notes: notes || null,
			launchedByUserId,
			totalRecipients: recipientRows.length,
			pendingRecipients,
			skippedRecipients,
			defaultComponents: normalizedComponents,
			previewText: previewBase.previewText,
			status: 'DRAFT',
			recipients: {
				create: recipientRows
			}
		},
		include: {
			recipients: true
		}
	});

	return {
		campaign
	};
}

export async function launchCampaign(campaignId) {
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId }
	});

	if (!campaign) {
		throw new Error('No se encontró la campaña.');
	}

	if (campaign.status === 'CANCELED') {
		throw new Error('La campaña está cancelada y no se puede lanzar.');
	}

	const template = campaign.templateLocalId
		? await getTemplateOrThrow(campaign.templateLocalId)
		: null;

	ensureApprovedTemplate(template);

	const pendingCount = await prisma.campaignRecipient.count({
		where: {
			campaignId,
			status: 'PENDING'
		}
	});

	if (!pendingCount) {
		throw new Error('La campaña no tiene destinatarios pendientes.');
	}

	const updated = await prisma.campaign.update({
		where: { id: campaignId },
		data: {
			status: 'QUEUED',
			lastError: null,
			finishedAt: null
		}
	});

	return {
		campaign: updated,
		pendingCount
	};
}

export async function cancelCampaign(campaignId) {
	return prisma.campaign.update({
		where: { id: campaignId },
		data: {
			status: 'CANCELED',
			dispatchLockedAt: null,
			dispatchLockId: null,
			finishedAt: new Date()
		}
	});
}

export async function retryFailedCampaignRecipients(campaignId) {
	await prisma.campaignRecipient.updateMany({
		where: {
			campaignId,
			status: {
				in: ['FAILED', 'SKIPPED']
			}
		},
		data: {
			status: 'PENDING',
			errorCode: null,
			errorSubcode: null,
			errorMessage: null,
			failedAt: null
		}
	});

	const updated = await prisma.campaign.update({
		where: { id: campaignId },
		data: {
			status: 'QUEUED',
			lastError: null,
			finishedAt: null
		}
	});

	await refreshCampaignCounters(campaignId);

	return {
		campaign: updated
	};
}

export async function claimNextCampaignForDispatch() {
	const lockExpiresBefore = new Date(Date.now() - normalizeCampaignLockMs());
	const candidates = await prisma.campaign.findMany({
		where: {
			status: {
				in: ['QUEUED', 'RUNNING']
			},
			OR: [
				{ dispatchLockedAt: null },
				{ dispatchLockedAt: { lt: lockExpiresBefore } }
			]
		},
		orderBy: [
			{ createdAt: 'asc' }
		],
		take: 10
	});

	for (const candidate of candidates) {
		const lockId = randomUUID();
		const claimed = await prisma.campaign.updateMany({
			where: {
				id: candidate.id,
				status: {
					in: ['QUEUED', 'RUNNING']
				},
				OR: [
					{ dispatchLockedAt: null },
					{ dispatchLockedAt: { lt: lockExpiresBefore } }
				]
			},
			data: {
				dispatchLockedAt: new Date(),
				dispatchLockId: lockId,
				status: 'RUNNING',
				startedAt: candidate.startedAt || new Date()
			}
		});

		if (claimed.count === 1) {
			return {
				campaignId: candidate.id,
				lockId
			};
		}
	}

	return null;
}

async function persistCampaignOutboundMessage({
	campaign,
	recipient,
	sendResult
}) {
	const ensured = await ensureCampaignConversation({
		phone: recipient.phone,
		contactId: recipient.contactId,
		contactName: recipient.contactName
	});

	await prisma.campaignRecipient.update({
		where: {
			id: recipient.id
		},
		data: {
			contactId: ensured.contactId || recipient.contactId,
			conversationId: ensured.conversationId || recipient.conversationId
		}
	});

	if (!ensured.conversationId) {
		return null;
	}

	return prisma.message.create({
		data: {
			conversationId: ensured.conversationId,
			metaMessageId: sendResult?.rawPayload?.messages?.[0]?.id || null,
			senderName: process.env.BUSINESS_NAME || 'Lummine',
			direction: 'OUTBOUND',
			type: 'template',
			body: recipient.renderedPreviewText || `[Plantilla ${campaign.templateName}]`,
			provider: 'whatsapp-cloud-api',
			model: campaign.templateName,
			rawPayload: sendResult?.rawPayload || null
		}
	});
}

async function dispatchSingleRecipient(campaign, recipient) {
	const template = campaign.templateLocalId
		? await getTemplateOrThrow(campaign.templateLocalId)
		: null;

	ensureApprovedTemplate(template);

	if (recipient.status !== 'PENDING') {
		return recipient;
	}

	const sendResult = await sendWhatsAppTemplate({
		to: recipient.phone,
		templateName: campaign.templateName,
		languageCode: campaign.templateLanguage,
		components: Array.isArray(recipient.renderedComponents)
			? recipient.renderedComponents
			: safeArray(campaign.defaultComponents)
	});

	if (!sendResult?.ok) {
		return prisma.campaignRecipient.update({
			where: { id: recipient.id },
			data: {
				status: 'FAILED',
				errorCode: normalizeString(sendResult?.error?.error?.code || ''),
				errorSubcode: normalizeString(sendResult?.error?.error?.error_subcode || ''),
				errorMessage: normalizeString(
					sendResult?.error?.error?.message ||
					sendResult?.error?.message ||
					'No se pudo enviar la plantilla.'
				),
				failedAt: new Date(),
				rawPayload: sendResult?.error || null
			}
		});
	}

	const updatedRecipient = await prisma.campaignRecipient.update({
		where: { id: recipient.id },
		data: {
			status: 'SENT',
			waMessageId: sendResult?.rawPayload?.messages?.[0]?.id || null,
			sentAt: new Date(),
			rawPayload: sendResult?.rawPayload || null
		}
	});

	await persistCampaignOutboundMessage({
		campaign,
		recipient: {
			...recipient,
			...updatedRecipient
		},
		sendResult
	});

	return updatedRecipient;
}

export async function dispatchCampaignBatch(campaignId, lockId) {
	const campaign = await prisma.campaign.findUnique({
		where: { id: campaignId }
	});

	if (!campaign) {
		return {
			ok: false,
			message: 'La campaña no existe.'
		};
	}

	if (campaign.status === 'CANCELED') {
		return {
			ok: true,
			message: 'La campaña ya estaba cancelada.'
		};
	}

	const recipients = await prisma.campaignRecipient.findMany({
		where: {
			campaignId,
			status: 'PENDING'
		},
		orderBy: [
			{ createdAt: 'asc' }
		],
		take: normalizeCampaignBatchSize()
	});

	if (!recipients.length) {
		const refreshed = await refreshCampaignCounters(campaignId);

		await prisma.campaign.updateMany({
			where: {
				id: campaignId,
				dispatchLockId: lockId
			},
			data: {
				dispatchLockedAt: null,
				dispatchLockId: null,
				status: refreshed?.status || campaign.status
			}
		});

		return {
			ok: true,
			campaignId,
			processedCount: 0,
			message: 'No había destinatarios pendientes.'
		};
	}

	const delayMs = normalizeCampaignDelayMs();

	for (const recipient of recipients) {
		try {
			await dispatchSingleRecipient(campaign, recipient);
		} catch (error) {
			await prisma.campaignRecipient.update({
				where: { id: recipient.id },
				data: {
					status: 'FAILED',
					errorMessage: error.message,
					failedAt: new Date()
				}
			});

			await prisma.campaign.update({
				where: { id: campaignId },
				data: {
					lastError: error.message
				}
			});
		}

		if (delayMs > 0) {
			await sleep(delayMs);
		}
	}

	const refreshed = await refreshCampaignCounters(campaignId);

	await prisma.campaign.updateMany({
		where: {
			id: campaignId,
			dispatchLockId: lockId
		},
		data: {
			dispatchLockedAt: null,
			dispatchLockId: null,
			status: refreshed?.status || campaign.status
		}
	});

	return {
		ok: true,
		campaignId,
		processedCount: recipients.length,
		status: refreshed?.status || campaign.status
	};
}

export async function runCampaignDispatchTick() {
	const claimed = await claimNextCampaignForDispatch();

	if (!claimed) {
		return {
			ok: true,
			processed: false,
			message: 'No hay campañas pendientes para despachar.'
		};
	}

	const result = await dispatchCampaignBatch(claimed.campaignId, claimed.lockId);

	return {
		ok: true,
		processed: true,
		...result
	};
}

function toDateFromUnixTimestamp(value) {
	const seconds = Number(value || 0);

	if (!seconds) {
		return new Date();
	}

	return new Date(seconds * 1000);
}

export async function applyCampaignMessageStatusWebhook(statusPayload = {}) {
	const waMessageId = normalizeString(statusPayload?.id || statusPayload?.message_id || '');

	if (!waMessageId) {
		return null;
	}

	const recipient = await prisma.campaignRecipient.findFirst({
		where: {
			waMessageId
		}
	});

	if (!recipient) {
		return null;
	}

	const nextStatus = normalizeString(statusPayload?.status || '').toLowerCase();
	const timestamp = toDateFromUnixTimestamp(statusPayload?.timestamp);
	const error = safeArray(statusPayload?.errors)[0] || null;

	const updateData = {
		rawPayload: statusPayload,
		pricingCategory: statusPayload?.pricing?.category || recipient.pricingCategory,
		conversationCategory: statusPayload?.conversation?.origin?.type || recipient.conversationCategory,
		billable: typeof statusPayload?.pricing?.billable === 'boolean'
			? statusPayload.pricing.billable
			: recipient.billable
	};

	if (nextStatus === 'sent') {
		updateData.status = 'SENT';
		updateData.sentAt = timestamp;
	}

	if (nextStatus === 'delivered') {
		updateData.status = 'DELIVERED';
		updateData.deliveredAt = timestamp;
	}

	if (nextStatus === 'read') {
		updateData.status = 'READ';
		updateData.readAt = timestamp;
	}

	if (nextStatus === 'failed') {
		updateData.status = 'FAILED';
		updateData.failedAt = timestamp;
		updateData.errorCode = normalizeString(error?.code || '');
		updateData.errorSubcode = normalizeString(error?.error_subcode || '');
		updateData.errorMessage = normalizeString(
			error?.title ||
			error?.message ||
			error?.details ||
			'Error de entrega'
		);
	}

	await prisma.campaignRecipient.update({
		where: { id: recipient.id },
		data: updateData
	});

	await refreshCampaignCounters(recipient.campaignId);

	return recipient.campaignId;
}
