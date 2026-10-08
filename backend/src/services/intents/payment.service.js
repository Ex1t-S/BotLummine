import { getWorkspaceRuntimeConfig } from '../workspaces/workspace-context.service.js';

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

export function classifyPaymentQuestion(messageBody = '') {
	const text = normalizeText(messageBody);

	if (/\b(eva|cupon|coupon|descuento|promo|promocion|no aplica|no me aplica|no esta disponible)\b/.test(text)) {
		return 'coupon';
	}

	if (/(12\s*cuotas|doce\s*cuotas|cuotas|mercado\s*pago|mercadopago|go\s*cuotas|tarjeta)/.test(text)) {
		return 'installments';
	}

	if (/(transferencia|transferir|alias|cbu|cvu|cuit|comprobante|ya transferi|te transferi|pasame alias)/.test(text)) {
		return 'transfer';
	}

	return 'general';
}

export function resolveTransferDetails(transferConfig = {}) {
	return {
		alias: String(transferConfig.alias || '').trim() || null,
		cbu: String(transferConfig.cbu || '').trim() || null,
		cvu: String(transferConfig.cvu || '').trim() || null,
		holder: String(transferConfig.holder || '').trim() || null,
		cuit: String(transferConfig.cuit || '').trim() || null,
		bank: String(transferConfig.bank || '').trim() || null,
		extra: String(transferConfig.extra || transferConfig.extraInstructions || '').trim() || null,
	};
}

export async function handlePaymentIntent({ messageBody = '', currentState = {}, workspaceId } = {}) {
	const workspaceConfig = workspaceId
		? await getWorkspaceRuntimeConfig(workspaceId).catch(() => null)
		: null;
	const questionType = classifyPaymentQuestion(messageBody);
	const transfer = resolveTransferDetails(workspaceConfig?.ai?.paymentConfig?.transfer || {});

	const missing = [];

	if (!Array.isArray(currentState?.interestedProducts) || !currentState.interestedProducts.length) {
		missing.push('producto');
	}

	if (!currentState?.frequentSize) {
		missing.push('talle');
	}

	if (!currentState?.deliveryPreference) {
		missing.push('envío o retiro');
	}

	const paymentDataAvailable = Boolean(transfer.alias || transfer.cbu || transfer.cvu);
	const transferDetails = [
		transfer.alias ? `Alias: ${transfer.alias}` : '',
		transfer.cbu ? `CBU: ${transfer.cbu}` : '',
		transfer.cvu ? `CVU: ${transfer.cvu}` : '',
		transfer.holder ? `Titular: ${transfer.holder}` : '',
		transfer.cuit ? `CUIT: ${transfer.cuit}` : '',
		transfer.bank ? `Banco: ${transfer.bank}` : '',
		transfer.extra || '',
	].filter(Boolean);
	const forcedReplyByQuestion = {
		coupon:
			'Te aclaro: el cupón EVA ya no está disponible. Si tu carrito lo muestra, fue una promo anterior y no va a aplicar al finalizar. Podés continuar la compra con el precio vigente del checkout.',
		installments:
			'Te aclaro: ya no estamos trabajando con 12 cuotas sin interés. En el checkout vas a ver las cuotas disponibles vigentes para tarjeta o Mercado Pago.',
		transfer: paymentDataAvailable
			? `Si queres pagar por transferencia, podes enviar el comprobante por este mismo chat. ${transferDetails.join(' | ')}`
			: null,
	};

	return {
		handled: false,
		forcedReply: forcedReplyByQuestion[questionType] || null,
		liveOrderContext: null,
		aiGuidance: {
			type: 'payment',
			questionType,
			paymentDataAvailable,
			missing,
			transfer: {
				...transfer
			}
		}
	};
}
