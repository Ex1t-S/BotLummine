import { Router } from 'express';

import { attachUser, requireAuth, requireAdmin } from '../middleware/auth.js';
import {
	listTemplates,
	getTemplate,
	createTemplateController,
	updateTemplateController,
	deleteTemplateController,
	syncTemplatesController,
	renderTemplatePreviewController,
	previewAbandonedCartAudienceController,
	listCampaignsController,
	getCampaignController,
	createCampaignController,
	launchCampaignController,
	cancelCampaignController,
	deleteCampaignController,
	retryFailedCampaignRecipientsController,
	dispatchTickController,
	getCampaignStatsController,
} from '../controllers/campaign.controller.js';

const router = Router();

router.use(attachUser, requireAuth, requireAdmin);

router.get('/templates', listTemplates);
router.get('/templates/:templateId', getTemplate);
router.post('/templates', createTemplateController);
router.patch('/templates/:templateId', updateTemplateController);
router.delete('/templates/:templateId', deleteTemplateController);
router.post('/templates/sync', syncTemplatesController);
router.post('/templates/preview', renderTemplatePreviewController);

router.post('/abandoned-carts/preview', previewAbandonedCartAudienceController);

router.post('/dispatch/tick', dispatchTickController);
router.get('/stats', getCampaignStatsController);

router.get('/', listCampaignsController);
router.post('/', createCampaignController);
router.get('/:campaignId', getCampaignController);
router.delete('/:campaignId', deleteCampaignController);
router.post('/:campaignId/launch', launchCampaignController);
router.post('/:campaignId/cancel', cancelCampaignController);
router.post('/:campaignId/retry-failed', retryFailedCampaignRecipientsController);

export default router;
