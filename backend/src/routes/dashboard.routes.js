import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import {
	getInbox,
	getInboxStream,
	getOperationSummary,
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
const OUTBOUND_MEDIA_ALLOWED_MIME_TYPES = new Set([
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
	'video/mp4',
	'video/3gpp',
	'audio/aac',
	'audio/amr',
	'audio/mpeg',
	'audio/mp3',
	'audio/ogg',
	'application/pdf',
	'text/plain',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.ms-excel',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const outboundMediaMaxBytes = Math.max(
	1024 * 1024,
	Math.min(Number(process.env.OUTBOUND_MEDIA_MAX_BYTES || 25 * 1024 * 1024), 100 * 1024 * 1024)
);
const uploadInboxAttachment = multer({
	dest: 'tmp/',
	limits: {
		fileSize: outboundMediaMaxBytes,
	},
	fileFilter(_req, file, callback) {
		const mimeType = String(file.mimetype || '').toLowerCase();
		if (OUTBOUND_MEDIA_ALLOWED_MIME_TYPES.has(mimeType)) {
			return callback(null, true);
		}

		return callback(new Error('Tipo de archivo no permitido para enviar por WhatsApp.'));
	},
});

router.use(requireAuth);

router.get('/operations/summary', requireInboxAccess, getOperationSummary);
router.get('/inbox', requireInboxAccess, getInbox);
router.get('/inbox/stream', requireInboxAccess, getInboxStream);
router.get('/conversations/:conversationId/messages', requireInboxAccess, getConversationMessagesJson);
router.post(
	'/conversations/:conversationId/messages',
	requireInboxAccess,
	uploadInboxAttachment.single('file'),
	postConversationMessage
);
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
