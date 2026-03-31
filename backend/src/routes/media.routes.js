import { Router } from 'express';
import multer from 'multer';
import { uploadCampaignHeaderImageController } from '../controllers/media.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

const upload = multer({
	dest: 'tmp/',
	limits: {
		fileSize: 10 * 1024 * 1024
	}
});

router.post(
	'/campaign-header-image',
	requireAuth,
	upload.single('image'),
	uploadCampaignHeaderImageController
);

export default router;