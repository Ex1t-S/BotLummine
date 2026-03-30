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
		introMode: 'offer_first',
		primaryOfferHints: ['3x1', 'promo 3x1', 'pack 3x1'],
		secondaryOfferHints: ['2x1', 'promo 2x1', 'pack 2x1'],
		fallbackHints: ['body modelador', 'body modelador reductor', 'body reductor'],
		avoidHints: ['gift', 'regalo', 'segunda piel de regalo'],
		defaultPitch:
			'Tenemos el body modelador individual y también promos. La principal para mostrar primero es la 3x1; si no te sirve, seguimos con la 2x1 o la opción individual.',
		linkHint: 'Si pasás link, priorizá la opción elegida o, si todavía no eligió, la principal de esta familia.'
	},
	calzas_linfaticas: {
		label: 'calzas linfáticas',
		introMode: 'product_first',
		primaryOfferHints: ['calzas linfaticas', 'calza linfatica', 'calzas modeladoras'],
		secondaryOfferHints: ['3x1 calzas', '2x1 calzas'],
		fallbackHints: ['calzas linfaticas', 'calza modeladora'],
		avoidHints: ['gift', 'regalo'],
		defaultPitch:
			'Si preguntan por piernas o modelado en piernas, guiá primero con calzas linfáticas antes de abrir otras familias.',
		linkHint: 'Si cambió a calzas, el link tiene que seguir esa conversación y no volver al body.'
	},
	short_faja: {
		label: 'short faja',
		introMode: 'product_first',
		primaryOfferHints: ['short faja', 'short modelador', 'short reductor'],
		secondaryOfferHints: ['2x1 short', '3x1 short'],
		fallbackHints: ['short faja', 'short modelador'],
		avoidHints: ['gift', 'regalo']
	},
	faja: {
		label: 'faja',
		introMode: 'product_first',
		primaryOfferHints: ['faja', 'faja reductora', 'faja modeladora'],
		secondaryOfferHints: ['2x1 faja', '3x1 faja'],
		fallbackHints: ['faja', 'faja reductora'],
		avoidHints: ['gift', 'regalo']
	},
	bombacha_modeladora: {
		label: 'bombacha modeladora',
		introMode: 'product_first',
		primaryOfferHints: ['bombacha modeladora', 'bombacha reductora'],
		secondaryOfferHints: ['2x1 bombacha', '3x1 bombacha'],
		fallbackHints: ['bombacha modeladora'],
		avoidHints: ['gift', 'regalo']
	}
};

const FAMILY_PATTERNS = [
	{ family: 'body_modelador', regex: /(body|bodys|bodys)\b.*(modelador|reductor|reductora)|\bbody\b|\bbodys\b/ },
	{ family: 'calzas_linfaticas', regex: /(calza|calzas)\b.*(linfat|modeladora)|\bcalzas linfaticas\b|\bcalza linfatica\b/ },
	{ family: 'short_faja', regex: /(short)\b.*(faja|modelador|reductor)|\bshort faja\b/ },
	{ family: 'bombacha_modeladora', regex: /(bombacha)\b.*(modelador|reductor)|\bbombacha modeladora\b/ },
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
