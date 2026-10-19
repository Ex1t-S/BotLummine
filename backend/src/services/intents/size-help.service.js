export async function handleSizeHelpIntent({ currentState = {} } = {}) {
	return {
		handled: false,
		forcedReply: null,
		liveOrderContext: null,
		aiGuidance: {
			type: 'size_help',
			productAlreadyInContext:
				(Array.isArray(currentState?.interestedProducts) && currentState.interestedProducts.length > 0) ||
				Boolean(currentState?.currentProductFocus || currentState?.currentProductFamily),
			knownSize: currentState?.frequentSize || null,
			instruction:
				'Si el producto ya viene en conversación, no lo pidas de nuevo como si arrancaras de cero. Continuá el hilo y pedí solo lo que falte. Si no hay una guía de medidas confirmada para ese modelo, no recomiendes un talle ni prometas cómo va a calzar basándote sólo en la letra del talle; reconocé el talle que ya indicó, priorizá su preocupación por la comodidad y pedí únicamente el dato faltante. No cambies de producto ni agregues promociones.'
		}
	};
}
