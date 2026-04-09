import { normalizeWhatsAppDeliveryPhone } from '../../lib/phone-normalization.js';

export function normalizeWhatsAppNumber(value = '') {
	return normalizeWhatsAppDeliveryPhone(value);
}

export function debugWhatsAppRecipient(label, data = {}) {
	try {
		console.log(`[WA DEBUG] ${label}`, JSON.stringify(data, null, 2));
	} catch {
		console.log(`[WA DEBUG] ${label}`, data);
	}
}

export function buildTextPayload(body) {
	return {
		messaging_product: 'whatsapp',
		preview_url: false,
		text: { body: String(body || '') }
	};
}

export function buildInteractiveListPayload({ body, buttonText = 'Ver opciones', sections = [], footer = '' }) {
	return {
		messaging_product: 'whatsapp',
		interactive: {
			type: 'list',
			body: { text: String(body || '') },
			...(footer ? { footer: { text: String(footer) } } : {}),
			action: {
				button: String(buttonText || 'Ver opciones'),
				sections: Array.isArray(sections) ? sections : []
			}
		}
	};
}

export function buildTemplatePayload({ name, languageCode = 'es_AR', components = [] }) {
	return {
		messaging_product: 'whatsapp',
		type: 'template',
		template: {
			name,
			language: { code: languageCode },
			...(Array.isArray(components) && components.length ? { components } : {})
		}
	};
}