function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export const CATALOG_COMMERCIAL_MAP = {
	body_modelador: {
		label: 'body modelador',
		introMode: 'guided_discovery',
		strictFamilyLock: true,
		offerPriority: {
			general: ['3x1', 'single', '2x1'],
			askOffer: ['3x1', '2x1', 'single'],
			askPrice: ['single', '3x1', '2x1'],
			askPriceAndOffer: ['3x1', 'single', '2x1'],
			askVariant: ['single', '2x1', '3x1'],
			readyToBuy: ['3x1', '2x1', 'single']
		},
		primaryOfferHints: [
			'3x1 en bodys',
			'pack 3x1',
			'3x1 bodys modeladores',
			'total white',
			'bodys modeladores reductores'
		],
		secondaryOfferHints: ['2x1 en bodys', 'promo 2x1', 'pack 2x1'],
		fallbackHints: ['body modelador', 'body modelador reductor', 'body reductor'],
		avoidHints: ['gift', 'regalo', 'segunda piel de regalo', 'calza', 'calzas linfaticas'],
		defaultPitch:
			'En body modelador no arranques clavando una promo al azar. Primero ubicá familia y necesidad; si pide promo, la principal es 3x1. Si no le sirve, seguí con 2x1 y después individual.',
		discoveryPrompt:
			'Si recién abre tema body, respondé que hay opción individual y promos, y ofrecé seguir por color/talle o por promo. No empujes 2x1 de entrada.',
		linkHint:
			'Si pasás link en body modelador, compartí solo una opción: la elegida o la promo principal compatible con el talle/color que viene pidiendo.'
	},
	calzas_linfaticas: {
		label: 'calzas linfáticas',
		introMode: 'product_first',
		strictFamilyLock: true,
		offerPriority: {
			general: ['single', '3x1', '2x1'],
			askOffer: ['3x1', '2x1', 'single'],
			askPrice: ['single', '3x1', '2x1'],
			askPriceAndOffer: ['3x1', 'single', '2x1'],
			askVariant: ['single', '3x1', '2x1'],
			readyToBuy: ['3x1', 'single', '2x1']
		},
		primaryOfferHints: ['calzas linfaticas', 'calza linfatica', 'calzas modeladoras'],
		secondaryOfferHints: ['3x1 calzas', '2x1 calzas'],
		fallbackHints: ['calzas linfaticas', 'calza modeladora'],
		avoidHints: ['gift', 'regalo', 'body modelador'],
		defaultPitch:
			'Si preguntan por piernas o modelado de piernas, guiá primero con calzas linfáticas antes de abrir otras familias.',
		linkHint: 'Si cambió a calzas, sostené calzas hasta que la clienta cambie de familia en forma explícita.'
	},
	short_faja: {
		label: 'short faja',
		introMode: 'product_first',
		strictFamilyLock: true,
		offerPriority: {
			general: ['single', '2x1', '3x1'],
			askOffer: ['2x1', '3x1', 'single'],
			askPrice: ['single', '2x1', '3x1'],
			askPriceAndOffer: ['2x1', 'single', '3x1'],
			askVariant: ['single', '2x1', '3x1'],
			readyToBuy: ['2x1', 'single', '3x1']
		},
		primaryOfferHints: ['short faja', 'short modelador', 'short reductor'],
		secondaryOfferHints: ['2x1 short', '3x1 short'],
		fallbackHints: ['short faja', 'short modelador'],
		avoidHints: ['gift', 'regalo']
	},
	faja: {
		label: 'faja',
		introMode: 'product_first',
		strictFamilyLock: true,
		offerPriority: {
			general: ['single', '2x1', '3x1'],
			askOffer: ['2x1', '3x1', 'single'],
			askPrice: ['single', '2x1', '3x1'],
			askPriceAndOffer: ['2x1', 'single', '3x1'],
			askVariant: ['single', '2x1', '3x1'],
			readyToBuy: ['2x1', 'single', '3x1']
		},
		primaryOfferHints: ['faja', 'faja reductora', 'faja modeladora'],
		secondaryOfferHints: ['2x1 faja', '3x1 faja'],
		fallbackHints: ['faja', 'faja reductora'],
		avoidHints: ['gift', 'regalo']
	},
	bombacha_modeladora: {
		label: 'bombacha modeladora',
		introMode: 'product_first',
		strictFamilyLock: true,
		offerPriority: {
			general: ['single', '2x1', '3x1'],
			askOffer: ['2x1', '3x1', 'single'],
			askPrice: ['single', '2x1', '3x1'],
			askPriceAndOffer: ['2x1', 'single', '3x1'],
			askVariant: ['single', '2x1', '3x1'],
			readyToBuy: ['2x1', 'single', '3x1']
		},
		primaryOfferHints: ['bombacha modeladora', 'bombacha reductora'],
		secondaryOfferHints: ['2x1 bombacha', '3x1 bombacha'],
		fallbackHints: ['bombacha modeladora'],
		avoidHints: ['gift', 'regalo']
	}
};

const FAMILY_PATTERNS = [
	{
		family: 'body_modelador',
		regex:
			/(body|bodys?)\b.*(modelador|reductor|reductora)|\bbody modelador\b|\bbodys? modeladores?\b|\bbody\b/
	},
	{
		family: 'calzas_linfaticas',
		regex:
			/(calza|calzas)\b.*(linfat|modeladora)|\bcalzas? linfaticas\b|\bcalza linfatica\b/
	},
	{
		family: 'short_faja',
		regex: /(short)\b.*(faja|modelador|reductor)|\bshort faja\b/
	},
	{
		family: 'bombacha_modeladora',
		regex: /(bombacha)\b.*(modelador|reductor)|\bbombacha modeladora\b/
	},
	{ family: 'faja', regex: /\bfaja\b/ }
];

export function inferCommercialFamily(text = '') {
	const normalized = normalizeText(text);
	for (const item of FAMILY_PATTERNS) {
		if (item.regex.test(normalized)) return item.family;
	}
	return null;
}

export function getCommercialProfile(family = null) {
	if (!family) return null;
	return CATALOG_COMMERCIAL_MAP[family] || null;
}

export function getFamilyLabel(family = null) {
	return getCommercialProfile(family)?.label || family || 'producto';
}

export function getPreferredOfferOrder(family = null, contextKey = 'general') {
	const profile = getCommercialProfile(family);
	if (!profile?.offerPriority) return ['3x1', '2x1', 'single'];
	return profile.offerPriority[contextKey] || profile.offerPriority.general || ['3x1', '2x1', 'single'];
}

function termHitScore(text, hints = []) {
	const normalized = normalizeText(text);
	let score = 0;
	for (const hint of hints) {
		if (normalized.includes(normalizeText(hint))) score += 1;
	}
	return score;
}

export function scoreProductAgainstCommercialProfile(product = {}, family = null) {
	const profile = getCommercialProfile(family);
	if (!profile) return 0;

	const haystack = normalizeText(
		[
			product.name,
			product.handle,
			product.tags,
			product.shortDescription,
			...(Array.isArray(product.variantHints) ? product.variantHints : []),
			...(Array.isArray(product.colors) ? product.colors : []),
			...(Array.isArray(product.sizes) ? product.sizes : [])
		]
			.filter(Boolean)
			.join(' ')
	);

	let score = 0;
	score += termHitScore(haystack, profile.primaryOfferHints) * 18;
	score += termHitScore(haystack, profile.secondaryOfferHints) * 12;
	score += termHitScore(haystack, profile.fallbackHints) * 10;
	score -= termHitScore(haystack, profile.avoidHints) * 40;

	return score;
}
