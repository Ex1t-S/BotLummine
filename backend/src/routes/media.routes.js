import { Router } from 'express';
import multer from 'multer';
import {
	serveInboxMediaController,
	serveBrandLogoController,
	uploadBrandLogoController,
	uploadCampaignHeaderMediaController
} from '../controllers/media.controller.js';
import { attachUser, requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

const CAMPAIGN_HEADER_ALLOWED_MIME_TYPES = new Set([
	'image/jpeg',
	'image/jpg',
	'image/png',
	'video/mp4',
	'application/pdf',
]);
const campaignHeaderMediaMaxBytes = Math.max(
	1024 * 1024,
	Math.min(Number(process.env.CAMPAIGN_HEADER_MEDIA_MAX_BYTES || 25 * 1024 * 1024), 100 * 1024 * 1024)
);

const upload = multer({
	dest: 'tmp/',
	limits: {
		fileSize: campaignHeaderMediaMaxBytes
	},
	fileFilter(_req, file, callback) {
		const mimeType = String(file.mimetype || '').toLowerCase();
		if (CAMPAIGN_HEADER_ALLOWED_MIME_TYPES.has(mimeType)) {
			return callback(null, true);
		}

		return callback(new Error('El header de campaña tiene que ser JPG, PNG, MP4 o PDF.'));
	},
});

const uploadBrandLogo = multer({
	dest: 'tmp/',
	limits: {
		fileSize: 5 * 1024 * 1024
	},
	fileFilter(_req, file, callback) {
		if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype || '')) {
			return callback(null, true);
		}

		return callback(new Error('El logo tiene que ser una imagen PNG, JPG, WebP o GIF.'));
	}
});

router.get('/inbox/:fileName', requireAuth, serveInboxMediaController);
router.get('/brand-logo/:fileName', serveBrandLogoController);

router.post(
	'/brand-logo',
	attachUser,
	requireAdmin,
	uploadBrandLogo.single('file'),
	uploadBrandLogoController
);

router.post(
	'/campaign-header-media',
	attachUser,
	requireAdmin,
	upload.single('file'),
	uploadCampaignHeaderMediaController
);

router.post(
	'/campaign-header-image',
	attachUser,
	requireAdmin,
	upload.single('file'),
	uploadCampaignHeaderMediaController
);

export default router;
