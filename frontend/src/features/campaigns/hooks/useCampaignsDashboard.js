import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import {
	createCampaign,
	createCampaignSchedule,
	createTemplate,
	deleteCampaign,
	deleteCampaignSchedule,
	deleteTemplate,
	dispatchCampaign,
	fetchAbandonedCartAutomationSettings,
	fetchAutomationRunDetail,
	fetchAutomationRuns,
	fetchCampaignOverview,
	fetchCampaignSchedules,
	fetchCampaigns,
	fetchPendingPaymentAutomationSettings,
	fetchShipmentNotificationCandidates,
	fetchShipmentNotificationSettings,
	fetchTemplates,
	pauseCampaign,
	previewAbandonedCartAudience,
	previewCampaignSchedule,
	purgeDeletedTemplates,
	resumeAutomationRun,
	resumeCampaign,
	runAbandonedCartAutomationNow,
	runCampaignScheduleNow,
	runCampaignDispatchTick,
	runPendingPaymentAutomationNow,
	sendShipmentNotifications,
	syncTemplates,
	updateAbandonedCartAutomationSettings,
	updateCampaignSchedule,
	updatePendingPaymentAutomationSettings,
	updateShipmentNotificationSettings,
	updateTemplate,
} from '../../../lib/campaigns.js';
import { queryKeys, queryPresets } from '../../../lib/queryClient.js';
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
	daysBack: 30,
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
const SHIPMENT_NOTIFICATION_DAYS_BACK = 14;

function formatDateInput(date) {
	return date.toISOString().slice(0, 10);
}

function buildDefaultShipmentRange() {
	const to = new Date();
	const from = new Date();
	from.setDate(to.getDate() - (SHIPMENT_NOTIFICATION_DAYS_BACK - 1));
	return {
		dateFrom: formatDateInput(from),
		dateTo: formatDateInput(to),
	};
}

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

function getAutomationRunCollection(data) {
	if (Array.isArray(data)) return data;
	return data?.runs || data?.items || [];
}

function isAutomationAudienceSource(source = '') {
	return ['abandoned_carts', 'pending_payment', 'shipment_dispatch'].includes(
		String(source || '').trim().toLowerCase()
	);
}

function normalizeTrackingItem(item = {}, kind = 'campaign') {
	return {
		...item,
		kind: item.kind || kind,
	};
}

function buildTrackingItems(automationData, campaignData) {
	const automationRuns = getAutomationRunCollection(automationData).map((run) =>
		normalizeTrackingItem(run, 'automation_run')
	);
	const manualCampaigns = getCampaignCollection(campaignData)
		.filter((campaign) => !campaign?.automationRunId && !isAutomationAudienceSource(campaign?.audienceSource))
		.map((campaign) => normalizeTrackingItem(campaign, 'campaign'));

	return [...automationRuns, ...manualCampaigns];
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
			skipped: Number(fallbackCampaign?.skippedCount || fallbackCampaign?.skippedRecipients) || 0,
		};
	}

	let sent = 0;
	let delivered = 0;
	let read = 0;
	let failed = 0;
	let pending = 0;
	let skipped = 0;

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

		if (status === 'SKIPPED') {
			skipped += 1;
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
		skipped,
	};
}

function extractDetailResponsePayload(data) {
	if (!data) return {};
	if (data?.campaign || data?.recipients || data?.pagination) return data;
	if (data?.data && (data.data.campaign || data.data.recipients || data.data.pagination)) return data.data;
	return data;
}

export function useCampaignsDashboard({ activeTab = 'library' } = {}) {
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
	const [campaignTrackingPurchase, setCampaignTrackingPurchase] = useState('ALL');
	const [campaignTrackingSearch, setCampaignTrackingSearch] = useState('');
	const [campaignTrackingPage, setCampaignTrackingPage] = useState(1);
	const [shipmentRange, setShipmentRange] = useState(buildDefaultShipmentRange);
	const needsTemplates = [
		'library',
		'builder',
		'segment',
		'abandoned-carts',
		'schedules',
		'pending-payments',
		'shipments',
	].includes(activeTab);
	const needsCampaignRuns = activeTab === 'tracking';
	const needsSchedules = activeTab === 'schedules';
	const needsAbandonedAutomation = activeTab === 'abandoned-carts';
	const needsPendingPaymentAutomation = activeTab === 'pending-payments';
	const needsShipmentNotifications = activeTab === 'shipments';

	const overviewQuery = useQuery({
		queryKey: queryKeys.campaigns.overview,
		queryFn: fetchCampaignOverview,
		enabled: false,
		placeholderData: keepPreviousData,
	});

	const templatesQuery = useQuery({
		queryKey: queryKeys.campaigns.templates(),
		queryFn: () => fetchTemplates(),
		enabled: needsTemplates,
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
	});

	const campaignsQuery = useQuery({
		queryKey: queryKeys.campaigns.runs(),
		queryFn: () => fetchCampaigns(),
		enabled: needsCampaignRuns,
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
		refetchInterval: (query) => {
			if (!needsCampaignRuns) return false;
			const payload = query.state.data;
			const runs =
				Array.isArray(payload?.campaigns) ? payload.campaigns : Array.isArray(payload) ? payload : [];
			return runs.some((campaign) => shouldPollCampaignStatusUpdates(campaign))
				? CAMPAIGN_POLL_INTERVAL_MS
				: false;
		},
		refetchIntervalInBackground: true,
	});

	const automationRunsQuery = useQuery({
		queryKey: queryKeys.campaigns.automationRuns(),
		queryFn: () => fetchAutomationRuns(),
		enabled: needsCampaignRuns,
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
		refetchInterval: (query) => {
			if (!needsCampaignRuns) return false;
			const runs = getAutomationRunCollection(query.state.data);
			return runs.some((run) => shouldPollCampaignStatusUpdates(run))
				? CAMPAIGN_POLL_INTERVAL_MS
				: false;
		},
		refetchIntervalInBackground: true,
	});

	const trackingItems = useMemo(
		() => buildTrackingItems(automationRunsQuery.data, campaignsQuery.data),
		[automationRunsQuery.data, campaignsQuery.data]
	);
	const selectedTrackingItem = useMemo(
		() => trackingItems.find((item) => item.id === selectedCampaignId) || null,
		[trackingItems, selectedCampaignId]
	);

	const schedulesQuery = useQuery({
		queryKey: queryKeys.campaigns.schedules,
		queryFn: fetchCampaignSchedules,
		enabled: needsSchedules,
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
	});

	const abandonedCartAutomationQuery = useQuery({
		queryKey: ['campaigns', 'abandoned-cart-automation', 'settings'],
		queryFn: fetchAbandonedCartAutomationSettings,
		enabled: needsAbandonedAutomation,
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
	});

	const pendingPaymentAutomationQuery = useQuery({
		queryKey: ['campaigns', 'pending-payment-automation', 'settings'],
		queryFn: fetchPendingPaymentAutomationSettings,
		enabled: needsPendingPaymentAutomation,
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
	});

	const shipmentSettingsQuery = useQuery({
		queryKey: ['campaigns', 'shipment-notifications', 'settings'],
		queryFn: fetchShipmentNotificationSettings,
		enabled: needsShipmentNotifications,
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
	});

	const shipmentCandidatesQuery = useQuery({
		queryKey: ['campaigns', 'shipment-notifications', 'candidates', shipmentRange],
		queryFn: () => fetchShipmentNotificationCandidates({
			dateFrom: shipmentRange.dateFrom,
			dateTo: shipmentRange.dateTo,
			includeNotified: true,
		}),
		enabled: needsShipmentNotifications,
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
	});

	const campaignDetailQuery = useQuery({
		queryKey: [
			...(selectedTrackingItem?.kind === 'automation_run'
				? queryKeys.campaigns.automationRunDetail(selectedCampaignId)
				: queryKeys.campaigns.detail(selectedCampaignId)),
			CAMPAIGN_RECIPIENT_FETCH_SIZE,
		],
		queryFn: async () => {
			const params = {
				page: 1,
				pageSize: CAMPAIGN_RECIPIENT_FETCH_SIZE,
			};
			if (selectedTrackingItem?.kind === 'automation_run') {
				return fetchAutomationRunDetail(selectedCampaignId, params);
			}
			const response = await api.get(`/campaigns/${selectedCampaignId}`, { params });
			return response.data;
		},
		enabled: Boolean(selectedCampaignId && selectedTrackingItem),
		placeholderData: keepPreviousData,
		...queryPresets.campaigns,
		refetchInterval: (query) => {
			const payload = extractDetailResponsePayload(query.state.data);
			const campaign = payload?.campaign || payload?.item || payload?.run || null;
			return shouldPollCampaignStatusUpdates(campaign) ? CAMPAIGN_POLL_INTERVAL_MS : false;
		},
		refetchIntervalInBackground: true,
	});

	const templates = useMemo(() => getTemplateCollection(templatesQuery.data), [templatesQuery.data]);
	const campaigns = trackingItems;
	const schedules = useMemo(() => {
		const data = schedulesQuery.data;
		if (Array.isArray(data)) return data;
		return data?.schedules || data?.items || [];
	}, [schedulesQuery.data]);
	const shipmentNotifications = useMemo(() => ({
		settings: shipmentSettingsQuery.data?.settings || null,
		range: shipmentRange,
		setRange: setShipmentRange,
		candidates: Array.isArray(shipmentCandidatesQuery.data?.candidates)
			? shipmentCandidatesQuery.data.candidates
			: [],
		summary: shipmentCandidatesQuery.data?.summary || {},
	}), [shipmentSettingsQuery.data, shipmentCandidatesQuery.data, shipmentRange]);
	const overview = useMemo(() => normalizeOverview(overviewQuery.data || {}), [overviewQuery.data]);

	const selectedCampaign = useMemo(() => {
		if (!selectedCampaignId) return null;

		const listCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) || null;
		const detailPayload = extractDetailResponsePayload(campaignDetailQuery.data);
		const rawDetailCampaign =
			detailPayload?.campaign ||
			detailPayload?.item ||
			detailPayload?.run ||
			null;
		const detailCampaign = rawDetailCampaign?.id === selectedCampaignId ? rawDetailCampaign : null;

		if (!listCampaign && !detailCampaign) return null;

		const activeDetailPayload = detailCampaign ? detailPayload : {};
		const detailRecipients = Array.isArray(activeDetailPayload?.recipients)
			? activeDetailPayload.recipients
			: Array.isArray(detailCampaign?.recipients)
				? detailCampaign.recipients
				: [];

		const merged = {
			...(listCampaign || {}),
			...(detailCampaign || {}),
			analytics: activeDetailPayload?.analytics || detailCampaign?.analytics || listCampaign?.analytics || null,
			diagnostics: activeDetailPayload?.diagnostics || detailCampaign?.diagnostics || listCampaign?.diagnostics || null,
			recipients: detailRecipients,
			allRecipients: detailRecipients,
			pagination: activeDetailPayload?.pagination || detailCampaign?.pagination || listCampaign?.pagination || null,
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
			skippedCount: metrics.skipped,
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
		if ((!selectedCampaignId || !campaigns.some((campaign) => campaign.id === selectedCampaignId)) && campaigns.length) {
			setSelectedCampaignId(campaigns[0].id);
			return;
		}

		if (selectedCampaignId && campaigns.length === 0) {
			setSelectedCampaignId(null);
		}
	}, [campaigns, selectedCampaignId]);

	useEffect(() => {
		setCampaignTrackingPage(1);
		setCampaignTrackingSearch('');
		setCampaignTrackingStatus('ALL');
		setCampaignTrackingPurchase('ALL');
	}, [selectedCampaignId]);

	function invalidateAll(nextCampaignId = selectedCampaignId) {
		queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.overview });
		queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.templates() });
		queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.runs() });
		queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.automationRuns() });
		queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.schedules });
		queryClient.invalidateQueries({ queryKey: ['campaigns', 'abandoned-cart-automation'] });
		queryClient.invalidateQueries({ queryKey: ['campaigns', 'pending-payment-automation'] });
		queryClient.invalidateQueries({ queryKey: ['campaigns', 'shipment-notifications'] });

		if (nextCampaignId) {
			queryClient.invalidateQueries({
				queryKey: [...queryKeys.campaigns.detail(nextCampaignId), CAMPAIGN_RECIPIENT_FETCH_SIZE],
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.campaigns.detail(nextCampaignId),
			});
			queryClient.invalidateQueries({
				queryKey: [...queryKeys.campaigns.automationRunDetail(nextCampaignId), CAMPAIGN_RECIPIENT_FETCH_SIZE],
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.campaigns.automationRunDetail(nextCampaignId),
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
		mutationFn: ({
			templateId,
			filters,
			variableMapping = {},
			manualVariables = {},
		}) => previewAbandonedCartAudience({
			templateId,
			filters: {
				...(filters || {}),
				variableMapping,
				manualVariables,
			},
		}),
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

	const updateAbandonedCartAutomationMutation = useMutation({
		mutationFn: updateAbandonedCartAutomationSettings,
		onSuccess: () => {
			invalidateAll();
			showFeedback('success', 'Automatizacion de carritos actualizada.');
		},
		onError: (error) =>
			showFeedback('error', error?.response?.data?.error || 'No se pudo actualizar la automatizacion de carritos.'),
	});

	const runAbandonedCartAutomationNowMutation = useMutation({
		mutationFn: runAbandonedCartAutomationNow,
		onSuccess: (result) => {
			invalidateAll(result?.campaignId || null);
			showFeedback('success', `Automatizacion ejecutada para ${Number(result?.processed || 0)} destinatario(s).`);
		},
		onError: (error) =>
			showFeedback('error', error?.response?.data?.error || 'No se pudo ejecutar la automatizacion de carritos.'),
	});

	const updatePendingPaymentAutomationMutation = useMutation({
		mutationFn: updatePendingPaymentAutomationSettings,
		onSuccess: () => {
			invalidateAll();
			showFeedback('success', 'Automatizacion de pagos pendientes actualizada.');
		},
		onError: (error) =>
			showFeedback('error', error?.response?.data?.error || 'No se pudo actualizar pagos pendientes.'),
	});

	const runPendingPaymentAutomationNowMutation = useMutation({
		mutationFn: runPendingPaymentAutomationNow,
		onSuccess: (result) => {
			invalidateAll(result?.campaignId || null);
			showFeedback('success', `Pagos pendientes ejecutados para ${Number(result?.processed || 0)} destinatario(s).`);
		},
		onError: (error) =>
			showFeedback('error', error?.response?.data?.error || 'No se pudo ejecutar pagos pendientes.'),
	});

	const createAbandonedCartCampaignMutation = useMutation({
		mutationFn: async (input = {}) => {
			const {
				launchNow = false,
				name = '',
				notes = null,
				templateId = null,
				languageCode = null,
				filters = null,
				variableMapping = {},
				manualVariables = {},
			} = input;
			const resolvedTemplateId = templateId || selectedTemplate?.id || null;

			if (!resolvedTemplateId) {
				throw new Error('Elegí un template antes de crear la campaña.');
			}

			const payload = {
				name:
					String(name || abandonedCartForm.name || '').trim() ||
					`Recuperación ${abandonedCartForm.daysBack} días`,
				templateId: resolvedTemplateId,
				languageCode: languageCode || selectedTemplate?.language || 'es_AR',
				audienceSource: 'abandoned_carts',
				audienceFilters: {
					...(filters || buildAbandonedCartFilters(abandonedCartForm)),
					variableMapping,
					manualVariables,
				},
				notes: (notes ?? abandonedCartForm.notes) || null,
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

	const createScheduleMutation = useMutation({
		mutationFn: createCampaignSchedule,
		onSuccess: () => {
			invalidateAll();
			showFeedback('success', 'Programación creada.');
		},
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo crear la programación.'),
	});

	const updateScheduleMutation = useMutation({
		mutationFn: ({ scheduleId, payload }) => updateCampaignSchedule(scheduleId, payload),
		onSuccess: () => {
			invalidateAll();
			showFeedback('success', 'Programación actualizada.');
		},
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo actualizar la programación.'),
	});

	const deleteScheduleMutation = useMutation({
		mutationFn: deleteCampaignSchedule,
		onSuccess: () => {
			invalidateAll();
			showFeedback('success', 'Programación eliminada.');
		},
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo eliminar la programación.'),
	});

	const previewScheduleMutation = useMutation({
		mutationFn: previewCampaignSchedule,
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo previsualizar la audiencia.'),
	});

	const runScheduleNowMutation = useMutation({
		mutationFn: runCampaignScheduleNow,
		onSuccess: (result) => {
			invalidateAll(result?.campaignId || null);
			showFeedback('success', `Programacion ejecutada para ${Number(result?.selectedCount || 0)} destinatario(s).`);
		},
		onError: (error) => showFeedback('error', error?.response?.data?.error || 'No se pudo ejecutar la programacion.'),
	});

	const dispatchTickMutation = useMutation({
		mutationFn: runCampaignDispatchTick,
		onSuccess: (result) => {
			invalidateAll();
			const processedSchedules = Number(result?.schedules?.processed || 0);
			const processedCampaign = Boolean(result?.campaigns?.processed);
			showFeedback(
				'success',
				processedSchedules || processedCampaign
					? `Dispatcher ejecutado: ${processedSchedules} programacion(es) procesada(s).`
					: 'Dispatcher ejecutado. No habia programaciones o campanas pendientes.'
			);
		},
		onError: (error) =>
			showFeedback('error', error?.response?.data?.error || 'No se pudo ejecutar el dispatcher.'),
	});

	const updateShipmentSettingsMutation = useMutation({
		mutationFn: updateShipmentNotificationSettings,
		onSuccess: () => {
			invalidateAll();
			showFeedback('success', 'Avisos de despacho actualizados.');
		},
		onError: (error) =>
			showFeedback('error', error?.response?.data?.error || 'No se pudo actualizar avisos de despacho.'),
	});

	const sendShipmentNotificationsMutation = useMutation({
		mutationFn: sendShipmentNotifications,
		onSuccess: (result) => {
			invalidateAll(result?.campaignId || null);
			showFeedback('success', `Avisos de despacho creados para ${Number(result?.selectedCount || 0)} destinatario(s).`);
		},
		onError: (error) =>
			showFeedback('error', error?.response?.data?.error || 'No se pudieron enviar los avisos de despacho.'),
	});

	const actionMutation = useMutation({
		mutationFn: async ({ type, campaignId }) => {
			const item = trackingItems.find((entry) => entry.id === campaignId) || null;
			const isAutomationRun = item?.kind === 'automation_run';
			if (isAutomationRun && type === 'resume') return resumeAutomationRun(campaignId);
			if (isAutomationRun) return null;
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

	function handlePreviewAbandonedCarts(payload = {}) {
		const resolvedTemplateId = payload.templateId || selectedTemplate?.id || null;

		if (!resolvedTemplateId) {
			showFeedback('error', 'Elegí un template para previsualizar la campaña.');
			return;
		}

		abandonedCartPreviewMutation.mutate({
			templateId: resolvedTemplateId,
			filters: payload.filters || buildAbandonedCartFilters(abandonedCartForm),
			variableMapping: payload.variableMapping || {},
			manualVariables: payload.manualVariables || {},
		});
	}

	function handleCreateAbandonedCartCampaign(payload = {}) {
		createAbandonedCartCampaignMutation.mutate(payload);
	}

	return {
		feedback,
		overview,
		templates,
		campaigns,
		schedules,
		shipmentNotifications,
		selectedTemplate,
		setSelectedTemplate,
		selectedCampaign,
		setSelectedCampaignId,
		queries: {
			overview: overviewQuery,
			templates: templatesQuery,
			campaigns: campaignsQuery,
			automationRuns: automationRunsQuery,
			campaignDetail: campaignDetailQuery,
			schedules: schedulesQuery,
			abandonedCartAutomation: abandonedCartAutomationQuery,
			pendingPaymentAutomation: pendingPaymentAutomationQuery,
			shipmentSettings: shipmentSettingsQuery,
			shipmentCandidates: shipmentCandidatesQuery,
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
			updateAbandonedCartAutomation: updateAbandonedCartAutomationMutation,
			runAbandonedCartAutomationNow: runAbandonedCartAutomationNowMutation,
			updatePendingPaymentAutomation: updatePendingPaymentAutomationMutation,
			runPendingPaymentAutomationNow: runPendingPaymentAutomationNowMutation,
			createAbandonedCampaign: createAbandonedCartCampaignMutation,
			createSchedule: createScheduleMutation,
			updateSchedule: updateScheduleMutation,
			deleteSchedule: deleteScheduleMutation,
			previewSchedule: previewScheduleMutation,
			runScheduleNow: runScheduleNowMutation,
			dispatchTick: dispatchTickMutation,
			updateShipmentSettings: updateShipmentSettingsMutation,
			sendShipmentNotifications: sendShipmentNotificationsMutation,
		},
		tracking: {
			statusFilter: campaignTrackingStatus,
			setStatusFilter: setCampaignTrackingStatus,
			purchaseFilter: campaignTrackingPurchase,
			setPurchaseFilter: setCampaignTrackingPurchase,
			search: campaignTrackingSearch,
			setSearch: setCampaignTrackingSearch,
			page: campaignTrackingPage,
			setPage: setCampaignTrackingPage,
			pageSize: CAMPAIGN_TRACKING_PAGE_SIZE,
		},
		abandonedCart: {
			form: abandonedCartForm,
			preview: abandonedCartPreview,
			automationSettings: abandonedCartAutomationQuery.data?.settings || null,
			automationLoading: abandonedCartAutomationQuery.isLoading || abandonedCartAutomationQuery.isFetching,
			updateField: updateAbandonedCartForm,
			handlePreview: handlePreviewAbandonedCarts,
			handleCreate: handleCreateAbandonedCartCampaign,
		},
		pendingPayment: {
			automationSettings: pendingPaymentAutomationQuery.data?.settings || null,
			automationLoading: pendingPaymentAutomationQuery.isLoading || pendingPaymentAutomationQuery.isFetching,
		},
	};
}
