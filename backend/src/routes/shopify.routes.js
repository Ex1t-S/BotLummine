import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
	getShopifyStatus,
	handleShopifyCallback,
	startShopifyInstall
} from '../controllers/shopify.controller.js';

const router = Router();

router.get('/callback', handleShopifyCallback);
router.get('/install', requireAuth, requireAdmin, startShopifyInstall);
router.get('/status', requireAuth, requireAdmin, getShopifyStatus);

export default router;
