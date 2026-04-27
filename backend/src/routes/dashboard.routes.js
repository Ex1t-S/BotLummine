import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { requireAuth, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import {
	getInbox,
	getInboxStream,
	getConversationMessagesJson,
	postConversationMessage,
	patchConversationRead,
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
const dashboardAttachmentDir = path.resolve(process.cwd(), 'tmp/dashboard-attachments');
const messageAttachmentUpload = multer({
	storage: multer.diskStorage({
		destination: (_req, _file, cb) => {
			try {
				fs.mkdirSync(dashboardAttachmentDir, { recursive: true });
				cb(null, dashboardAttachmentDir);
			} catch (error) {
				cb(error);
			}
		},
		filename: (_req, file, cb) => {
			const extension = path.extname(file.originalname || '');
			const safeSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
			cb(null, `inbox-${safeSuffix}${extension}`);
		},
	}),
	limits: {
		fileSize: 25 * 1024 * 1024,
		files: 5,
	},
});

router.use(requireAuth);

router.get('/inbox', requireInboxAccess, getInbox);
router.get('/inbox/stream', requireInboxAccess, getInboxStream);
router.get('/conversations/:conversationId/messages', requireInboxAccess, getConversationMessagesJson);
router.post(
	'/conversations/:conversationId/messages',
	requireInboxAccess,
	messageAttachmentUpload.array('files', 5),
	postConversationMessage
);
router.patch('/conversations/:conversationId/read', requireInboxAccess, patchConversationRead);
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
