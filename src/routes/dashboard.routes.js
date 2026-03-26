import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
	renderInbox,
	renderCampaigns,
	renderCatalog,
	getAiLab,
	postSimulateInbound,
	postManualReply,
	postToggleAi,
	postSendCampaign,
	postSyncCatalog,
	postMoveConversation,
  getConversationMessagesJson
} from '../controllers/dashboard.controller.js';
import {
	renderAbandonedCarts,
	postSyncAbandonedCarts,
	postSendAbandonedCartMessage
} from '../controllers/abandoned-cart.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/', renderInbox);
router.get('/inbox', renderInbox);
router.get('/conversations/:conversationId', renderInbox);
router.get('/api/conversations/:conversationId/messages', getConversationMessagesJson);
router.get('/campaigns', renderCampaigns);
router.post('/campaigns/send', postSendCampaign);

router.get('/catalog', renderCatalog);
router.post('/catalog/sync', postSyncCatalog);

router.get('/ai-lab', getAiLab);

router.post('/simulate-inbound', postSimulateInbound);
router.post('/conversations/:conversationId/reply', postManualReply);
router.post('/conversations/:conversationId/toggle-ai', postToggleAi);
router.post('/conversations/:conversationId/move', postMoveConversation);
router.get('/abandoned-carts', renderAbandonedCarts);
router.post('/abandoned-carts/sync', postSyncAbandonedCarts);
router.post('/abandoned-carts/:id/message', postSendAbandonedCartMessage);
export default router;