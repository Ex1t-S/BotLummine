import { Router } from 'express';
import { attachUser, requireAuth } from '../middleware/auth.js';
import { createCampaign, listCampaigns } from '../controllers/campaign.controller.js';

const router = Router();

router.use(attachUser, requireAuth);

router.get('/', listCampaigns);
router.post('/', createCampaign);

export default router;
