import { Router } from 'express';
import { requireAuth, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import {
	getInbox,
	getInboxStream,
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
	postFullSyncCustomers,
	postRepairCustomers,
	postSyncCustomers,
	getCustomersSyncStatus,
} from '../controllers/customer.controller.js';

const router = Router();
const requireInboxAccess = requireAnyRole(['ADMIN', 'AGENT']);

router.use(requireAuth);

router.get('/inbox', requireInboxAccess, getInbox);
router.get('/inbox/stream', requireInboxAccess, getInboxStream);
router.get('/conversations/:conversationId/messages', requireInboxAccess, getConversationMessagesJson);
router.post('/conversations/:conversationId/messages', requireInboxAccess, postConversationMessage);
router.patch('/conversations/:conversationId/queue', requireInboxAccess, patchConversationQueue);
router.patch('/conversations/:conversationId/archive', requireInboxAccess, patchConversationArchive);

router.patch('/conversations/:conversationId/reset-context', requireAdmin, patchConversationResetContext);
router.delete('/conversations/:conversationId/history', requireAdmin, deleteConversationHistory);
router.post('/inbox/deduplicate', requireAdmin, postDeduplicateInboxContacts);

router.get('/catalog', requireAdmin, getCatalog);
router.post('/catalog/sync', requireAdmin, postSyncCatalog);

router.get('/abandoned-carts', requireAdmin, getAbandonedCarts);
router.post('/abandoned-carts/sync', requireAdmin, postSyncAbandonedCarts);
router.post('/abandoned-carts/:id/message', requireAdmin, postSendAbandonedCartMessage);

router.get('/customers', requireAdmin, getCustomers);
router.post('/customers/sync', requireAdmin, postSyncCustomers);
router.get('/customers/sync-status', requireAdmin, getCustomersSyncStatus);
router.post('/customers/sync-full', requireAdmin, postFullSyncCustomers);
router.post('/customers/repair', requireAdmin, postRepairCustomers);

export default router;
