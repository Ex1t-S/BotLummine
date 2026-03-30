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
		familyLabel: 'body modelador',
		showMode: 'offer_first',
		linkMode: 'recent_or_primary',
		primaryOffer: {
			type: 'pack_3x1',
			handles: ['3x1', 'bodys-modeladores', 'body-modelador'],
			keywords: ['3x1', 'bodies', 'body modelador']
		},
		secondaryOffer: {
			type: 'pack_2x1',
			handles: ['2x1', 'bodys-modeladores', 'body-modelador'],
			keywords: ['2x1', 'bodies', 'body modelador']
		},
		fallback: {
			type: 'single',
			handles: ['body-modelador-reductor', 'body-modelador'],
			keywords: ['body modelador', 'reductor']
		},
		introLine: 'Tenemos body modelador individual y también promos. Si querés, te cuento primero la más conveniente y después vemos otras opciones.'
	},
	calzas_linfaticas: {
		familyLabel: 'calzas linfáticas',
		showMode: 'product_first',
		linkMode: 'recent_only',
		primaryOffer: {
			type: 'single',
			handles: ['calza', 'linfatica', 'linfaticas'],
			keywords: ['calza', 'linfatica', 'linfaticas']
		},
		secondaryOffer: null,
		fallback: {
			type: 'single',
			handles: ['calza', 'linfatica', 'linfaticas'],
			keywords: ['calza', 'linfatica', 'linfaticas']
		},
		introLine: 'Para piernas solemos orientar más con las calzas linfáticas. Si querés, te cuento breve cómo son y después te paso el link.'
	},
	short_faja: {
		familyLabel: 'short faja',
		showMode: 'offer_first',
		linkMode: 'recent_or_primary',
		primaryOffer: {
			type: 'pack_3x1',
			handles: ['3x1', 'short', 'faja'],
			keywords: ['3x1', 'short', 'faja']
		},
		secondaryOffer: {
			type: 'pack_2x1',
			handles: ['2x1', 'short', 'faja'],
			keywords: ['2x1', 'short', 'faja']
		},
		fallback: {
			type: 'single',
			handles: ['short', 'faja'],
			keywords: ['short', 'faja']
		}
	},
	faja: {
		familyLabel: 'faja reductora',
		showMode: 'product_first',
		linkMode: 'recent_or_primary',
		primaryOffer: {
			type: 'single',
			handles: ['faja', 'reductora'],
			keywords: ['faja', 'reductora']
		},
		secondaryOffer: null,
		fallback: {
			type: 'single',
			handles: ['faja', 'reductora'],
			keywords: ['faja', 'reductora']
		}
	},
	bombacha_modeladora: {
		familyLabel: 'bombacha modeladora',
		showMode: 'product_first',
		linkMode: 'recent_or_primary',
		primaryOffer: {
			type: 'single',
			handles: ['bombacha', 'modeladora'],
			keywords: ['bombacha', 'modeladora']
		},
		secondaryOffer: null,
		fallback: {
			type: 'single',
			handles: ['bombacha', 'modeladora'],
			keywords: ['bombacha', 'modeladora']
		}
	}
};

export function normalizeCommercialFamily(value = '') {
	const text = normalizeText(value);
	if (!text) return 'general';
	if (/(calza|linfatica|linfaticas)/.test(text)) return 'calzas_linfaticas';
	if (/(body|bodies|body modelador|body reductor)/.test(text)) return 'body_modelador';
	if (/(short|short faja)/.test(text)) return 'short_faja';
	if (/(bombacha|colaless)/.test(text)) return 'bombacha_modeladora';
	if (/(faja|reductora|reductor)/.test(text)) return 'faja';
	return 'general';
}

export function getCommercialProfile(family = '') {
	const key = normalizeCommercialFamily(family);
	return CATALOG_COMMERCIAL_MAP[key] || null;
}

export function scoreProductAgainstProfile(product = {}, profile = null, slot = 'primaryOffer') {
	if (!profile?.[slot]) return 0;
	const rule = profile[slot];
	const haystack = normalizeText([product.name, product.handle, product.tags, product.description].join(' '));
	let score = 0;
	if (rule.type && product.offerType === rule.type) score += 30;
	for (const handle of rule.handles || []) {
		if (haystack.includes(normalizeText(handle))) score += 10;
	}
	for (const keyword of rule.keywords || []) {
		if (haystack.includes(normalizeText(keyword))) score += 6;
	}
	return score;
}

export function isCommercialNoiseProduct(product = {}) {
	const text = normalizeText([product.name, product.handle, product.tags, product.description].join(' '));
	return /(regalo|gift|mes de la mujer|free gift|segunda piel de regalo)/.test(text);
}
