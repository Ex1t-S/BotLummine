function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

const ARGENTINA_PROVINCES = [
	'buenos aires',
	'caba',
	'capital federal',
	'cordoba',
	'santa fe',
	'mendoza',
	'tucuman',
	'entre rios',
	'salta',
	'chaco',
	'corrientes',
	'misiones',
	'santiago del estero',
	'san juan',
	'jujuy',
	'rio negro',
	'neuquen',
	'formosa',
	'chubut',
	'san luis',
	'catamarca',
	'la rioja',
	'la pampa',
	'santa cruz',
	'tierra del fuego'
];

function hasPostalCode(text = '') {
	return /\b(?:cp|codigo postal|cod postal|postal)\s*(?:es|:|#|-)?\s*([a-z]?\d{4}[a-z]{0,3}|\d{4})\b/i.test(text) ||
		/\b[a-z]\d{4}[a-z]{3}\b/i.test(text);
}

function hasKnownProvince(text = '') {
	const normalized = normalizeText(text);
	return ARGENTINA_PROVINCES.some((province) => normalized.includes(province));
}

function hasLocalityPhrase(text = '') {
	const normalized = normalizeText(text);
	const match = normalized.match(
		/\b(?:soy de|vivo en|estoy en|estoy por|para|a|en)\s+([a-z][a-z\s]{2,45})(?:[?.!,]|$)/
	);
	if (!match) return false;

	const candidate = match[1].trim();
	if (!candidate || candidate.length < 3) return false;
	return !/\b(envio|envios|correo|domicilio|sucursal|retiro|precio|costo|demora|pais|todo el pais)\b/.test(candidate);
}

function hasLocationSignal(messageBody = '', currentState = {}) {
	const text = String(messageBody || '');
	if (hasPostalCode(text) || hasKnownProvince(text) || hasLocalityPhrase(text)) return true;

	const deliveryPreference = normalizeText(currentState?.deliveryPreference || '');
	return Boolean(deliveryPreference && deliveryPreference !== 'retiro');
}

export async function handleShippingIntent({ messageBody = '', currentState = {} } = {}) {
	const hasLocation = hasLocationSignal(messageBody, currentState);

	return {
		handled: false,
		forcedReply: hasLocation
			? 'Hacemos envios. Con ese dato lo revisamos y te orientamos con las opciones disponibles, sin confirmarte un correo o costo que no corresponda.'
			: 'Hacemos envios. Decime tu localidad o codigo postal y te orientamos con las opciones disponibles, sin confirmarte un correo o costo que no corresponda.',
		liveOrderContext: null,
		aiGuidance: {
			type: 'shipping',
			coverage: 'envios_nacionales',
			eta: 'hasta_8_dias_habiles',
			hasLocation,
			askForLocationIfMissing: !hasLocation
		}
	};
}
