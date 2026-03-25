import { Router } from 'express';
import { attachUser, requireAuth } from '../middleware/auth.js';
import {
  startTiendanubeInstall,
  handleTiendanubeCallback,
  registerTiendanubeWebhooks,
  getTiendanubeStatus
} from '../controllers/tiendanube.controller.js';

const router = Router();

router.get('/callback', handleTiendanubeCallback);

router.use(attachUser, requireAuth);
router.get('/install', startTiendanubeInstall);
router.get('/status', getTiendanubeStatus);
router.post('/webhooks/register', registerTiendanubeWebhooks);

export default router;
