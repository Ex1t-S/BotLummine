import crypto from 'node:crypto';
import axios from 'axios';
import {
	normalizeWhatsAppNumber,
	debugWhatsAppRecipient,
	buildTextPayload,
	buildInteractiveListPayload,
	buildTemplatePayload,
} from './whatsapp-formatters.js';
import {
	getGraphVersion,
	getWhatsAppAccessToken,
	getWhatsAppPhoneNumberId,
} from './meta-graph.service.js';

function buildTokenDebugFingerprint(token = '') {
	const normalized = String(token || '').trim();

	if (!normalized) {
		return {
			tokenPresent: false,
			tokenLength: 0,
			tokenFingerprint: null,
			tokenPrefix: null,
			tokenSuffix: null,
		};
	}

	return {
		tokenPresent: true,
		tokenLength: normalized.length,
		tokenFingerprint: crypto
			.createHash('sha256')
			.update(normalized)
			.digest('hex')
			.slice(0, 16),
		tokenPrefix: normalized.slice(0, 6),
		tokenSuffix: normalized.slice(-6),
	};
}

async function sendWhatsAppRequest({ to, payload, debugLabel = 'REQUEST' }) {
	const rawTo = to;
	const finalTo = normalizeWhatsAppNumber(rawTo);
	const graphVersion = getGraphVersion();
	const phoneNumberId = getWhatsAppPhoneNumberId();
	const accessToken = getWhatsAppAccessToken();
	const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
	const tokenDebug = buildTokenDebugFingerprint(accessToken);

	debugWhatsAppRecipient(`${debugLabel} META`, {
		rawTo,
		finalTo,
		graphVersion,
		phoneNumberId,
		...tokenDebug,
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
				Authorization: `Bearer ${accessToken}`,
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
			`[WA DEBUG] ${debugLabel} ERROR CONTEXT`,
			JSON.stringify(
				{
					rawTo,
					finalTo,
					graphVersion,
					phoneNumberId,
					...tokenDebug,
					payloadType: payload?.type || null,
				},
				null,
				2
			)
		);
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

export async function sendWhatsAppMedia({
	to,
	mediaId,
	mediaType = 'document',
	caption = '',
	fileName = '',
}) {
	const cleanMediaId = String(mediaId || '').trim();
	const cleanType = String(mediaType || '').trim().toLowerCase();
	const finalType = ['image', 'video', 'audio', 'document'].includes(cleanType)
		? cleanType
		: 'document';
	const cleanCaption = String(caption || '').trim();
	const cleanFileName = String(fileName || '').trim();

	if (!cleanMediaId) {
		return {
			ok: false,
			provider: 'whatsapp-cloud-api',
			model: null,
			error: { message: 'Falta mediaId para enviar por WhatsApp.' },
		};
	}

	const mediaPayload = {
		id: cleanMediaId,
	};

	if (cleanCaption && ['image', 'video', 'document'].includes(finalType)) {
		mediaPayload.caption = cleanCaption.slice(0, 1024);
	}

	if (finalType === 'document' && cleanFileName) {
		mediaPayload.filename = cleanFileName.slice(0, 240);
	}

	return sendWhatsAppRequest({
		to,
		debugLabel: `MEDIA_${finalType.toUpperCase()}`,
		payload: {
			messaging_product: 'whatsapp',
			type: finalType,
			[finalType]: mediaPayload,
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
