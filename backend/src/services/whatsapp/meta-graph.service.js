import axios from 'axios';

function normalizeEnvValue(value, fallback = '') {
	const normalized = String(value ?? '').trim();

	if (!normalized) {
		return fallback;
	}

	if (
		(normalized.startsWith('"') && normalized.endsWith('"')) ||
		(normalized.startsWith("'") && normalized.endsWith("'"))
	) {
		return normalized.slice(1, -1).trim() || fallback;
	}

	return normalized;
}

function readRequiredEnv(name) {
	const value = normalizeEnvValue(process.env[name] || '');

	if (!value) {
		throw new Error(`Falta la variable de entorno ${name}.`);
	}

	return value;
}

export function getGraphVersion() {
	return normalizeEnvValue(process.env.WHATSAPP_GRAPH_VERSION, 'v25.0');
}

export function getWhatsAppBusinessAccountId() {
	return normalizeEnvValue(
		process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
		process.env.WHATSAPP_WABA_ID ||
		'',
		readRequiredEnv('WHATSAPP_BUSINESS_ACCOUNT_ID')
	);
}

export function getWhatsAppPhoneNumberId() {
	return readRequiredEnv('WHATSAPP_PHONE_NUMBER_ID');
}

export function getWhatsAppAccessToken() {
	return readRequiredEnv('WHATSAPP_ACCESS_TOKEN');
}

export function buildGraphUrl(path) {
	const normalizedPath = String(path || '').startsWith('/')
		? String(path)
		: `/${String(path || '')}`;

	return `https://graph.facebook.com/${getGraphVersion()}${normalizedPath}`;
}

function buildHeaders(extraHeaders = {}, accessToken = null) {
	return {
		Authorization: `Bearer ${accessToken || getWhatsAppAccessToken()}`,
		'Content-Type': 'application/json',
		...extraHeaders
	};
}

function logGraph(label, payload) {
	try {
		console.log(`[META GRAPH] ${label}`, JSON.stringify(payload, null, 2));
	} catch {
		console.log(`[META GRAPH] ${label}`, payload);
	}
}

function normalizeAxiosGraphError(error) {
	const apiError = error?.response?.data?.error;

	return new Error(
		apiError?.message ||
		error?.response?.data?.message ||
		error?.message ||
		'Error desconocido contra Graph API.'
	);
}

export async function graphGet(path, { params = {}, headers = {}, accessToken = null } = {}) {
	const url = buildGraphUrl(path);

	logGraph('GET', { url, params });

	try {
		const response = await axios.get(url, {
			params,
			headers: buildHeaders(headers, accessToken)
		});

		return response.data;
	} catch (error) {
		logGraph('GET ERROR', {
			url,
			params,
			status: error?.response?.status || null,
			data: error?.response?.data || null
		});

		throw normalizeAxiosGraphError(error);
	}
}

export async function graphPost(path, data = {}, { params = {}, headers = {}, accessToken = null } = {}) {
	const url = buildGraphUrl(path);

	logGraph('POST', { url, params, data });

	try {
		const response = await axios.post(url, data, {
			params,
			headers: buildHeaders(headers, accessToken)
		});

		return response.data;
	} catch (error) {
		logGraph('POST ERROR', {
			url,
			params,
			data,
			status: error?.response?.status || null,
			responseData: error?.response?.data || null
		});

		throw normalizeAxiosGraphError(error);
	}
}

export async function graphDelete(path, { params = {}, data = {}, headers = {}, accessToken = null } = {}) {
	const url = buildGraphUrl(path);

	logGraph('DELETE', { url, params, data });

	try {
		const response = await axios.delete(url, {
			params,
			data,
			headers: buildHeaders(headers, accessToken)
		});

		return response.data;
	} catch (error) {
		logGraph('DELETE ERROR', {
			url,
			params,
			data,
			status: error?.response?.status || null,
			responseData: error?.response?.data || null
		});

		throw normalizeAxiosGraphError(error);
	}
}
