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

async function sendWhatsAppRequest({ to, payload, debugLabel = 'REQUEST' }) {
	const rawTo = to;
	const finalTo = normalizeWhatsAppNumber(rawTo);
	const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';
	const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
	const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;

	debugWhatsAppRecipient(`${debugLabel} META`, {
		rawTo,
		finalTo,
		graphVersion,
		phoneNumberId,
		tokenLoaded: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
		payloadType: payload?.type || null,
	});

	if (!finalTo) {
		return {
			ok: false,
			provider: 'whatsapp-cloud-api',
			model: null,
			error: { message: 'Falta número para enviar por WhatsApp.' },
		};
	}

	const finalPayload = {
		messaging_product: 'whatsapp',
		to: finalTo,
		...payload,
	};

	debugWhatsAppRecipient(`${debugLabel} URL`, { url });
	debugWhatsAppRecipient(`${debugLabel} PAYLOAD`, finalPayload);

	try {
		const response = await axios.post(url, finalPayload, {
			headers: {
				Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
				'Content-Type': 'application/json',
			},
		});

		debugWhatsAppRecipient(`${debugLabel} RESPONSE`, response.data);

		return {
			ok: true,
			provider: 'whatsapp-cloud-api',
			model: null,
			rawPayload: response.data,
		};
	} catch (error) {
		console.error(`[WA DEBUG] ${debugLabel} ERROR MESSAGE`, error.message);
		console.error(`[WA DEBUG] ${debugLabel} ERROR STATUS`, error.response?.status);
		console.error(
			`[WA DEBUG] ${debugLabel} ERROR DATA`,
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

export async function sendWhatsAppText({ to, body }) {
	const cleanBody = String(body || '').trim();

	if (!cleanBody) {
		debugWhatsAppRecipient('ABORT sendWhatsAppText', {
			reason: 'missing_body',
			bodyLength: cleanBody.length,
		});

		return {
			ok: false,
			provider: 'whatsapp-cloud-api',
			model: null,
			error: { message: 'Falta mensaje para enviar por WhatsApp.' },
		};
	}

	return sendWhatsAppRequest({
		to,
		debugLabel: 'TEXT',
		payload: {
			type: 'text',
			text: { body: cleanBody },
		},
	});
}

export async function sendWhatsAppInteractiveList({
	to,
	body,
	headerText = null,
	footerText = null,
	buttonText = 'Ver opciones',
	sections = [],
}) {
	const cleanBody = String(body || '').trim();
	const cleanSections = Array.isArray(sections)
		? sections
				.map((section) => ({
					title: String(section?.title || '').trim(),
					rows: Array.isArray(section?.rows)
						? section.rows
								.map((row) => ({
									id: String(row?.id || '').trim(),
									title: String(row?.title || '').trim(),
									description: row?.description ? String(row.description).trim() : undefined,
								}))
								.filter((row) => row.id && row.title)
						: [],
				}))
				.filter((section) => section.rows.length)
		: [];

	if (!cleanBody || !cleanSections.length) {
		return {
			ok: false,
			provider: 'whatsapp-cloud-api',
			model: null,
			error: { message: 'Falta contenido para enviar el menú interactivo.' },
		};
	}

	const interactive = {
		type: 'list',
		body: { text: cleanBody },
		action: {
			button: String(buttonText || 'Ver opciones').slice(0, 20),
			sections: cleanSections,
		},
	};

	if (headerText) {
		interactive.header = {
			type: 'text',
			text: String(headerText).slice(0, 60),
		};
	}

	if (footerText) {
		interactive.footer = {
			text: String(footerText).slice(0, 60),
		};
	}

	return sendWhatsAppRequest({
		to,
		debugLabel: 'INTERACTIVE_LIST',
		payload: {
			type: 'interactive',
			interactive,
		},
	});
}

export async function sendWhatsAppTemplate({
	to,
	templateName,
	languageCode = 'es_AR',
	components = []
}) {
	if (!templateName) {
		return {
			ok: false,
			provider: 'whatsapp-cloud-api',
			model: null,
			error: {
				message: 'Falta nombre del template para enviar por WhatsApp.'
			}
		};
	}

	return sendWhatsAppRequest({
		to,
		debugLabel: 'TEMPLATE',
		payload: {
			type: 'template',
			template: {
				name: templateName,
				language: { code: languageCode },
				components,
			}
		},
	});
}
