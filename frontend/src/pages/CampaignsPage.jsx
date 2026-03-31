import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import CampaignKpiCard from '../components/campaigns/CampaignKpiCard.jsx';
import TemplateLibraryPanel from '../components/campaigns/TemplateLibraryPanel.jsx';
import TemplateBuilderPanel from '../components/campaigns/TemplateBuilderPanel.jsx';
import CampaignComposerPanel from '../components/campaigns/CampaignComposerPanel.jsx';
import CampaignRunsPanel from '../components/campaigns/CampaignRunsPanel.jsx';
import {
  createCampaign,
  createTemplate,
  deleteTemplate,
  dispatchCampaign,
  fetchCampaignDetail,
  fetchCampaignOverview,
  fetchCampaigns,
  fetchTemplates,
  pauseCampaign,
  resumeCampaign,
  syncTemplates,
  updateTemplate,
} from '../lib/campaigns.js';
import '../styles/campaigns.css';

function normalizeOverview(data) {
  return {
    templatesCount: data?.templatesCount ?? data?.templates?.length ?? 0,
    approvedTemplatesCount: data?.approvedTemplatesCount ?? data?.approvedTemplates ?? 0,
    campaignsCount: data?.campaignsCount ?? data?.campaigns?.length ?? 0,
    activeCampaignsCount: data?.activeCampaignsCount ?? data?.activeCampaigns ?? 0,
    recipientsCount: data?.recipientsCount ?? 0,
    estimatedMonthlyCostUsd: data?.estimatedMonthlyCostUsd ?? 0,
  };
}

function extractCreatedCampaignId(response) {
  return (
    response?.id ||
    response?.campaign?.id ||
    response?.data?.id ||
    response?.data?.campaign?.id ||
    null
  );
}

export default function CampaignsPage() {
  const queryClient = useQueryClient();
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const overviewQuery = useQuery({
    queryKey: ['campaigns-overview'],
    queryFn: fetchCampaignOverview,
  });

  const templatesQuery = useQuery({
    queryKey: ['campaign-templates'],
    queryFn: () => fetchTemplates(),
  });

  const campaignsQuery = useQuery({
    queryKey: ['campaign-runs'],
    queryFn: () => fetchCampaigns(),
  });

  const campaignDetailQuery = useQuery({
    queryKey: ['campaign-detail', selectedCampaignId],
    queryFn: () => fetchCampaignDetail(selectedCampaignId),
    enabled: Boolean(selectedCampaignId),
  });

  const templates = useMemo(() => {
    const data = templatesQuery.data;
    if (Array.isArray(data)) return data;
    return data?.items || data?.templates || [];
  }, [templatesQuery.data]);

  const campaigns = useMemo(() => {
    const data = campaignsQuery.data;
    if (Array.isArray(data)) return data;
    return data?.items || data?.campaigns || [];
  }, [campaignsQuery.data]);

  const selectedCampaign = useMemo(() => {
    const detail = campaignDetailQuery.data;

    if (detail?.campaign) {
      return {
        ...detail.campaign,
        template: detail.template || null,
        recipients: Array.isArray(detail.recipients) ? detail.recipients : [],
        pagination: detail.pagination || null,
      };
    }

    return campaigns.find((campaign) => campaign.id === selectedCampaignId) || null;
  }, [campaignDetailQuery.data, campaigns, selectedCampaignId]);

  const overview = normalizeOverview(overviewQuery.data || {});

  useEffect(() => {
    if (!selectedTemplate && templates.length) {
      setSelectedTemplate(templates[0]);
    }
  }, [templates, selectedTemplate]);

  useEffect(() => {
    if (!selectedCampaignId && campaigns.length) {
      setSelectedCampaignId(campaigns[0].id);
    }
  }, [campaigns, selectedCampaignId]);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['campaigns-overview'] });
    queryClient.invalidateQueries({ queryKey: ['campaign-templates'] });
    queryClient.invalidateQueries({ queryKey: ['campaign-runs'] });

    if (selectedCampaignId) {
      queryClient.invalidateQueries({
        queryKey: ['campaign-detail', selectedCampaignId],
      });
    }
  }

  function showFeedback(type, message) {
    setFeedback({ type, message });
    window.clearTimeout(window.__campaignFeedbackTimeout);
    window.__campaignFeedbackTimeout = window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  useEffect(() => {
    async function handleLaunchRequested(event) {
      const campaignId = event?.detail?.campaignId;
      if (!campaignId) return;

      try {
        await dispatchCampaign(campaignId);
        invalidateAll();
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

    return () => {
      window.removeEventListener('campaign:launch-requested', handleLaunchRequested);
    };
  }, [selectedCampaignId, queryClient]);

  const syncMutation = useMutation({
    mutationFn: syncTemplates,
    onSuccess: () => {
      invalidateAll();
      showFeedback('success', 'Templates sincronizados con Meta.');
    },
    onError: (error) =>
      showFeedback('error', error?.response?.data?.error || 'No se pudo sincronizar.'),
  });

  const createTemplateMutation = useMutation({
    mutationFn: createTemplate,
    onSuccess: () => {
      invalidateAll();
      showFeedback('success', 'Template creado correctamente.');
    },
    onError: (error) =>
      showFeedback('error', error?.response?.data?.error || 'No se pudo crear el template.'),
  });

  const updateTemplateMutation = useMutation({
    mutationFn: ({ templateId, payload }) => updateTemplate(templateId, payload),
    onSuccess: () => {
      invalidateAll();
      showFeedback('success', 'Template actualizado.');
    },
    onError: (error) =>
      showFeedback('error', error?.response?.data?.error || 'No se pudo actualizar el template.'),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => {
      invalidateAll();
      setSelectedTemplate(null);
      showFeedback('success', 'Template eliminado.');
    },
    onError: (error) =>
      showFeedback('error', error?.response?.data?.error || 'No se pudo eliminar el template.'),
  });

  const createCampaignMutation = useMutation({
    mutationFn: createCampaign,
    onSuccess: async (response) => {
      invalidateAll();

      const createdId = extractCreatedCampaignId(response);
      if (createdId) {
        setSelectedCampaignId(createdId);
      }

      showFeedback('success', 'Campaña creada.');
    },
    onError: (error) =>
      showFeedback('error', error?.response?.data?.error || 'No se pudo crear la campaña.'),
  });

  const actionMutation = useMutation({
    mutationFn: async ({ type, campaignId }) => {
      if (type === 'dispatch') return dispatchCampaign(campaignId);
      if (type === 'pause') return pauseCampaign(campaignId);
      if (type === 'resume') return resumeCampaign(campaignId);
      return null;
    },
    onSuccess: (_response, variables) => {
      invalidateAll();
      setSelectedCampaignId(variables.campaignId);
      showFeedback('success', 'Acción ejecutada correctamente.');
    },
    onError: (error) =>
      showFeedback('error', error?.response?.data?.error || 'No se pudo ejecutar la acción.'),
  });

  return (
    <section className="campaigns-page">
      <div className="campaigns-hero page-card">
        <div>
          <span className="campaigns-eyebrow">Campañas · WhatsApp Templates</span>
          <h2>Módulo comercial listo para vender en serio</h2>
          <p>
            Creá templates, sincronizalos con Meta, armá campañas, estimá costo y seguí el
            estado de cada envío sin salir del panel.
          </p>
        </div>

        {feedback ? (
          <div className={`campaign-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        ) : null}
      </div>

      <div className="campaign-kpi-grid">
        <CampaignKpiCard
          label="Templates totales"
          value={overview.templatesCount}
          hint={`${overview.approvedTemplatesCount} aprobados`}
        />
        <CampaignKpiCard
          label="Campañas"
          value={overview.campaignsCount}
          hint={`${overview.activeCampaignsCount} activas o en cola`}
        />
        <CampaignKpiCard
          label="Destinatarios"
          value={overview.recipientsCount}
          hint="audiencia acumulada"
        />
        <CampaignKpiCard
          label="Costo estimado"
          value={`USD ${Number(overview.estimatedMonthlyCostUsd || 0).toFixed(2)}`}
          hint="según actividad actual"
        />
      </div>

      <div className="campaign-section-grid">
        <TemplateLibraryPanel
          templates={templates}
          selectedTemplateId={selectedTemplate?.id}
          onSelectTemplate={setSelectedTemplate}
          onSync={() => syncMutation.mutate()}
          syncing={syncMutation.isPending}
          onDeleteTemplate={(template) => {
            const confirmed = window.confirm(`¿Eliminar el template ${template.name}?`);
            if (confirmed) {
              deleteTemplateMutation.mutate(template.id);
            }
          }}
        />

        <TemplateBuilderPanel
          selectedTemplate={selectedTemplate}
          creating={createTemplateMutation.isPending}
          updating={updateTemplateMutation.isPending}
          onCreateTemplate={(payload) => createTemplateMutation.mutateAsync(payload)}
          onUpdateTemplate={(templateId, payload) =>
            updateTemplateMutation.mutateAsync({ templateId, payload })
          }
        />
      </div>

      <div className="campaign-section-grid two-rows">
        <CampaignComposerPanel
          templates={templates}
          selectedTemplate={selectedTemplate}
          onSelectTemplate={setSelectedTemplate}
          onCreateCampaign={(payload) => createCampaignMutation.mutateAsync(payload)}
          creating={createCampaignMutation.isPending}
        />

        <CampaignRunsPanel
          campaigns={campaigns}
          selectedCampaign={selectedCampaign}
          onSelectCampaign={(campaign) => setSelectedCampaignId(campaign.id)}
          onDispatch={(campaignId) => actionMutation.mutate({ type: 'dispatch', campaignId })}
          onPause={(campaignId) => actionMutation.mutate({ type: 'pause', campaignId })}
          onResume={(campaignId) => actionMutation.mutate({ type: 'resume', campaignId })}
          actionLoading={actionMutation.isPending || campaignDetailQuery.isFetching}
        />
      </div>
    </section>
  );
}