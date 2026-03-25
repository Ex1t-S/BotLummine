import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  renderInbox,
  renderCampaigns,
  getAiLab,
  postSimulateInbound,
  postManualReply,
  postToggleAi,
  postSendCampaign
} from '../controllers/dashboard.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/', renderInbox);
router.get('/inbox', renderInbox);
router.get('/conversations/:conversationId', renderInbox);
router.get('/campaigns', renderCampaigns);
router.get('/ai-lab', getAiLab);

router.post('/simulate-inbound', postSimulateInbound);
router.post('/conversations/:conversationId/reply', postManualReply);
router.post('/conversations/:conversationId/toggle-ai', postToggleAi);
router.post('/campaigns/send', postSendCampaign);

export default router;