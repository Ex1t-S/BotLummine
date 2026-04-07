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
			<div className="campaign-stage-header">
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
		abandonedCart,
	} = useCampaignsDashboard();

	const approvedTemplates = Number(overview.approvedTemplatesCount || 0);
	const activeCampaigns = Number(overview.activeCampaignsCount || 0);
	const recipients = Number(overview.recipientsCount || 0);
	const estimatedCost = Number(overview.estimatedMonthlyCostUsd || 0);

	return (
		<section className="campaigns-page campaign-page-stack">
			<div className="campaigns-hero page-card campaign-shell-card">
				<div className="campaigns-hero-copy">
					<span className="campaigns-eyebrow">Campañas · WhatsApp Templates</span>
					<h2>Campañas más claras, vendibles y fáciles de operar</h2>
					<p>
						Ordená el trabajo comercial por pasos: elegí audiencia, definí el mensaje,
						creá la campaña y seguí su resultado sin obligar al usuario a entender Meta por
						dentro.
					</p>

					<div className="campaigns-hero-highlights">
						<div className="campaigns-hero-highlight">
							<strong>{approvedTemplates}</strong>
							<span>templates aprobados</span>
						</div>
						<div className="campaigns-hero-highlight">
							<strong>{activeCampaigns}</strong>
							<span>campañas activas o en cola</span>
						</div>
						<div className="campaigns-hero-highlight">
							<strong>{recipients}</strong>
							<span>destinatarios acumulados</span>
						</div>
						<div className="campaigns-hero-highlight accent">
							<strong>USD {estimatedCost.toFixed(2)}</strong>
							<span>actividad estimada actual</span>
						</div>
					</div>
				</div>

				<div className="campaigns-hero-side">
					<CampaignFeedbackAlert feedback={feedback} />

					<div className="campaign-quick-guide">
						<div className="campaign-quick-guide-title">Recorrido recomendado</div>
						<ol>
							<li>Elegí o sincronizá un template.</li>
							<li>Armá la audiencia manual o desde carritos.</li>
							<li>Creá la campaña y revisá el historial.</li>
						</ol>
					</div>
				</div>
			</div>

			<CampaignOverviewGrid overview={overview} />

			<div className="campaign-workflow-strip page-card campaign-shell-card">
				<div className="campaign-workflow-step is-active">
					<span>01</span>
					<div>
						<strong>Audiencia</strong>
						<small>Elegí a quién escribirle.</small>
					</div>
				</div>
				<div className="campaign-workflow-step">
					<span>02</span>
					<div>
						<strong>Mensaje</strong>
						<small>Seleccioná o editá el template.</small>
					</div>
				</div>
				<div className="campaign-workflow-step">
					<span>03</span>
					<div>
						<strong>Lanzamiento</strong>
						<small>Creá la campaña y despachala.</small>
					</div>
				</div>
				<div className="campaign-workflow-step">
					<span>04</span>
					<div>
						<strong>Seguimiento</strong>
						<small>Controlá estados y resultados.</small>
					</div>
				</div>
			</div>

			<PageSection
				eyebrow="Paso 1"
				title="Audiencias y recuperación de carritos"
				description="Este bloque está pensado para usuarios de negocio: menos configuración técnica, más foco en quién recibe la campaña y por qué."
			>
				<CampaignAccordion
					title="Recuperación automática desde carritos abandonados"
					description="Generá una audiencia lista para usar con filtros simples y una vista previa clara."
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
				title="Templates y contenido del mensaje"
				description="La biblioteca queda separada del editor para que el usuario primero encuentre el mensaje correcto y después lo ajuste si hace falta."
			>
				<div className="campaign-section-grid campaign-section-grid--editor">
					<CampaignAccordion
						title="Biblioteca de templates"
						description="Buscá, filtrá y elegí la plantilla correcta para cada campaña."
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
						description="Ajustá el contenido y dejalo listo para campañas futuras sin salir del módulo."
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
				title="Creación de campañas y seguimiento"
				description="Primero se arma el envío, después se monitorea. El historial queda explicado en lenguaje más comercial para que no parezca una consola técnica."
			>
				<div className="campaign-section-grid two-rows">
					<CampaignAccordion
						title="Crear campaña manual"
						description="Elegí template, definí audiencia y dejá listo el envío."
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
						description="Revisá borradores, campañas activas y resultados en una vista más clara y accionable."
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
			</PageSection>
		</section>
	);
}
