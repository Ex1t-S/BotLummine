import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import {
	createCampaign,
	createTemplate,
	deleteCampaign,
	deleteTemplate,
	dispatchCampaign,
	fetchCampaignOverview,
	fetchCampaigns,
	fetchTemplates,
	pauseCampaign,
	previewAbandonedCartAudience,
	purgeDeletedTemplates,
	resumeCampaign,
	syncTemplates,
	updateTemplate,
} from '../../../lib/campaigns.js';
import { queryKeys } from '../../../lib/queryClient.js';
import {
	buildAbandonedCartFilters,
	extractCreatedCampaignId,
	getCampaignCollection,
	getTemplateCollection,
	normalizeOverview,
} from '../utils.js';
import { useCampaignFeedback } from './useCampaignFeedback.js';

const initialAbandonedCartForm = {
	name: '',
	notes: '',
	daysBack: 7,
	status: 'NEW',
	limit: 50,
	minTotal: '',
	productQuery: '',
	launchNow: false,
};

const CAMPAIGN_RECIPIENT_FETCH_SIZE = 500;
const CAMPAIGN_TRACKING_PAGE_SIZE = 24;
const CAMPAIGN_POLL_INTERVAL_MS = 5000;
const CAMPAIGN_STATUS_POLL_WINDOW_MS = 60 * 60 * 1000;

function isLiveCampaignStatus(status = '') {
	return ['QUEUED', 'RUNNING'].includes(String(status || '').trim().toUpperCase());
}

function readCampaignCount(campaign = {}, keys = []) {
	for (const key of keys) {
		const value = Number(campaign?.[key]);
		if (Number.isFinite(value) && value > 0) return value;
	}

	return 0;
}

function getCampaignStatusUpdatedAt(campaign = {}) {
	const candidates = [
		campaign?.finishedAt,
		campaign?.startedAt,
		campaign?.updatedAt,
		campaign?.createdAt,
	].filter(Boolean);

	for (const value of candidates) {
		const timestamp = new Date(value).getTime();
		if (Number.isFinite(timestamp)) return timestamp;
	}

	return 0;
}

function shouldPollCampaignStatusUpdates(campaign = {}) {
	if (isLiveCampaignStatus(campaign?.status)) return true;

	const status = String(campaign?.status || '').trim().toUpperCase();
	if (!['FINISHED', 'PARTIAL'].includes(status)) return false;

	const lastUpdateAt = getCampaignStatusUpdatedAt(campaign);
	if (!lastUpdateAt || Date.now() - lastUpdateAt > CAMPAIGN_STATUS_POLL_WINDOW_MS) {
		return false;
	}

	const sent = readCampaignCount(campaign, ['sentCount', 'sentRecipients']);
	const delivered = readCampaignCount(campaign, ['deliveredCount', 'deliveredRecipients']);
	const read = readCampaignCount(campaign, ['readCount', 'readRecipients']);
	const failed = readCampaignCount(campaign, ['failedCount', 'failedRecipients']);
	const terminal = Math.max(delivered, read) + failed;

	return sent > terminal || delivered > read;
}

function normalizeRecipientStatus(status = '') {
	const normalized = String(status || '').trim().toUpperCase();

	if (['READ', 'SEEN'].includes(normalized)) return 'READ';
	if (['DELIVERED'].includes(normalized)) return 'DELIVERED';
	if (['SENT', 'DISPATCHED'].includes(normalized)) return 'SENT';
	if (['FAILED', 'ERROR'].includes(normalized)) return 'FAILED';
	if (['PENDING', 'QUEUED', 'NEW', 'CREATED'].includes(normalized)) return 'PENDING';

	return normalized || 'PENDING';
}

function buildRecipientMetrics(recipients = [], fallbackCampaign = {}) {
	if (!Array.isArray(recipients) || recipients.length === 0) {
		return {
			total:
				Number(fallbackCampaign?.totalRecipients) ||
				Number(fallbackCampaign?.recipientCount) ||
				0,
			sent: Number(fallbackCampaign?.sentCount) || 0,
			delivered: Number(fallbackCampaign?.deliveredCount) || 0,
			read: Number(fallbackCampaign?.readCount) || 0,
			failed: Number(fallbackCampaign?.failedCount) || 0,
			pending: Number(fallbackCampaign?.pendingCount) || 0,
		};
	}

	let sent = 0;
	let delivered = 0;
	let read = 0;
	let failed = 0;
	let pending = 0;

	for (const recipient of recipients) {
		const status = normalizeRecipientStatus(recipient?.status);

		if (status === 'READ') {
			read += 1;
			delivered += 1;
			sent += 1;
			continue;
		}

		if (status === 'DELIVERED') {
			delivered += 1;
			sent += 1;
			continue;
		}

		if (status === 'SENT') {
			sent += 1;
			continue;
		}

		if (status === 'FAILED') {
			failed += 1;
			continue;
		}

		pending += 1;
	}

	return {
		total: recipients.length,
		sent,
		delivered,
		read,
		failed,
		pending,
	};
}

function extractDetailResponsePayload(data) {
	if (!data) return {};
	if (data?.campaign || data?.recipients || data?.pagination) return data;
	if (data?.data && (data.data.campaign || data.data.recipients || data.data.pagination)) return data.data;
	return data;
}

export function useCampaignsDashboard() {
	const queryClient = useQueryClient();
	const { feedback, showFeedback } = useCampaignFeedback();

	const [selectedTemplate, setSelectedTemplate] = useState(null);
	const [selectedCampaignId, setSelectedCampaignId] = useState(null);
	const [abandonedCartForm, setAbandonedCartForm] = useState(initialAbandonedCartForm);
	const [abandonedCartPreview, setAbandonedCartPreview] = useState({
		total: 0,
		recipients: [],
	});

	const [campaignTrackingStatus, setCampaignTrackingStatus] = useState('ALL');
	const [campaignTrackingSearch, setCampaignTrackingSearch] = useState('');
	const [campaignTrackingPage, setCampaignTrackingPage] = useState(1);

	const overviewQuery = useQuery({
		queryKey: queryKeys.campaigns.overview,
		queryFn: fetchCampaignOverview,
	});

	const templatesQuery = useQuery({
		queryKey: queryKeys.campaigns.templates(),
		queryFn: () => fetchTemplates(),
	});

	const campaignsQuery = useQuery({
		queryKey: queryKeys.campaigns.runs(),
		queryFn: () => fetchCampaigns(),
		refetchInterval: (query) => {
			const payload = query.state.data;
			const runs =
				Array.isArray(payload?.campaigns) ? payload.campaigns : Array.isArray(payload) ? payload : [];
			return runs.some((campaign) => shouldPollCampaignStatusUpdates(campaign))
				? CAMPAIGN_POLL_INTERVAL_MS
				: false;
		},
		refetchIntervalInBackground: true,
	});

	const campaignDetailQuery = useQuery({
		queryKey: [
			...queryKeys.campaigns.detail(selectedCampaignId),
			CAMPAIGN_RECIPIENT_FETCH_SIZE,
		],
		queryFn: async () => {
			const response = await api.get(`/campaigns/${selectedCampaignId}`, {
				params: {
					page: 1,
					pageSize: CAMPAIGN_RECIPIENT_FETCH_SIZE,
				},
			});
			return response.data;
		},
		enabled: Boolean(selectedCampaignId),
		refetchInterval: (query) => {
			const payload = extractDetailResponsePayload(query.state.data);
			const campaign = payload?.campaign || payload?.item || payload?.run || null;
			return shouldPollCampaignStatusUpdates(campaign) ? CAMPAIGN_POLL_INTERVAL_MS : false;
		},
		refetchIntervalInBackground: true,
	});

	const templates = useMemo(() => getTemplateCollection(templatesQuery.data), [templatesQuery.data]);
	const campaigns = useMemo(() => getCampaignCollection(campaignsQuery.data), [campaignsQuery.data]);
	const overview = useMemo(() => normalizeOverview(overviewQuery.data || {}), [overviewQuery.data]);

	const selectedCampaign = useMemo(() => {
		const listCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) || null;
		const detailPayload = extractDetailResponsePayload(campaignDetailQuery.data);
		const detailCampaign =
			detailPayload?.campaign ||
			detailPayload?.item ||
			detailPayload?.run ||
			null;

		const detailRecipients = Array.isArray(detailPayload?.recipients)
			? detailPayload.recipients
			: Array.isArray(detailCampaign?.recipients)
				? detailCampaign.recipients
				: [];

		const merged = {
			...(listCampaign || {}),
			...(detailCampaign || {}),
			analytics: detailPayload?.analytics || detailCampaign?.analytics || null,
			recipients: detailRecipients,
			allRecipients: detailRecipients,
			pagination: detailPayload?.pagination || detailCampaign?.pagination || null,
		};

		const metrics = buildRecipientMetrics(detailRecipients, merged);

		return {
			...merged,
			totalRecipients: metrics.total,
			recipientCount: metrics.total,
			sentCount: metrics.sent,
			deliveredCount: metrics.delivered,
			readCount: metrics.read,
			failedCount: metrics.failed,
			pendingCount: metrics.pending,
		};
	}, [campaignDetailQuery.data, campaigns, selectedCampaignId]);

	useEffect(() => {
		if (!selectedTemplate && templates.length) {
			const firstEditable = templates.find(
				(template) => String(template?.name || '').trim().toLowerCase() !== 'hello_world'
			);
			setSelectedTemplate(firstEditable || templates[0]);
		}
	}, [templates, selectedTemplate]);

	useEffect(() => {
		if (!selectedCampaignId && campaigns.length) {
			setSelectedCampaignId(campaigns[0].id);
		}
	}, [campaigns, selectedCampaignId]);

	useEffect(() => {
		setCampaignTrackingPage(1);
		setCampaignTrackingSearch('');
		setCampaignTrackingStatus('ALL');
	}, [selectedCampaignId]);

	function invalidateAll(nextCampaignId = selectedCampaignId) {
		queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.overview });
		queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.templates() });
		queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.runs() });

		if (nextCampaignId) {
			queryClient.invalidateQueries({
				queryKey: [...queryKeys.campaigns.detail(nextCampaignId), CAMPAIGN_RECIPIENT_FETCH_SIZE],
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.campaigns.detail(nextCampaignId),
			});
		}
	}

	useEffect(() => {
		async function handleLaunchRequested(event) {
			const campaignId = event?.detail?.campaignId;
			if (!campaignId) return;

			try {
				await dispatchCampaign(campaignId);
				invalidateAll(campaignId);
				setSelectedCampaignId(campaignId);
				showFeedback('success', 'Campaña creada y lanzada.');
			} catch (error) {
				showFeedback(
					'error',
					error?.response?.data?.error || 'La campaña se creó pero no se pudo lanzar.'
				);
			}
		}

		window.addEventListener('campaign:launch-requested', handleLaunchRequested);
		return () => window.removeEventListener('campaign:launch-requested', handleLaunchRequested);
	}, [selectedCampaignId, showFeedback]);

	const syncMutation = useMutation({
		mutationFn: syncTemplates,
		onSuccess: (result) => {
			invalidateAll();
			const markedDeletedCount = Number(result?.markedDeletedCount || 0);
			const deletedCount = Number(result?.deletedCount || 0);
			showFeedback(
				'success',
				deletedCount > 0
					? `Templates sincronizados con Meta. ${deletedCount} se eliminaron de la base local.`
					: markedDeletedCount > 0
						? `Templates sincronizados con Meta. ${markedDeletedCount} quedaron marcados para limpiar.`
						: 'Templates sincronizados con Meta.'
			);
		},
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo sincronizar.'),
	});

	const purgeDeletedTemplatesMutation = useMutation({
		mutationFn: purgeDeletedTemplates,
		onSuccess: (result) => {
			invalidateAll();
			showFeedback(
				'success',
				`${Number(result?.deletedCount || 0)} templates eliminados de la base local.`
			);
		},
		onError: (error) =>
			showFeedback('error', error?.response?.data?.error || 'No se pudieron limpiar los templates eliminados.'),
	});

	const createTemplateMutation = useMutation({
		mutationFn: createTemplate,
		onSuccess: (response) => {
			invalidateAll();
			const createdTemplate = response?.template || response?.data?.template || null;
			if (createdTemplate?.id) {
				setSelectedTemplate(createdTemplate);
			}
			showFeedback('success', 'Template creado correctamente.');
		},
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo crear el template.'),
	});

	const updateTemplateMutation = useMutation({
		mutationFn: ({ templateId, payload }) => updateTemplate(templateId, payload),
		onSuccess: () => {
			invalidateAll();
			showFeedback('success', 'Template actualizado.');
		},
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo actualizar el template.'),
	});

	const deleteTemplateMutation = useMutation({
		mutationFn: deleteTemplate,
		onSuccess: () => {
			invalidateAll();
			setSelectedTemplate(null);
			showFeedback('success', 'Template eliminado.');
		},
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo eliminar el template.'),
	});

	const createCampaignMutation = useMutation({
		mutationFn: createCampaign,
		onSuccess: async (response) => {
			const createdId = extractCreatedCampaignId(response);
			invalidateAll(createdId);
			if (createdId) {
				setSelectedCampaignId(createdId);
			}
			showFeedback('success', 'Campaña creada.');
		},
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo crear la campaña.'),
	});

	const deleteCampaignMutation = useMutation({
		mutationFn: deleteCampaign,
		onSuccess: (_response, deletedCampaignId) => {
			queryClient.removeQueries({ queryKey: queryKeys.campaigns.detail(deletedCampaignId) });
			setSelectedCampaignId((current) => (current === deletedCampaignId ? null : current));
			invalidateAll();
			showFeedback('success', 'Campaña eliminada.');
		},
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo eliminar la campaña.'),
	});

	const abandonedCartPreviewMutation = useMutation({
		mutationFn: ({ templateId, filters }) => previewAbandonedCartAudience({ templateId, filters }),
		onSuccess: (response) => {
			setAbandonedCartPreview({
				total: response?.total || 0,
				recipients: Array.isArray(response?.recipients) ? response.recipients : [],
			});
			showFeedback('success', 'Audiencia generada desde carritos abandonados.');
		},
		onError: (error) => {
			showFeedback(
				'error',
				error?.response?.data?.error || 'No se pudo generar la audiencia de carritos.'
			);
		},
	});

	const createAbandonedCartCampaignMutation = useMutation({
		mutationFn: async ({ launchNow }) => {
			if (!selectedTemplate?.id) {
				throw new Error('Elegí un template antes de crear la campaña.');
			}

			const payload = {
				name:
					String(abandonedCartForm.name || '').trim() ||
					`Recuperación ${abandonedCartForm.daysBack} días`,
				templateId: selectedTemplate.id,
				languageCode: selectedTemplate.language || 'es_AR',
				audienceSource: 'abandoned_carts',
				audienceFilters: buildAbandonedCartFilters(abandonedCartForm),
				notes: abandonedCartForm.notes || null,
			};

			const response = await api.post('/campaigns', payload);
			const data = response.data;
			const createdId = extractCreatedCampaignId(data);

			if (launchNow && createdId) {
				await dispatchCampaign(createdId);
			}

			return { data, createdId, launchNow };
		},
		onSuccess: ({ createdId, launchNow }) => {
			invalidateAll(createdId);
			if (createdId) {
				setSelectedCampaignId(createdId);
			}
			showFeedback(
				'success',
				launchNow ? 'Campaña de carritos creada y lanzada.' : 'Campaña de carritos creada.'
			);
		},
		onError: (error) => {
			showFeedback(
				'error',
				error?.response?.data?.error || error.message || 'No se pudo crear la campaña de carritos.'
			);
		},
	});

	const actionMutation = useMutation({
		mutationFn: async ({ type, campaignId }) => {
			if (type === 'dispatch') return dispatchCampaign(campaignId);
			if (type === 'pause') return pauseCampaign(campaignId);
			if (type === 'resume') return resumeCampaign(campaignId);
			return null;
		},
		onSuccess: (_response, variables) => {
			invalidateAll(variables.campaignId);
			setSelectedCampaignId(variables.campaignId);
			showFeedback('success', 'Acción ejecutada correctamente.');
		},
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo ejecutar la acción.'),
	});

	function updateAbandonedCartForm(field, value) {
		setAbandonedCartForm((prev) => ({
			...prev,
			[field]: value,
		}));
	}

	function handlePreviewAbandonedCarts() {
		if (!selectedTemplate?.id) {
			showFeedback('error', 'Elegí un template para previsualizar la campaña.');
			return;
		}

		abandonedCartPreviewMutation.mutate({
			templateId: selectedTemplate.id,
			filters: buildAbandonedCartFilters(abandonedCartForm),
		});
	}

	function handleCreateAbandonedCartCampaign(launchNow = false) {
		createAbandonedCartCampaignMutation.mutate({ launchNow });
	}

	return {
		feedback,
		overview,
		templates,
		campaigns,
		selectedTemplate,
		setSelectedTemplate,
		selectedCampaign,
		setSelectedCampaignId,
		queries: {
			overview: overviewQuery,
			templates: templatesQuery,
			campaigns: campaignsQuery,
			campaignDetail: campaignDetailQuery,
		},
		mutations: {
			sync: syncMutation,
			purgeDeletedTemplates: purgeDeletedTemplatesMutation,
			createTemplate: createTemplateMutation,
			updateTemplate: updateTemplateMutation,
			deleteTemplate: deleteTemplateMutation,
			createCampaign: createCampaignMutation,
			deleteCampaign: deleteCampaignMutation,
			action: actionMutation,
			abandonedPreview: abandonedCartPreviewMutation,
			createAbandonedCampaign: createAbandonedCartCampaignMutation,
		},
		tracking: {
			statusFilter: campaignTrackingStatus,
			setStatusFilter: setCampaignTrackingStatus,
			search: campaignTrackingSearch,
			setSearch: setCampaignTrackingSearch,
			page: campaignTrackingPage,
			setPage: setCampaignTrackingPage,
			pageSize: CAMPAIGN_TRACKING_PAGE_SIZE,
		},
		abandonedCart: {
			form: abandonedCartForm,
			preview: abandonedCartPreview,
			updateField: updateAbandonedCartForm,
			handlePreview: handlePreviewAbandonedCarts,
			handleCreate: handleCreateAbandonedCartCampaign,
		},
	};
}
