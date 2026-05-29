import { logger, maskPhone } from '../../lib/logger.js';
import { getWorkspaceRuntimeConfig } from '../workspaces/workspace-context.service.js';
import { sendWhatsAppMedia } from '../whatsapp/whatsapp.service.js';

function normalizeString(value = '') {
	return String(value || '').trim();
}

function normalizeForwardNumber(value = '') {
	return normalizeString(value).replace(/\D+/g, '');
}

function resolveAttachment(rawPayload = null, attachmentMeta = null, messageType = '') {
	const payloadAttachment = rawPayload?.attachment || {};
	const type = normalizeString(
		attachmentMeta?.attachmentType ||
			payloadAttachment.type ||
			messageType
	).toLowerCase();
	const mediaId = normalizeString(
		attachmentMeta?.attachmentId ||
			payloadAttachment.id ||
			rawPayload?.message?.image?.id ||
			rawPayload?.message?.document?.id ||
			rawPayload?.message?.video?.id ||
			rawPayload?.message?.audio?.id ||
			''
	);
	const mimeType = normalizeString(
		attachmentMeta?.attachmentMimeType ||
			payloadAttachment.mimeType ||
			rawPayload?.attachmentMimeType ||
			''
	).toLowerCase();
	const fileName = normalizeString(
		attachmentMeta?.attachmentName ||
			payloadAttachment.name ||
			rawPayload?.attachmentName ||
			''
	);

	let mediaType = ['image', 'document', 'video', 'audio'].includes(type) ? type : '';
	if (!mediaType && mimeType.startsWith('image/')) mediaType = 'image';
	if (!mediaType && mimeType === 'application/pdf') mediaType = 'document';

	return { mediaId, mediaType, mimeType, fileName };
}

function buildForwardCaption({
	customerPhone = '',
	customerName = '',
	orderNumber = '',
}) {
	return [
		'Comprobante recibido por el bot.',
		customerName ? `Cliente: ${customerName}` : '',
		customerPhone ? `WhatsApp: ${customerPhone}` : '',
		orderNumber ? `Pedido: ${orderNumber}` : '',
	].filter(Boolean).join('\n');
}

export async function maybeForwardPaymentProof({
	workspaceId,
	transportMode = 'live',
	messageType = 'text',
	rawPayload = null,
	attachmentMeta = null,
	customerPhone = '',
	customerName = '',
	orderNumber = '',
} = {}) {
	if (transportMode === 'lab') {
		return { skipped: true, reason: 'lab_transport' };
	}

	const workspaceConfig = await getWorkspaceRuntimeConfig(workspaceId);
	const forwardTo = normalizeForwardNumber(
		workspaceConfig?.ai?.paymentConfig?.transfer?.paymentProofForwardPhone ||
			workspaceConfig?.ai?.paymentConfig?.paymentProofForwardPhone ||
			''
	);

	if (!forwardTo) {
		return { skipped: true, reason: 'missing_forward_phone' };
	}

	const attachment = resolveAttachment(rawPayload, attachmentMeta, messageType);
	if (!attachment.mediaId || !['image', 'document'].includes(attachment.mediaType)) {
		return {
			skipped: true,
			reason: 'missing_supported_media',
			forwardTo: maskPhone(forwardTo),
		};
	}

	const caption = buildForwardCaption({
		customerPhone,
		customerName,
		orderNumber,
	});

	const result = await sendWhatsAppMedia({
		workspaceId,
		to: forwardTo,
		mediaType: attachment.mediaType,
		mediaId: attachment.mediaId,
		caption,
		fileName: attachment.fileName,
	});

	if (!result?.ok) {
		logger.warn('payment_proof.forward_failed', {
			workspaceId,
			to: maskPhone(forwardTo),
			customerPhone: maskPhone(customerPhone),
			mediaType: attachment.mediaType,
			error: result?.error?.message || result?.error || null,
		});
	}

	return {
		ok: Boolean(result?.ok),
		forwardTo: maskPhone(forwardTo),
		mediaType: attachment.mediaType,
		messageId: result?.rawPayload?.messages?.[0]?.id || null,
		error: result?.ok ? null : result?.error || null,
	};
}
