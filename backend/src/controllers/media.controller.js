import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { logger, fingerprint } from '../lib/logger.js';
import { applyPrivateMediaCachePolicy } from '../lib/http-cache-policy.js';
import {
	uploadWhatsAppMedia,
	resolveInboxMediaAbsolutePath,
	getWhatsAppMediaMetadata,
	downloadWhatsAppMediaBuffer,
	saveRecoveredInboxMediaBuffer,
} from '../services/whatsapp/whatsapp-media.service.js';
import {
	getPrivateObject,
	isR2StorageEnabled,
	putPublicObject,
} from '../services/storage/r2-storage.service.js';
import {
	isPlatformAdmin,
	requireRequestWorkspaceId
} from '../services/workspaces/workspace-context.service.js';

const BRAND_LOGO_DIR = path.resolve(process.env.BRAND_LOGO_DIR || 'storage/brand-logos');
const BRAND_LOGO_PUBLIC_PREFIX = '/api/media/brand-logo';

function sanitizeFileStem(value = '', fallback = 'brand-logo') {
	const clean = String(value || '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);

	return clean || fallback;
}

function getLogoExtension(file = {}) {
	const originalExtension = path.extname(file.originalname || '').toLowerCase();
	if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(originalExtension)) {
		return originalExtension;
	}

	const mimeMap = {
		'image/png': '.png',
		'image/jpeg': '.jpg',
		'image/webp': '.webp',
		'image/gif': '.gif',
	};

	return mimeMap[file.mimetype] || '.png';
}

function buildBrandLogoUrl(fileName = '') {
	return `${BRAND_LOGO_PUBLIC_PREFIX}/${encodeURIComponent(path.basename(fileName))}`;
}

async function findInboxMediaMessage(fileName, workspaceId) {
	const safeFileName = String(fileName || '').trim();
	if (!safeFileName || !workspaceId) return null;

	return prisma.message.findFirst({
		where: {
			workspaceId,
			attachmentUrl: {
				contains: safeFileName
			}
		},
		select: {
			id: true,
			workspaceId: true,
			attachmentMimeType: true,
			attachmentName: true,
			attachmentStatus: true,
			attachmentStorageKey: true,
			attachmentSha256: true,
			rawPayload: true
		},
		orderBy: {
			createdAt: 'desc'
		}
	});
}

function getInboxMediaPhoneNumberId(rawPayload = null) {
	const direct = String(rawPayload?.attachment?.phoneNumberId || '').trim();
	if (direct) return direct;

	const entries = Array.isArray(rawPayload?.webhook?.entry) ? rawPayload.webhook.entry : [];
	for (const entry of entries) {
		const changes = Array.isArray(entry?.changes) ? entry.changes : [];
		for (const change of changes) {
			const value = change?.value || {};
			const phoneNumberId = String(
				value?.metadata?.phone_number_id ||
					value?.metadata?.phoneNumberId ||
					''
			).trim();

			if (phoneNumberId) return phoneNumberId;
		}
	}

	return '';
}

function resolveInboxMediaMimeType(message = {}) {
	const storedMimeType = String(message.attachmentMimeType || '').trim().toLowerCase();
	if (storedMimeType) return storedMimeType.split(';')[0].trim();

	const attachmentType = String(message?.rawPayload?.attachment?.type || '').trim().toLowerCase();
	if (attachmentType === 'sticker') return 'image/webp';
	if (attachmentType === 'audio') return 'audio/ogg';

	return '';
}

async function tryRestoreMissingInboxMedia(fileName, workspaceId) {
	const safeFileName = String(fileName || '').trim();
	if (!safeFileName) return false;

	const message = await findInboxMediaMessage(safeFileName, workspaceId);

	if (!message) return false;
	if (!['PENDING', 'DOWNLOAD_FAILED'].includes(message.attachmentStatus)) return false;

	const attachmentId =
		message?.rawPayload?.attachment?.id ||
		null;

	if (!attachmentId) return false;
	const phoneNumberId = getInboxMediaPhoneNumberId(message.rawPayload);

	const metadata = await getWhatsAppMediaMetadata({
		workspaceId: message.workspaceId,
		attachmentId,
		mimeType: message.attachmentMimeType || '',
		phoneNumberId
	});

	const buffer = await downloadWhatsAppMediaBuffer(metadata.url, {
		workspaceId: message.workspaceId,
		phoneNumberId
	});
	const persisted = await saveRecoveredInboxMediaBuffer({
		workspaceId,
		buffer,
		fileName: safeFileName,
		mimeType: metadata.mimeType || resolveInboxMediaMimeType(message),
		sha256: metadata.sha256 || message.attachmentSha256 || '',
	});

	await prisma.message.update({
		where: { id: message.id },
		data: {
			attachmentStatus: 'AVAILABLE',
			attachmentStorageKey: persisted.storageKey,
			attachmentSha256: metadata.sha256 || message.attachmentSha256 || null,
		},
	});

	return persisted;
}

function isMissingR2Object(error) {
	return ['NoSuchKey', 'NotFound'].includes(String(error?.name || error?.Code || '')) ||
		Number(error?.$metadata?.httpStatusCode || 0) === 404;
}

async function tryServePrivateR2Object(message, res) {
	if (!isR2StorageEnabled() || !message?.attachmentStorageKey) return false;

	let object;
	try {
		object = await getPrivateObject(message.attachmentStorageKey);
	} catch (error) {
		if (isMissingR2Object(error)) return false;
		throw error;
	}

	applyPrivateMediaCachePolicy(res);
	const mimeType = String(object.ContentType || resolveInboxMediaMimeType(message) || '').trim();
	if (mimeType) res.type(mimeType);
	if (Number.isFinite(Number(object.ContentLength))) {
		res.setHeader('Content-Length', String(object.ContentLength));
	}

	if (typeof object.Body?.pipe === 'function') {
		object.Body.on('error', (error) => res.destroy(error));
		object.Body.pipe(res);
		return true;
	}

	if (typeof object.Body?.transformToByteArray === 'function') {
		const bytes = await object.Body.transformToByteArray();
		res.send(Buffer.from(bytes));
		return true;
	}

	return false;
}

export async function serveInboxMediaController(req, res) {
	const fileName = String(req.params?.fileName || '').trim();

	if (!fileName) {
		return res.status(400).json({
			ok: false,
			error: 'Nombre de archivo inválido.'
		});
	}

	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const message = await findInboxMediaMessage(fileName, workspaceId);

		if (!message) {
			return res.status(404).json({
				ok: false,
				error: 'Archivo no encontrado para este workspace.'
			});
		}

		if (await tryServePrivateR2Object(message, res)) {
			return;
		}

		const absolutePath = resolveInboxMediaAbsolutePath(fileName);
		let stats = await fs.stat(absolutePath).catch(() => null);

		if (!stats || !stats.isFile()) {
			if (message.attachmentStatus === 'UNRECOVERABLE') {
				return res.status(410).json({
					ok: false,
					error: 'Este archivo histórico ya no está disponible en el workspace actual.',
					attachmentStatus: 'UNRECOVERABLE',
				});
			}

			const restored = await tryRestoreMissingInboxMedia(fileName, workspaceId).catch((error) => {
				logger.warn('media.restore_failed', {
					workspaceId,
					fileNameFingerprint: fingerprint(fileName),
					error,
				});
				return false;
			});

			if (restored?.storageKey && await tryServePrivateR2Object({
				...message,
				attachmentStorageKey: restored.storageKey,
			}, res)) {
				return;
			}

			if (restored) {
				stats = await fs.stat(absolutePath).catch(() => null);
			}
		}

		if (!stats || !stats.isFile()) {
			return res.status(404).json({
				ok: false,
				error: 'Archivo no encontrado.'
			});
		}

		const inferredMimeType = resolveInboxMediaMimeType(message);

		applyPrivateMediaCachePolicy(res);
		if (inferredMimeType) {
			res.type(inferredMimeType);
		}
		return res.sendFile(absolutePath);
	} catch (error) {
		return res.status(400).json({
			ok: false,
			error: error.message || 'No se pudo servir el archivo.'
		});
	}
}

export async function uploadCampaignHeaderMediaController(req, res) {
	const file = req.file || req.files?.file?.[0] || req.files?.media?.[0] || req.files?.image?.[0] || req.files?.video?.[0] || null;
	const purpose = String(req.body?.purpose || '').trim().toLowerCase();
	const generateHeaderHandle = purpose === 'template_header';

	if (!req.user) {
		return res.status(401).json({ ok: false, error: 'No autenticado' });
	}

	if (!file) {
		return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo de media.' });
	}

	try {
		const workspaceId = requireRequestWorkspaceId(req);
		const result = await uploadWhatsAppMedia({
			workspaceId,
			filePath: file.path,
			fileName: file.originalname || file.filename || 'header-image',
			mimeType: file.mimetype,
			generateHeaderHandle
		});

		if (!result.ok) {
			logger.warn('media.upload_failed', {
				workspaceId,
				userId: req.user?.id || null,
				fileNameFingerprint: fingerprint(file.originalname || file.filename || ''),
				mimeType: file.mimetype || null,
				fileSize: file.size || null,
				error: result.error || null,
			});

			return res.status(400).json({
				ok: false,
				error: 'No se pudo subir el media a Meta.',
				details: result.error || null
			});
		}

		return res.json({
			ok: true,
			mediaId: result.mediaId || null,
			headerHandle: result.headerHandle || null,
			fileName: result.fileName || file.originalname || null,
			mimeType: result.mimeType || file.mimetype || null,
			fileSize: result.fileSize || null,
			purpose: purpose || null,
			warnings: Array.isArray(result.warnings) ? result.warnings : []
		});
	} catch (error) {
		logger.error('media.upload_exception', {
			workspaceId: req.user?.workspaceId || null,
			userId: req.user?.id || null,
			fileNameFingerprint: fingerprint(file?.originalname || file?.filename || ''),
			mimeType: file?.mimetype || null,
			fileSize: file?.size || null,
			error,
		});

		return res.status(500).json({
			ok: false,
			error: error.message || 'Error interno al subir el media.'
		});
	} finally {
		try {
			if (file?.path) {
				await fs.unlink(file.path);
			}
		} catch {
			// ignore
		}
	}
}

export const uploadCampaignHeaderImageController = uploadCampaignHeaderMediaController;

export async function uploadBrandLogoController(req, res) {
	const file = req.file || null;

	if (!req.user) {
		return res.status(401).json({ ok: false, error: 'No autenticado' });
	}

	if (isPlatformAdmin(req.user)) {
		return res.status(403).json({
			ok: false,
			error: 'Solo el admin de la marca puede cambiar el logo manualmente.'
		});
	}

	if (!file) {
		return res.status(400).json({ ok: false, error: 'No se recibió ninguna imagen.' });
	}

	try {
		const workspaceId = requireRequestWorkspaceId(req, { allowDefaultForPlatformAdmin: false });
		const extension = getLogoExtension(file);
		const stem = sanitizeFileStem(path.basename(file.originalname || 'brand-logo', path.extname(file.originalname || '')));
		const fileName = `${workspaceId}-${stem}-${crypto.randomUUID()}${extension}`;
		const absolutePath = path.join(BRAND_LOGO_DIR, fileName);
		let logoUrl = buildBrandLogoUrl(fileName);

		if (isR2StorageEnabled()) {
			const buffer = await fs.readFile(file.path);
			const stored = await putPublicObject({
				key: `branding/${workspaceId}/${fileName}`,
				body: buffer,
				contentType: file.mimetype || 'image/png',
				metadata: { workspaceid: workspaceId },
			});
			logoUrl = stored.url;
		} else {
			await fs.mkdir(BRAND_LOGO_DIR, { recursive: true });
			await fs.rename(file.path, absolutePath);
		}

		await prisma.workspaceBranding.upsert({
			where: { workspaceId },
			update: { logoUrl },
			create: { workspaceId, logoUrl },
		});

		return res.json({
			ok: true,
			logoUrl,
			fileName,
			mimeType: file.mimetype || null,
			fileSize: file.size || null
		});
	} catch (error) {
		return res.status(error.status || 500).json({
			ok: false,
			error: error.message || 'No se pudo guardar el logo.'
		});
	} finally {
		try {
			if (file?.path) {
				await fs.unlink(file.path);
			}
		} catch {
			// The file may have been moved into permanent storage.
		}
	}
}

export async function serveBrandLogoController(req, res) {
	const fileName = path.basename(String(req.params?.fileName || '').trim());

	if (!fileName) {
		return res.status(400).json({ ok: false, error: 'Nombre de archivo inválido.' });
	}

	try {
		const absolutePath = path.join(BRAND_LOGO_DIR, fileName);
		const stats = await fs.stat(absolutePath).catch(() => null);

		if (!stats || !stats.isFile()) {
			return res.status(404).json({ ok: false, error: 'Logo no encontrado.' });
		}

		res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
		return res.sendFile(absolutePath);
	} catch (error) {
		return res.status(500).json({
			ok: false,
			error: error.message || 'No se pudo servir el logo.'
		});
	}
}
