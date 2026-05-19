import axios from 'axios';
import { getHttpTimeoutMs } from '../../lib/http-timeout.js';
import { logger } from '../../lib/logger.js';

const GRAPH_TIMEOUT_MS = getHttpTimeoutMs('META_GRAPH_TIMEOUT_MS', 15000);
const REQUIRED_EMBEDDED_SIGNUP_SCOPES = [
	'whatsapp_business_management',
	'whatsapp_business_messaging',
];
const PERMISSION_ERROR_PATTERN = /(\(#200\)|permissions? error|permission denied|requires?.*permission|missing.*permission)/i;
const GRAPH_OPERATION_LABELS = {
	exchange_code: 'canjear el codigo de Meta',
	debug_token: 'validar el token de Meta',
	read_waba: 'leer la WABA autorizada',
	read_phone_number: 'leer el numero de WhatsApp',
	list_phone_numbers: 'listar numeros de la WABA',
	subscribe_waba_webhooks: 'suscribir la WABA a webhooks',
};

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

function getCodeExchangeRedirectUriCandidates(redirectUri = '') {
	return [
		normalizeString(redirectUri),
		readEnv('WHATSAPP_EMBEDDED_SIGNUP_CALLBACK_URI', 'META_REDIRECT_URI', 'WHATSAPP_EMBEDDED_SIGNUP_REDIRECT_URI'),
		'https://staticxx.facebook.com/x/connect/xd_arbiter/?version=46',
		'https://static.xx.fbcdn.net/x/connect/xd_arbiter/?version=46',
		'',
	].filter((value, index, values) => values.indexOf(value) === index);
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

function normalizeGraphError(error, fallbackMessage = 'No se pudo completar la operacion contra Meta.', context = {}) {
	const apiError = error?.response?.data?.error;
	const message = (
		apiError?.message ||
		error?.response?.data?.message ||
		error?.message ||
		fallbackMessage
	);
	const operation = normalizeString(context.operation);
	const operationLabel = GRAPH_OPERATION_LABELS[operation] || operation;
	const isPermissionError = apiError?.code === 200 || PERMISSION_ERROR_PATTERN.test(message);
	const nextError = new Error(
		isPermissionError
			? `Meta rechazo la conexion por permisos al ${operationLabel || 'completar la operacion'}: ${message}. Revisa que la app tenga acceso avanzado a whatsapp_business_management y whatsapp_business_messaging, que el Config ID de Embedded Signup pertenezca a la misma app, y que el usuario sea administrador del Business/WABA que esta conectando.`
			: operationLabel
				? `Meta no pudo ${operationLabel}: ${message}`
				: message
	);
	nextError.status = error?.response?.status || 502;
	nextError.metaCode = apiError?.code || null;
	nextError.metaSubcode = apiError?.error_subcode || null;
	nextError.graphOperation = operation || null;
	nextError.graphPath = context.graphPath || null;
	return nextError;
}

async function graphGet(path, { accessToken, params = {}, graphVersion, operation = '' } = {}) {
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
		throw normalizeGraphError(error, undefined, { operation, graphPath: path });
	}
}

async function graphPost(path, { accessToken, data = {}, params = {}, graphVersion, operation = '' } = {}) {
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
		throw normalizeGraphError(error, undefined, { operation, graphPath: path });
	}
}

function uniqueNormalizedStrings(values = []) {
	return values
		.map((value) => normalizeString(value))
		.filter((value, index, list) => value && list.indexOf(value) === index);
}

function getWabaIdsFromDebugToken(debugToken = {}) {
	const granularScopes = Array.isArray(debugToken?.data?.granular_scopes)
		? debugToken.data.granular_scopes
		: [];
	const targetIds = granularScopes
		.filter((item) => ['whatsapp_business_management', 'whatsapp_business_messaging'].includes(item?.scope))
		.flatMap((item) => (Array.isArray(item?.target_ids) ? item.target_ids : []));
	return uniqueNormalizedStrings(targetIds);
}

function getScopesFromDebugToken(debugToken = {}) {
	const scopes = Array.isArray(debugToken?.data?.scopes) ? debugToken.data.scopes : [];
	const granularScopes = Array.isArray(debugToken?.data?.granular_scopes)
		? debugToken.data.granular_scopes.map((item) => item?.scope)
		: [];
	return uniqueNormalizedStrings([...scopes, ...granularScopes]);
}

function assertEmbeddedSignupScopes(debugToken = {}) {
	if (!debugToken?.data || debugToken.data.is_valid === false) return;

	const scopes = getScopesFromDebugToken(debugToken);
	if (!scopes.length) return;

	const missingScopes = REQUIRED_EMBEDDED_SIGNUP_SCOPES.filter((scope) => !scopes.includes(scope));
	if (!missingScopes.length) return;

	const error = new Error(
		`Meta devolvio un token sin permisos de WhatsApp (${missingScopes.join(', ')}). Revisa App Review/Advanced Access y el Config ID de Embedded Signup antes de volver a conectar.`
	);
	error.status = 400;
	error.metaCode = 200;
	error.graphOperation = 'validate_whatsapp_permissions';
	error.details = {
		missingScopes,
		receivedScopes: scopes,
	};
	throw error;
}

async function exchangeCodeForAccessToken(code, { redirectUri = '' } = {}) {
	assertMetaAppConfig();

	const baseParams = {
		client_id: getMetaAppId(),
		client_secret: getMetaAppSecret(),
		code,
	};
	let lastError = null;

	for (const candidateRedirectUri of getCodeExchangeRedirectUriCandidates(redirectUri)) {
		const params = { ...baseParams };
		if (candidateRedirectUri) params.redirect_uri = candidateRedirectUri;

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
			lastError = error;
			const apiError = error?.response?.data?.error;
			const message = apiError?.message || error?.message || '';
			if (!/redirect_uri|verification code/i.test(message)) {
				break;
			}
		}
	}

	throw normalizeGraphError(lastError, 'No se pudo canjear el codigo de Meta.', {
		operation: 'exchange_code',
		graphPath: '/oauth/access_token',
	});
}

async function debugAccessToken(accessToken) {
	const appAccessToken = `${getMetaAppId()}|${getMetaAppSecret()}`;
	return graphGet('/debug_token', {
		accessToken: appAccessToken,
		operation: 'debug_token',
		params: { input_token: accessToken },
	});
}

async function resolvePhoneNumber({ wabaId, phoneNumberId, accessToken, graphVersion }) {
	if (phoneNumberId) {
		return graphGet(`/${phoneNumberId}`, {
			accessToken,
			graphVersion,
			operation: 'read_phone_number',
			params: {
				fields: 'id,display_phone_number,verified_name,code_verification_status,quality_rating',
			},
		});
	}

	const phoneNumbers = await graphGet(`/${wabaId}/phone_numbers`, {
		accessToken,
		graphVersion,
		operation: 'list_phone_numbers',
		params: {
			fields: 'id,display_phone_number,verified_name,code_verification_status,quality_rating',
			limit: 25,
		},
	});

	return Array.isArray(phoneNumbers?.data) ? phoneNumbers.data[0] : null;
}

async function resolveEmbeddedSignupAssets({
	wabaId,
	phoneNumberId,
	accessToken,
	graphVersion,
	debugToken,
}) {
	const cleanWabaId = normalizeString(wabaId);
	const cleanPhoneNumberId = normalizeString(phoneNumberId);
	const candidateWabaIds = uniqueNormalizedStrings([
		cleanWabaId,
		...getWabaIdsFromDebugToken(debugToken),
	]);
	const attemptedWabaIds = [];
	let lastError = null;

	if (cleanPhoneNumberId && cleanWabaId) {
		const waba = await graphGet(`/${cleanWabaId}`, {
			accessToken,
			graphVersion,
			operation: 'read_waba',
			params: {
				fields: 'id,name,currency,timezone_id,message_template_namespace,account_review_status',
			},
		});
		const phoneNumber = await resolvePhoneNumber({
			wabaId: cleanWabaId,
			phoneNumberId: cleanPhoneNumberId,
			accessToken,
			graphVersion,
		});
		return { wabaId: cleanWabaId, phoneNumberId: cleanPhoneNumberId, waba, phoneNumber, candidateWabaIds };
	}

	for (const candidateWabaId of candidateWabaIds) {
		attemptedWabaIds.push(candidateWabaId);
		try {
			const waba = await graphGet(`/${candidateWabaId}`, {
				accessToken,
				graphVersion,
				operation: 'read_waba',
				params: {
					fields: 'id,name,currency,timezone_id,message_template_namespace,account_review_status',
				},
			});
			const phoneNumber = await resolvePhoneNumber({
				wabaId: candidateWabaId,
				phoneNumberId: candidateWabaId === cleanWabaId ? cleanPhoneNumberId : '',
				accessToken,
				graphVersion,
			});
			const finalPhoneNumberId = normalizeString(phoneNumber?.id) || (candidateWabaId === cleanWabaId ? cleanPhoneNumberId : '');
			if (finalPhoneNumberId) {
				return {
					wabaId: candidateWabaId,
					phoneNumberId: finalPhoneNumberId,
					waba,
					phoneNumber,
					candidateWabaIds,
				};
			}
		} catch (error) {
			lastError = error;
			logger.warn('whatsapp.embedded_signup.resolve_waba_failed', {
				wabaId: candidateWabaId,
				error: error?.message || String(error),
				metaCode: error?.metaCode || null,
				metaSubcode: error?.metaSubcode || null,
			});
		}
	}

	if (cleanPhoneNumberId && candidateWabaIds.length) {
		try {
			const phoneNumber = await resolvePhoneNumber({
				wabaId: candidateWabaIds[0],
				phoneNumberId: cleanPhoneNumberId,
				accessToken,
				graphVersion,
			});
			return {
				wabaId: candidateWabaIds[0],
				phoneNumberId: cleanPhoneNumberId,
				waba: null,
				phoneNumber,
				candidateWabaIds,
			};
		} catch (error) {
			lastError = error;
		}
	}

	logger.warn('whatsapp.embedded_signup.no_phone_number_resolved', {
		providedWabaId: cleanWabaId || null,
		providedPhoneNumberId: cleanPhoneNumberId || null,
		candidateWabaIds,
		attemptedWabaIds,
		error: lastError?.message || null,
		metaCode: lastError?.metaCode || null,
		metaSubcode: lastError?.metaSubcode || null,
	});

	return {
		wabaId: cleanWabaId || candidateWabaIds[0] || '',
		phoneNumberId: '',
		waba: null,
		phoneNumber: null,
		candidateWabaIds,
	};
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
	assertEmbeddedSignupScopes(debugToken);

	const signupAssets = await resolveEmbeddedSignupAssets({
		wabaId,
		phoneNumberId,
		accessToken,
		graphVersion,
		debugToken,
	});
	const finalWabaId = normalizeString(signupAssets.wabaId);
	if (!finalWabaId) {
		const error = new Error('Meta no devolvio un WABA para conectar.');
		error.status = 400;
		throw error;
	}

	const waba = signupAssets.waba || (await graphGet(`/${finalWabaId}`, {
		accessToken,
		graphVersion,
		operation: 'read_waba',
		params: {
			fields: 'id,name,currency,timezone_id,message_template_namespace,account_review_status',
		},
	}));
	const phoneNumber = signupAssets.phoneNumber;
	const finalPhoneNumberId = normalizeString(signupAssets.phoneNumberId) || normalizeString(phoneNumber?.id) || normalizeString(phoneNumberId);
	if (!finalPhoneNumberId) {
		const error = new Error('Meta no devolvio un numero de WhatsApp para conectar.');
		error.status = 400;
		error.details = {
			wabaId: finalWabaId,
			candidateWabaIds: signupAssets.candidateWabaIds,
		};
		throw error;
	}

	const subscription = await graphPost(`/${finalWabaId}/subscribed_apps`, {
		accessToken,
		graphVersion,
		operation: 'subscribe_waba_webhooks',
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
