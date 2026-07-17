import { prisma } from '../lib/prisma.js';
import { publishInboxEvent } from '../lib/inbox-events.js';
import { requireRequestWorkspaceId } from '../services/workspaces/workspace-context.service.js';

const PAYMENT_REVIEW_ACTIONS = new Set([
	'APPROVE',
	'REJECT',
	'REQUEST_NEW_PROOF',
	'HANDOFF',
]);

const ACTIONS_REQUIRING_REASON = new Set(['REJECT', 'REQUEST_NEW_PROOF']);
const MAX_REASON_LENGTH = 500;
const MAX_IDEMPOTENCY_KEY_LENGTH = 120;

function normalizeAction(value = '') {
	return String(value || '').trim().toUpperCase();
}

function normalizeReason(value = '') {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

function getIdempotencyKey(req) {
	const raw = req.get('Idempotency-Key') || req.body?.idempotencyKey || '';
	const value = String(raw || '').trim();
	return value || null;
}

function serializeAction(action, { replayed = false } = {}) {
	return {
		id: action.id,
		conversationId: action.conversationId,
		action: action.action,
		previousQueue: action.previousQueue,
		resultQueue: action.resultQueue,
		reason: action.reason || null,
		actorUserId: action.actorUserId || null,
		createdAt: action.createdAt,
		replayed,
	};
}

async function findIdempotentAction({ workspaceId, conversationId, action, idempotencyKey }) {
	if (!idempotencyKey) return null;

	const existing = await prisma.paymentReviewAction.findFirst({
		where: { workspaceId, idempotencyKey },
	});

	if (!existing) return null;
	if (existing.conversationId !== conversationId || existing.action !== action) {
		const conflict = new Error('La clave de idempotencia ya fue utilizada para otra acción.');
		conflict.status = 409;
		throw conflict;
	}

	return existing;
}

export async function getPaymentReviewActions(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const { conversationId } = req.params;
		const conversation = await prisma.conversation.findFirst({
			where: { id: conversationId, workspaceId },
			select: { id: true },
		});

		if (!conversation) {
			return res.status(404).json({ ok: false, error: 'Conversación no encontrada.' });
		}

		const actions = await prisma.paymentReviewAction.findMany({
			where: { conversationId, workspaceId },
			orderBy: { createdAt: 'desc' },
			take: 50,
			select: {
				id: true,
				conversationId: true,
				action: true,
				previousQueue: true,
				resultQueue: true,
				reason: true,
				actorUserId: true,
				createdAt: true,
			},
		});

		return res.json({ ok: true, actions });
	} catch (error) {
		next(error);
	}
}
export async function postPaymentReviewAction(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const { conversationId } = req.params;
		const action = normalizeAction(req.body?.action);
		const reason = normalizeReason(req.body?.reason);
		const idempotencyKey = getIdempotencyKey(req);

		if (!PAYMENT_REVIEW_ACTIONS.has(action)) {
			return res.status(400).json({
				ok: false,
				error: 'Acción de revisión de pago inválida.',
			});
		}

		if (ACTIONS_REQUIRING_REASON.has(action) && !reason) {
			return res.status(400).json({
				ok: false,
				error: 'Indica un motivo para rechazar o pedir otro comprobante.',
			});
		}

		if (reason.length > MAX_REASON_LENGTH) {
			return res.status(400).json({
				ok: false,
				error: `El motivo no puede superar ${MAX_REASON_LENGTH} caracteres.`,
			});
		}

		if (idempotencyKey && idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
			return res.status(400).json({
				ok: false,
				error: `La clave de idempotencia no puede superar ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres.`,
			});
		}

		const existing = await findIdempotentAction({
			workspaceId,
			conversationId,
			action,
			idempotencyKey,
		});

		if (existing) {
			return res.json({
				ok: true,
				action: serializeAction(existing, { replayed: true }),
				conversationId,
				queue: existing.resultQueue,
				replayed: true,
			});
		}

		const conversation = await prisma.conversation.findFirst({
			where: { id: conversationId, workspaceId },
			select: { id: true, workspaceId: true, queue: true },
		});

		if (!conversation) {
			return res.status(404).json({ ok: false, error: 'Conversación no encontrada.' });
		}

		if (conversation.queue !== 'PAYMENT_REVIEW') {
			return res.status(409).json({
				ok: false,
				error: 'La conversación ya no está en revisión de comprobantes.',
			});
		}

		const resultQueue = 'HUMAN';
		const handoffReason = `payment_review_${action.toLowerCase()}`;
		const actionRecord = await prisma.$transaction(async (tx) => {
			const created = await tx.paymentReviewAction.create({
				data: {
					workspaceId,
					conversationId,
					actorUserId: req.user?.id || null,
					action,
					previousQueue: conversation.queue,
					resultQueue,
					reason: reason || null,
					idempotencyKey,
				},
			});

			await tx.conversation.updateMany({
				where: { id: conversationId, workspaceId },
				data: { queue: resultQueue, aiEnabled: false },
			});

			await tx.conversationState.upsert({
				where: { conversationId },
				update: { needsHuman: true, handoffReason },
				create: { conversationId, needsHuman: true, handoffReason },
			});

			return created;
		});

		publishInboxEvent({
			workspaceId,
			scope: 'conversation',
			action: 'payment-review-updated',
			conversationId,
			paymentReviewAction: action,
			queue: resultQueue,
		});

		return res.status(201).json({
			ok: true,
			action: serializeAction(actionRecord),
			conversationId,
			queue: resultQueue,
			replayed: false,
		});
	} catch (error) {
		if (error?.code === 'P2002' && getIdempotencyKey(req)) {
			try {
				const workspaceId = requireRequestWorkspaceId(req);
				const action = normalizeAction(req.body?.action);
				const existing = await findIdempotentAction({
					workspaceId,
					conversationId: req.params.conversationId,
					action,
					idempotencyKey: getIdempotencyKey(req),
				});
				if (existing) {
					return res.json({
						ok: true,
						action: serializeAction(existing, { replayed: true }),
						conversationId: req.params.conversationId,
						queue: existing.resultQueue,
						replayed: true,
					});
				}
			} catch (idempotencyError) {
				next(idempotencyError);
				return;
			}
		}

		next(error);
	}
}
