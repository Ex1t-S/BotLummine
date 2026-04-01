import fs from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';

function normalizeString(value, fallback = '') {
	const normalized = String(value ?? '').trim();
	return normalized || fallback;
}

function getAccessToken() {
	return normalizeString(process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || '');
}

function getGraphVersion() {
	return normalizeString(process.env.WHATSAPP_GRAPH_VERSION || 'v25.0');
}

function getGraphBaseUrl() {
	return `https://graph.facebook.com/${getGraphVersion()}`;
}

function getAppId() {
	return normalizeString(
		process.env.META_APP_ID ||
			process.env.FACEBOOK_APP_ID ||
			process.env.APP_ID ||
			process.env.WHATSAPP_APP_ID ||
			''
	);
}

function getPhoneNumberId() {
	return normalizeString(process.env.WHATSAPP_PHONE_NUMBER_ID || '');
}

function buildMetaError(error, context = 'meta_request_failed') {
	return {
		context,
		message:
			error?.response?.data?.error?.message ||
			error?.response?.data?.message ||
			error?.message ||
			'Error desconocido en Meta.',
		status: error?.response?.status || null,
		responseData: error?.response?.data || null
	};
}

async function createResumableUploadSession({ appId, fileName, fileLength, mimeType, accessToken }) {
	const url = `${getGraphBaseUrl()}/${appId}/uploads`;

	const response = await axios.post(url, null, {
		params: {
			file_name: fileName,
			file_length: String(fileLength),
			file_type: mimeType,
			access_token: accessToken
		},
		timeout: 30_000
	});

	const sessionId =
		normalizeString(response?.data?.id) ||
		normalizeString(response?.data?.upload_session_id) ||
		normalizeString(response?.data?.upload_session) ||
		'';

	if (!sessionId) {
		throw new Error('Meta no devolvió upload session id para el Resumable Upload API.');
	}

	return sessionId;
}

async function uploadBinaryToSession({ sessionId, buffer, accessToken }) {
	const url = `${getGraphBaseUrl()}/${sessionId}`;

	const response = await axios.post(url, buffer, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/octet-stream',
			file_offset: '0'
		},
		maxContentLength: Infinity,
		maxBodyLength: Infinity,
		timeout: 120_000
	});

	const headerHandle =
		normalizeString(response?.data?.h) ||
		normalizeString(response?.data?.header_handle) ||
		normalizeString(response?.data?.handle) ||
		'';

	if (!headerHandle) {
		throw new Error('Meta no devolvió header handle al subir el asset de ejemplo.');
	}

	return headerHandle;
}

async function uploadStandardWhatsAppMedia({ phoneNumberId, fileName, mimeType, buffer, accessToken }) {
	const url = `${getGraphBaseUrl()}/${phoneNumberId}/media`;
	const formData = new FormData();
	formData.append('messaging_product', 'whatsapp');
	formData.append('file', new Blob([buffer], { type: mimeType }), fileName);

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`
		},
		body: formData
	});

	const data = await response.json().catch(() => null);

	if (!response.ok) {
		const error = new Error(
			data?.error?.message || data?.message || 'No se pudo subir el media estándar a WhatsApp.'
		);
		error.response = {
			status: response.status,
			data
		};
		throw error;
	}

	return normalizeString(data?.id || data?.media_id || '');
}

export async function uploadWhatsAppMedia({ filePath, fileName, mimeType }) {
	const accessToken = getAccessToken();
	const appId = getAppId();
	const phoneNumberId = getPhoneNumberId();

	if (!accessToken) {
		return {
			ok: false,
			error: {
				message: 'Falta WHATSAPP_ACCESS_TOKEN en el backend.'
			}
		};
	}

	if (!filePath) {
		return {
			ok: false,
			error: {
				message: 'Falta filePath para subir el archivo a Meta.'
			}
		};
	}

	const resolvedMimeType = normalizeString(mimeType || 'application/octet-stream');
	const resolvedFileName = normalizeString(fileName || path.basename(filePath) || 'upload.bin');
	const warnings = [];

	try {
		const buffer = await fs.readFile(filePath);
		const stats = await fs.stat(filePath);

		let headerHandle = null;
		let mediaId = null;

		if (!appId) {
			warnings.push(
				'No se encontró META_APP_ID/FACEBOOK_APP_ID/APP_ID. No se pudo generar header_handle para templates IMAGE.'
			);
		} else {
			try {
				const sessionId = await createResumableUploadSession({
					appId,
					fileName: resolvedFileName,
					fileLength: stats.size,
					mimeType: resolvedMimeType,
					accessToken
				});

				headerHandle = await uploadBinaryToSession({
					sessionId,
					buffer,
					accessToken
				});
			} catch (error) {
				return {
					ok: false,
					error: buildMetaError(error, 'resumable_upload_failed')
				};
			}
		}

		if (!phoneNumberId) {
			warnings.push(
				'No se encontró WHATSAPP_PHONE_NUMBER_ID. No se pudo generar mediaId estándar para futuros envíos.'
			);
		} else {
			try {
				mediaId = await uploadStandardWhatsAppMedia({
					phoneNumberId,
					fileName: resolvedFileName,
					mimeType: resolvedMimeType,
					buffer,
					accessToken
				});
			} catch (error) {
				warnings.push(
					buildMetaError(error, 'standard_media_upload_failed')?.message ||
						'No se pudo subir el media estándar a WhatsApp.'
				);
			}
		}

		if (!headerHandle) {
			return {
				ok: false,
				error: {
					message:
						'La imagen se subió parcialmente, pero Meta no devolvió header_handle para templates IMAGE.',
					warnings
				}
			};
		}

		return {
			ok: true,
			headerHandle,
			mediaId: mediaId || null,
			fileName: resolvedFileName,
			mimeType: resolvedMimeType,
			fileSize: stats.size,
			warnings
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				message: error.message || 'Error interno al subir media a Meta.'
			}
		};
	}
}
