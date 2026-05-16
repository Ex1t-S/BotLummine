function normalizeType(value = '') {
	return String(value || '').trim().toUpperCase();
}

function normalizeString(value = '') {
	return String(value || '').trim();
}

function safeArray(value) {
	return Array.isArray(value) ? value : [];
}

export function getTemplateComponents(template) {
	if (Array.isArray(template?.components)) return template.components;
	if (Array.isArray(template?.rawPayload?.components)) return template.rawPayload.components;
	return [];
}

export function getTemplateHeaderComponent(template) {
	return (
		getTemplateComponents(template).find(
			(component) => normalizeType(component?.type) === 'HEADER'
		) || null
	);
}

export function getTemplateHeaderFormat(template) {
	return normalizeType(getTemplateHeaderComponent(template)?.format || template?.headerFormat || '');
}

export function getHeaderMediaFieldByFormat(format = '') {
	const normalized = normalizeType(format);
	if (normalized === 'VIDEO') return 'video';
	if (normalized === 'DOCUMENT') return 'document';
	if (normalized === 'IMAGE') return 'image';
	return null;
}

export function getTemplateHeaderMediaField(template) {
	return getHeaderMediaFieldByFormat(getTemplateHeaderFormat(template));
}

export function templateRequiresHeaderMedia(template) {
	return Boolean(getTemplateHeaderMediaField(template));
}

export function getTemplateHeaderMediaLabel(template) {
	const format = getTemplateHeaderFormat(template);
	if (format === 'VIDEO') return 'video';
	if (format === 'DOCUMENT') return 'documento';
	if (format === 'IMAGE') return 'imagen';
	return 'media';
}

export function getTemplateHeaderMediaAccept(template) {
	const format = getTemplateHeaderFormat(template);
	if (format === 'VIDEO') return 'video/mp4';
	if (format === 'DOCUMENT') return 'application/pdf';
	return 'image/*';
}

export function getTemplateHeaderMediaAsset(template) {
	const header = getTemplateHeaderComponent(template);
	const rawHeaderMedia = template?.rawPayload?.headerMedia || {};
	const mediaField = getTemplateHeaderMediaField(template);
	const headerMedia = mediaField ? header?.[mediaField] || {} : {};

	const mediaId = normalizeString(rawHeaderMedia.mediaId || headerMedia.id || '');
	const previewUrl = normalizeString(rawHeaderMedia.previewUrl || headerMedia.link || '');
	const headerHandle = normalizeString(rawHeaderMedia.headerHandle || '');

	return {
		format: getTemplateHeaderFormat(template),
		mediaField,
		mediaId,
		previewUrl,
		headerHandle,
		hasResolvedAsset: Boolean(mediaId || previewUrl),
	};
}

export function getHeaderMediaVariableKey(template) {
	const mediaField = getTemplateHeaderMediaField(template);
	return mediaField ? `header_${mediaField}_id` : '';
}

export function buildHeaderMediaVariableMapping(template, mediaId = '') {
	const variableKey = getHeaderMediaVariableKey(template);
	const cleanMediaId = normalizeString(mediaId);

	if (!variableKey || !cleanMediaId) {
		return {};
	}

	return {
		[variableKey]: {
			source: 'fixed',
			fixedValue: cleanMediaId,
		},
	};
}

export function readHeaderMediaIdFromVariableMapping(template, variableMapping = {}) {
	const variableKey = getHeaderMediaVariableKey(template);
	if (!variableKey || !variableMapping || typeof variableMapping !== 'object') {
		return '';
	}

	const value = variableMapping[variableKey];
	if (!value) return '';

	if (typeof value === 'string') {
		return normalizeString(value === variableKey ? '' : value);
	}

	if (value && typeof value === 'object' && !Array.isArray(value)) {
		if (normalizeType(value.source) === 'FIXED') {
			return normalizeString(value.fixedValue || '');
		}

		return normalizeString(value.mediaId || value.id || '');
	}

	return '';
}

export function templateNeedsHeaderMediaUpload(template, mediaId = '') {
	return (
		templateRequiresHeaderMedia(template) &&
		!getTemplateHeaderMediaAsset(template).hasResolvedAsset &&
		!normalizeString(mediaId)
	);
}

export function mergeHeaderMediaVariableMapping(template, mediaId = '', variableMapping = {}) {
	const headerMediaMapping = buildHeaderMediaVariableMapping(template, mediaId);
	const next = { ...(variableMapping || {}) };

	for (const key of safeArray(['header_image_id', 'header_video_id', 'header_document_id'])) {
		if (!headerMediaMapping[key] && next[key]?.source === 'fixed') {
			delete next[key];
		}
	}

	return {
		...next,
		...headerMediaMapping,
	};
}
