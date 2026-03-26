export async function handleShippingIntent() {
	return {
		handled: false,
		forcedReply: null,
		liveOrderContext: null,
		aiGuidance: {
			type: 'shipping',
			coverage: 'envios_nacionales',
			eta: 'hasta_8_dias_habiles',
			askForLocationIfMissing: true
		}
	};
}