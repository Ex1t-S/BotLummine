export async function handlePaymentIntent({ currentState = {} } = {}) {
	const alias = process.env.TRANSFER_ALIAS;
	const cbu = process.env.TRANSFER_CBU;
	const holder = process.env.TRANSFER_HOLDER;
	const bank = process.env.TRANSFER_BANK;
	const extra = process.env.TRANSFER_EXTRA;

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
				bank: bank || null,
				extra: extra || null
			}
		}
	};
}