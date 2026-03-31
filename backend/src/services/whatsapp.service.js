import axios from 'axios';

export function normalizeWhatsAppNumber(fromRaw) {
	const original = String(fromRaw || '');
	let clean = original.replace(/\D/g, '');

	if (!clean) return '';

	if (clean.startsWith('549')) {
		const cuerpo = clean.substring(3);
		const prefijosTres = [
			'220', '221', '223', '230', '236', '237', '249', '260', '261', '263',
			'264', '266', '280', '291', '294', '297', '298', '299', '336', '341',
			'342', '343', '345', '348', '351', '353', '358', '362', '364', '370',
			'376', '379', '380', '381', '383', '385', '387', '388'
		];

		const codArea = cuerpo.startsWith('11')
			? '11'
			: (prefijosTres.includes(cuerpo.substring(0, 3))
				? cuerpo.substring(0, 3)
				: cuerpo.substring(0, 4));

		const numeroLocal = cuerpo.substring(codArea.length);

		if (codArea === '2252') {
			return `54${codArea}${numeroLocal}`;
		}

		if (codArea === '2923') {
			return `54${codArea}15${numeroLocal}`;
		}

		return `54${codArea}15${numeroLocal}`;
	}

	if (clean.startsWith('54')) {
		const cuerpo = clean.substring(2);

		if (cuerpo.startsWith('22529')) {
			return `542252${cuerpo.substring(5)}`;
		}

		if (cuerpo.startsWith('2923') && !cuerpo.startsWith('292315')) {
			return `54292315${cuerpo.substring(4)}`;
		}

		return clean;
	}

	return clean;
}

function debugWhatsAppRecipient(label, data = {}) {
	try {
		console.log(`[WA DEBUG] ${label}`, JSON.stringify(data, null, 2));
	} catch {
		console.log(`[WA DEBUG] ${label}`, data);
	}
}

export async function sendWhatsAppText({ to, body }) {
	const rawTo = to;
	const cleanBody = String(body || '').trim();
	const finalTo = normalizeWhatsAppNumber(rawTo);

	debugWhatsAppRecipient('sendWhatsAppText', {
		rawTo,
		finalTo,
		bodyPreview: cleanBody.slice(0, 120),
		graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v25.0',
		phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
		tokenLoaded: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
	});

	if (!finalTo || !cleanBody) {
		debugWhatsAppRecipient('ABORT sendWhatsAppText', {
			reason: 'missing_to_or_body',
			rawTo,
			finalTo,
			bodyLength: cleanBody.length,
		});

		return {
			ok: false,
			provider: 'whatsapp-cloud-api',
			model: null,
			error: { message: 'Falta número o mensaje para enviar por WhatsApp.' },
		};
	}

	const url = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v25.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

	const payload = {
		messaging_product: 'whatsapp',
		to: finalTo,
		type: 'text',
		text: { body: cleanBody },
	};

	debugWhatsAppRecipient('TEXT URL', { url });
	debugWhatsAppRecipient('TEXT PAYLOAD', payload);

	try {
		const response = await axios.post(url, payload, {
			headers: {
				Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
				'Content-Type': 'application/json',
			},
		});

		debugWhatsAppRecipient('TEXT RESPONSE', response.data);

		return {
			ok: true,
			provider: 'whatsapp-cloud-api',
			model: null,
			rawPayload: response.data,
		};
	} catch (error) {
		console.error('[WA DEBUG] TEXT ERROR MESSAGE', error.message);
		console.error('[WA DEBUG] TEXT ERROR STATUS', error.response?.status);
		console.error(
			'[WA DEBUG] TEXT ERROR DATA',
			JSON.stringify(error.response?.data || {}, null, 2)
		);

		return {
			ok: false,
			provider: 'whatsapp-cloud-api',
			model: null,
			error: error.response?.data || { message: error.message },
		};
	}
}

export async function sendWhatsAppTemplate({
	to,
	templateName,
	languageCode = 'es_AR',
	components = []
}) {
	const rawTo = to;
	const finalTo = normalizeWhatsAppNumber(rawTo);

	debugWhatsAppRecipient('sendWhatsAppTemplate', {
		rawTo,
		finalTo,
		templateName,
		componentsCount: Array.isArray(components) ? components.length : 0,
	});

	if (!finalTo || !templateName) {
		return {
			ok: false,
			provider: 'whatsapp-cloud-api',
			model: null,
			error: {
				message: 'Falta número o nombre del template para enviar por WhatsApp.'
			}
		};
	}

	const url = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v25.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

	const payload = {
		messaging_product: 'whatsapp',
		to: finalTo,
		type: 'template',
		template: {
			name: templateName,
			language: { code: languageCode },
			components
		}
	};

	debugWhatsAppRecipient('TEMPLATE URL', { url });
	debugWhatsAppRecipient('TEMPLATE PAYLOAD', payload);

	try {
		const response = await axios.post(url, payload, {
			headers: {
				Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
				'Content-Type': 'application/json'
			}
		});

		debugWhatsAppRecipient('TEMPLATE RESPONSE', response.data);

		return {
			ok: true,
			provider: 'whatsapp-cloud-api',
			model: null,
			rawPayload: response.data
		};
	} catch (error) {
		console.error('[WA DEBUG] TEMPLATE ERROR MESSAGE', error.message);
		console.error('[WA DEBUG] TEMPLATE ERROR STATUS', error.response?.status);
		console.error(
			'[WA DEBUG] TEMPLATE ERROR DATA',
			JSON.stringify(error.response?.data || {}, null, 2)
		);

		return {
			ok: false,
			provider: 'whatsapp-cloud-api',
			model: null,
			error: error.response?.data || { message: error.message }
		};
	}
}