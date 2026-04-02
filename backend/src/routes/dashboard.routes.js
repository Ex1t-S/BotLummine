import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
	getInbox,
	getConversationMessagesJson,
	postConversationMessage,
	patchConversationQueue,
	patchConversationResetContext,
	deleteConversationHistory,
	getCatalog,
	postSyncCatalog,
	patchConversationArchive,
	postDeduplicateInboxContacts,
} from '../controllers/dashboard.controller.js';
import {
	getAbandonedCarts,
	postSyncAbandonedCarts,
	postSendAbandonedCartMessage,
} from '../controllers/abandoned-cart.controller.js';
import {
	getCustomers,
	postSyncCustomers,
} from '../controllers/customer.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/inbox', getInbox);
router.get('/conversations/:conversationId/messages', getConversationMessagesJson);
router.post('/conversations/:conversationId/messages', postConversationMessage);
router.patch('/conversations/:conversationId/queue', patchConversationQueue);
router.patch('/conversations/:conversationId/reset-context', patchConversationResetContext);
router.delete('/conversations/:conversationId/history', deleteConversationHistory);
router.patch('/conversations/:conversationId/archive', patchConversationArchive);
router.post('/inbox/deduplicate', postDeduplicateInboxContacts);

router.get('/catalog', getCatalog);
router.post('/catalog/sync', postSyncCatalog);

router.get('/abandoned-carts', getAbandonedCarts);
router.post('/abandoned-carts/sync', postSyncAbandonedCarts);
router.post('/abandoned-carts/:id/message', postSendAbandonedCartMessage);

router.get('/customers', getCustomers);
router.post('/customers/sync', postSyncCustomers);

export default router;