import fs from 'node:fs/promises';
import { uploadWhatsAppMedia } from '../services/whatsapp-media.service.js';

export async function uploadCampaignHeaderImageController(req, res) {
	const file = req.file;

	console.log('[MEDIA][UPLOAD] cookie header:', req.headers.cookie);
	console.log('[MEDIA][UPLOAD] user:', req.user?.id || null);

	if (!req.user) {
		return res.status(401).json({ ok: false, error: 'No autenticado' });
	}

	if (!file) {
		return res.status(400).json({ ok: false, error: 'No se recibió ninguna imagen.' });
	}

	try {
		const result = await uploadWhatsAppMedia({
			filePath: file.path,
			fileName: file.originalname || file.filename || 'header-image',
			mimeType: file.mimetype
		});

		if (!result.ok) {
			console.log('[MEDIA][UPLOAD][ERROR]', JSON.stringify(result.error, null, 2));

			return res.status(400).json({
				ok: false,
				error: 'No se pudo subir la imagen a Meta.',
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
			warnings: Array.isArray(result.warnings) ? result.warnings : []
		});
	} catch (error) {
		console.log('[MEDIA][UPLOAD][EXCEPTION]', error.message);

		return res.status(500).json({
			ok: false,
			error: error.message || 'Error interno al subir la imagen.'
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
