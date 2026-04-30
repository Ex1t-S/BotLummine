import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
		path: 'library',
		label: 'Biblioteca de templates',
		eyebrow: 'Templates',
		title: 'Biblioteca de templates',
		description:
			'Busca, filtra y elegi la plantilla con la que queres trabajar. Desde aca arrancas sin dar vueltas.',
	},
	{
		id: 'builder',
		path: 'builder',
		label: 'Editor de templates',
		eyebrow: 'Templates',
		title: 'Editor de templates',
		description:
			'Edita variables, botones y contenido del template sin salir del flujo de campanas.',
		hiddenFromNav: true,
	},
	{
		id: 'segment',
		path: 'segment',
		label: 'Segmentar campana',
		eyebrow: 'Campanas',
		title: 'Segmentar campana',
		description:
			'Elegi si la audiencia sale de carritos abandonados o de clientes con compras, y arma la campana desde un solo flujo.',
	},
	{
		id: 'tracking',
		path: 'tracking',
		label: 'Seguimiento',
		eyebrow: 'Campanas',
		title: 'Seguimiento',
		description:
			'Revisa estados, resultados y destinatarios desde una vista separada para controlar lo que ya salio.',
	},
];

function DashboardTabButton({ tab, isActive, onClick }) {
	return (
		<button
			type="button"
			role="tab"
			id={`campaigns-tab-${tab.id}`}
			aria-selected={isActive}
			aria-controls={`campaigns-panel-${tab.id}`}
			className={`campaigns-tab-button ${isActive ? 'is-active' : ''}`.trim()}
			onClick={() => onClick(tab.id)}
		>
			<span className="campaigns-tab-button__label">{tab.label}</span>
		</button>
	);
}

function CampaignSectionShell({ tabId, eyebrow, title, description, children }) {
	return (
		<section
			id={`campaigns-panel-${tabId}`}
			role="tabpanel"
			aria-labelledby={`campaigns-tab-${tabId}`}
			className="campaigns-tab-shell page-card campaign-shell-card campaigns-tab-shell--clean"
		>
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
	const location = useLocation();
	const navigate = useNavigate();
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

	const [builderModeRequest, setBuilderModeRequest] = useState('edit');
	const tabsByPath = useMemo(
		() =>
			TAB_DEFINITIONS.reduce((acc, tab) => {
				acc[tab.path] = tab;
				return acc;
			}, {}),
		[]
	);

	const activeTab = useMemo(() => {
		const pathSegments = location.pathname.split('/').filter(Boolean);
		const activePath = pathSegments[1] || '';
		return tabsByPath[activePath]?.id || 'library';
	}, [location.pathname, tabsByPath]);

	const currentTab = useMemo(
		() => TAB_DEFINITIONS.find((tab) => tab.id === activeTab) || TAB_DEFINITIONS[0],
		[activeTab]
	);

	useEffect(() => {
		const pathSegments = location.pathname.split('/').filter(Boolean);
		const activePath = pathSegments[1] || '';

		if (!activePath || !tabsByPath[activePath]) {
			navigate('/campaigns/library', { replace: true });
		}
	}, [location.pathname, navigate, tabsByPath]);

	function openTab(tabId) {
		const tab = TAB_DEFINITIONS.find((item) => item.id === tabId);
		if (!tab) return;
		navigate(`/campaigns/${tab.path}`);
	}

	function openBuilderForEdit(template) {
		setSelectedTemplate(template || null);
		setBuilderModeRequest('edit');
		openTab('builder');
	}

	function openBuilderForCreate() {
		setBuilderModeRequest('create');
		openTab('builder');
	}

	function renderContent() {
		switch (activeTab) {
			case 'library':
				return (
					<CampaignSectionShell
						tabId={currentTab.id}
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
							onPurgeDeleted={() => mutations.purgeDeletedTemplates.mutate()}
							purgingDeleted={mutations.purgeDeletedTemplates.isPending}
							onDeleteTemplate={(template) => {
								const confirmed = window.confirm(`Eliminar el template ${template.name}?`);
								if (confirmed) mutations.deleteTemplate.mutate(template.id);
							}}
						/>
					</CampaignSectionShell>
				);

			case 'builder':
				return (
					<CampaignSectionShell
						tabId={currentTab.id}
						eyebrow={currentTab.eyebrow}
						title={currentTab.title}
						description={currentTab.description}
					>
						<TemplateBuilderPanel
							selectedTemplate={selectedTemplate}
							builderModeRequest={builderModeRequest}
							onBackToLibrary={() => openTab('library')}
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
						tabId={currentTab.id}
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
						tabId={currentTab.id}
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
									`Eliminar la campana "${campaign.name}"?\n\nEsta accion no se puede deshacer.`
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
					<span className="campaigns-eyebrow">Campanas - WhatsApp Templates</span>
					<h2>Creacion y seguimiento de campanas</h2>
					<p className="campaigns-hero-lead">
						Crea campanas de WhatsApp, elegi audiencia, edita templates y segui resultados desde
						un solo lugar sin perderte en paneles gigantes.
					</p>

					<CampaignFeedbackAlert feedback={feedback} />

					<div className="campaigns-tab-nav" role="tablist" aria-label="Secciones de campanas">
						{TAB_DEFINITIONS.filter((tab) => !tab.hiddenFromNav).map((tab) => (
							<DashboardTabButton
								key={tab.id}
								tab={tab}
								isActive={activeTab === tab.id}
								onClick={openTab}
							/>
						))}
					</div>
				</div>
			</div>

			{renderContent()}
		</section>
	);
}
