import {
	getCommercialProfile,
	inferCommercialFamily,
	scoreProductAgainstCommercialProfile
} from '../../data/catalog-commercial-map.js';

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

export function inferProductFamily({ messageBody = '', currentState = {} } = {}) {
	const interestedProducts = asArray(currentState?.interestedProducts).join(' ');
	return inferCommercialFamily(`${messageBody} ${interestedProducts}`);
}

export function scoreProductForSelection(product, { messageBody = '', currentState = {}, commercialPlan = null } = {}) {
	const family = commercialPlan?.family || inferProductFamily({ messageBody, currentState });
	const profile = family ? getCommercialProfile(family) : null;

	const baseText = normalizeText([
		product?.name,
		product?.shortDescription,
		asArray(product?.tags).join(' '),
		asArray(product?.variantValues).join(' ')
	].join(' '));

	let score = 0;
	const terms = normalizeText(messageBody).split(/[^a-z0-9]+/i).filter(Boolean);
	for (const term of terms) {
		if (baseText.includes(term)) score += term.length >= 4 ? 4 : 2;
	}

	if (profile) {
		score += scoreProductAgainstCommercialProfile(product, profile) || 0;
	}

	if (commercialPlan?.bestOffer?.productId && String(commercialPlan.bestOffer.productId) === String(product?.productId)) {
		score += 12;
	}

	return score;
}

export function rankProductsForReply(products = [], context = {}) {
	return [...asArray(products)]
		.map((product) => ({ product, score: scoreProductForSelection(product, context) }))
		.sort((a, b) => b.score - a.score)
		.map((entry) => entry.product);
}

export function pickTopProducts(products = [], context = {}, limit = 3) {
	return rankProductsForReply(products, context).slice(0, Math.max(1, limit));
}
