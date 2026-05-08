import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../lib/prisma.js';
import {
	uploadWhatsAppMedia,
	resolveInboxMediaAbsolutePath,
	getWhatsAppMediaMetadata,
	downloadWhatsAppMediaBuffer
} from '../services/whatsapp/whatsapp-media.service.js';
import { requireRequestWorkspaceId } from '../services/workspaces/workspace-context.service.js';

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
			workspaceId: true,
			attachmentMimeType: true,
			attachmentName: true,
			rawPayload: true
		},
		orderBy: {
			createdAt: 'desc'
		}
	});
}

async function tryRestoreMissingInboxMedia(fileName, workspaceId) {
	const safeFileName = String(fileName || '').trim();
	if (!safeFileName) return false;

	const message = await findInboxMediaMessage(safeFileName, workspaceId);

	if (!message) return false;

	const attachmentId =
		message?.rawPayload?.attachment?.id ||
		null;

	if (!attachmentId) return false;

	const metadata = await getWhatsAppMediaMetadata({
		workspaceId: message.workspaceId,
		attachmentId,
		mimeType: message.attachmentMimeType || ''
	});

	const buffer = await downloadWhatsAppMediaBuffer(metadata.url, { workspaceId: message.workspaceId });
	const absolutePath = resolveInboxMediaAbsolutePath(safeFileName);

	await fs.mkdir(path.dirname(absolutePath), { recursive: true });
	await fs.writeFile(absolutePath, buffer);

	return true;
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

		const absolutePath = resolveInboxMediaAbsolutePath(fileName);
		let stats = await fs.stat(absolutePath).catch(() => null);

		if (!stats || !stats.isFile()) {
			const restored = await tryRestoreMissingInboxMedia(fileName, workspaceId).catch((error) => {
				console.error('[MEDIA][RESTORE ERROR]', fileName, error?.message || error);
				return false;
			});

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

		const inferredMimeType =
			message.attachmentMimeType ||
			(message?.rawPayload?.attachment?.type === 'sticker' ? 'image/webp' : '');

		res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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

	console.log('[MEDIA][UPLOAD] user:', req.user?.id || null);

	if (!req.user) {
		return res.status(401).json({ ok: false, error: 'No autenticado' });
	}

	if (!file) {
		return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo de media.' });
	}

	try {
		const result = await uploadWhatsAppMedia({
			workspaceId: requireRequestWorkspaceId(req),
			filePath: file.path,
			fileName: file.originalname || file.filename || 'header-image',
			mimeType: file.mimetype,
			generateHeaderHandle
		});

		if (!result.ok) {
			console.log('[MEDIA][UPLOAD][ERROR]', JSON.stringify(result.error, null, 2));

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
		console.log('[MEDIA][UPLOAD][EXCEPTION]', error.message);

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
