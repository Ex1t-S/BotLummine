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
		label: 'bodys modeladores',
		introMode: 'product_first',
		primaryOfferHints: ['body modelador', 'bodys modeladores', 'body reductor', '3x1 bodys'],
		secondaryOfferHints: ['2x1 bodys', 'promo bodys', 'pack bodys'],
		fallbackHints: ['body', 'bodys', 'body modelador', 'body reductor'],
		avoidHints: ['gift card', 'tarjeta regalo', 'tarjeta de regalo', 'mes de la mujer'],
		defaultPitch:
			'Si hablan de bodys, quedate en esa familia. Primero confirma el tipo de body o promo que buscan y despues abri alternativas dentro de bodys.',
		linkHint:
			'Si pasas link, que sea del body o promo que vienen hablando. No cambies a otra familia sin permiso explicito.'
	},
	calzas_linfaticas: {
		label: 'calzas linfaticas',
		introMode: 'product_first',
		primaryOfferHints: ['calzas linfaticas', 'calza linfatica', 'calzas modeladoras'],
		secondaryOfferHints: ['3x1 calzas', '2x1 calzas'],
		fallbackHints: ['calza', 'calzas', 'calzas linfaticas', 'calza modeladora'],
		avoidHints: ['gift card', 'tarjeta regalo', 'tarjeta de regalo', 'mes de la mujer'],
		defaultPitch:
			'Si preguntan por piernas o modelado en piernas, guia primero con calzas linfaticas y manten la conversacion en esa familia.',
		linkHint:
			'Si cambio a calzas, el link tiene que seguir esa conversacion y no volver a otra familia.'
	},
	short_faja: {
		label: 'short faja',
		introMode: 'product_first',
		primaryOfferHints: ['short faja', 'short modelador', 'short reductor'],
		secondaryOfferHints: ['2x1 short', '3x1 short'],
		fallbackHints: ['short faja', 'short modelador'],
		avoidHints: ['gift card', 'tarjeta regalo', 'tarjeta de regalo', 'mes de la mujer']
	},
	faja: {
		label: 'fajas',
		introMode: 'product_first',
		primaryOfferHints: ['faja', 'faja reductora', 'faja modeladora'],
		secondaryOfferHints: ['2x1 faja', '3x1 faja'],
		fallbackHints: ['faja', 'fajas', 'faja reductora'],
		avoidHints: ['gift card', 'tarjeta regalo', 'tarjeta de regalo', 'mes de la mujer']
	},
	bombacha_modeladora: {
		label: 'bombachas modeladoras',
		introMode: 'product_first',
		primaryOfferHints: ['bombacha modeladora', 'bombacha reductora'],
		secondaryOfferHints: ['2x1 bombacha', '3x1 bombacha'],
		fallbackHints: ['bombacha', 'bombachas', 'bombacha modeladora'],
		avoidHints: ['gift card', 'tarjeta regalo', 'tarjeta de regalo', 'mes de la mujer']
	},
	corset: {
		label: 'corset',
		introMode: 'product_first',
		primaryOfferHints: ['corset', 'corset modelador', 'corseteria'],
		secondaryOfferHints: ['2x1 corset', '3x1 corset'],
		fallbackHints: ['corset'],
		avoidHints: ['gift card', 'tarjeta regalo', 'tarjeta de regalo', 'mes de la mujer']
	},
	corpinio: {
		label: 'corpino',
		introMode: 'product_first',
		primaryOfferHints: ['corpino', 'corpinio', 'sosten', 'bralette', 'segunda piel'],
		secondaryOfferHints: ['promo corpino', 'pack corpino'],
		fallbackHints: ['corpino', 'corpinio', 'bralette', 'segunda piel'],
		avoidHints: ['gift card', 'tarjeta regalo', 'tarjeta de regalo', 'mes de la mujer']
	},
	musculosa: {
		label: 'musculosa',
		introMode: 'product_first',
		primaryOfferHints: ['musculosa', 'camiseta musculosa', 'musculosa modeladora'],
		secondaryOfferHints: ['pack musculosa', 'promo musculosa'],
		fallbackHints: ['musculosa'],
		avoidHints: ['gift card', 'tarjeta regalo', 'tarjeta de regalo', 'mes de la mujer']
	},
	legging: {
		label: 'legging',
		introMode: 'product_first',
		primaryOfferHints: ['legging', 'leggings'],
		secondaryOfferHints: ['promo legging', 'pack legging'],
		fallbackHints: ['legging', 'leggings'],
		avoidHints: ['gift card', 'tarjeta regalo', 'tarjeta de regalo', 'mes de la mujer']
	}
};

const BODY_FAMILY_PATTERN = /\b(body|bodys|bodies|bodyus)\b|\bbodys modeladores\b|\bbody modelador\b|\bbody reductor\b/;

const FAMILY_PATTERNS = [
	{ family: 'body_modelador', regex: BODY_FAMILY_PATTERN },
	{ family: 'calzas_linfaticas', regex: /\b(calza|calzas)\b.*(linfat|modeladora|reductora)|\bcalzas? linfaticas?\b|\bcalzas? modeladoras?\b/ },
	{ family: 'legging', regex: /\blegging\b|\bleggings\b/ },
	{ family: 'short_faja', regex: /\bshort\b.*(faja|modelador|reductor)|\bshort faja\b|\bshort modelador\b/ },
	{ family: 'bombacha_modeladora', regex: /\bbombacha\b.*(modelador|reductor)|\bbombacha modeladora\b/ },
	{ family: 'corset', regex: /\bcorset\b|\bcorseteria\b/ },
	{ family: 'corpinio', regex: /\bcorpiño\b|\bcorpinio\b|\bcorpino\b|\bsosten\b|\bbralette\b|\bsegunda piel\b/ },
	{ family: 'musculosa', regex: /\bmusculosa\b|\bmusculosas\b/ },
	{ family: 'faja', regex: /\bfaja\b|\bfajas\b/ }
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

export function getCommercialFamilyLabel(family = null) {
	if (!family) return null;
	return CATALOG_COMMERCIAL_MAP[family]?.label || family;
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

	const haystack = normalizeText([
		product.name,
		product.handle,
		product.tags,
		product.shortDescription,
		...(Array.isArray(product.variantHints) ? product.variantHints : []),
		...(Array.isArray(product.colors) ? product.colors : []),
		...(Array.isArray(product.sizes) ? product.sizes : [])
	].filter(Boolean).join(' '));

	let score = 0;
	score += termHitScore(haystack, profile.primaryOfferHints) * 18;
	score += termHitScore(haystack, profile.secondaryOfferHints) * 12;
	score += termHitScore(haystack, profile.fallbackHints) * 10;
	score -= termHitScore(haystack, profile.avoidHints) * 40;
	return score;
}
