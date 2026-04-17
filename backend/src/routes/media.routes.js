import { Router } from 'express';
import multer from 'multer';
import {
	serveInboxMediaController,
	uploadCampaignHeaderImageController
} from '../controllers/media.controller.js';
import { attachUser, requireAdmin } from '../middleware/auth.js';

const router = Router();

const upload = multer({
	dest: 'tmp/',
	limits: {
		fileSize: 10 * 1024 * 1024
	}
});

router.get('/inbox/:fileName', serveInboxMediaController);

router.post(
	'/campaign-header-image',
	attachUser,
	requireAdmin,
	upload.fields([
		{ name: 'image', maxCount: 1 },
		{ name: 'media', maxCount: 1 },
		{ name: 'video', maxCount: 1 }
	]),
	uploadCampaignHeaderImageController
);

export default router;
