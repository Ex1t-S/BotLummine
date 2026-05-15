import { Router } from 'express';
import { requireAuth, requirePlatformAdmin, requireAdmin } from '../middleware/auth.js';
import {
	createWorkspace,
	deleteWorkspace,
	completeWhatsAppEmbeddedSignupForWorkspace,
	createWorkspaceUser,
	generateWorkspaceContextDraft,
	getPlatformDiagnostics,
	getWorkspaceFeatureFlags,
	getWorkspaceAnalytics,
	getWorkspace,
	getWorkspaceCatalogStatus,
	listWorkspaceUsers,
	listWorkspaces,
	runWorkspaceCatalogSync,
	syncWorkspaceBranding,
	updateWorkspace,
	updateWorkspaceFeatureFlag,
	updateWorkspaceUser,
	upsertCommerceConnection,
	upsertLogisticsConnection,
	upsertWhatsAppChannel,
} from '../controllers/admin.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/diagnostics', requirePlatformAdmin, getPlatformDiagnostics);
router.get('/analytics/workspaces', requireAdmin, getWorkspaceAnalytics);
router.get('/workspaces', requirePlatformAdmin, listWorkspaces);
router.post('/workspaces', requirePlatformAdmin, createWorkspace);
router.delete('/workspaces/:workspaceId', requirePlatformAdmin, deleteWorkspace);
router.get('/workspaces/:workspaceId', requireAdmin, getWorkspace);
router.post('/workspaces/:workspaceId/ai-context/generate', requireAdmin, generateWorkspaceContextDraft);
router.patch('/workspaces/:workspaceId', requireAdmin, updateWorkspace);
router.get('/workspaces/:workspaceId/users', requireAdmin, listWorkspaceUsers);
router.post('/workspaces/:workspaceId/users', requireAdmin, createWorkspaceUser);
router.get('/workspaces/:workspaceId/catalog/status', requireAdmin, getWorkspaceCatalogStatus);
router.get('/workspaces/:workspaceId/feature-flags', requirePlatformAdmin, getWorkspaceFeatureFlags);
router.patch('/workspaces/:workspaceId/feature-flags/:key', requirePlatformAdmin, updateWorkspaceFeatureFlag);
router.post('/workspaces/:workspaceId/catalog/sync', requirePlatformAdmin, runWorkspaceCatalogSync);
router.post('/workspaces/:workspaceId/branding/sync', requireAdmin, syncWorkspaceBranding);
router.post('/workspaces/:workspaceId/whatsapp/embedded-signup/complete', requireAdmin, completeWhatsAppEmbeddedSignupForWorkspace);
router.put('/workspaces/:workspaceId/whatsapp-channel', requirePlatformAdmin, upsertWhatsAppChannel);
router.put('/workspaces/:workspaceId/commerce-connections/:provider', requirePlatformAdmin, upsertCommerceConnection);
router.put('/workspaces/:workspaceId/logistics-connections/:provider', requirePlatformAdmin, upsertLogisticsConnection);
router.patch('/users/:userId', requireAdmin, updateWorkspaceUser);

export default router;
