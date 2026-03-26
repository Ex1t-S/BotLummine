import { buildRelevantBusinessData } from '../../data/lummine-business.js';

export async function handleProductRecommendationIntent({ currentState = {} } = {}) {
	return {
		handled: false,
		forcedReply: null,
		liveOrderContext: null,
		aiGuidance: {
			type: 'product',
			alreadyInPurchaseFlow:
				currentState?.lastUserGoal === 'comprar' ||
				Boolean(currentState?.paymentPreference) ||
				Boolean(currentState?.deliveryPreference),
			topProduct: null
		}
	};
}