import dotenv from 'dotenv';
import { prisma } from '../src/lib/prisma.js';

dotenv.config();

const apply = process.argv.includes('--apply');
const workspaceArg = process.argv.find((arg) => arg.startsWith('--workspace='));
const workspaceId = workspaceArg ? workspaceArg.slice('--workspace='.length).trim() : null;
const terminalStatuses = new Set(['SENT', 'DELIVERED', 'READ']);

function normalize(value) {
	return String(value ?? '').trim();
}

function toIso(value) {
	return value instanceof Date ? value.toISOString() : value || null;
}

async function main() {
	const recipients = await prisma.campaignRecipient.findMany({
		where: {
			...(workspaceId ? { workspaceId } : {}),
			externalKey: { startsWith: 'abandoned_cart:' },
			campaign: { audienceSource: 'abandoned_carts' },
		},
		select: {
			id: true,
			workspaceId: true,
			externalKey: true,
			phone: true,
			status: true,
			createdAt: true,
			sentAt: true,
			campaignId: true,
			campaign: { select: { createdAt: true } },
		},
		orderBy: [{ createdAt: 'asc' }],
	});

	const groups = new Map();
	for (const recipient of recipients) {
		const key = `${recipient.workspaceId}:${normalize(recipient.externalKey)}`;
		const list = groups.get(key) || [];
		list.push(recipient);
		groups.set(key, list);
	}

	const duplicateGroups = [...groups.values()].filter((list) => list.length > 1);
	const retryableDuplicateIds = [];
	let pendingDuplicateCount = 0;
	let failedDuplicateCount = 0;
	let sentDuplicateCount = 0;
	const examples = [];

	for (const list of duplicateGroups) {
		const ordered = [...list].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
		const keeper = ordered.find((item) => terminalStatuses.has(item.status)) || ordered[0];
		const duplicates = ordered.filter((item) => item.id !== keeper.id);
		for (const duplicate of duplicates) {
			if (duplicate.status === 'PENDING') pendingDuplicateCount += 1;
			if (duplicate.status === 'FAILED') failedDuplicateCount += 1;
			if (duplicate.status === 'PENDING' || duplicate.status === 'FAILED') retryableDuplicateIds.push(duplicate.id);
			if (terminalStatuses.has(duplicate.status)) sentDuplicateCount += 1;
		}
		if (examples.length < 20) {
			examples.push({
				workspaceId: list[0].workspaceId,
				count: list.length,
				statuses: list.map((item) => item.status),
				firstCreatedAt: toIso(ordered[0].createdAt),
				lastCreatedAt: toIso(ordered.at(-1).createdAt),
			});
		}
	}

	let skippedDuplicates = 0;
	if (apply && retryableDuplicateIds.length) {
		const result = await prisma.campaignRecipient.updateMany({
			where: { id: { in: retryableDuplicateIds }, status: { in: ['PENDING', 'FAILED'] } },
			data: {
				status: 'SKIPPED',
				errorCode: 'DUPLICATE_ABANDONED_CART',
				errorMessage: 'Destinatario duplicado: se conserva el primer intento del carrito.',
				failedAt: new Date(),
			},
		});
		skippedDuplicates = Number(result.count || 0);
	}

	// A provider can accept multiple sends even when recipient rows are later
	// marked as duplicates. Measure adjacent identical template messages so the
	// report also covers the customer-visible “three in a row” symptom.
	const messages = await prisma.message.findMany({
		where: {
			...(workspaceId ? { workspaceId } : {}),
			direction: 'OUTBOUND',
			type: 'template',
		},
		select: { conversationId: true, body: true, createdAt: true },
		orderBy: { createdAt: 'asc' },
	});
	const messageGroups = new Map();
	for (const message of messages) {
		const key = `${message.conversationId}:${normalize(message.body)}`;
		const list = messageGroups.get(key) || [];
		list.push(message.createdAt);
		messageGroups.set(key, list);
	}
	let messageClustersWithThreeWithin15m = 0;
	let messageExtrasInClusters = 0;
	for (const list of messageGroups.values()) {
		for (let index = 0; index < list.length; index += 1) {
			let end = index + 1;
			while (end < list.length && new Date(list[end]).getTime() - new Date(list[index]).getTime() <= 15 * 60 * 1000) end += 1;
			if (end - index >= 3) {
				messageClustersWithThreeWithin15m += 1;
				messageExtrasInClusters += end - index - 1;
				break;
			}
		}
	}

	console.log(JSON.stringify({
		mode: apply ? 'apply' : 'dry-run',
		workspaceId: workspaceId || 'all',
		recipientCount: recipients.length,
		duplicateGroups: duplicateGroups.length,
		pendingDuplicates: pendingDuplicateCount,
		failedDuplicates: failedDuplicateCount,
		retryableDuplicates: retryableDuplicateIds.length,
		pendingDuplicatesSkipped: apply ? Math.min(pendingDuplicateCount, skippedDuplicates) : 0,
		retryableDuplicatesSkipped: skippedDuplicates,
		sentDuplicatesKeptForAudit: sentDuplicateCount,
		templateMessages: messages.length,
		messageClustersWithThreeWithin15m,
		messageExtrasInClusters,
		note: 'Los mensajes ya enviados no pueden retirarse de WhatsApp; se conservan para auditoria.',
		examples,
	}, null, 2));
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
