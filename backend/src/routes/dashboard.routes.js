import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
	getInbox,
	getConversationMessagesJson,
	postConversationMessage,
	patchConversationQueue,
	getCatalog,
	postSyncCatalog
} from '../controllers/dashboard.controller.js';
import {
	getAbandonedCarts,
	postSyncAbandonedCarts,
	postSendAbandonedCartMessage
} from '../controllers/abandoned-cart.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/inbox', getInbox);
router.get('/conversations/:conversationId/messages', getConversationMessagesJson);
router.post('/conversations/:conversationId/messages', postConversationMessage);
router.patch('/conversations/:conversationId/queue', patchConversationQueue);

router.get('/catalog', getCatalog);
router.post('/catalog/sync', postSyncCatalog);

router.get('/abandoned-carts', getAbandonedCarts);
router.post('/abandoned-carts/sync', postSyncAbandonedCarts);
router.post('/abandoned-carts/:id/message', postSendAbandonedCartMessage);

export default router;