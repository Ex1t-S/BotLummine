import { useMemo, useState } from 'react';
import CampaignRunsPanel from '../../components/campaigns/CampaignRunsPanel.jsx';
import TemplateBuilderPanel from '../../components/campaigns/TemplateBuilderPanel.jsx';
import TemplateLibraryPanel from '../../components/campaigns/TemplateLibraryPanel.jsx';
import UnifiedCampaignSegmentPanel from './components/UnifiedCampaignSegmentPanel.jsx';
import CampaignFeedbackAlert from './components/CampaignFeedbackAlert.jsx';
import { useCampaignsDashboard } from './hooks/useCampaignsDashboard.js';
import './CampaignsFeaturePage.css';

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
		id: 'segment',
		label: 'Segmentar campaña',
		eyebrow: 'Campañas',
		title: 'Segmentar campaña',
		description:
			'Elegí si la audiencia sale de carritos abandonados o de clientes con compras, y armá la campaña desde un solo flujo.',
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
			className={`campaigns-tab-button ${isActive ? 'is-active' : ''}`.trim()}
			onClick={() => onClick(tab.id)}
		>
			<span className="campaigns-tab-button__label">{tab.label}</span>
		</button>
	);
}

function CampaignSectionShell({ eyebrow, title, description, children }) {
	return (
		<section className="campaigns-tab-shell page-card campaign-shell-card campaigns-tab-shell--clean">
			<div className="campaigns-tab-shell__header campaigns-tab-shell__header--stacked">
				<div>
					{eyebrow ? <span className="campaigns-tab-shell__eyebrow">{eyebrow}</span> : null}
					<h3>{title}</h3>
					{description ? <p>{description}</p> : null}
				</div>
			</div>
			<div className="campaigns-tab-shell__body">{children}</div>
		</section>
	);
}

export default function CampaignsFeaturePage() {
	const {
		feedback,
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
	const [builderModeRequest, setBuilderModeRequest] = useState('edit');
	const currentTab = useMemo(
		() => TAB_DEFINITIONS.find((tab) => tab.id === activeTab) || TAB_DEFINITIONS[0],
		[activeTab]
	);
	function openBuilderForEdit(template) {
		setSelectedTemplate(template || null);
		setBuilderModeRequest('edit');
		setActiveTab('builder');
	}

	function openBuilderForCreate() {
		setBuilderModeRequest('create');
		setActiveTab('builder');
	}
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
							onEditTemplate={openBuilderForEdit}
							onCreateTemplate={openBuilderForCreate}
							onSync={() => mutations.sync.mutate()}
							syncing={mutations.sync.isPending}
							onDeleteTemplate={(template) => {
								const confirmed = window.confirm(`¿Eliminar el template ${template.name}?`);
								if (confirmed) mutations.deleteTemplate.mutate(template.id);
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
							builderModeRequest={builderModeRequest}
							onBackToLibrary={() => setActiveTab('library')}
							creating={mutations.createTemplate.isPending}
							updating={mutations.updateTemplate.isPending}
							onCreateTemplate={(payload) => mutations.createTemplate.mutateAsync(payload)}
							onUpdateTemplate={(templateId, payload) =>
								mutations.updateTemplate.mutateAsync({ templateId, payload })
							}
						/>
					</CampaignSectionShell>
				);

			case 'segment':
				return (
					<CampaignSectionShell
						eyebrow={currentTab.eyebrow}
						title={currentTab.title}
						description={currentTab.description}
					>
						<UnifiedCampaignSegmentPanel
							templates={templates}
							selectedTemplate={selectedTemplate}
							onSelectTemplate={setSelectedTemplate}
							abandonedCart={abandonedCart}
							mutations={mutations}
							onCreateCampaign={(payload) => mutations.createCampaign.mutateAsync(payload)}
							creatingCampaign={mutations.createCampaign.isPending}
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
		<section className="campaigns-page campaigns-page--tabs campaigns-page--feature-refresh">
			<div className="campaigns-hero page-card campaign-shell-card campaigns-hero--tabs campaigns-hero--feature-refresh">
				<div className="campaigns-hero-copy campaigns-hero-copy--full">
					<span className="campaigns-eyebrow">Campañas · WhatsApp Templates</span>
					<h2>Creación y seguimiento de campañas</h2>
					<p className="campaigns-hero-lead">
						Creá campañas de WhatsApp, elegí audiencia, editá templates y seguí resultados desde
						un solo lugar sin perderte en paneles gigantes.
					</p>

					<CampaignFeedbackAlert feedback={feedback} />

					<div className="campaigns-tab-nav" role="tablist" aria-label="Secciones de campañas">
						{TAB_DEFINITIONS.map((tab) => (
							<DashboardTabButton
								key={tab.id}
								tab={tab}
								isActive={activeTab === tab.id}
								onClick={setActiveTab}
							/>
						))}
					</div>
				</div>
			</div>

			{renderContent()}
		</section>
	);
}
