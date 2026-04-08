import CampaignComposerPanel from '../../components/campaigns/CampaignComposerPanel.jsx';
import CampaignRunsPanel from '../../components/campaigns/CampaignRunsPanel.jsx';
import TemplateBuilderPanel from '../../components/campaigns/TemplateBuilderPanel.jsx';
import TemplateLibraryPanel from '../../components/campaigns/TemplateLibraryPanel.jsx';
import CampaignAccordion from './components/CampaignAccordion.jsx';
import AbandonedCartCampaignPanel from './components/AbandonedCartCampaignPanel.jsx';
import CampaignFeedbackAlert from './components/CampaignFeedbackAlert.jsx';
import CampaignOverviewGrid from './components/CampaignOverviewGrid.jsx';
import { useCampaignsDashboard } from './hooks/useCampaignsDashboard.js';

function PageSection({ eyebrow, title, description, actions = null, children, className = '' }) {
	return (
		<section className={`campaign-stage ${className}`.trim()}>
			<div className="campaign-stage-header campaign-stage-header--compact">
				<div>
					{eyebrow ? <span className="campaign-stage-eyebrow">{eyebrow}</span> : null}
					<h3>{title}</h3>
					{description ? <p>{description}</p> : null}
				</div>
				{actions ? <div className="campaign-stage-actions">{actions}</div> : null}
			</div>
			{children}
		</section>
	);
}

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
	tracking,
	abandonedCart,
} = useCampaignsDashboard();

	const approvedTemplates = Number(overview.approvedTemplatesCount || 0);
	const activeCampaigns = Number(overview.activeCampaignsCount || 0);
	const recipients = Number(overview.recipientsCount || 0);
	const estimatedCost = Number(overview.estimatedMonthlyCostUsd || 0);

	return (
		<section className="campaigns-page campaign-page-stack">
			<div className="campaigns-hero page-card campaign-shell-card campaigns-hero--clean">
				<div className="campaigns-hero-copy">
					<span className="campaigns-eyebrow">Campañas · WhatsApp Templates</span>
					<h2>Campañas simples de crear y fáciles de seguir</h2>
					<p className="campaigns-hero-lead">
						Elegí audiencia, mensaje y lanzamiento sin enterrarte en opciones técnicas. La idea es vender más, no pelearte con el panel.
					</p>

					<div className="campaigns-hero-highlights campaigns-hero-highlights--compact">
						<div className="campaigns-hero-highlight">
							<strong>{approvedTemplates}</strong>
							<span>templates aprobados</span>
						</div>

						<div className="campaigns-hero-highlight">
							<strong>{activeCampaigns}</strong>
							<span>activas o en cola</span>
						</div>

						<div className="campaigns-hero-highlight">
							<strong>{recipients}</strong>
							<span>destinatarios</span>
						</div>

						<div className="campaigns-hero-highlight accent">
							<strong>USD {estimatedCost.toFixed(2)}</strong>
							<span>actividad estimada</span>
						</div>
					</div>

					<div className="campaigns-mini-steps">
						<span>1. Audiencia</span>
						<span>2. Mensaje</span>
						<span>3. Lanzamiento</span>
						<span>4. Seguimiento</span>
					</div>
				</div>

				<div className="campaigns-hero-side campaigns-hero-side--stack">
					<CampaignFeedbackAlert feedback={feedback} />

					<div className="campaign-quick-guide campaign-quick-guide--compact">
						<div className="campaign-quick-guide-title">Inicio rápido</div>
						<div className="campaign-quick-guide-pills">
							<span>Elegí template</span>
							<span>Definí audiencia</span>
							<span>Creá campaña</span>
						</div>
					</div>
				</div>
			</div>

			<CampaignOverviewGrid overview={overview} />

			<div className="campaign-workflow-strip page-card campaign-shell-card campaign-workflow-strip--clean">
				<div className="campaign-workflow-step is-active">
					<span>01</span>
					<div>
						<strong>Audiencia</strong>
						<small>Quién recibe</small>
					</div>
				</div>

				<div className="campaign-workflow-step is-active">
					<span>02</span>
					<div>
						<strong>Mensaje</strong>
						<small>Qué se envía</small>
					</div>
				</div>

				<div className="campaign-workflow-step">
					<span>03</span>
					<div>
						<strong>Lanzamiento</strong>
						<small>Cuándo sale</small>
					</div>
				</div>

				<div className="campaign-workflow-step">
					<span>04</span>
					<div>
						<strong>Seguimiento</strong>
						<small>Qué resultado tuvo</small>
					</div>
				</div>
			</div>

			<PageSection
				eyebrow="Paso 1"
				title="Audiencia y recuperación"
				description="Elegí a quién escribir con filtros simples y vista previa."
			>
				<CampaignAccordion
					title="Carritos abandonados"
					description="Armá una audiencia lista para usar."
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
			</PageSection>

			<PageSection
				eyebrow="Paso 2"
				title="Templates"
				description="Primero elegí uno de la biblioteca. Después lo editás con un flujo más claro y visual."
			>
				<div className="campaign-section-grid campaign-section-grid--editor">
					<CampaignAccordion
						title="Biblioteca"
						description="Buscá y seleccioná una plantilla."
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
						title="Editor"
						description="Editá el contenido, revisá la vista previa y guardalo listo para usar."
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
			</PageSection>

			<PageSection
				eyebrow="Paso 3 y 4"
				title="Creación y seguimiento"
				description="Primero se arma la campaña. Después se controla su estado."
			>
				<div className="campaign-section-grid two-rows">
					<CampaignAccordion
						title="Crear campaña manual"
						description="Configurá el envío."
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
						title="Historial"
						description="Revisá estado y resultados."
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
							tracking={tracking}
						/>
					</CampaignAccordion>
				</div>
			</PageSection>
		</section>
	);
}