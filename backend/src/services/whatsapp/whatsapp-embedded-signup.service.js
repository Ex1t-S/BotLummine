import axios from 'axios';
import { getHttpTimeoutMs } from '../../lib/http-timeout.js';
import { logger } from '../../lib/logger.js';

const GRAPH_TIMEOUT_MS = getHttpTimeoutMs('META_GRAPH_TIMEOUT_MS', 15000);

function normalizeString(value = '') {
	return String(value || '').trim();
}

function readEnv(...names) {
	for (const name of names) {
		const value = normalizeString(process.env[name]);
		if (value) return value;
	}
	return '';
}

export function getEmbeddedSignupGraphVersion() {
	return readEnv('WHATSAPP_GRAPH_VERSION', 'META_GRAPH_VERSION') || 'v25.0';
}

function getMetaAppId() {
	return readEnv('META_APP_ID', 'FACEBOOK_APP_ID');
}

function getMetaAppSecret() {
	return readEnv('META_APP_SECRET', 'FACEBOOK_APP_SECRET');
}

function getCodeExchangeRedirectUri(redirectUri = '') {
	return normalizeString(redirectUri) || readEnv('META_REDIRECT_URI', 'WHATSAPP_EMBEDDED_SIGNUP_REDIRECT_URI');
}

function assertMetaAppConfig() {
	if (!getMetaAppId() || !getMetaAppSecret()) {
		const error = new Error('Faltan META_APP_ID y META_APP_SECRET para completar la conexion con Meta.');
		error.status = 500;
		throw error;
	}
}

function buildGraphUrl(path, graphVersion = getEmbeddedSignupGraphVersion()) {
	const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
	return `https://graph.facebook.com/${graphVersion}${normalizedPath}`;
}

function normalizeGraphError(error, fallbackMessage = 'No se pudo completar la operacion contra Meta.') {
	const apiError = error?.response?.data?.error;
	const nextError = new Error(
		apiError?.message ||
		error?.response?.data?.message ||
		error?.message ||
		fallbackMessage
	);
	nextError.status = error?.response?.status || 502;
	nextError.metaCode = apiError?.code || null;
	nextError.metaSubcode = apiError?.error_subcode || null;
	return nextError;
}

async function graphGet(path, { accessToken, params = {}, graphVersion } = {}) {
	try {
		const response = await axios.get(buildGraphUrl(path, graphVersion), {
			params: {
				...params,
				access_token: accessToken,
			},
			timeout: GRAPH_TIMEOUT_MS,
		});
		return response.data;
	} catch (error) {
		throw normalizeGraphError(error);
	}
}

async function graphPost(path, { accessToken, data = {}, params = {}, graphVersion } = {}) {
	try {
		const response = await axios.post(buildGraphUrl(path, graphVersion), data, {
			params: {
				...params,
				access_token: accessToken,
			},
			timeout: GRAPH_TIMEOUT_MS,
		});
		return response.data;
	} catch (error) {
		throw normalizeGraphError(error);
	}
}

function pickWabaIdFromDebugToken(debugToken = {}) {
	const granularScopes = Array.isArray(debugToken?.data?.granular_scopes)
		? debugToken.data.granular_scopes
		: [];
	const whatsappScope = granularScopes.find((item) => item?.scope === 'whatsapp_business_management');
	const targetIds = Array.isArray(whatsappScope?.target_ids) ? whatsappScope.target_ids : [];
	return normalizeString(targetIds[0]);
}

async function exchangeCodeForAccessToken(code, { redirectUri = '' } = {}) {
	assertMetaAppConfig();

	const params = {
		client_id: getMetaAppId(),
		client_secret: getMetaAppSecret(),
		code,
	};
	const finalRedirectUri = getCodeExchangeRedirectUri(redirectUri);
	if (finalRedirectUri) params.redirect_uri = finalRedirectUri;

	try {
		const response = await axios.get(buildGraphUrl('/oauth/access_token'), {
			params,
			timeout: GRAPH_TIMEOUT_MS,
		});
		const accessToken = normalizeString(response.data?.access_token);
		if (!accessToken) {
			const error = new Error('Meta no devolvio un access_token valido.');
			error.status = 502;
			throw error;
		}
		return response.data;
	} catch (error) {
		throw normalizeGraphError(error, 'No se pudo canjear el codigo de Meta.');
	}
}

async function debugAccessToken(accessToken) {
	const appAccessToken = `${getMetaAppId()}|${getMetaAppSecret()}`;
	return graphGet('/debug_token', {
		accessToken: appAccessToken,
		params: { input_token: accessToken },
	});
}

async function resolvePhoneNumber({ wabaId, phoneNumberId, accessToken, graphVersion }) {
	if (phoneNumberId) {
		return graphGet(`/${phoneNumberId}`, {
			accessToken,
			graphVersion,
			params: {
				fields: 'id,display_phone_number,verified_name,code_verification_status,quality_rating',
			},
		});
	}

	const phoneNumbers = await graphGet(`/${wabaId}/phone_numbers`, {
		accessToken,
		graphVersion,
		params: {
			fields: 'id,display_phone_number,verified_name,code_verification_status,quality_rating',
			limit: 25,
		},
	});

	return Array.isArray(phoneNumbers?.data) ? phoneNumbers.data[0] : null;
}

export async function completeWhatsAppEmbeddedSignup({
	code,
	redirectUri = '',
	wabaId = '',
	phoneNumberId = '',
	businessId = '',
}) {
	const cleanCode = normalizeString(code);
	if (!cleanCode) {
		const error = new Error('Falta el codigo de autorizacion de Meta.');
		error.status = 400;
		throw error;
	}

	const graphVersion = getEmbeddedSignupGraphVersion();
	const tokenResponse = await exchangeCodeForAccessToken(cleanCode, { redirectUri });
	const accessToken = normalizeString(tokenResponse.access_token);
	const debugToken = await debugAccessToken(accessToken).catch((error) => {
		logger.warn('whatsapp.embedded_signup.debug_token_failed', {
			error: error?.message || String(error),
		});
		return null;
	});

	const finalWabaId = normalizeString(wabaId) || pickWabaIdFromDebugToken(debugToken);
	if (!finalWabaId) {
		const error = new Error('Meta no devolvio un WABA para conectar.');
		error.status = 400;
		throw error;
	}

	const waba = await graphGet(`/${finalWabaId}`, {
		accessToken,
		graphVersion,
		params: {
			fields: 'id,name,currency,timezone_id,message_template_namespace,account_review_status',
		},
	});
	const phoneNumber = await resolvePhoneNumber({
		wabaId: finalWabaId,
		phoneNumberId: normalizeString(phoneNumberId),
		accessToken,
		graphVersion,
	});

	const finalPhoneNumberId = normalizeString(phoneNumber?.id) || normalizeString(phoneNumberId);
	if (!finalPhoneNumberId) {
		const error = new Error('Meta no devolvio un numero de WhatsApp para conectar.');
		error.status = 400;
		throw error;
	}

	const subscription = await graphPost(`/${finalWabaId}/subscribed_apps`, {
		accessToken,
		graphVersion,
		data: {},
	});

	return {
		accessToken,
		graphVersion,
		wabaId: finalWabaId,
		phoneNumberId: finalPhoneNumberId,
		displayPhoneNumber: normalizeString(phoneNumber?.display_phone_number),
		businessId: normalizeString(businessId),
		waba,
		phoneNumber,
		subscription,
		token: {
			tokenType: tokenResponse.token_type || null,
			expiresIn: tokenResponse.expires_in || null,
			dataAccessExpiresAt: debugToken?.data?.data_access_expires_at || null,
			scopes: debugToken?.data?.scopes || null,
			isValid: debugToken?.data?.is_valid ?? null,
		},
	};
}
