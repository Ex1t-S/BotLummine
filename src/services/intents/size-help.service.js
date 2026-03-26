export async function handleSizeHelpIntent({ currentState = {} } = {}) {
	return {
		handled: false,
		forcedReply: null,
		liveOrderContext: null,
		aiGuidance: {
			type: 'size_help',
			productAlreadyInContext:
				Array.isArray(currentState?.interestedProducts) &&
				currentState.interestedProducts.length > 0,
			knownSize: currentState?.frequentSize || null,
			instruction:
				'Si el producto ya viene en conversación, no lo pidas de nuevo como si arrancaras de cero. Continuá el hilo y pedí solo lo que falte.'
		}
	};
}