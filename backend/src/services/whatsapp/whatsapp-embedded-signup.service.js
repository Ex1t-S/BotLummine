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
	validate_app_credentials: 'validar el App ID y App Secret',
	read_waba: 'leer la WABA autorizada',
	read_phone_number: 'leer el numero de WhatsApp',
	list_phone_numbers: 'listar numeros de la WABA',
	list_owned_wabas: 'listar las cuentas de WhatsApp del negocio',
	list_shared_wabas: 'listar las cuentas de WhatsApp compartidas con el negocio',
	list_subscribed_apps: 'comprobar las suscripciones de webhooks de la WABA',
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

function getMetaAppId(appConfig = {}) {
	return normalizeString(appConfig.metaAppId) || readEnv('META_APP_ID', 'FACEBOOK_APP_ID');
}

function getMetaAppSecret(appConfig = {}) {
	return normalizeString(appConfig.appSecret) || readEnv('META_APP_SECRET', 'FACEBOOK_APP_SECRET');
}

export async function validateMetaAppCredentials({ metaAppId, appSecret, graphVersion }) {
	const cleanAppId = normalizeString(metaAppId);
	const cleanSecret = normalizeString(appSecret);
	if (!/^\d+$/.test(cleanAppId) || !cleanSecret || /^EAA[A-Za-z0-9]/.test(cleanSecret)) {
		const error = new Error('Ingresá el App ID numérico y el App Secret de Meta for Developers. Un access token no es un App Secret.');
		error.status = 400;
		throw error;
	}
	const app = await graphGet(`/${cleanAppId}`, {
		accessToken: `${cleanAppId}|${cleanSecret}`,
		graphVersion,
		operation: 'validate_app_credentials',
		params: { fields: 'id,name' },
	});
	if (normalizeString(app?.id) !== cleanAppId) {
		const error = new Error('Meta devolvió una App distinta del App ID ingresado.');
		error.status = 400;
		throw error;
	}
	return { id: cleanAppId, name: normalizeString(app?.name) };
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

function assertMetaAppConfig(appConfig = {}) {
	if (!getMetaAppId(appConfig) || !getMetaAppSecret(appConfig)) {
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
			? `Meta rechazó la conexión por permisos al ${operationLabel || 'completar la operación'}: ${message}. Revisá que el token tenga whatsapp_business_management y whatsapp_business_messaging y que su usuario del sistema tenga acceso a esta WABA.`
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
			params,
			headers: { Authorization: `Bearer ${accessToken}` },
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
			params,
			headers: { Authorization: `Bearer ${accessToken}` },
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

export function getScopesFromDebugToken(debugToken = {}) {
	const scopes = Array.isArray(debugToken?.data?.scopes) ? debugToken.data.scopes : [];
	const granularScopes = Array.isArray(debugToken?.data?.granular_scopes)
		? debugToken.data.granular_scopes.map((item) => item?.scope)
		: [];
	return uniqueNormalizedStrings([...scopes, ...granularScopes]);
}

export function getMissingWhatsAppScopes(scopes = []) {
	const normalizedScopes = uniqueNormalizedStrings(scopes);
	return REQUIRED_EMBEDDED_SIGNUP_SCOPES.filter((scope) => !normalizedScopes.includes(scope));
}

async function validateMessagingPermission(accessToken, appConfig = {}) {
	const hasAppCredentials = Boolean(getMetaAppId(appConfig) && getMetaAppSecret(appConfig));
	if (!hasAppCredentials) return { checked: false, missingScopes: [] };

	const debugToken = await debugAccessToken(accessToken, appConfig);
	if (debugToken?.data?.is_valid === false) {
		const error = new Error('Meta informa que el token no es válido o ya venció.');
		error.status = 401;
		error.metaCode = 190;
		error.code = 'WHATSAPP_TOKEN_INVALID';
		throw error;
	}

	const scopes = getScopesFromDebugToken(debugToken);
	const missingScopes = getMissingWhatsAppScopes(scopes);
	const tokenAppId = normalizeString(debugToken?.data?.app_id);
	if (tokenAppId && tokenAppId !== getMetaAppId(appConfig)) {
		const error = new Error('El token fue generado para otra App de Meta. Genera un token de usuario del sistema seleccionando la App registrada para esta marca.');
		error.status = 403;
		error.code = 'WHATSAPP_TOKEN_APP_MISMATCH';
		throw error;
	}
	if (scopes.length && missingScopes.includes('whatsapp_business_messaging')) {
		const error = new Error('El token puede leer la cuenta, pero no tiene el permiso whatsapp_business_messaging para enviar mensajes.');
		error.status = 403;
		error.metaCode = 200;
		error.code = 'WHATSAPP_MESSAGING_PERMISSION_MISSING';
		throw error;
	}
	if (scopes.length && missingScopes.includes('whatsapp_business_management')) {
		const error = new Error('Al token le falta whatsapp_business_management para leer la WABA y suscribir sus webhooks.');
		error.status = 403;
		error.code = 'WHATSAPP_MANAGEMENT_PERMISSION_MISSING';
		throw error;
	}

	return {
		checked: scopes.length > 0,
		missingScopes,
		appId: tokenAppId || null,
		tokenType: normalizeString(debugToken?.data?.type) || null,
		expiresAt: Number(debugToken?.data?.expires_at) || null,
	};
}

export async function getWhatsAppWabaSubscription({ wabaId, accessToken, metaAppId, graphVersion }) {
	const result = await graphGet(`/${normalizeString(wabaId)}/subscribed_apps`, {
		accessToken,
		graphVersion,
		operation: 'list_subscribed_apps',
	});
	const apps = Array.isArray(result?.data) ? result.data : [];
	return {
		checked: true,
		subscribed: apps.some((app) => normalizeString(app?.id || app?.app_id) === normalizeString(metaAppId)),
	};
}

export async function subscribeWhatsAppWaba({ wabaId, accessToken, graphVersion }) {
	const result = await graphPost(`/${normalizeString(wabaId)}/subscribed_apps`, {
		accessToken,
		graphVersion,
		operation: 'subscribe_waba_webhooks',
	});
	if (result?.success !== true && result?.success !== 'true') {
		const error = new Error('Meta no confirmó la suscripción de la App a los webhooks de la WABA.');
		error.status = 502;
		throw error;
	}
	return { success: true };
}

function warnAboutEmbeddedSignupScopes(debugToken = {}) {
	if (!debugToken?.data || debugToken.data.is_valid === false) return;

	const scopes = getScopesFromDebugToken(debugToken);
	if (!scopes.length) return;

	const missingScopes = REQUIRED_EMBEDDED_SIGNUP_SCOPES.filter((scope) => !scopes.includes(scope));
	if (!missingScopes.length) return;

	logger.warn('whatsapp.embedded_signup.missing_expected_scopes', {
		missingScopes,
		receivedScopes: scopes,
	});
}

async function exchangeCodeForAccessToken(code, { redirectUri = '', appConfig = {} } = {}) {
	assertMetaAppConfig(appConfig);

	const baseParams = {
		client_id: getMetaAppId(appConfig),
		client_secret: getMetaAppSecret(appConfig),
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

async function debugAccessToken(accessToken, appConfig = {}) {
	const appAccessToken = `${getMetaAppId(appConfig)}|${getMetaAppSecret(appConfig)}`;
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
				fields: 'id,display_phone_number,verified_name,code_verification_status,quality_rating,whatsapp_business_account{id,name}',
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

async function listPhoneNumbersForWaba({ wabaId, accessToken, graphVersion }) {
	const phoneNumbers = await graphGet(`/${wabaId}/phone_numbers`, {
		accessToken,
		graphVersion,
		operation: 'list_phone_numbers',
		params: {
			fields: 'id,display_phone_number,verified_name,code_verification_status,quality_rating',
			limit: 200,
		},
	});

	return Array.isArray(phoneNumbers?.data) ? phoneNumbers.data : [];
}

export async function discoverWhatsAppManualAssets({ accessToken, businessManagerId = '', graphVersion, appConfig = {} }) {
	const cleanAccessToken = normalizeString(accessToken);
	const cleanBusinessManagerId = normalizeString(businessManagerId);
	if (!cleanAccessToken) {
		const error = new Error('Ingresá un token de usuario del sistema para buscar cuentas y números.');
		error.status = 400;
		throw error;
	}
	if (cleanBusinessManagerId && !/^\d+$/.test(cleanBusinessManagerId)) {
		const error = new Error('El ID del negocio debe ser numérico.');
		error.status = 400;
		throw error;
	}

	const messagingPermissionCheck = await validateMessagingPermission(cleanAccessToken, appConfig);
	if (!messagingPermissionCheck.checked) {
		const error = new Error('Meta no confirmó los permisos del token para esta App.');
		error.status = 400;
		throw error;
	}
	const debugToken = await debugAccessToken(cleanAccessToken, appConfig);
	const wabaIds = getWabaIdsFromDebugToken(debugToken);
	const wabasById = new Map();
	const discoveryErrors = [];

	if (cleanBusinessManagerId) {
		for (const [edge, operation] of [
			['owned_whatsapp_business_accounts', 'list_owned_wabas'],
			['client_whatsapp_business_accounts', 'list_shared_wabas'],
		]) {
			try {
				const result = await graphGet(`/${cleanBusinessManagerId}/${edge}`, {
					accessToken: cleanAccessToken,
					graphVersion,
					operation,
					params: { fields: 'id,name', limit: 100 },
				});
				for (const item of result?.data || []) {
					const id = normalizeString(item?.id);
					if (id) wabasById.set(id, { id, name: normalizeString(item?.name) || id });
				}
			} catch (error) {
				discoveryErrors.push(error.message);
			}
		}
	}
	for (const id of wabaIds) {
		if (!wabasById.has(id)) wabasById.set(id, { id, name: id });
	}
	if (!wabasById.size) {
		const error = new Error(discoveryErrors[0] || 'Meta no mostró WABAs para este token y negocio. Revisá la asignación del usuario del sistema.');
		error.status = 400;
		throw error;
	}

	const wabas = [];
	for (const waba of wabasById.values()) {
		try {
			const phoneNumbers = await listPhoneNumbersForWaba({
				wabaId: waba.id,
				accessToken: cleanAccessToken,
				graphVersion,
			});
			wabas.push({
				...waba,
				phoneNumbers: phoneNumbers.map((phone) => ({
					id: normalizeString(phone?.id),
					displayPhoneNumber: normalizeString(phone?.display_phone_number),
					verifiedName: normalizeString(phone?.verified_name),
					codeVerificationStatus: normalizeString(phone?.code_verification_status),
				})).filter((phone) => phone.id),
			});
		} catch (error) {
			discoveryErrors.push(`${waba.name}: ${error.message}`);
			wabas.push({ ...waba, phoneNumbers: [] });
		}
	}
	return { wabas, messagingPermissionCheck, warnings: discoveryErrors };
}

export async function validateWhatsAppChannelAccess({
	wabaId,
	phoneNumberId,
	accessToken,
	graphVersion = getEmbeddedSignupGraphVersion(),
	appConfig = {},
}) {
	const cleanWabaId = normalizeString(wabaId);
	const cleanPhoneNumberId = normalizeString(phoneNumberId);
	const cleanAccessToken = normalizeString(accessToken);

	if (!cleanWabaId || !cleanPhoneNumberId || !cleanAccessToken) {
		const error = new Error('wabaId, phoneNumberId y accessToken son obligatorios.');
		error.status = 400;
		throw error;
	}
	const messagingPermissionCheck = await validateMessagingPermission(cleanAccessToken, appConfig);

	let waba = null;

	try {
		waba = await graphGet(`/${cleanWabaId}`, {
			accessToken: cleanAccessToken,
			graphVersion,
			operation: 'validate_manual_waba',
			params: {
				fields: 'id,name,account_review_status',
			},
		});
	} catch (error) {
		// Access to the phone_numbers edge is the authoritative ownership check below.
	}

	const phoneNumbers = await listPhoneNumbersForWaba({
		wabaId: cleanWabaId,
		accessToken: cleanAccessToken,
		graphVersion,
	});
	const matchingPhoneNumber =
		phoneNumbers.find((item) => normalizeString(item?.id) === cleanPhoneNumberId) || null;
	if (!matchingPhoneNumber) {
		const error = new Error('El Phone Number ID no aparece entre los números de esa WABA. Revisá que no sea el número de prueba ni pertenezca a otro negocio.');
		error.status = 400;
		throw error;
	}
	return {
		waba: waba || { id: cleanWabaId },
		phoneNumber: matchingPhoneNumber,
		messagingPermissionCheck,
	};
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
	appConfig = {},
}) {
	const cleanCode = normalizeString(code);
	if (!cleanCode) {
		const error = new Error('Falta el codigo de autorizacion de Meta.');
		error.status = 400;
		throw error;
	}

	const graphVersion = normalizeString(appConfig.graphVersion) || getEmbeddedSignupGraphVersion();
	const tokenResponse = await exchangeCodeForAccessToken(cleanCode, { redirectUri, appConfig });
	const accessToken = normalizeString(tokenResponse.access_token);
	const debugToken = await debugAccessToken(accessToken, appConfig).catch((error) => {
		logger.warn('whatsapp.embedded_signup.debug_token_failed', {
			error: error?.message || String(error),
		});
		return null;
	});
	warnAboutEmbeddedSignupScopes(debugToken);

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
