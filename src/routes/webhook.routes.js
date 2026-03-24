import { Router } from 'express';
import { verifyWhatsappWebhook, receiveWhatsappWebhook } from '../controllers/webhook.controller.js';

const router = Router();

router.get('/whatsapp', verifyWhatsappWebhook);
router.post('/whatsapp', receiveWhatsappWebhook);

export default router;
