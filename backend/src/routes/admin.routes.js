import { Router } from 'express';
import { requireAuth, requirePlatformAdmin, requireAdmin } from '../middleware/auth.js';
import {
	createWorkspace,
	createWorkspaceUser,
	getWorkspace,
	listWorkspaceUsers,
	listWorkspaces,
	updateWorkspace,
	updateWorkspaceUser,
	upsertCommerceConnection,
	upsertWhatsAppChannel,
} from '../controllers/admin.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/workspaces', requirePlatformAdmin, listWorkspaces);
router.post('/workspaces', requirePlatformAdmin, createWorkspace);
router.get('/workspaces/:workspaceId', requireAdmin, getWorkspace);
router.patch('/workspaces/:workspaceId', requireAdmin, updateWorkspace);
router.get('/workspaces/:workspaceId/users', requireAdmin, listWorkspaceUsers);
router.post('/workspaces/:workspaceId/users', requireAdmin, createWorkspaceUser);
router.put('/workspaces/:workspaceId/whatsapp-channel', requireAdmin, upsertWhatsAppChannel);
router.put('/workspaces/:workspaceId/commerce-connections/:provider', requireAdmin, upsertCommerceConnection);
router.patch('/users/:userId', requireAdmin, updateWorkspaceUser);

export default router;
