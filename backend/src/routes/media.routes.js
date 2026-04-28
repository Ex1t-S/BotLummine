import { Router } from 'express';
import multer from 'multer';
import {
	serveInboxMediaController,
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

router.get('/inbox/:fileName', requireAuth, serveInboxMediaController);

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
