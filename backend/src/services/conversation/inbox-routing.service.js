function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

function recentConversationLooksLikePayment(recentMessages = [], currentState = {}) {
	if (currentState?.paymentPreference) return true;
	if (currentState?.lastIntent === 'payment') return true;
	if (currentState?.lastUserGoal === 'resolver_pago') return true;

	return recentMessages
		.slice(-6)
		.some((msg) =>
			/(transferencia|transferi|transferí|alias|cbu|mercado pago|mercadopago|comprobante|pago)/i.test(
				String(msg.text || '')
			)
		);
}

export function isPaymentProofMessage({
	messageType = 'text',
	body = '',
	rawPayload = null,
	currentState = {},
	recentMessages = []
} = {}) {
	const text = normalizeText(body);

	const textLooksLikeProof =
		/(ya transferi|ya transferí|te transferi|te transferí|te adjunto comprobante|te mando comprobante|te paso comprobante|adjunto el comprobante|ahi te mande el comprobante|ahí te mandé el comprobante|comprobante de pago|ticket de pago|acuse de transferencia)/.test(
			text
		);

	const typeLooksLikeProof = ['image', 'document'].includes(String(messageType || '').toLowerCase());

	const mime = String(
		rawPayload?.attachment?.mimeType ||
			rawPayload?.attachmentMimeType ||
			''
	).toLowerCase();

	const fileLooksLikeProof =
		mime.includes('pdf') ||
		mime.includes('image') ||
		typeLooksLikeProof;

	if (textLooksLikeProof) {
		return true;
	}

	if (fileLooksLikeProof && recentConversationLooksLikePayment(recentMessages, currentState)) {
		return true;
	}

	return false;
}

export function isAmbiguousPaymentAttachment({
	messageType = 'text',
	body = '',
	rawPayload = null,
	currentState = {},
	recentMessages = []
} = {}) {
	const text = normalizeText(body);
	if (text) return false;

	const typeLooksLikeAttachment = ['image', 'document'].includes(String(messageType || '').toLowerCase());
	const mime = String(
		rawPayload?.attachment?.mimeType ||
			rawPayload?.attachmentMimeType ||
			''
	).toLowerCase();
	const fileLooksLikeAttachment =
		typeLooksLikeAttachment ||
		mime.includes('pdf') ||
		mime.includes('image');

	if (!fileLooksLikeAttachment) return false;
	return recentConversationLooksLikePayment(recentMessages, currentState);
}

export function buildPaymentReviewAck() {
	return '¡Gracias! Ya recibimos tu comprobante 😊 En breve lo revisamos y seguimos con tu pedido.';
}

export function resolveConversationQueue({
	currentConversation,
	memoryPatch,
	detectedPaymentProof,
	aiDeclaredHandoff = false
}) {
	if (detectedPaymentProof) {
		return {
			queue: 'PAYMENT_REVIEW',
			aiEnabled: false
		};
	}

	if (aiDeclaredHandoff || memoryPatch?.needsHuman === true) {
		return {
			queue: 'HUMAN',
			aiEnabled: false
		};
	}

	if (currentConversation?.queue === 'HUMAN' || currentConversation?.queue === 'PAYMENT_REVIEW') {
		return {
			queue: currentConversation.queue,
			aiEnabled: currentConversation.aiEnabled ?? false
		};
	}

	return {
		queue: 'AUTO',
		aiEnabled: true
	};
}

export function getQueueMeta(queue = 'AUTO') {
	if (queue === 'HUMAN') {
		return {
			label: 'Atención humana',
			badgeClass: 'warning'
		};
	}

	if (queue === 'PAYMENT_REVIEW') {
		return {
			label: 'Comprobante',
			badgeClass: 'accent'
		};
	}

	return {
		label: 'Auto',
		badgeClass: 'success'
	};
}
