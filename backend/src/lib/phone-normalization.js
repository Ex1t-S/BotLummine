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

function hasExplicitInternationalPrefix(value = '') {
	return String(value || '').trim().startsWith('+') || digitsOnly(value).startsWith('00');
}

function isValidE164Digits(value = '') {
	return /^[1-9]\d{7,14}$/.test(value);
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

function removeDomesticMobile15(national = '') {
	if (national.length !== 12) {
		return national;
	}

	for (const areaLen of [2, 3, 4]) {
		if (national.length <= areaLen + 2) continue;

		const area = national.slice(0, areaLen);
		const rest = national.slice(areaLen);

		if (rest.startsWith('15')) {
			return `${area}${rest.slice(2)}`;
		}
	}

	return national;
}

function removeMobile15AfterArea(value = '') {
	const digits = ensureArgentinaCountryCode(value);

	if (!digits.startsWith('54')) {
		return digits;
	}

	const national = digits.slice(2);
	return `54${removeDomesticMobile15(national)}`;
}

function ensureArgentinaMobileNine(value = '') {
	const digits = removeMobile15AfterArea(value);

	if (!digits.startsWith('54')) {
		return '';
	}

	const national = digits.slice(2);

	if (national.startsWith('9')) {
		return national.slice(1).length === 10 ? digits : '';
	}

	if (/^\d{10}$/.test(national)) {
		return `549${national}`;
	}

	return '';
}

export function normalizeWhatsAppIdentityPhone(value = '') {
	const digits = stripInternationalPrefix(value);
	if (!digits) return '';

	const normalized = ensureArgentinaMobileNine(value);

	if (/^54\d+$/.test(normalized)) {
		return normalized;
	}

	if (digits.startsWith('54')) {
		return '';
	}

	if (isValidE164Digits(digits) && (hasExplicitInternationalPrefix(value) || digits.length >= 11)) {
		return digits;
	}

	return '';
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
