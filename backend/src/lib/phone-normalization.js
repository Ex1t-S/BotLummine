function digitsOnly(value = '') {
	return String(value || '').replace(/\D+/g, '');
}

function stripInternationalPrefix(value = '') {
	let digits = digitsOnly(value);

	if (digits.startsWith('00')) {
		digits = digits.slice(2);
	}

	return digits;
}

function removeArgentinaTrunkPrefix(value = '') {
	let digits = stripInternationalPrefix(value);

	if (digits.startsWith('0')) {
		digits = digits.slice(1);
	}

	return digits;
}

function ensureArgentinaCountryCode(value = '') {
	const digits = removeArgentinaTrunkPrefix(value);

	if (!digits) return '';

	if (digits.startsWith('54')) {
		return digits;
	}

	return `54${digits}`;
}

function removeMobile15AfterArea(value = '') {
	const digits = ensureArgentinaCountryCode(value);

	if (!digits.startsWith('54')) {
		return digits;
	}

	const national = digits.slice(2);

	for (const areaLen of [2, 3, 4]) {
		if (national.length <= areaLen + 2) continue;

		const area = national.slice(0, areaLen);
		const rest = national.slice(areaLen);

		if (rest.startsWith('15')) {
			return `54${area}${rest.slice(2)}`;
		}
	}

	return digits;
}

function ensureArgentinaMobileNine(value = '') {
	const digits = removeMobile15AfterArea(value);

	if (!digits.startsWith('54')) {
		return digits;
	}

	const national = digits.slice(2);

	if (national.startsWith('9')) {
		return digits;
	}

	if (/^11\d{8}$/.test(national)) {
		return `549${national}`;
	}

	if (/^\d{8,12}$/.test(national)) {
		return `549${national}`;
	}

	return digits;
}

export function normalizeWhatsAppIdentityPhone(value = '') {
	const digits = digitsOnly(value);
	if (!digits) return '';

	const normalized = ensureArgentinaMobileNine(value);

	if (!/^54\d+$/.test(normalized)) {
		return '';
	}

	return normalized;
}

export function normalizeWhatsAppDeliveryPhone(value = '') {
	return normalizeWhatsAppIdentityPhone(value);
}

export function phonesAreEquivalent(left = '', right = '') {
	const a = normalizeWhatsAppIdentityPhone(left);
	const b = normalizeWhatsAppIdentityPhone(right);

	if (!a || !b) return false;
	return a === b;
}