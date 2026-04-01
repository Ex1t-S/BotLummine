import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
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

function getPhoneNumberId() {
	return normalizeString(process.env.WHATSAPP_PHONE_NUMBER_ID || '');
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

export async function uploadWhatsAppMedia({ filePath, fileName, mimeType }) {
	const accessToken = getAccessToken();
	const phoneNumberId = getPhoneNumberId();

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

		const mediaId = await uploadStandardWhatsAppMedia({
			phoneNumberId,
			fileName: resolvedFileName,
			mimeType: resolvedMimeType,
			buffer,
			accessToken
		});

		return {
			ok: true,
			mediaId,
			headerHandle: null,
			fileName: resolvedFileName,
			mimeType: resolvedMimeType,
			fileSize: stats.size,
			warnings: []
		};
	} catch (error) {
		return {
			ok: false,
			error: extractMetaError(error)
		};
	}
}

export async function getWhatsAppMediaMetadata({ attachmentId, mimeType = '' }) {
	const accessToken = getAccessToken();

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

export async function downloadWhatsAppMediaBuffer(downloadUrl) {
	const accessToken = getAccessToken();

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
		attachmentId: safeAttachmentId,
		mimeType: attachmentMimeType
	});

	const buffer = await downloadWhatsAppMediaBuffer(metadata.url);
	const storageDir = await ensureInboundMediaDir();

	const effectiveMimeType = normalizeString(
		attachmentMimeType || metadata.mimeType || 'application/octet-stream'
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