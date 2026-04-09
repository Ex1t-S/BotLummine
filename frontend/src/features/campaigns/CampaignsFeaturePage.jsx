import CampaignComposerPanel from '../../components/campaigns/CampaignComposerPanel.jsx';
import CampaignRunsPanel from '../../components/campaigns/CampaignRunsPanel.jsx';
import TemplateBuilderPanel from '../../components/campaigns/TemplateBuilderPanel.jsx';
import TemplateLibraryPanel from '../../components/campaigns/TemplateLibraryPanel.jsx';
import AbandonedCartCampaignPanel from './components/AbandonedCartCampaignPanel.jsx';
import CampaignFeedbackAlert from './components/CampaignFeedbackAlert.jsx';
import { useCampaignsDashboard } from './hooks/useCampaignsDashboard.js';

function PageSection({ title, description, children, className = '' }) {
	return (
		<section className={`campaign-stage ${className}`.trim()}>
			<div className="campaign-stage-header campaign-stage-header--compact campaign-stage-header--plain">
				<div>
					<h3>{title}</h3>
					{description ? <p>{description}</p> : null}
				</div>
			</div>
			{children}
		</section>
	);
}

function StageCard({ title, description, children, className = '' }) {
	return (
		<div className={`campaign-stage-card ${className}`.trim()}>
			<div className="campaign-stage-card-header">
				<div>
					<h4>{title}</h4>
					{description ? <p>{description}</p> : null}
				</div>
			</div>
			<div className="campaign-stage-card-body">{children}</div>
		</div>
	);
}

function SummaryItem({ label, value, muted = false }) {
	return (
		<div className={`campaign-summary-item${muted ? ' is-muted' : ''}`}>
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
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
			<div className="campaign-page-feedback-row">
				<CampaignFeedbackAlert feedback={feedback} />
			</div>

			<div className="campaign-builder-layout">
				<div className="campaign-builder-main">
					<PageSection
						title="Audiencia"
						description="Definí a quién escribir sin abrir y cerrar paneles a cada rato."
					>
						<StageCard
							title="Carritos abandonados"
							description="Armá una audiencia lista para usar con filtros, vista previa y creación directa."
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
						</StageCard>
					</PageSection>

					<PageSection
						title="Templates y mensaje"
						description="Elegí una base y editála en la misma vista, sin acordeones gigantes peleando por tu atención."
					>
						<div className="campaign-section-grid campaign-section-grid--editor campaign-stage-cards-grid">
							<StageCard
								title="Biblioteca"
								description="Buscá, filtrá y elegí la plantilla con la que querés trabajar."
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
							</StageCard>

							<StageCard
								title="Editor"
								description="Modificá el contenido y dejá el template listo para usar."
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
							</StageCard>
						</div>
					</PageSection>

					<PageSection
						title="Lanzamiento"
						description="Configurá la campaña y dejala lista para salir."
					>
						<StageCard
							title="Crear campaña manual"
							description="Elegí el template, definí el envío y creá la campaña."
						>
							<CampaignComposerPanel
								templates={templates}
								selectedTemplate={selectedTemplate}
								onSelectTemplate={setSelectedTemplate}
								onCreateCampaign={(payload) => mutations.createCampaign.mutateAsync(payload)}
								creating={mutations.createCampaign.isPending}
							/>
						</StageCard>
					</PageSection>
				</div>

				<aside className="campaign-builder-sidebar">
					<div className="campaign-summary-card">
						<div className="campaign-summary-card-header">
							<span className="campaigns-eyebrow">Resumen</span>
							<h3>Vista general de la campaña</h3>
							<p>
								Mientras configurás, acá tenés a mano lo importante sin perderte entre bloques.
							</p>
						</div>

						<div className="campaign-summary-grid">
							<SummaryItem label="Templates aprobados" value={approvedTemplates} />
							<SummaryItem label="Campañas activas" value={activeCampaigns} />
							<SummaryItem label="Destinatarios" value={recipients} />
							<SummaryItem label="Actividad estimada" value={`USD ${estimatedCost.toFixed(2)}`} />
						</div>

						<div className="campaign-summary-divider" />

						<div className="campaign-summary-list">
							<SummaryItem
								label="Template seleccionado"
								value={selectedTemplate?.name || 'Todavía no elegiste uno'}
								muted={!selectedTemplate}
							/>
							<SummaryItem
								label="Idioma"
								value={selectedTemplate?.language || '—'}
								muted={!selectedTemplate?.language}
							/>
							<SummaryItem
								label="Campaña en foco"
								value={selectedCampaign?.name || 'Todavía no seleccionaste una'}
								muted={!selectedCampaign}
							/>
							<SummaryItem
								label="Estado actual"
								value={selectedCampaign?.status || 'Borrador'}
								muted={!selectedCampaign?.status}
							/>
						</div>
					</div>
				</aside>
			</div>

			<PageSection
				title="Seguimiento"
				description="Historial y estado de campañas en una sección aparte, sin mezclarlo con la creación."
			>
				<StageCard
					title="Historial"
					description="Revisá resultados, estados y acciones disponibles."
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
				</StageCard>
			</PageSection>
		</section>
	);
}
