import { Router } from 'express';

import { attachUser, requireAuth, requireAdmin } from '../middleware/auth.js';
import {
	listTemplates,
	getTemplate,
	createTemplateController,
	updateTemplateController,
	deleteTemplateController,
	syncTemplatesController,
	purgeDeletedTemplatesController,
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
	listCampaignSchedulesController,
	createCampaignScheduleController,
	previewCampaignScheduleController,
	runCampaignScheduleNowController,
	updateCampaignScheduleController,
	deleteCampaignScheduleController,
	getAbandonedCartAutomationSettingsController,
	updateAbandonedCartAutomationSettingsController,
	runAbandonedCartAutomationNowController,
	getPendingPaymentAutomationSettingsController,
	updatePendingPaymentAutomationSettingsController,
	runPendingPaymentAutomationNowController,
	getShipmentNotificationSettingsController,
	updateShipmentNotificationSettingsController,
	listShipmentNotificationCandidatesController,
	sendShipmentNotificationsController,
} from '../controllers/campaign.controller.js';

const router = Router();

router.use(attachUser, requireAuth, requireAdmin);

router.get('/templates', listTemplates);
router.get('/templates/:templateId', getTemplate);
router.post('/templates', createTemplateController);
router.patch('/templates/:templateId', updateTemplateController);
router.delete('/templates/:templateId', deleteTemplateController);
router.post('/templates/sync', syncTemplatesController);
router.post('/templates/purge-deleted', purgeDeletedTemplatesController);
router.post('/templates/preview', renderTemplatePreviewController);

router.post('/abandoned-carts/preview', previewAbandonedCartAudienceController);

router.post('/dispatch/tick', dispatchTickController);
router.get('/stats', getCampaignStatsController);
router.get('/schedules', listCampaignSchedulesController);
router.post('/schedules/preview', previewCampaignScheduleController);
router.post('/schedules', createCampaignScheduleController);
router.post('/schedules/:scheduleId/run-now', runCampaignScheduleNowController);
router.patch('/schedules/:scheduleId', updateCampaignScheduleController);
router.delete('/schedules/:scheduleId', deleteCampaignScheduleController);
router.get('/abandoned-cart-automation/settings', getAbandonedCartAutomationSettingsController);
router.patch('/abandoned-cart-automation/settings', updateAbandonedCartAutomationSettingsController);
router.post('/abandoned-cart-automation/run-now', runAbandonedCartAutomationNowController);
router.get('/pending-payment-automation/settings', getPendingPaymentAutomationSettingsController);
router.patch('/pending-payment-automation/settings', updatePendingPaymentAutomationSettingsController);
router.post('/pending-payment-automation/run-now', runPendingPaymentAutomationNowController);
router.get('/shipment-notifications/settings', getShipmentNotificationSettingsController);
router.patch('/shipment-notifications/settings', updateShipmentNotificationSettingsController);
router.get('/shipment-notifications/candidates', listShipmentNotificationCandidatesController);
router.post('/shipment-notifications/send', sendShipmentNotificationsController);

router.get('/', listCampaignsController);
router.post('/', createCampaignController);
router.get('/:campaignId', getCampaignController);
router.delete('/:campaignId', deleteCampaignController);
router.post('/:campaignId/launch', launchCampaignController);
router.post('/:campaignId/cancel', cancelCampaignController);
router.post('/:campaignId/retry-failed', retryFailedCampaignRecipientsController);

export default router;
