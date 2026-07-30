import { getWorkspaceRuntimeConfig } from '../workspaces/workspace-context.service.js';

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

function classifyPaymentQuestion(messageBody = '') {
	const text = normalizeText(messageBody);

	if (/\b(eva|cupon|coupon|descuento|promo|promocion|no aplica|no me aplica|no esta disponible)\b/.test(text)) {
		return 'coupon';
	}

	if (/(12\s*cuotas|doce\s*cuotas|cuotas|mercado\s*pago|mercadopago|go\s*cuotas|tarjeta)/.test(text)) {
		return 'installments';
	}

	if (/(transferencia|transferir|alias|cbu|comprobante|ya transferi|te transferi|pasame alias)/.test(text)) {
		return 'transfer';
	}

	return 'general';
}

export async function handlePaymentIntent({ messageBody = '', currentState = {}, workspaceId } = {}) {
	const workspaceConfig = workspaceId
		? await getWorkspaceRuntimeConfig(workspaceId).catch(() => null)
		: null;
	const questionType = classifyPaymentQuestion(messageBody);
	const transferConfig = workspaceConfig?.ai?.paymentConfig?.transfer || {};
	const alias = transferConfig.alias || process.env.TRANSFER_ALIAS;
	const cbu = transferConfig.cbu || process.env.TRANSFER_CBU;
	const holder = transferConfig.holder || process.env.TRANSFER_HOLDER;
	const bank = transferConfig.bank || process.env.TRANSFER_BANK;
	const extra = transferConfig.extra || transferConfig.extraInstructions || process.env.TRANSFER_EXTRA;

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

	const paymentDataAvailable = Boolean(alias || cbu);
	const transferDetails = [
		alias ? `Alias: ${alias}` : '',
		cbu ? `CBU: ${cbu}` : '',
		holder ? `Titular: ${holder}` : '',
		bank ? `Banco: ${bank}` : '',
		extra ? String(extra) : '',
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
				alias: alias || null,
				cbu: cbu || null,
				holder: holder || null,
				bank: bank || null,
				extra: extra || null
			}
		}
	};
}
