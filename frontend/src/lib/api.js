import axios from 'axios';

function normalizeBaseUrl(value = '') {
	return String(value || '').trim().replace(/\/+$/, '');
}

function isAbsoluteUrl(value = '') {
	return /^https?:\/\//i.test(String(value || '').trim());
}

const explicitApiBase = normalizeBaseUrl(import.meta.env.VITE_BASE_API_URL || '');
const apiBaseURL = explicitApiBase || '/api';

export function getApiBaseUrl() {
	return apiBaseURL;
}

export function getApiOrigin() {
	if (isAbsoluteUrl(apiBaseURL)) {
		try {
			return new URL(apiBaseURL).origin;
		} catch {
			return '';
		}
	}

	if (typeof window !== 'undefined') {
		return window.location.origin;
	}

	return '';
}

export function buildApiUrl(path = '') {
	const rawPath = String(path || '').trim();

	if (!rawPath) {
		if (isAbsoluteUrl(apiBaseURL)) return apiBaseURL;

		if (typeof window !== 'undefined') {
			const basePath = apiBaseURL.startsWith('/') ? apiBaseURL : `/${apiBaseURL}`;
			return new URL(basePath, window.location.origin).toString();
		}

		return apiBaseURL;
	}

	if (isAbsoluteUrl(rawPath) || rawPath.startsWith('blob:') || rawPath.startsWith('data:')) {
		return rawPath;
	}

	const cleanPath = rawPath.replace(/^\/+/, '');

	if (isAbsoluteUrl(apiBaseURL)) {
		try {
			return new URL(cleanPath, `${normalizeBaseUrl(apiBaseURL)}/`).toString();
		} catch {
			return rawPath;
		}
	}

	if (typeof window !== 'undefined') {
		const basePath = apiBaseURL.startsWith('/') ? apiBaseURL : `/${apiBaseURL}`;
		return new URL(
			`${basePath.replace(/\/+$/, '')}/${cleanPath}`,
			window.location.origin
		).toString();
	}

	return rawPath;
}

export function resolveApiUrl(value = '') {
	const raw = String(value || '').trim();

	if (!raw) return '';
	if (isAbsoluteUrl(raw) || raw.startsWith('blob:') || raw.startsWith('data:')) {
		return raw;
	}

	if (raw.startsWith('//')) {
		if (typeof window !== 'undefined') {
			return `${window.location.protocol}${raw}`;
		}
		return `https:${raw}`;
	}

	const origin = getApiOrigin();
	if (!origin) return raw;

	if (raw.startsWith('/')) {
		return `${origin}${raw}`;
	}

	return `${origin}/${raw.replace(/^\/+/, '')}`;
}

export function createApiEventSource(path = '', options = {}) {
	const url = buildApiUrl(path);
	return new EventSource(url, {
		withCredentials: true,
		...options,
	});
}

const api = axios.create({
	baseURL: apiBaseURL,
	withCredentials: true,
});

export default api;
