import crypto from 'node:crypto';
import axios from 'axios';
import { getHttpTimeoutMs } from '../../lib/http-timeout.js';
import { logger, maskPhone } from '../../lib/logger.js';
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
import { getWhatsAppChannelForWorkspace } from '../workspaces/workspace-context.service.js';

const WHATSAPP_TIMEOUT_MS = getHttpTimeoutMs('WHATSAPP_SEND_TIMEOUT_MS', 15000);

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

async function sendWhatsAppRequest({ workspaceId = null, to, payload, debugLabel = 'REQUEST' }) {
	const rawTo = to;
	const finalTo = normalizeWhatsAppNumber(rawTo);
	const channel = workspaceId ? await getWhatsAppChannelForWorkspace(workspaceId) : null;
	const graphVersion = channel?.graphVersion || getGraphVersion();
	const phoneNumberId = channel?.phoneNumberId || getWhatsAppPhoneNumberId();
	const accessToken = channel?.accessToken || getWhatsAppAccessToken();
	const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
	const tokenDebug = buildTokenDebugFingerprint(accessToken);

	debugWhatsAppRecipient(`${debugLabel} META`, {
		rawTo,
		finalTo,
		graphVersion,
		phoneNumberId,
		workspaceId: channel?.workspaceId || workspaceId || null,
		channelSource: channel?.source || 'env',
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
			timeout: WHATSAPP_TIMEOUT_MS,
		});

		debugWhatsAppRecipient(`${debugLabel} RESPONSE`, response.data);

		return {
			ok: true,
			provider: 'whatsapp-cloud-api',
			model: null,
			rawPayload: response.data,
		};
	} catch (error) {
		logger.warn('whatsapp.send_failed', {
			label: debugLabel,
			status: error.response?.status || null,
			message: error.message,
			to: maskPhone(finalTo || rawTo || ''),
			graphVersion,
			phoneNumberId,
			tokenFingerprint: tokenDebug.tokenFingerprint,
			payloadType: payload?.type || null,
			providerCode: error.response?.data?.error?.code || null,
			providerSubcode: error.response?.data?.error?.error_subcode || null,
			providerMessage: error.response?.data?.error?.message || null,
		});

		return {
			ok: false,
			provider: 'whatsapp-cloud-api',
			model: null,
			error: error.response?.data || { message: error.message },
		};
	}
}

export { normalizeWhatsAppNumber } from './whatsapp-formatters.js';

export async function sendWhatsAppText({ workspaceId = null, to, body }) {
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
		workspaceId,
		to,
		debugLabel: 'TEXT',
		payload: {
			type: 'text',
			...buildTextPayload(cleanBody),
		},
	});
}

export async function sendWhatsAppInteractiveList({
	workspaceId = null,
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
		workspaceId,
		to,
		debugLabel: 'INTERACTIVE_LIST',
		payload: {
			type: 'interactive',
			...payload,
		},
	});
}

export async function sendWhatsAppTemplate({
	workspaceId = null,
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
		workspaceId,
		to,
		debugLabel: 'TEMPLATE',
		payload: buildTemplatePayload({
			name: templateName,
			languageCode,
			components,
		}),
	});
}
