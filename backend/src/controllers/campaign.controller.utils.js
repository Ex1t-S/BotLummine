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

function getHeaderMediaFieldByFormat(format = '') {
	const normalized = toUpper(format);

	if (normalized === 'VIDEO') return 'video';
	if (normalized === 'DOCUMENT') return 'document';
	return 'image';
}

function cloneJson(value, fallback) {
	try {
		return JSON.parse(JSON.stringify(value ?? fallback));
	} catch {
		return fallback;
	}
}

function buildTemplateRawPayloadWithLocalMedia(
	template = {},
	{ components = [], headerMedia = null, parameterFormat = null } = {}
) {
	const rawPayload = cloneJson(template?.rawPayload, {}) || {};
	const nextComponents = safeArray(components).length
		? cloneJson(components, [])
		: cloneJson(rawPayload.components, []) || [];

	rawPayload.name = template?.name || rawPayload.name;
	rawPayload.language = template?.language || rawPayload.language;
	rawPayload.category = template?.category || rawPayload.category;
	rawPayload.components = nextComponents;

	if (parameterFormat) {
		rawPayload.parameter_format = normalizeString(parameterFormat);
	}

	const headerIndex = nextComponents.findIndex(
		(component) => toUpper(component?.type) === 'HEADER'
	);

	if (headerIndex >= 0 && toUpper(nextComponents[headerIndex]?.format) === 'TEXT') {
		const nextHeader = { ...nextComponents[headerIndex] };
		delete nextHeader.image;
		delete nextHeader.video;
		delete nextHeader.document;
		nextComponents[headerIndex] = nextHeader;
	}

	const headerMediaFormat = toUpper(
		headerMedia?.format ||
			nextComponents[headerIndex]?.format ||
			template?.headerFormat ||
			'IMAGE'
	);
	const headerMediaField = getHeaderMediaFieldByFormat(headerMediaFormat);

	if (headerMedia && (headerMedia.mediaId || headerMedia.previewUrl || headerMedia.headerHandle)) {
		const currentHeader =
			headerIndex >= 0
				? { ...nextComponents[headerIndex] }
				: {
						type: 'HEADER',
						format: headerMediaFormat,
					};

		const nextHeader = {
			...currentHeader,
			type: 'HEADER',
			format: headerMediaFormat,
			image: undefined,
			video: undefined,
			document: undefined,
			[headerMediaField]: {
				...(currentHeader[headerMediaField] || {}),
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
			format: headerMediaFormat,
			mediaType: headerMediaField,
			...(headerMedia.mediaId ? { mediaId: normalizeString(headerMedia.mediaId) } : {}),
			...(headerMedia.previewUrl ? { previewUrl: normalizeString(headerMedia.previewUrl) } : {}),
			...(headerMedia.headerHandle ? { headerHandle: normalizeString(headerMedia.headerHandle) } : {}),
		};
	} else if (!['IMAGE', 'VIDEO', 'DOCUMENT'].includes(toUpper(template?.headerFormat))) {
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
		parameterFormat: reqBody?.parameterFormat || null,
	});

	const nextHeader = safeArray(nextRawPayload.components).find(
		(component) => toUpper(component?.type) === 'HEADER'
	);

	return prisma.whatsAppTemplate.update({
		where: { id: template.id },
		data: {
			rawPayload: nextRawPayload,
			headerFormat: normalizeString(nextHeader?.format || template.headerFormat || '') || null,
			parameterFormat:
				normalizeString(
					reqBody?.parameterFormat ||
						nextRawPayload?.parameter_format ||
						template?.parameterFormat ||
						''
				) || null,
		},
	});
}
