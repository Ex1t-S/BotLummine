import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import axios from 'axios';
import {
	DEFAULT_WORKSPACE_ID,
	getWhatsAppChannelForWorkspace,
	normalizeWorkspaceId
} from '../workspaces/workspace-context.service.js';

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

function getPhoneNumberId() {
	return normalizeString(process.env.WHATSAPP_PHONE_NUMBER_ID || '');
}

async function getMediaWorkspaceConfig(workspaceId = DEFAULT_WORKSPACE_ID) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const channel = await getWhatsAppChannelForWorkspace(resolvedWorkspaceId).catch(() => null);

	return {
		workspaceId: resolvedWorkspaceId,
		accessToken: normalizeString(channel?.accessToken || getAccessToken()),
		phoneNumberId: normalizeString(channel?.phoneNumberId || getPhoneNumberId()),
		graphVersion: normalizeString(channel?.graphVersion || getGraphVersion())
	};
}

function getMetaAppId() {
	return normalizeString(
		process.env.META_APP_ID ||
			process.env.FACEBOOK_APP_ID ||
			process.env.APP_ID ||
			''
	);
}

function canGenerateTemplateHeaderHandle(mimeType = '') {
	return [
		'image/jpeg',
		'image/jpg',
		'image/png',
		'video/mp4',
		'application/pdf'
	].includes(normalizeString(mimeType).toLowerCase());
}

function getBackendPublicBaseUrl() {
	const explicit =
		normalizeString(process.env.BACKEND_PUBLIC_URL) ||
		normalizeString(process.env.PUBLIC_BACKEND_URL) ||
		normalizeString(process.env.RENDER_EXTERNAL_URL) ||
		normalizeString(process.env.RAILWAY_STATIC_URL) ||
		(process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${normalizeString(process.env.RAILWAY_PUBLIC_DOMAIN)}` : '');

	return explicit.replace(/\/+$/, '');
}

function sanitizeFileName(value, fallback = 'file') {
	const normalized = normalizeString(value, fallback)
		.replace(/[\\/:*?"<>|]+/g, '-')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^\.+/, '')
		.replace(/^-+/, '')
		.trim();

	return normalized || fallback;
}

function getExtensionFromMimeType(mimeType = '', fallback = '.bin') {
	const normalized = normalizeString(mimeType).toLowerCase();

	const known = {
		'image/jpeg': '.jpg',
		'image/jpg': '.jpg',
		'image/png': '.png',
		'image/webp': '.webp',
		'image/gif': '.gif',
		'video/mp4': '.mp4',
		'video/3gpp': '.3gp',
		'audio/ogg': '.ogg',
		'audio/opus': '.opus',
		'audio/mpeg': '.mp3',
		'audio/mp3': '.mp3',
		'audio/aac': '.aac',
		'audio/amr': '.amr',
		'application/pdf': '.pdf',
		'text/plain': '.txt',
		'application/msword': '.doc',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
		'application/vnd.ms-excel': '.xls',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx'
	};

	if (known[normalized]) {
		return known[normalized];
	}

	return fallback;
}

function extractMetaError(error) {
	return {
		message:
			error?.response?.data?.error?.message ||
			error?.response?.data?.message ||
			error?.message ||
			'Error desconocido en Meta.',
		status: error?.response?.status || null,
		responseData: error?.response?.data || null
	};
}

function buildPublicInboxMediaUrl(fileName) {
	const safeFileName = encodeURIComponent(path.basename(String(fileName || '').trim()));
	const baseUrl = getBackendPublicBaseUrl();

	if (baseUrl) {
		return `${baseUrl}/api/media/inbox/${safeFileName}`;
	}

	return `/api/media/inbox/${safeFileName}`;
}

function resolveConfiguredStorageDir() {
	const configured = normalizeString(process.env.WHATSAPP_INBOUND_MEDIA_DIR || 'storage/inbox-media');

	if (path.isAbsolute(configured)) {
		return configured;
	}

	return path.resolve(process.cwd(), configured);
}

async function ensureInboundMediaDir() {
	const storageDir = resolveConfiguredStorageDir();
	await fs.mkdir(storageDir, { recursive: true });
	return storageDir;
}

function buildStoredInboundFileName({
	messageType = 'media',
	mimeType = '',
	preferredFileName = '',
	metaMessageId = ''
}) {
	const cleanPreferred = sanitizeFileName(preferredFileName || '');
	const preferredExt = cleanPreferred ? path.extname(cleanPreferred) : '';
	const mimeExt = getExtensionFromMimeType(mimeType, '');
	const finalExt = preferredExt || mimeExt || '.bin';

	const preferredBase = cleanPreferred ? path.basename(cleanPreferred, preferredExt) : '';
	const fallbackBase = sanitizeFileName(`${messageType || 'media'}-${metaMessageId || crypto.randomUUID()}`, 'media');
	const finalBase = sanitizeFileName(preferredBase || fallbackBase, 'media');

	return `${Date.now()}-${finalBase}-${crypto.randomUUID()}${finalExt}`;
}

function buildReadableAttachmentName({ messageType = 'media', mimeType = '', originalName = '' }) {
	const cleanOriginal = sanitizeFileName(originalName || '');

	if (cleanOriginal && cleanOriginal !== 'file') {
		return cleanOriginal;
	}

	const extension = getExtensionFromMimeType(mimeType, '.bin');
	const safeType = sanitizeFileName(messageType || 'media', 'media');

	return `${safeType}${extension}`;
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

async function createResumableUploadSession({
	appId,
	fileName,
	fileLength,
	fileType,
	accessToken
}) {
	const params = new URLSearchParams({
		file_name: fileName,
		file_length: String(Number(fileLength || 0)),
		file_type: fileType
	});

	const response = await fetch(`${getGraphBaseUrl()}/${appId}/uploads?${params.toString()}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`
		}
	});

	const data = await response.json().catch(() => null);

	if (!response.ok) {
		const error = new Error(
			data?.error?.message || data?.message || 'No se pudo crear la sesión de upload de Meta.'
		);

		error.response = {
			status: response.status,
			data
		};

		throw error;
	}

	const sessionId = normalizeString(data?.id || '');

	if (!sessionId) {
		const error = new Error('Meta no devolvió el id de la sesión de upload.');
		error.response = {
			status: response.status,
			data
		};
		throw error;
	}

	return sessionId;
}

async function uploadTemplateHeaderAsset({
	uploadSessionId,
	buffer,
	accessToken
}) {
	const response = await fetch(`${getGraphBaseUrl()}/${uploadSessionId}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			file_offset: '0',
			'Content-Type': 'application/octet-stream'
		},
		body: buffer
	});

	const data = await response.json().catch(() => null);

	if (!response.ok) {
		const error = new Error(
			data?.error?.message || data?.message || 'No se pudo subir el asset del header a Meta.'
		);

		error.response = {
			status: response.status,
			data
		};

		throw error;
	}

	const headerHandle = normalizeString(
		data?.h ||
			data?.header_handle ||
			data?.handle ||
			''
	);

	if (!headerHandle) {
		const error = new Error('Meta no devolvió header_handle para el asset del template.');
		error.response = {
			status: response.status,
			data
		};
		throw error;
	}

	return headerHandle;
}

export async function uploadWhatsAppMedia({
	workspaceId = DEFAULT_WORKSPACE_ID,
	filePath,
	fileName,
	mimeType,
	generateHeaderHandle = false
}) {
	const mediaConfig = await getMediaWorkspaceConfig(workspaceId);
	const accessToken = mediaConfig.accessToken;
	const phoneNumberId = mediaConfig.phoneNumberId;

	if (!accessToken) {
		return {
			ok: false,
			error: {
				message: 'Falta WHATSAPP_ACCESS_TOKEN o META_ACCESS_TOKEN.',
				status: null,
				responseData: null
			}
		};
	}

	if (!phoneNumberId) {
		return {
			ok: false,
			error: {
				message: 'Falta WHATSAPP_PHONE_NUMBER_ID.',
				status: null,
				responseData: null
			}
		};
	}

	try {
		const absolutePath = path.resolve(filePath);
		const [buffer, stats] = await Promise.all([fs.readFile(absolutePath), fs.stat(absolutePath)]);

		const resolvedFileName = sanitizeFileName(fileName || path.basename(absolutePath) || 'media');
		const resolvedMimeType = normalizeString(mimeType || 'application/octet-stream');
		const warnings = [];

		const mediaId = await uploadStandardWhatsAppMedia({
			phoneNumberId,
			fileName: resolvedFileName,
			mimeType: resolvedMimeType,
			buffer,
			accessToken
		});

		let headerHandle = null;

		if (generateHeaderHandle) {
			if (!canGenerateTemplateHeaderHandle(resolvedMimeType)) {
				return {
					ok: false,
					error: {
						message: `Tipo de archivo no soportado para header de template: ${resolvedMimeType}`,
						status: 400,
						responseData: {
							mimeType: resolvedMimeType
						}
					}
				};
			}

			const appId = getMetaAppId();

			if (!appId) {
				return {
					ok: false,
					error: {
						message: 'Falta META_APP_ID, FACEBOOK_APP_ID o APP_ID para generar header_handle de templates.',
						status: 400,
						responseData: null
					}
				};
			}

			const uploadSessionId = await createResumableUploadSession({
				appId,
				fileName: resolvedFileName,
				fileLength: stats.size,
				fileType: resolvedMimeType,
				accessToken
			});

			headerHandle = await uploadTemplateHeaderAsset({
				uploadSessionId,
				buffer,
				accessToken
			});
		} else if (canGenerateTemplateHeaderHandle(resolvedMimeType) && !getMetaAppId()) {
			warnings.push(
				'No se generó header_handle porque falta META_APP_ID/FACEBOOK_APP_ID/APP_ID. Para crear templates con media header, configurá esa variable.'
			);
		}

		return {
			ok: true,
			mediaId,
			headerHandle,
			fileName: resolvedFileName,
			mimeType: resolvedMimeType,
			fileSize: stats.size,
			warnings
		};
	} catch (error) {
		return {
			ok: false,
			error: extractMetaError(error)
		};
	}
}

export async function saveLocalInboxMediaCopy({
	filePath,
	fileName = '',
	mimeType = '',
	messageType = 'media',
	metaMessageId = ''
}) {
	const absolutePath = path.resolve(filePath);
	const [buffer, stats] = await Promise.all([fs.readFile(absolutePath), fs.stat(absolutePath)]);
	const storedFileName = buildStoredInboundFileName({
		messageType,
		mimeType,
		preferredFileName: fileName,
		metaMessageId
	});
	const storageDir = await ensureInboundMediaDir();
	const storedPath = path.join(storageDir, storedFileName);

	await fs.writeFile(storedPath, buffer);

	return {
		attachmentUrl: buildPublicInboxMediaUrl(storedFileName),
		storedFileName,
		attachmentMimeType: normalizeString(mimeType || 'application/octet-stream'),
		attachmentName: buildReadableAttachmentName({
			messageType,
			mimeType,
			originalName: fileName
		}),
		attachmentSize: stats.size
	};
}

export async function getWhatsAppMediaMetadata({
	workspaceId = DEFAULT_WORKSPACE_ID,
	attachmentId,
	mimeType = ''
}) {
	const mediaConfig = await getMediaWorkspaceConfig(workspaceId);
	const accessToken = mediaConfig.accessToken;

	if (!accessToken) {
		throw new Error('Falta WHATSAPP_ACCESS_TOKEN o META_ACCESS_TOKEN.');
	}

	const safeAttachmentId = normalizeString(attachmentId);

	if (!safeAttachmentId) {
		throw new Error('attachmentId inválido para consultar metadata de WhatsApp.');
	}

	const url = `${getGraphBaseUrl()}/${safeAttachmentId}`;

	const response = await axios.get(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`
		},
		timeout: 30_000
	});

	const data = response?.data || {};
	const downloadUrl = normalizeString(data.url || '');

	if (!downloadUrl) {
		throw new Error('Meta no devolvió la URL de descarga del media.');
	}

	return {
		attachmentId: normalizeString(data.id || safeAttachmentId),
		url: downloadUrl,
		mimeType: normalizeString(data.mime_type || mimeType || 'application/octet-stream'),
		sha256: normalizeString(data.sha256 || ''),
		fileSize: Number(data.file_size || 0) || null
	};
}

export async function downloadWhatsAppMediaBuffer(
	downloadUrl,
	{ workspaceId = DEFAULT_WORKSPACE_ID } = {}
) {
	const mediaConfig = await getMediaWorkspaceConfig(workspaceId);
	const accessToken = mediaConfig.accessToken;

	if (!accessToken) {
		throw new Error('Falta WHATSAPP_ACCESS_TOKEN o META_ACCESS_TOKEN.');
	}

	const url = normalizeString(downloadUrl);

	if (!url) {
		throw new Error('URL de descarga inválida para el media de WhatsApp.');
	}

	const response = await axios.get(url, {
		responseType: 'arraybuffer',
		headers: {
			Authorization: `Bearer ${accessToken}`
		},
		timeout: 60_000,
		maxContentLength: 100 * 1024 * 1024,
		maxBodyLength: 100 * 1024 * 1024
	});

	return Buffer.from(response.data);
}

export async function saveInboundWhatsAppMedia({
	workspaceId = DEFAULT_WORKSPACE_ID,
	attachmentId,
	attachmentMimeType = '',
	attachmentName = '',
	messageType = 'media',
	waId = '',
	metaMessageId = ''
}) {
	const safeAttachmentId = normalizeString(attachmentId);

	if (!safeAttachmentId) {
		return null;
	}

	const metadata = await getWhatsAppMediaMetadata({
		workspaceId,
		attachmentId: safeAttachmentId,
		mimeType: attachmentMimeType
	});

	const buffer = await downloadWhatsAppMediaBuffer(metadata.url, { workspaceId });
	const storageDir = await ensureInboundMediaDir();

	const effectiveMimeType = normalizeString(
		attachmentMimeType ||
			metadata.mimeType ||
			(String(messageType || '').toLowerCase() === 'sticker' ? 'image/webp' : '') ||
			'application/octet-stream'
	);

	const storedFileName = buildStoredInboundFileName({
		messageType,
		mimeType: effectiveMimeType,
		preferredFileName: attachmentName,
		metaMessageId
	});

	const absolutePath = path.join(storageDir, storedFileName);
	await fs.writeFile(absolutePath, buffer);

	return {
		attachmentId: safeAttachmentId,
		attachmentUrl: buildPublicInboxMediaUrl(storedFileName),
		attachmentMimeType: effectiveMimeType,
		attachmentName: buildReadableAttachmentName({
			messageType,
			mimeType: effectiveMimeType,
			originalName: attachmentName
		}),
		attachmentSha256: normalizeString(metadata.sha256 || ''),
		attachmentSize: metadata.fileSize || buffer.length,
		storedFileName,
		storedAbsolutePath: absolutePath,
		downloadSourceUrl: metadata.url,
		waId: normalizeString(waId || '')
	};
}

export function resolveInboxMediaAbsolutePath(fileName) {
	const rawName = String(fileName || '').trim();
	const safeName = path.basename(rawName);

	if (!rawName || safeName !== rawName) {
		throw new Error('Nombre de archivo inválido.');
	}

	return path.join(resolveConfiguredStorageDir(), safeName);
}
