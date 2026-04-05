import CampaignComposerPanel from '../../components/campaigns/CampaignComposerPanel.jsx';
import CampaignRunsPanel from '../../components/campaigns/CampaignRunsPanel.jsx';
import TemplateBuilderPanel from '../../components/campaigns/TemplateBuilderPanel.jsx';
import TemplateLibraryPanel from '../../components/campaigns/TemplateLibraryPanel.jsx';
import CampaignAccordion from './components/CampaignAccordion.jsx';
import AbandonedCartCampaignPanel from './components/AbandonedCartCampaignPanel.jsx';
import CampaignFeedbackAlert from './components/CampaignFeedbackAlert.jsx';
import CampaignOverviewGrid from './components/CampaignOverviewGrid.jsx';
import { useCampaignsDashboard } from './hooks/useCampaignsDashboard.js';

export default function CampaignsFeaturePage() {
	const {
		feedback,
		overview,
		templates,
		campaigns,
		selectedTemplate,
		setSelectedTemplate,
		selectedCampaign,
		setSelectedCampaignId,
		queries,
		mutations,
		abandonedCart,
	} = useCampaignsDashboard();

	return (
		<section className="campaigns-page campaign-page-stack">
			<div className="campaigns-hero page-card">
				<div>
					<span className="campaigns-eyebrow">Campañas · WhatsApp Templates</span>
					<h2>Módulo comercial listo para vender en serio</h2>
					<p>
						Creá templates, sincronizalos con Meta, armá campañas, estimá costo y seguí el
						estado de cada envío sin salir del panel.
					</p>
				</div>

				<CampaignFeedbackAlert feedback={feedback} />
			</div>

			<CampaignOverviewGrid overview={overview} />

			<CampaignAccordion
				title="Campañas desde carritos abandonados"
				description="Generá audiencia automática desde AbandonedCart y ocultá este bloque cuando no lo uses."
				defaultOpen={true}
			>
				<AbandonedCartCampaignPanel
					templates={templates}
					selectedTemplate={selectedTemplate}
					onSelectTemplate={setSelectedTemplate}
					form={abandonedCart.form}
					onUpdateField={abandonedCart.updateField}
					preview={abandonedCart.preview}
					previewing={mutations.abandonedPreview.isPending}
					creating={mutations.createAbandonedCampaign.isPending}
					onPreview={abandonedCart.handlePreview}
					onCreate={abandonedCart.handleCreate}
				/>
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
						onSync={() => mutations.sync.mutate()}
						syncing={mutations.sync.isPending}
						onDeleteTemplate={(template) => {
							const confirmed = window.confirm(`¿Eliminar el template ${template.name}?`);
							if (confirmed) {
								mutations.deleteTemplate.mutate(template.id);
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
						creating={mutations.createTemplate.isPending}
						updating={mutations.updateTemplate.isPending}
						onCreateTemplate={(payload) => mutations.createTemplate.mutateAsync(payload)}
						onUpdateTemplate={(templateId, payload) =>
							mutations.updateTemplate.mutateAsync({ templateId, payload })
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
						onCreateCampaign={(payload) => mutations.createCampaign.mutateAsync(payload)}
						creating={mutations.createCampaign.isPending}
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
						onDispatch={(campaignId) => mutations.action.mutate({ type: 'dispatch', campaignId })}
						onPause={(campaignId) => mutations.action.mutate({ type: 'pause', campaignId })}
						onResume={(campaignId) => mutations.action.mutate({ type: 'resume', campaignId })}
						onDelete={(campaign) => {
							if (!campaign?.id) return;
							const confirmed = window.confirm(
								`¿Eliminar la campaña "${campaign.name}"?\n\nEsta acción no se puede deshacer.`
							);
							if (!confirmed) return;
							mutations.deleteCampaign.mutate(campaign.id);
						}}
						actionLoading={mutations.action.isPending || queries.campaignDetail.isFetching}
						deleteLoading={mutations.deleteCampaign.isPending}
					/>
				</CampaignAccordion>
			</div>
		</section>
	);
}
