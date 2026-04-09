import {
	createCampaignDraft,
	launchCampaign,
	cancelCampaign,
	deleteCampaign,
	listCampaigns,
	getCampaignDetail,
	retryFailedCampaignRecipients,
	previewAbandonedCartAudience,
} from '../services/campaigns/whatsapp-campaign.service.js';
import { executeCampaignDispatcherTick } from '../services/campaigns/campaign-dispatcher.service.js';
import {
	createTemplate,
	updateTemplate,
	deleteTemplate,
	syncTemplatesFromMeta,
	listLocalTemplates,
	getTemplateOrThrow,
	renderTemplatePreviewFromComponents,
} from '../services/whatsapp/whatsapp-template.service.js';
import { getCampaignStats } from '../services/campaigns/campaign-stats.service.js';
import {
	normalizeBoolean,
	persistTemplateBuilderMetadata,
	sendError,
} from './campaign.controller.utils.js';

export async function listTemplates(req, res) {
	try {
		const templates = await listLocalTemplates({
			q: req.query.q || '',
			status: req.query.status || '',
			category: req.query.category || '',
			language: req.query.language || '',
			includeDeleted: normalizeBoolean(req.query.includeDeleted),
			limit: req.query.limit || 100,
		});

		return res.json({ ok: true, templates });
	} catch (error) {
		return sendError(res, error, 500);
	}
}

export async function getTemplate(req, res) {
	try {
		const template = await getTemplateOrThrow(req.params.templateId);
		return res.json({ ok: true, template });
	} catch (error) {
		return sendError(res, error, 404);
	}
}

export async function createTemplateController(req, res) {
	try {
		const result = await createTemplate({
			name: req.body?.name,
			category: req.body?.category,
			language: req.body?.language || 'es_AR',
			parameterFormat: req.body?.parameterFormat || 'POSITIONAL',
			components: Array.isArray(req.body?.components) ? req.body.components : [],
		});

		const template = await persistTemplateBuilderMetadata(result.template, req.body);
		return res.status(201).json({ ok: true, ...result, template });
	} catch (error) {
		return sendError(res, error);
	}
}

export async function updateTemplateController(req, res) {
	try {
		const result = await updateTemplate(req.params.templateId, {
			category: req.body?.category,
			parameterFormat: req.body?.parameterFormat || 'POSITIONAL',
			components: Array.isArray(req.body?.components) ? req.body.components : [],
		});

		const template = await persistTemplateBuilderMetadata(result.template, req.body);
		return res.json({ ok: true, ...result, template });
	} catch (error) {
		return sendError(res, error);
	}
}

export async function deleteTemplateController(req, res) {
	try {
		const result = await deleteTemplate(req.params.templateId, {
			deleteAllLanguages: normalizeBoolean(req.query.allLanguages || req.body?.allLanguages),
		});

		return res.json({ ok: true, ...result });
	} catch (error) {
		return sendError(res, error);
	}
}

export async function syncTemplatesController(_req, res) {
	try {
		const result = await syncTemplatesFromMeta();
		return res.json({ ok: true, ...result });
	} catch (error) {
		return sendError(res, error, 500);
	}
}

export async function renderTemplatePreviewController(req, res) {
	try {
		const preview = renderTemplatePreviewFromComponents(
			Array.isArray(req.body?.components) ? req.body.components : [],
			req.body?.variables || {}
		);
		return res.json({ ok: true, preview });
	} catch (error) {
		return sendError(res, error);
	}
}

export async function previewAbandonedCartAudienceController(req, res) {
	try {
		const result = await previewAbandonedCartAudience({
			templateId: req.body?.templateId || null,
			filters: req.body?.filters || {},
		});
		return res.json({ ok: true, ...result });
	} catch (error) {
		return sendError(res, error);
	}
}

export async function listCampaignsController(req, res) {
	try {
		const campaigns = await listCampaigns({ limit: req.query.limit || 50 });
		return res.json({ ok: true, campaigns });
	} catch (error) {
		return sendError(res, error, 500);
	}
}

export async function getCampaignController(req, res) {
	try {
		const result = await getCampaignDetail(req.params.campaignId, {
			page: req.query.page || 1,
			pageSize: req.query.pageSize || 50,
		});
		return res.json({ ok: true, ...result });
	} catch (error) {
		return sendError(res, error, 404);
	}
}

export async function createCampaignController(req, res) {
	try {
		const result = await createCampaignDraft({
			name: req.body?.name,
			templateId: req.body?.templateId || null,
			templateName: req.body?.templateName || null,
			languageCode: req.body?.languageCode || 'es_AR',
			sendComponents: Array.isArray(req.body?.sendComponents) ? req.body.sendComponents : [],
			recipients: Array.isArray(req.body?.recipients) ? req.body.recipients : [],
			contactIds: Array.isArray(req.body?.contactIds) ? req.body.contactIds : [],
			includeAllContacts: normalizeBoolean(req.body?.includeAllContacts),
			audienceSource: req.body?.audienceSource || null,
			audienceFilters: req.body?.audienceFilters || null,
			notes: req.body?.notes || null,
			launchedByUserId: req.user?.id || null,
		});

		return res.status(201).json({ ok: true, ...result });
	} catch (error) {
		return sendError(res, error);
	}
}

export async function launchCampaignController(req, res) {
	try {
		const result = await launchCampaign(req.params.campaignId);
		return res.json(result);
	} catch (error) {
		console.log('[CAMPAIGN][LAUNCH][ERROR]', error.message);
		return res.status(400).json({ error: error.message });
	}
}

export async function cancelCampaignController(req, res) {
	try {
		const campaign = await cancelCampaign(req.params.campaignId);
		return res.json({ ok: true, campaign });
	} catch (error) {
		return sendError(res, error);
	}
}

export async function deleteCampaignController(req, res) {
	try {
		const result = await deleteCampaign(req.params.campaignId);
		return res.json({ ok: true, ...result });
	} catch (error) {
		return sendError(res, error);
	}
}

export async function retryFailedCampaignRecipientsController(req, res) {
	try {
		const result = await retryFailedCampaignRecipients(req.params.campaignId);
		void executeCampaignDispatcherTick();
		return res.json({ ok: true, ...result });
	} catch (error) {
		return sendError(res, error);
	}
}

export async function dispatchTickController(_req, res) {
	try {
		const result = await executeCampaignDispatcherTick();
		return res.json({ ok: true, ...result });
	} catch (error) {
		return sendError(res, error, 500);
	}
}

export async function getCampaignStatsController(_req, res) {
	try {
		const stats = await getCampaignStats();
		return res.json({ ok: true, stats });
	} catch (error) {
		return sendError(res, error, 500);
	}
}