import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  startTiendanubeInstall,
  handleTiendanubeCallback,
  registerTiendanubeWebhooks,
  getTiendanubeStatus
} from '../controllers/tiendanube.controller.js';

const router = Router();

router.get('/callback', handleTiendanubeCallback);

router.get('/install', requireAuth, startTiendanubeInstall);
router.get('/status', requireAuth, getTiendanubeStatus);
router.post('/webhooks/register', registerTiendanubeWebhooks);

export default router;
