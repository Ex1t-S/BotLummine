import { useMemo, useState } from 'react';
import CampaignComposerPanel from '../../components/campaigns/CampaignComposerPanel.jsx';
import CampaignRunsPanel from '../../components/campaigns/CampaignRunsPanel.jsx';
import TemplateBuilderPanel from '../../components/campaigns/TemplateBuilderPanel.jsx';
import TemplateLibraryPanel from '../../components/campaigns/TemplateLibraryPanel.jsx';
import './CampaignsFeaturePage.css';
import AbandonedCartCampaignPanel from './components/AbandonedCartCampaignPanel.jsx';
import CampaignFeedbackAlert from './components/CampaignFeedbackAlert.jsx';
import { useCampaignsDashboard } from './hooks/useCampaignsDashboard.js';

const TAB_DEFINITIONS = [
	{
		id: 'library',
		label: 'Biblioteca de templates',
		eyebrow: 'Templates',
		title: 'Biblioteca de templates',
		description:
			'Buscá, filtrá y elegí la plantilla con la que querés trabajar. Desde acá arrancás sin dar vueltas.',
	},
	{
		id: 'builder',
		label: 'Editor de template',
		eyebrow: 'Templates',
		title: 'Editor de template',
		description:
			'Modificá el contenido del template, revisá la vista previa y dejalo listo para usar en campañas.',
	},
	{
		id: 'audience',
		label: 'Audiencia',
		eyebrow: 'Segmentación',
		title: 'Audiencia y recuperación',
		description:
			'Definí a quién escribir con filtros claros, vista previa y creación directa para carritos abandonados.',
	},
	{
		id: 'launch',
		label: 'Lanzamiento',
		eyebrow: 'Campañas',
		title: 'Lanzamiento',
		description:
			'Configurá la campaña, elegí el mensaje y dejala lista para salir sin mezclar esto con el historial.',
	},
	{
		id: 'tracking',
		label: 'Seguimiento',
		eyebrow: 'Campañas',
		title: 'Seguimiento',
		description:
			'Revisá estados, resultados y destinatarios desde una vista separada para controlar lo que ya salió.',
	},
];

function DashboardTabButton({ tab, isActive, onClick }) {
	return (
		<button
			type="button"
			className={`campaigns-nav-tab ${isActive ? 'is-active' : ''}`.trim()}
			onClick={() => onClick(tab.id)}
		>
			<span>{tab.label}</span>
		</button>
	);
}

function SummaryCard({ label, value, accent = false }) {
	return (
		<div className={`campaigns-overview-card ${accent ? 'is-accent' : ''}`.trim()}>
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}

function CampaignSectionShell({ eyebrow, title, description, children }) {
	return (
		<section className="page-card campaign-shell-card campaigns-workspace-shell">
			<div className="campaigns-workspace-shell__header">
				<div>
					{eyebrow ? <span className="campaigns-workspace-shell__eyebrow">{eyebrow}</span> : null}
					<h3>{title}</h3>
					{description ? <p>{description}</p> : null}
				</div>
			</div>
			<div className="campaigns-workspace-shell__body">{children}</div>
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

	const [activeTab, setActiveTab] = useState('library');

	const currentTab = useMemo(
		() => TAB_DEFINITIONS.find((tab) => tab.id === activeTab) || TAB_DEFINITIONS[0],
		[activeTab]
	);

	const approvedTemplates = Number(overview.approvedTemplatesCount || 0);
	const campaignsCount = Number(overview.campaignsCount || campaigns.length || 0);
	const recipientsCount = Number(overview.recipientsCount || 0);
	const estimatedCost = `USD ${Number(overview.estimatedMonthlyCostUsd || 0).toFixed(2)}`;

	function renderContent() {
		switch (activeTab) {
			case 'library':
				return (
					<CampaignSectionShell
						eyebrow={currentTab.eyebrow}
						title={currentTab.title}
						description={currentTab.description}
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
						eyebrow={currentTab.eyebrow}
						title={currentTab.title}
						description={currentTab.description}
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
						eyebrow={currentTab.eyebrow}
						title={currentTab.title}
						description={currentTab.description}
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
						eyebrow={currentTab.eyebrow}
						title={currentTab.title}
						description={currentTab.description}
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
						eyebrow={currentTab.eyebrow}
						title={currentTab.title}
						description={currentTab.description}
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
		<section className="campaigns-page campaigns-page--workspace">
			<header className="page-card campaign-shell-card campaigns-workspace-hero">
				<div className="campaigns-workspace-hero__copy">
					<span className="campaigns-eyebrow">Campañas · WhatsApp Templates</span>
					<h2>Creación y seguimiento de campañas</h2>
					<p className="campaigns-hero-lead">
						Creá campañas de WhatsApp, elegí audiencia, editá templates y seguí resultados desde
						un solo lugar.
					</p>
					<CampaignFeedbackAlert feedback={feedback} />
				</div>

				<div className="campaigns-overview-grid">
					<SummaryCard label="Templates aprobados" value={approvedTemplates} />
					<SummaryCard label="Campañas creadas" value={campaignsCount} />
					<SummaryCard label="Destinatarios" value={recipientsCount} />
					<SummaryCard label="Actividad estimada" value={estimatedCost} accent />
				</div>

				<nav className="campaigns-nav" aria-label="Secciones de campañas">
					{TAB_DEFINITIONS.map((tab) => (
						<DashboardTabButton
							key={tab.id}
							tab={tab}
							isActive={activeTab === tab.id}
							onClick={setActiveTab}
						/>
					))}
				</nav>
			</header>

			{renderContent()}
		</section>
	);
}
