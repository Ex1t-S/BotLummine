import axios from 'axios';

function normalizeBaseUrl(value = '') {
	return String(value || '').trim().replace(/\/+$/, '');
}

function isAbsoluteUrl(value = '') {
	return /^https?:\/\//i.test(String(value || '').trim());
}

const explicitApiBase = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || '');
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

const api = axios.create({
	baseURL: apiBaseURL,
	withCredentials: true,
});

export default api;
