import express from 'express';
import {
	getWhatsAppMenu,
	restoreDefaultWhatsAppMenu,
	updateWhatsAppMenu
} from '../controllers/whatsapp-menu.controller.js';

const router = express.Router();

function requireAuthenticatedUser(req, res, next) {
	if (!req.user) {
		return res.status(401).json({
			ok: false,
			error: 'Necesitás iniciar sesión para editar el menú de WhatsApp.'
		});
	}

	return next();
}

router.use(requireAuthenticatedUser);
router.get('/', getWhatsAppMenu);
router.put('/', updateWhatsAppMenu);
router.post('/reset', restoreDefaultWhatsAppMenu);

export default router;
