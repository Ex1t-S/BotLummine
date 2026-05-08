import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const backendEnvPath = path.join(repoRoot, 'backend', '.env');
const rootEnvPath = path.join(repoRoot, '.env');

const APPLY = process.argv.includes('--apply');
const WORKSPACE_ID = process.env.MIGRATE_WORKSPACE_ID || 'workspace_lummine';
const CUTOFF = new Date(process.env.MIGRATE_OLD_DB_CUTOFF || '2026-04-29T00:00:00.000Z');
const BATCH_SIZE = 500;

function readEnvValue(filePath, key) {
	if (!fs.existsSync(filePath)) return '';
	const prefix = `${key}=`;
	const line = fs
		.readFileSync(filePath, 'utf8')
		.split(/\r?\n/)
		.find((entry) => entry.trim().startsWith(prefix));

	return line
		? line.slice(prefix.length).trim().replace(/^['"]|['"]$/g, '')
		: '';
}

const currentUrl =
	process.env.CURRENT_DATABASE_URL ||
	process.env.DATABASE_URL ||
	readEnvValue(backendEnvPath, 'DATABASE_URL') ||
	readEnvValue(rootEnvPath, 'DATABASE_URL');
const oldUrl = process.env.OLD_DATABASE_URL || readEnvValue(rootEnvPath, 'OLD_DATABASE_URL');

if (!currentUrl) throw new Error('Falta DATABASE_URL/CURRENT_DATABASE_URL.');
if (!oldUrl) throw new Error('Falta OLD_DATABASE_URL.');

const current = new PrismaClient({ datasources: { db: { url: currentUrl } } });
const old = new PrismaClient({ datasources: { db: { url: oldUrl } } });

const stats = {
	mode: APPLY ? 'apply' : 'dry-run',
	workspaceId: WORKSPACE_ID,
	cutoff: CUTOFF.toISOString(),
	source: {
		conversations: 0,
		messages: 0,
		campaigns: 0,
		recipients: 0,
		conversions: 0,
		schedules: 0,
	},
	contactsCreated: 0,
	contactsMappedByWaId: 0,
	conversationsCreated: 0,
	conversationsMappedByContact: 0,
	statesCreated: 0,
	messagesCreated: 0,
	messagesSkippedExisting: 0,
	messagesSkippedDuplicateMeta: 0,
	campaignsCreated: 0,
	campaignsSkippedExisting: 0,
	recipientsCreated: 0,
	recipientsSkippedExisting: 0,
	recipientsSkippedDuplicateWaMessage: 0,
	conversionsCreated: 0,
	conversionsSkippedExisting: 0,
	conversionsSkippedMissingCampaign: 0,
	schedulesCreated: 0,
	schedulesSkippedExisting: 0,
};

function unique(values) {
	return [...new Set(values.filter(Boolean))];
}

function chunk(values, size = BATCH_SIZE) {
	const chunks = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
}

async function findManyByIds(model, ids, select) {
	const rows = [];
	for (const idChunk of chunk(unique(ids))) {
		rows.push(
			...(await current[model].findMany({
				where: { id: { in: idChunk } },
				select,
			}))
		);
	}
	return rows;
}

async function createMany(model, data) {
	if (!data.length) return;
	if (!APPLY) return;
	for (const dataChunk of chunk(data)) {
		await current[model].createMany({
			data: dataChunk,
			skipDuplicates: true,
		});
	}
}

function mapDateFields(row) {
	return Object.fromEntries(
		Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value : value])
	);
}

async function loadSource() {
	const conversations = await old.conversation.findMany({
		where: {
			workspaceId: WORKSPACE_ID,
			OR: [
				{ createdAt: { gte: CUTOFF } },
				{ updatedAt: { gte: CUTOFF } },
				{ lastMessageAt: { gte: CUTOFF } },
			],
		},
		include: { contact: true, state: true },
		orderBy: { createdAt: 'asc' },
	});

	const messages = await old.message.findMany({
		where: { workspaceId: WORKSPACE_ID, createdAt: { gte: CUTOFF } },
		orderBy: { createdAt: 'asc' },
	});

	const missingConversationIds = unique(messages.map((message) => message.conversationId)).filter(
		(id) => !conversations.some((conversation) => conversation.id === id)
	);

	if (missingConversationIds.length) {
		conversations.push(
			...(await old.conversation.findMany({
				where: { id: { in: missingConversationIds }, workspaceId: WORKSPACE_ID },
				include: { contact: true, state: true },
			}))
		);
	}

	const campaigns = await old.campaign.findMany({
		where: {
			workspaceId: WORKSPACE_ID,
			OR: [
				{ createdAt: { gte: CUTOFF } },
				{ updatedAt: { gte: CUTOFF } },
				{ startedAt: { gte: CUTOFF } },
				{ finishedAt: { gte: CUTOFF } },
			],
		},
		orderBy: { createdAt: 'asc' },
	});

	const recipients = campaigns.length
		? await old.campaignRecipient.findMany({
				where: {
					workspaceId: WORKSPACE_ID,
					campaignId: { in: campaigns.map((campaign) => campaign.id) },
				},
				orderBy: { createdAt: 'asc' },
		  })
		: [];

	const recipientContactIds = unique(recipients.map((recipient) => recipient.contactId));
	const recipientConversationIds = unique(recipients.map((recipient) => recipient.conversationId));

	const knownContactIds = new Set(conversations.map((conversation) => conversation.contactId));
	const extraContactIds = recipientContactIds.filter((id) => !knownContactIds.has(id));
	const extraContacts = extraContactIds.length
		? await old.contact.findMany({
				where: { workspaceId: WORKSPACE_ID, id: { in: extraContactIds } },
		  })
		: [];

	const knownConversationIds = new Set(conversations.map((conversation) => conversation.id));
	const extraConversationIds = recipientConversationIds.filter((id) => !knownConversationIds.has(id));
	if (extraConversationIds.length) {
		conversations.push(
			...(await old.conversation.findMany({
				where: { id: { in: extraConversationIds }, workspaceId: WORKSPACE_ID },
				include: { contact: true, state: true },
			}))
		);
	}

	const conversions = await old.campaignConversion.findMany({
		where: {
			workspaceId: WORKSPACE_ID,
			OR: [
				{ campaignId: { in: campaigns.map((campaign) => campaign.id) } },
				{ createdAt: { gte: CUTOFF } },
				{ convertedAt: { gte: CUTOFF } },
			],
		},
		orderBy: { createdAt: 'asc' },
	}).catch((error) => {
		if (error?.code === 'P2021') return [];
		throw error;
	});

	const schedules = await old.campaignSchedule.findMany({
		where: {
			workspaceId: WORKSPACE_ID,
			OR: [
				{ createdAt: { gte: CUTOFF } },
				{ updatedAt: { gte: CUTOFF } },
				{ lastRunAt: { gte: CUTOFF } },
			],
		},
		orderBy: { createdAt: 'asc' },
	}).catch((error) => {
		if (error?.code === 'P2021') return [];
		throw error;
	});

	return {
		conversations,
		messages,
		campaigns,
		recipients,
		conversions,
		schedules,
		extraContacts,
	};
}

async function migrate() {
	const source = await loadSource();
	stats.source.conversations = source.conversations.length;
	stats.source.messages = source.messages.length;
	stats.source.campaigns = source.campaigns.length;
	stats.source.recipients = source.recipients.length;
	stats.source.conversions = source.conversions.length;
	stats.source.schedules = source.schedules.length;

	const oldContacts = [
		...source.conversations.map((conversation) => conversation.contact).filter(Boolean),
		...source.extraContacts,
	];
	const contactById = new Map(oldContacts.map((contact) => [contact.id, contact]));
	const currentContactsById = new Map(
		(await findManyByIds('contact', [...contactById.keys()], {
			id: true,
			waId: true,
			workspaceId: true,
		})).map((contact) => [contact.id, contact])
	);

	const oldWaIds = unique(oldContacts.map((contact) => contact.waId));
	const currentContactsByWaId = new Map();
	for (const waIdChunk of chunk(oldWaIds)) {
		const rows = await current.contact.findMany({
			where: { workspaceId: WORKSPACE_ID, waId: { in: waIdChunk } },
			select: { id: true, waId: true },
		});
		for (const row of rows) currentContactsByWaId.set(row.waId, row);
	}

	const contactIdMap = new Map();
	const contactsToCreate = [];
	for (const contact of contactById.values()) {
		const existingById = currentContactsById.get(contact.id);
		if (existingById) {
			contactIdMap.set(contact.id, existingById.id);
			continue;
		}

		const existingByWaId = currentContactsByWaId.get(contact.waId);
		if (existingByWaId) {
			contactIdMap.set(contact.id, existingByWaId.id);
			stats.contactsMappedByWaId += 1;
			continue;
		}

		contactIdMap.set(contact.id, contact.id);
		contactsToCreate.push({
			id: contact.id,
			workspaceId: contact.workspaceId,
			waId: contact.waId,
			phone: contact.phone,
			name: contact.name,
			marketingOptIn: contact.marketingOptIn,
			marketingOptedOutAt: contact.marketingOptedOutAt,
			marketingOptOutReason: contact.marketingOptOutReason,
			createdAt: contact.createdAt,
			updatedAt: contact.updatedAt,
		});
	}
	stats.contactsCreated = contactsToCreate.length;
	await createMany('contact', contactsToCreate);

	const currentConversationsById = new Map(
		(await findManyByIds('conversation', source.conversations.map((conversation) => conversation.id), {
			id: true,
			contactId: true,
		})).map((conversation) => [conversation.id, conversation])
	);

	const mappedContactIds = unique(
		source.conversations.map((conversation) => contactIdMap.get(conversation.contactId) || conversation.contactId)
	);
	const currentConversationsByContactId = new Map();
	for (const contactIdChunk of chunk(mappedContactIds)) {
		const rows = await current.conversation.findMany({
			where: { workspaceId: WORKSPACE_ID, contactId: { in: contactIdChunk } },
			select: { id: true, contactId: true },
		});
		for (const row of rows) currentConversationsByContactId.set(row.contactId, row);
	}

	const conversationIdMap = new Map();
	const conversationsToCreate = [];
	for (const conversation of source.conversations) {
		const mappedContactId = contactIdMap.get(conversation.contactId) || conversation.contactId;
		const existingById = currentConversationsById.get(conversation.id);
		if (existingById) {
			conversationIdMap.set(conversation.id, existingById.id);
			continue;
		}

		const existingByContact = currentConversationsByContactId.get(mappedContactId);
		if (existingByContact) {
			conversationIdMap.set(conversation.id, existingByContact.id);
			stats.conversationsMappedByContact += 1;
			continue;
		}

		conversationIdMap.set(conversation.id, conversation.id);
		conversationsToCreate.push({
			id: conversation.id,
			workspaceId: conversation.workspaceId,
			contactId: mappedContactId,
			status: conversation.status,
			queue: conversation.queue,
			aiEnabled: conversation.aiEnabled,
			lastSummary: conversation.lastSummary,
			lastMessageAt: conversation.lastMessageAt,
			lastInboundMessageAt: conversation.lastInboundMessageAt,
			lastReadAt: conversation.lastReadAt,
			unreadCount: conversation.unreadCount,
			archivedAt: conversation.archivedAt,
			createdAt: conversation.createdAt,
			updatedAt: conversation.updatedAt,
		});
	}
	stats.conversationsCreated = conversationsToCreate.length;
	await createMany('conversation', conversationsToCreate);

	const states = source.conversations
		.map((conversation) => conversation.state)
		.filter(Boolean)
		.map((state) => ({
			...mapDateFields(state),
			conversationId: conversationIdMap.get(state.conversationId) || state.conversationId,
		}));
	const existingStates = new Set(
		(await current.conversationState.findMany({
			where: { conversationId: { in: unique(states.map((state) => state.conversationId)) } },
			select: { conversationId: true },
		})).map((state) => state.conversationId)
	);
	const statesToCreate = states.filter((state) => !existingStates.has(state.conversationId));
	stats.statesCreated = statesToCreate.length;
	await createMany('conversationState', statesToCreate);

	const existingMessageIds = new Set(
		(await findManyByIds('message', source.messages.map((message) => message.id), { id: true })).map(
			(message) => message.id
		)
	);
	const oldMetaIds = unique(source.messages.map((message) => message.metaMessageId));
	const existingMetaIds = new Set();
	for (const metaChunk of chunk(oldMetaIds)) {
		const rows = await current.message.findMany({
			where: { workspaceId: WORKSPACE_ID, metaMessageId: { in: metaChunk } },
			select: { metaMessageId: true },
		});
		for (const row of rows) existingMetaIds.add(row.metaMessageId);
	}

	const messagesToCreate = [];
	for (const message of source.messages) {
		if (existingMessageIds.has(message.id)) {
			stats.messagesSkippedExisting += 1;
			continue;
		}
		if (message.metaMessageId && existingMetaIds.has(message.metaMessageId)) {
			stats.messagesSkippedDuplicateMeta += 1;
			continue;
		}
		messagesToCreate.push({
			...mapDateFields(message),
			conversationId: conversationIdMap.get(message.conversationId) || message.conversationId,
		});
	}
	stats.messagesCreated = messagesToCreate.length;
	await createMany('message', messagesToCreate);

	const existingCampaignIds = new Set(
		(await findManyByIds('campaign', source.campaigns.map((campaign) => campaign.id), { id: true })).map(
			(campaign) => campaign.id
		)
	);
	const campaignsToCreate = source.campaigns.filter((campaign) => !existingCampaignIds.has(campaign.id));
	stats.campaignsCreated = campaignsToCreate.length;
	stats.campaignsSkippedExisting = source.campaigns.length - campaignsToCreate.length;
	await createMany('campaign', campaignsToCreate.map(mapDateFields));

	const currentCampaignIds = new Set([
		...existingCampaignIds,
		...campaignsToCreate.map((campaign) => campaign.id),
	]);
	const existingRecipientIds = new Set(
		(await findManyByIds('campaignRecipient', source.recipients.map((recipient) => recipient.id), {
			id: true,
		})).map((recipient) => recipient.id)
	);
	const oldWaMessageIds = unique(source.recipients.map((recipient) => recipient.waMessageId));
	const existingWaMessageIds = new Set();
	for (const waMessageChunk of chunk(oldWaMessageIds)) {
		const rows = await current.campaignRecipient.findMany({
			where: { workspaceId: WORKSPACE_ID, waMessageId: { in: waMessageChunk } },
			select: { waMessageId: true },
		});
		for (const row of rows) existingWaMessageIds.add(row.waMessageId);
	}

	const recipientsToCreate = [];
	for (const recipient of source.recipients) {
		if (existingRecipientIds.has(recipient.id)) {
			stats.recipientsSkippedExisting += 1;
			continue;
		}
		if (recipient.waMessageId && existingWaMessageIds.has(recipient.waMessageId)) {
			stats.recipientsSkippedDuplicateWaMessage += 1;
			continue;
		}
		recipientsToCreate.push({
			...mapDateFields(recipient),
			contactId: recipient.contactId
				? contactIdMap.get(recipient.contactId) || recipient.contactId
				: null,
			conversationId: recipient.conversationId
				? conversationIdMap.get(recipient.conversationId) || recipient.conversationId
				: null,
		});
	}
	stats.recipientsCreated = recipientsToCreate.length;
	await createMany('campaignRecipient', recipientsToCreate);

	const existingConversionIds = new Set(
		(await findManyByIds('campaignConversion', source.conversions.map((conversion) => conversion.id), {
			id: true,
		})).map((conversion) => conversion.id)
	);
	const conversionsToCreate = [];
	for (const conversion of source.conversions) {
		if (existingConversionIds.has(conversion.id)) {
			stats.conversionsSkippedExisting += 1;
			continue;
		}
		if (!currentCampaignIds.has(conversion.campaignId)) {
			stats.conversionsSkippedMissingCampaign += 1;
			continue;
		}
		conversionsToCreate.push(mapDateFields(conversion));
	}
	stats.conversionsCreated = conversionsToCreate.length;
	await createMany('campaignConversion', conversionsToCreate);

	const existingScheduleIds = new Set(
		(await findManyByIds('campaignSchedule', source.schedules.map((schedule) => schedule.id), {
			id: true,
		})).map((schedule) => schedule.id)
	);
	const schedulesToCreate = source.schedules.filter((schedule) => !existingScheduleIds.has(schedule.id));
	stats.schedulesCreated = schedulesToCreate.length;
	stats.schedulesSkippedExisting = source.schedules.length - schedulesToCreate.length;
	await createMany('campaignSchedule', schedulesToCreate.map(mapDateFields));

	console.log(JSON.stringify(stats, null, 2));
}

migrate()
	.finally(async () => {
		await old.$disconnect();
		await current.$disconnect();
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
