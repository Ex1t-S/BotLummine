import express from 'express';
import {
	getWhatsAppMenu,
	restoreDefaultWhatsAppMenu,
	updateWhatsAppMenu
} from '../controllers/whatsapp-menu.controller.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAdmin);
router.get('/', getWhatsAppMenu);
router.put('/', updateWhatsAppMenu);
router.post('/reset', restoreDefaultWhatsAppMenu);

export default router;
