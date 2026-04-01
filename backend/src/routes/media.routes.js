import { Router } from 'express';
import multer from 'multer';
import {
	serveInboxMediaController,
	uploadCampaignHeaderImageController
} from '../controllers/media.controller.js';
import { attachUser } from '../middleware/auth.js';

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
	(req, res, next) => {
		console.log('[MEDIA][UPLOAD] cookie header:', req.headers.cookie);
		console.log('[MEDIA][UPLOAD] user:', req.user?.id || null);
		next();
	},
	upload.single('image'),
	uploadCampaignHeaderImageController
);

export default router;