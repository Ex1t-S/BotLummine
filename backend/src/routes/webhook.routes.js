import { Router } from 'express';
import {
	verifyWhatsappWebhook,
	receiveWhatsappWebhook,
	receiveTiendanubeOrderWebhook,
	receiveShopifyWebhook
} from '../controllers/webhook.controller.js';

const router = Router();

router.get('/whatsapp', verifyWhatsappWebhook);
router.post('/whatsapp', receiveWhatsappWebhook);
router.post('/tiendanube/orders', receiveTiendanubeOrderWebhook);
router.post('/shopify', receiveShopifyWebhook);

export default router;
