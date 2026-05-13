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

const upload = multer({
	dest: 'tmp/',
	limits: {
		fileSize: 100 * 1024 * 1024
	}
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
