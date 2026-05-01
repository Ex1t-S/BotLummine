import { Router } from 'express';
import { requireAuth, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import {
	getInbox,
	getInboxStream,
	getSalesOpportunities,
	getConversationMessagesJson,
	postConversationMessage,
	patchConversationRead,
	patchConversationUnread,
	patchConversationQueue,
	patchConversationResetContext,
	deleteConversationHistory,
	getCatalog,
	postSyncCatalog,
	getEnboxSyncStatusJson,
	postRunEnboxSync,
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

router.get('/sales-opportunities', requireAnyRole(['ADMIN', 'AGENT']), getSalesOpportunities);
router.get('/inbox', requireInboxAccess, getInbox);
router.get('/inbox/stream', requireInboxAccess, getInboxStream);
router.get('/conversations/:conversationId/messages', requireInboxAccess, getConversationMessagesJson);
router.post('/conversations/:conversationId/messages', requireInboxAccess, postConversationMessage);
router.patch('/conversations/:conversationId/read', requireInboxAccess, patchConversationRead);
router.patch('/conversations/:conversationId/unread', requireInboxAccess, patchConversationUnread);
router.patch('/conversations/:conversationId/queue', requireInboxAccess, patchConversationQueue);
router.patch('/conversations/:conversationId/archive', requireInboxAccess, patchConversationArchive);

router.patch('/conversations/:conversationId/reset-context', requireAdmin, patchConversationResetContext);
router.delete('/conversations/:conversationId/history', requireAdmin, deleteConversationHistory);
router.post('/inbox/deduplicate', requireAdmin, postDeduplicateInboxContacts);

router.get('/catalog', requireAdmin, getCatalog);
router.post('/catalog/sync', requireAdmin, postSyncCatalog);
router.get('/enbox-sync/status', requireAdmin, getEnboxSyncStatusJson);
router.post('/enbox-sync/run', requireAdmin, postRunEnboxSync);

router.get('/abandoned-carts', requireAdmin, getAbandonedCarts);
router.post('/abandoned-carts/sync', requireAdmin, postSyncAbandonedCarts);
router.post('/abandoned-carts/:id/message', requireAdmin, postSendAbandonedCartMessage);

router.get('/customers', requireAdmin, getCustomers);
router.post('/customers/sync', requireAdmin, postSyncCustomers);
router.get('/customers/sync-status', requireAdmin, getCustomersSyncStatus);
router.post('/customers/sync-full', requireAdmin, postFullSyncCustomers);
router.post('/customers/repair', requireAdmin, postRepairCustomers);

export default router;
