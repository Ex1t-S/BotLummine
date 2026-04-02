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
	deleteCampaign,
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
import api from '../lib/api.js';
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

function formatPreviewText(text = '', max = 220) {
	const value = String(text || '').trim();
	if (!value) return '';
	if (value.length <= max) return value;
	return `${value.slice(0, max - 1).trim()}…`;
}

function buildAbandonedCartFilters(state) {
	return {
		daysBack: Number(state.daysBack || 7),
		status: state.status || 'NEW',
		limit: Number(state.limit || 50),
		minTotal:
			state.minTotal === '' || state.minTotal === null || state.minTotal === undefined
				? null
				: Number(state.minTotal),
		productQuery: String(state.productQuery || '').trim(),
	};
}

function CampaignAccordion({
	title,
	description,
	defaultOpen = true,
	className = '',
	children,
}) {
	return (
		<details className={`campaign-accordion ${className}`.trim()} open={defaultOpen}>
			<summary className="campaign-accordion-summary">
				<div className="campaign-accordion-copy">
					<strong>{title}</strong>
					{description ? <span>{description}</span> : null}
				</div>

				<span className="campaign-accordion-chevron" aria-hidden="true">
					⌄
				</span>
			</summary>

			<div className="campaign-accordion-body">{children}</div>
		</details>
	);
}

export default function CampaignsPage() {
	const queryClient = useQueryClient();
	const [selectedTemplate, setSelectedTemplate] = useState(null);
	const [selectedCampaignId, setSelectedCampaignId] = useState(null);
	const [feedback, setFeedback] = useState(null);
	const [abandonedCartForm, setAbandonedCartForm] = useState({
		name: '',
		notes: '',
		daysBack: 7,
		status: 'NEW',
		limit: 50,
		minTotal: '',
		productQuery: '',
		launchNow: false,
	});
	const [abandonedCartPreview, setAbandonedCartPreview] = useState({
		total: 0,
		recipients: [],
	});

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
		onSuccess: (response) => {
			invalidateAll();
			const createdTemplate = response?.template || response?.data?.template || null;
			if (createdTemplate?.id) {
				setSelectedTemplate(createdTemplate);
			}
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

	const deleteCampaignMutation = useMutation({
		mutationFn: deleteCampaign,
		onSuccess: (_response, deletedCampaignId) => {
			queryClient.removeQueries({
				queryKey: ['campaign-detail', deletedCampaignId],
			});

			setSelectedCampaignId((current) =>
				current === deletedCampaignId ? null : current
			);

			invalidateAll();
			showFeedback('success', 'Campaña eliminada.');
		},
		onError: (error) =>
			showFeedback('error', error?.response?.data?.error || 'No se pudo eliminar la campaña.'),
	});

	const abandonedCartPreviewMutation = useMutation({
		mutationFn: async ({ templateId, filters }) => {
			const response = await api.post('/campaigns/abandoned-carts/preview', {
				templateId,
				filters,
			});
			return response.data;
		},
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

			return {
				data,
				createdId,
				launchNow,
			};
		},
		onSuccess: ({ createdId, launchNow }) => {
			invalidateAll();

			if (createdId) {
				setSelectedCampaignId(createdId);
			}

			showFeedback(
				'success',
				launchNow
					? 'Campaña de carritos creada y lanzada.'
					: 'Campaña de carritos creada.'
			);
		},
		onError: (error) => {
			showFeedback(
				'error',
				error?.response?.data?.error ||
					error.message ||
					'No se pudo crear la campaña de carritos.'
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
			invalidateAll();
			setSelectedCampaignId(variables.campaignId);
			showFeedback('success', 'Acción ejecutada correctamente.');
		},
		onError: (error) =>
			showFeedback('error', error?.response?.data?.error || 'No se pudo ejecutar la acción.'),
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

			<CampaignAccordion
				title="Campañas desde carritos abandonados"
				description="Generá audiencia automática desde AbandonedCart y ocultá este bloque cuando no lo uses."
				defaultOpen={true}
			>
				<div className="campaign-custom-audience">
					<div className="campaign-custom-audience-intro">
						<span className="campaigns-eyebrow">Campañas desde carritos abandonados</span>
						<h3>Crear audiencia automática desde AbandonedCart</h3>
						<p>
							Usa el template seleccionado para generar audiencia desde carritos reales,
							deduplicados por teléfono.
						</p>
					</div>

					<div className="campaign-custom-audience-grid">
						<div className="campaign-custom-audience-card">
							<div className="field">
								<span>Template seleccionado</span>
								<select
									value={selectedTemplate?.id || ''}
									onChange={(e) => {
										const next =
											templates.find((template) => template.id === e.target.value) || null;
										setSelectedTemplate(next);
									}}
								>
									<option value="">Seleccionar template</option>
									{templates.map((template) => (
										<option key={template.id} value={template.id}>
											{template.name} · {template.language} · {template.status}
										</option>
									))}
								</select>
							</div>

							<div className="campaign-form-grid two-columns">
								<div className="field">
									<span>Nombre de campaña</span>
									<input
										value={abandonedCartForm.name}
										onChange={(e) => updateAbandonedCartForm('name', e.target.value)}
										placeholder="Recuperación carritos 7 días"
									/>
								</div>

								<div className="field">
									<span>Ventana</span>
									<select
										value={abandonedCartForm.daysBack}
										onChange={(e) => updateAbandonedCartForm('daysBack', Number(e.target.value))}
									>
										<option value={7}>7 días</option>
										<option value={15}>15 días</option>
										<option value={30}>30 días</option>
									</select>
								</div>
							</div>

							<div className="campaign-custom-audience-grid-4">
								<div className="field">
									<span>Estado</span>
									<select
										value={abandonedCartForm.status}
										onChange={(e) => updateAbandonedCartForm('status', e.target.value)}
									>
										<option value="NEW">NEW</option>
										<option value="CONTACTED">CONTACTED</option>
										<option value="ALL">ALL</option>
									</select>
								</div>

								<div className="field">
									<span>Límite</span>
									<input
										type="number"
										min="1"
										max="500"
										value={abandonedCartForm.limit}
										onChange={(e) => updateAbandonedCartForm('limit', Number(e.target.value || 50))}
									/>
								</div>

								<div className="field">
									<span>Monto mínimo</span>
									<input
										type="number"
										min="0"
										value={abandonedCartForm.minTotal}
										onChange={(e) => updateAbandonedCartForm('minTotal', e.target.value)}
										placeholder="0"
									/>
								</div>

								<div className="field">
									<span>Producto</span>
									<input
										value={abandonedCartForm.productQuery}
										onChange={(e) => updateAbandonedCartForm('productQuery', e.target.value)}
										placeholder="body, faja, calza"
									/>
								</div>
							</div>

							<div className="field">
								<span>Notas</span>
								<textarea
									value={abandonedCartForm.notes}
									onChange={(e) => updateAbandonedCartForm('notes', e.target.value)}
									placeholder="Notas internas de esta campaña"
									rows={3}
								/>
							</div>

							<label className="campaign-toggle">
								<input
									type="checkbox"
									checked={abandonedCartForm.launchNow}
									onChange={(e) => updateAbandonedCartForm('launchNow', e.target.checked)}
								/>
								Enviar apenas se cree
							</label>

							<div className="campaign-form-actions">
								<button
									type="button"
									className="button ghost"
									onClick={handlePreviewAbandonedCarts}
									disabled={abandonedCartPreviewMutation.isPending}
								>
									{abandonedCartPreviewMutation.isPending
										? 'Generando...'
										: 'Previsualizar audiencia'}
								</button>

								<button
									type="button"
									className="button primary"
									onClick={() => handleCreateAbandonedCartCampaign(abandonedCartForm.launchNow)}
									disabled={createAbandonedCartCampaignMutation.isPending}
								>
									{createAbandonedCartCampaignMutation.isPending
										? 'Creando campaña...'
										: abandonedCartForm.launchNow
											? 'Crear y lanzar'
											: 'Guardar campaña'}
								</button>
							</div>
						</div>

						<div className="campaign-custom-audience-card campaign-custom-audience-preview">
							<div className="campaign-custom-audience-preview-head">
								<div>
									<div className="campaign-custom-audience-preview-title">
										Preview de audiencia
									</div>
									<div className="campaign-custom-audience-preview-subtitle">
										{abandonedCartPreview.total || 0} destinatarios
									</div>
								</div>

								{selectedTemplate ? (
									<span className="campaign-custom-audience-pill">
										{selectedTemplate.name}
									</span>
								) : null}
							</div>

							<div className="campaign-custom-audience-preview-list">
								{abandonedCartPreview.recipients?.length ? (
									abandonedCartPreview.recipients.slice(0, 8).map((recipient, index) => (
										<div
											key={`${recipient.phone}-${index}`}
											className="campaign-custom-audience-recipient"
										>
											<div className="campaign-custom-audience-recipient-top">
												<strong>{recipient.contactName || recipient.phone}</strong>
												<span>{recipient.totalAmount || ''}</span>
											</div>

											<div className="campaign-custom-audience-recipient-product">
												{recipient.primaryProductName || 'Sin producto'}
											</div>

											<div className="campaign-custom-audience-recipient-phone">
												{recipient.phone}
											</div>

											{recipient.renderedPreviewText ? (
												<div className="campaign-custom-audience-recipient-preview">
													{formatPreviewText(recipient.renderedPreviewText, 260)}
												</div>
											) : null}
										</div>
									))
								) : (
									<div className="campaign-custom-audience-empty">
										Previsualizá la audiencia para ver los primeros destinatarios y
										cómo se renderiza el template.
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			</CampaignAccordion>

			<div className="campaign-section-grid campaign-section-grid--editor">
				<CampaignAccordion
					title="Biblioteca de templates"
					description="Mostrá u ocultá la lista y los filtros."
					defaultOpen={true}
				>
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
				</CampaignAccordion>

				<CampaignAccordion
					title="Editor de template"
					description="Ocultá el editor completo cuando estés mirando solo la biblioteca."
					defaultOpen={true}
				>
					<TemplateBuilderPanel
						selectedTemplate={selectedTemplate}
						creating={createTemplateMutation.isPending}
						updating={updateTemplateMutation.isPending}
						onCreateTemplate={(payload) => createTemplateMutation.mutateAsync(payload)}
						onUpdateTemplate={(templateId, payload) =>
							updateTemplateMutation.mutateAsync({ templateId, payload })
						}
					/>
				</CampaignAccordion>
			</div>

			<div className="campaign-section-grid two-rows">
				<CampaignAccordion
					title="Crear campaña manual"
					description="Composer y configuración de envío."
					defaultOpen={true}
				>
					<CampaignComposerPanel
						templates={templates}
						selectedTemplate={selectedTemplate}
						onSelectTemplate={setSelectedTemplate}
						onCreateCampaign={(payload) => createCampaignMutation.mutateAsync(payload)}
						creating={createCampaignMutation.isPending}
					/>
				</CampaignAccordion>

				<CampaignAccordion
					title="Historial de campañas"
					description="Runs, estado y acciones."
					defaultOpen={true}
				>
					<CampaignRunsPanel
						campaigns={campaigns}
						selectedCampaign={selectedCampaign}
						onSelectCampaign={(campaign) => setSelectedCampaignId(campaign.id)}
						onDispatch={(campaignId) => actionMutation.mutate({ type: 'dispatch', campaignId })}
						onPause={(campaignId) => actionMutation.mutate({ type: 'pause', campaignId })}
						onResume={(campaignId) => actionMutation.mutate({ type: 'resume', campaignId })}
						onDelete={(campaign) => {
							if (!campaign?.id) return;

							const confirmed = window.confirm(
								`¿Eliminar la campaña "${campaign.name}"?\n\nEsta acción no se puede deshacer.`
							);

							if (!confirmed) return;

							deleteCampaignMutation.mutate(campaign.id);
						}}
						actionLoading={actionMutation.isPending || campaignDetailQuery.isFetching}
						deleteLoading={deleteCampaignMutation.isPending}
					/>
				</CampaignAccordion>
			</div>
		</section>
	);
}