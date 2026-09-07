import { pathToFileURL } from 'node:url';
import { evaluateInboundFreshness, MAX_AUTO_REPLY_AGE_MS } from '../src/services/conversation/inbound-safety.js';

export function planInboundTimestampRepair(message) {
	const receivedAt = new Date(message.createdAt);
	const policy = evaluateInboundFreshness({ ...message, now: receivedAt.getTime() });
	if (!policy.sentAt || receivedAt - policy.sentAt <= MAX_AUTO_REPLY_AGE_MS) return null;
	return { id: message.id, conversationId: message.conversationId, receivedAt, sentAt: policy.sentAt };
}

async function main() {
	const args = process.argv.slice(2);
	const arg = (name) => args.find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
	const workspaceId = arg('workspace');
	const from = new Date(arg('from') || 'invalid');
	const to = new Date(arg('to') || 'invalid');
	if (!workspaceId || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
		throw new Error('Required: --workspace=ID --from=ISO --to=ISO [--apply]');
	}
	const { prisma } = await import('../src/lib/prisma.js');
	try {
		const repairs = [];
		let cursor;
		while (true) {
			const rows = await prisma.message.findMany({
				where: { workspaceId, direction: 'INBOUND', createdAt: { gte: from, lt: to } },
				orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
				select: { id: true, conversationId: true, createdAt: true, metaMessageId: true, rawPayload: true },
			});
			repairs.push(...rows.map(planInboundTimestampRepair).filter(Boolean));
			if (rows.length < 500) break;
			cursor = rows.at(-1).id;
		}
		console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'dry-run', candidates: repairs.length,
			conversations: new Set(repairs.map((item) => item.conversationId)).size }));
		if (!args.includes('--apply')) return;
		let updated = 0;
		for (const repair of repairs) {
			updated += await prisma.$transaction(async (tx) => {
				// Lock the conversation while recomputing its latest activity; incoming updates wait and advance normally.
				await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${repair.conversationId}
					AND "workspaceId" = ${workspaceId} FOR UPDATE`;
				const key = `inbound-time-repair:${repair.id}`;
				if (await tx.conversationEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: key } } })) return 0;
				const result = await tx.message.updateMany({
					where: { id: repair.id, workspaceId, direction: 'INBOUND', createdAt: repair.receivedAt },
					data: { createdAt: repair.sentAt },
				});
				if (!result.count) return 0;
				await tx.conversationEvent.create({ data: {
					workspaceId, conversationId: repair.conversationId, eventType: 'INBOUND_TIMESTAMP_REPAIRED',
					idempotencyKey: key, reason: 'meta_webhook_backlog', metadata: {
						messageId: repair.id, receivedAt: repair.receivedAt.toISOString(), sentAt: repair.sentAt.toISOString(),
					},
				} });
				const [latest, latestInbound] = await Promise.all([
					tx.message.aggregate({ where: { workspaceId, conversationId: repair.conversationId }, _max: { createdAt: true } }),
					tx.message.aggregate({ where: { workspaceId, conversationId: repair.conversationId, direction: 'INBOUND' }, _max: { createdAt: true } }),
				]);
				await tx.conversation.updateMany({ where: { id: repair.conversationId, workspaceId }, data: {
					lastMessageAt: latest._max.createdAt, lastInboundMessageAt: latestInbound._max.createdAt,
				} });
				await tx.conversationState.updateMany({ where: {
					conversationId: repair.conversationId, conversation: { workspaceId }, pendingAutoReplyMessageId: repair.id,
				}, data: { pendingAutoReplyMessageId: null, pendingAutoReplyDueAt: null, pendingAutoReplyLockedAt: null } });
				return 1;
			});
		}
		console.log(JSON.stringify({ updated, deleted: 0, outboundSent: 0 }));
	} finally { await prisma.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => { console.error('Inbound timestamp repair failed:', error.code || error.name); process.exitCode = 1; });
}
