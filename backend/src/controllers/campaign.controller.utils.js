import { prisma } from '../lib/prisma.js';

export function normalizeBoolean(value) {
	return ['1', 'true', 'yes', 'si'].includes(String(value || '').trim().toLowerCase());
}

export function sendError(res, error, status = 400) {
	return res.status(status).json({
		ok: false,
		error: error.message || 'Error desconocido',
	});
}

function normalizeString(value, fallback = '') {
	const normalized = String(value ?? '').trim();
	return normalized || fallback;
}

function toUpper(value, fallback = '') {
	return normalizeString(value, fallback).toUpperCase();
}

function safeArray(value) {
	return Array.isArray(value) ? value : [];
}

function cloneJson(value, fallback) {
	try {
		return JSON.parse(JSON.stringify(value ?? fallback));
	} catch {
		return fallback;
	}
}

function buildTemplateRawPayloadWithLocalMedia(template = {}, { components = [], headerMedia = null } = {}) {
	const rawPayload = cloneJson(template?.rawPayload, {}) || {};
	const nextComponents = safeArray(components).length
		? cloneJson(components, [])
		: cloneJson(rawPayload.components, []) || [];

	rawPayload.name = template?.name || rawPayload.name;
	rawPayload.language = template?.language || rawPayload.language;
	rawPayload.category = template?.category || rawPayload.category;
	rawPayload.components = nextComponents;

	const headerIndex = nextComponents.findIndex(
		(component) => toUpper(component?.type) === 'HEADER'
	);

	if (headerIndex >= 0 && toUpper(nextComponents[headerIndex]?.format) === 'TEXT') {
		const nextHeader = { ...nextComponents[headerIndex] };
		delete nextHeader.image;
		nextComponents[headerIndex] = nextHeader;
	}

	if (headerMedia && (headerMedia.mediaId || headerMedia.previewUrl)) {
		const currentHeader =
			headerIndex >= 0
				? { ...nextComponents[headerIndex] }
				: {
					type: 'HEADER',
					format: 'IMAGE',
				};

		const nextHeader = {
			...currentHeader,
			type: 'HEADER',
			format: 'IMAGE',
			image: {
				...(currentHeader.image || {}),
				...(headerMedia.mediaId ? { id: normalizeString(headerMedia.mediaId) } : {}),
				...(headerMedia.previewUrl ? { link: normalizeString(headerMedia.previewUrl) } : {}),
			},
		};

		if (headerIndex >= 0) {
			nextComponents[headerIndex] = nextHeader;
		} else {
			nextComponents.unshift(nextHeader);
		}

		rawPayload.headerMedia = {
			...(rawPayload.headerMedia || {}),
			...(headerMedia.mediaId ? { mediaId: normalizeString(headerMedia.mediaId) } : {}),
			...(headerMedia.previewUrl ? { previewUrl: normalizeString(headerMedia.previewUrl) } : {}),
		};
	} else if (toUpper(template?.headerFormat) !== 'IMAGE') {
		delete rawPayload.headerMedia;
	}

	return rawPayload;
}

export async function persistTemplateBuilderMetadata(template = null, reqBody = {}) {
	if (!template?.id) {
		return template;
	}

	const nextRawPayload = buildTemplateRawPayloadWithLocalMedia(template, {
		components: Array.isArray(reqBody?.components) ? reqBody.components : [],
		headerMedia: reqBody?.headerMedia || null,
	});

	const nextHeader = safeArray(nextRawPayload.components).find(
		(component) => toUpper(component?.type) === 'HEADER'
	);

	return prisma.whatsAppTemplate.update({
		where: { id: template.id },
		data: {
			rawPayload: nextRawPayload,
			headerFormat: normalizeString(nextHeader?.format || template.headerFormat || '') || null,
		},
	});
}
