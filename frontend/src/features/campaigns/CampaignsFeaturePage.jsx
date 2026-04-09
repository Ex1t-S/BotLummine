import { useMemo, useState } from 'react';
import CampaignComposerPanel from '../../components/campaigns/CampaignComposerPanel.jsx';
import CampaignRunsPanel from '../../components/campaigns/CampaignRunsPanel.jsx';
import TemplateBuilderPanel from '../../components/campaigns/TemplateBuilderPanel.jsx';
import TemplateLibraryPanel from '../../components/campaigns/TemplateLibraryPanel.jsx';
import AbandonedCartCampaignPanel from './components/AbandonedCartCampaignPanel.jsx';
import CampaignFeedbackAlert from './components/CampaignFeedbackAlert.jsx';
import { useCampaignsDashboard } from './hooks/useCampaignsDashboard.js';

const TAB_DEFINITIONS = [
	{
		id: 'library',
		label: 'Biblioteca de templates',
		title: 'Biblioteca de templates',
		description:
			'Buscá, filtrá y elegí la plantilla con la que querés trabajar. Desde acá arrancás sin dar vueltas.',
	},
	{
		id: 'builder',
		label: 'Editor de template',
		title: 'Editor de template',
		description:
			'Modificá el contenido del template, revisá la vista previa y dejalo listo para usar en campañas.',
	},
	{
		id: 'audience',
		label: 'Audiencia',
		title: 'Audiencia y recuperación',
		description:
			'Definí a quién escribir con filtros claros, vista previa y creación directa para carritos abandonados.',
	},
	{
		id: 'launch',
		label: 'Lanzamiento',
		title: 'Lanzamiento',
		description:
			'Configurá la campaña, elegí el mensaje y dejala lista para salir sin mezclar esto con el historial.',
	},
	{
		id: 'tracking',
		label: 'Seguimiento',
		title: 'Seguimiento',
		description:
			'Revisá estados, resultados y destinatarios desde una vista separada para controlar lo que ya salió.',
	},
];

function DashboardTabButton({ tab, isActive, onClick, badge }) {
	return (
		<button
			type="button"
			className={`campaigns-tab-button ${isActive ? 'is-active' : ''}`.trim()}
			onClick={() => onClick(tab.id)}
		>
			<span className="campaigns-tab-button__label">{tab.label}</span>
			{badge !== null && badge !== undefined ? (
				<span className="campaigns-tab-button__badge">{badge}</span>
			) : null}
		</button>
	);
}

function CampaignSectionShell({ eyebrow, title, description, sidebar, children }) {
	return (
		<section className="campaigns-tab-shell page-card campaign-shell-card">
			<div className="campaigns-tab-shell__header">
				<div>
					{eyebrow ? <span className="campaigns-tab-shell__eyebrow">{eyebrow}</span> : null}
					<h3>{title}</h3>
					{description ? <p>{description}</p> : null}
				</div>
				{sidebar ? <div className="campaigns-tab-shell__sidebar">{sidebar}</div> : null}
			</div>
			<div className="campaigns-tab-shell__body">{children}</div>
		</section>
	);
}

function SummaryCard({ label, value }) {
	return (
		<div className="campaigns-summary-card">
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

	const [activeTab, setActiveTab] = useState('library');

	const currentTab = useMemo(
		() => TAB_DEFINITIONS.find((tab) => tab.id === activeTab) || TAB_DEFINITIONS[0],
		[activeTab]
	);

	const approvedTemplates = Number(overview.approvedTemplatesCount || 0);
	const campaignsCount = Number(overview.campaignsCount || campaigns.length || 0);
	const recipientsCount = Number(overview.recipientsCount || 0);
	const estimatedCost = `USD ${Number(overview.estimatedMonthlyCostUsd || 0).toFixed(2)}`;

	const summary = (
		<div className="campaigns-summary-panel">
			<SummaryCard label="Template activo" value={selectedTemplate?.name || 'Sin seleccionar'} />
			<SummaryCard label="Campaña en foco" value={selectedCampaign?.name || 'Sin seleccionar'} />
			<SummaryCard label="Destinatarios" value={recipientsCount} />
			<SummaryCard label="Actividad estimada" value={estimatedCost} />
		</div>
	);

	function renderContent() {
		switch (activeTab) {
			case 'library':
				return (
					<CampaignSectionShell
						eyebrow="Templates"
						title="Biblioteca de templates"
						description={currentTab.description}
						sidebar={summary}
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
					</CampaignSectionShell>
				);

			case 'builder':
				return (
					<CampaignSectionShell
						eyebrow="Templates"
						title="Editor de template"
						description={currentTab.description}
						sidebar={summary}
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
					</CampaignSectionShell>
				);

			case 'audience':
				return (
					<CampaignSectionShell
						eyebrow="Audiencia"
						title="Audiencia y recuperación"
						description={currentTab.description}
						sidebar={summary}
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
					</CampaignSectionShell>
				);

			case 'launch':
				return (
					<CampaignSectionShell
						eyebrow="Campañas"
						title="Lanzamiento"
						description={currentTab.description}
						sidebar={summary}
					>
						<CampaignComposerPanel
							templates={templates}
							selectedTemplate={selectedTemplate}
							onSelectTemplate={setSelectedTemplate}
							onCreateCampaign={(payload) => mutations.createCampaign.mutateAsync(payload)}
							creating={mutations.createCampaign.isPending}
						/>
					</CampaignSectionShell>
				);

			case 'tracking':
				return (
					<CampaignSectionShell
						eyebrow="Campañas"
						title="Seguimiento"
						description={currentTab.description}
						sidebar={summary}
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
					</CampaignSectionShell>
				);

			default:
				return null;
		}
	}

	return (
		<section className="campaigns-page campaigns-page--tabs">
			<div className="campaigns-hero page-card campaign-shell-card campaigns-hero--tabs">
				<div className="campaigns-hero-copy campaigns-hero-copy--full">
					<span className="campaigns-eyebrow">Campañas · WhatsApp Templates</span>
					<h2>Creación y seguimiento de campañas</h2>
					<p className="campaigns-hero-lead">
						Creá campañas de WhatsApp, elegí audiencia, editá templates y seguí resultados desde
						un solo lugar sin perderte en paneles gigantes.
					</p>

					<CampaignFeedbackAlert feedback={feedback} />

					<div className="campaigns-tab-nav" role="tablist" aria-label="Secciones de campañas">
						<DashboardTabButton
							tab={TAB_DEFINITIONS[0]}
							isActive={activeTab === 'library'}
							onClick={setActiveTab}
							badge={approvedTemplates}
						/>
						<DashboardTabButton
							tab={TAB_DEFINITIONS[1]}
							isActive={activeTab === 'builder'}
							onClick={setActiveTab}
							badge={selectedTemplate ? 'OK' : '—'}
						/>
						<DashboardTabButton
							tab={TAB_DEFINITIONS[2]}
							isActive={activeTab === 'audience'}
							onClick={setActiveTab}
							badge={recipientsCount}
						/>
						<DashboardTabButton
							tab={TAB_DEFINITIONS[3]}
							isActive={activeTab === 'launch'}
							onClick={setActiveTab}
							badge={campaignsCount}
						/>
						<DashboardTabButton
							tab={TAB_DEFINITIONS[4]}
							isActive={activeTab === 'tracking'}
							onClick={setActiveTab}
							badge={campaignsCount}
						/>
					</div>
				</div>
			</div>

			{renderContent()}
		</section>
	);
}
