import { PAYMENT_TRANSFER_DETAILS } from '../../data/lummine-business.js';

export async function handlePaymentIntent({ currentState = {} } = {}) {
	const { alias, cbu, holder, cuil, bank, extraInstructions } = PAYMENT_TRANSFER_DETAILS;

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

	return {
		handled: false,
		forcedReply: null,
		liveOrderContext: null,
		aiGuidance: {
			type: 'payment',
			paymentDataAvailable,
			missing,
			transfer: {
				alias: alias || null,
				cbu: cbu || null,
				holder: holder || null,
				cuil: cuil || null,
				bank: bank || null,
				extra: extraInstructions || null
			}
		}
	};
}
