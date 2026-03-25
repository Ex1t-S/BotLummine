import { buildRelevantBusinessData } from '../../data/lummine-business.js';

export async function handleProductRecommendationIntent({ messageBody }) {
  const businessData = buildRelevantBusinessData(messageBody);
  const products = businessData.products || [];

  if (!products.length) {
    return {
      handled: false,
      forcedReply: null,
      liveOrderContext: null
    };
  }

  const top = products[0];

  const lines = [
    `Te puede servir ${top.name} 😊`,
    top.shortDescription
  ];

  if (top.url) {
    lines.push(`Te lo dejo acá: ${top.url}`);
  }

  return {
    handled: true,
    forcedReply: lines.join('\n'),
    liveOrderContext: null
  };
}