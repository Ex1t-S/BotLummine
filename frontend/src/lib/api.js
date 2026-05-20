import axios from 'axios';

function normalizeBaseUrl(value = '') {
	return String(value || '').trim().replace(/\/+$/, '');
}

function isAbsoluteUrl(value = '') {
	return /^https?:\/\//i.test(String(value || '').trim());
}

const explicitApiBase = normalizeBaseUrl(
	import.meta.env.VITE_BASE_API_URL || import.meta.env.VITE_API_URL || ''
);
const apiBaseURL = explicitApiBase || '/api';

function normalizeTimeoutMs(value, fallbackMs = 30000) {
	const parsed = Number(value || fallbackMs);
	const safeValue = Number.isFinite(parsed) ? parsed : fallbackMs;
	return Math.max(1000, Math.min(safeValue, 120000));
}

export const API_TIMEOUT_MS = normalizeTimeoutMs(import.meta.env.VITE_API_TIMEOUT_MS, 30000);
export const LOGIN_TIMEOUT_MS = normalizeTimeoutMs(import.meta.env.VITE_LOGIN_TIMEOUT_MS, 15000);

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
	timeout: API_TIMEOUT_MS,
});

export function getApiErrorMessage(error, fallback = 'No se pudo completar la operacion') {
	const responseMessage = error?.response?.data?.error || error?.response?.data?.message;
	if (typeof responseMessage === 'string' && responseMessage.trim()) {
		if (responseMessage.toLowerCase().includes('application not found')) {
			return 'La API de produccion no esta disponible. Proba de nuevo en unos segundos.';
		}

		return responseMessage;
	}

	const message = String(error?.message || '').toLowerCase();
	if (
		error?.code === 'ECONNABORTED' ||
		error?.code === 'ETIMEDOUT' ||
		message.includes('timeout')
	) {
		return 'La API no respondio a tiempo. Proba de nuevo en unos segundos.';
	}

	if (!error?.response && error?.request) {
		return 'No pudimos conectar con la API. Proba de nuevo en unos segundos.';
	}

	return fallback;
}

export default api;
