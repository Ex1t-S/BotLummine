import axios from 'axios';
import {
	normalizeWhatsAppNumber,
	debugWhatsAppRecipient,
	buildTextPayload,
	buildInteractiveListPayload,
	buildTemplatePayload,
} from './whatsapp-formatters.js';

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

export { normalizeWhatsAppNumber } from './whatsapp-formatters.js';

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
			...buildTextPayload(cleanBody),
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

	const payload = buildInteractiveListPayload({
		body: cleanBody,
		buttonText: String(buttonText || 'Ver opciones').slice(0, 20),
		sections: cleanSections,
		footer: footerText ? String(footerText).slice(0, 60) : '',
	});

	if (headerText) {
		payload.interactive.header = {
			type: 'text',
			text: String(headerText).slice(0, 60),
		};
	}

	return sendWhatsAppRequest({
		to,
		debugLabel: 'INTERACTIVE_LIST',
		payload: {
			type: 'interactive',
			...payload,
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
		payload: buildTemplatePayload({
			name: templateName,
			languageCode,
			components,
		}),
	});
}
