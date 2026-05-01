import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import CampaignRunsPanel from '../../components/campaigns/CampaignRunsPanel.jsx';
import TemplateBuilderPanel from '../../components/campaigns/TemplateBuilderPanel.jsx';
import TemplateLibraryPanel from '../../components/campaigns/TemplateLibraryPanel.jsx';
import UnifiedCampaignSegmentPanel from './components/UnifiedCampaignSegmentPanel.jsx';
import CampaignFeedbackAlert from './components/CampaignFeedbackAlert.jsx';
import { useCampaignsDashboard } from './hooks/useCampaignsDashboard.js';
import { buildAbandonedCartFilters } from './utils.js';
import './CampaignsFeaturePage.css';

const TAB_DEFINITIONS = [
	{
		id: 'library',
		path: 'library',
		label: 'Biblioteca',
		eyebrow: 'Templates',
		title: 'Biblioteca de templates',
		description:
			'Elegí la plantilla correcta para crear, editar o programar campañas sin salir del flujo.',
	},
	{
		id: 'builder',
		path: 'builder',
		label: 'Editor de templates',
		eyebrow: 'Templates',
		title: 'Editor de templates',
		description:
			'Editá variables, botones y contenido del template sin salir del flujo de campañas.',
		hiddenFromNav: true,
	},
	{
		id: 'segment',
		path: 'segment',
		label: 'Crear campañas',
		eyebrow: 'Campañas',
		title: 'Crear campañas',
		description:
			'Elegí si la audiencia sale de carritos abandonados o de clientes con compras, y armá cada campaña con su objetivo claro.',
	},
	{
		id: 'tracking',
		path: 'tracking',
		label: 'Seguimiento',
		eyebrow: 'Campañas',
		title: 'Seguimiento',
		description:
			'Revisa estados, resultados y destinatarios desde una vista separada para controlar lo que ya salio.',
	},
	{
		id: 'schedules',
		path: 'schedules',
		label: 'Programar campañas',
		eyebrow: 'Automatizaciones',
		title: 'Programar campañas',
		description:
			'Creá envíos recurrentes separados para carritos abandonados o pagos pendientes, con pausa, edición y eliminación.',
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

const initialScheduleForm = {
	id: null,
	name: 'Recuperación diaria 22 hs',
	templateId: '',
	timeOfDay: '22:00',
	status: 'ACTIVE',
	audienceSource: 'abandoned_carts',
	daysBack: 1,
	audienceStatus: 'NEW',
	limit: 100,
	minTotal: '',
	productQuery: '',
	notes: 'Recuperación diaria del último día.',
};

const SCHEDULE_AUDIENCE_OPTIONS = {
	abandoned_carts: {
		label: 'Carritos abandonados',
		helper: 'Contacta carritos sin finalizar según estado, ventana, monto y producto.',
		statusLabel: 'Estado del carrito',
	},
	pending_payment: {
		label: 'Pagos pendientes',
		helper: 'Contacta pedidos pendientes de pago sin mezclar esta regla con carritos.',
		statusLabel: 'Estado de pago',
	},
};

function formatScheduleDate(value) {
	if (!value) return 'Sin fecha';

	try {
		return new Date(value).toLocaleString('es-AR', {
			timeZone: 'America/Argentina/Buenos_Aires',
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		});
	} catch {
		return 'Sin fecha';
	}
}

function scheduleToForm(schedule = {}) {
	const filters = schedule.audienceFilters || {};

	return {
		id: schedule.id || null,
		name: schedule.name || initialScheduleForm.name,
		templateId: schedule.templateLocalId || '',
		timeOfDay: schedule.timeOfDay || '22:00',
		status: schedule.status || 'ACTIVE',
		audienceSource: schedule.audienceSource || 'abandoned_carts',
		daysBack: Number(filters.daysBack || 1),
		audienceStatus: filters.status || 'NEW',
		limit: Number(filters.limit || 100),
		minTotal: filters.minTotal ?? '',
		productQuery: filters.productQuery || '',
		notes: schedule.notes || '',
	};
}

function buildSchedulePayload(form) {
	return {
		name: form.name,
		templateId: form.templateId,
		timeOfDay: form.timeOfDay,
		timezone: 'America/Argentina/Buenos_Aires',
		status: form.status,
		audienceSource: form.audienceSource,
		notes: form.notes || null,
		audienceFilters: buildAbandonedCartFilters({
			daysBack: form.daysBack,
			status: form.audienceSource === 'abandoned_carts' ? form.audienceStatus : 'ALL',
			limit: form.limit,
			minTotal: form.minTotal,
			productQuery: form.productQuery,
		}),
	};
}

function CampaignSchedulesPanel({
	templates = [],
	schedules = [],
	loading = false,
	mutations,
}) {
	const [form, setForm] = useState(initialScheduleForm);
	const isEditing = Boolean(form.id);
	const saving = mutations.createSchedule.isPending || mutations.updateSchedule.isPending;

	function updateField(field, value) {
		setForm((prev) => ({ ...prev, [field]: value }));
	}

	function formatScheduleAudience(schedule) {
		return SCHEDULE_AUDIENCE_OPTIONS[schedule.audienceSource]?.label || 'Carritos abandonados';
	}

	function resetForm() {
		setForm({
			...initialScheduleForm,
			templateId: templates[0]?.id || '',
		});
	}

	useEffect(() => {
		if (!form.templateId && templates[0]?.id) {
			setForm((prev) => ({ ...prev, templateId: templates[0].id }));
		}
	}, [form.templateId, templates]);

	function handleSubmit(event) {
		event.preventDefault();
		const payload = buildSchedulePayload(form);

		if (!payload.templateId) return;

		if (isEditing) {
			mutations.updateSchedule.mutate(
				{ scheduleId: form.id, payload },
				{ onSuccess: resetForm }
			);
			return;
		}

		mutations.createSchedule.mutate(payload, { onSuccess: resetForm });
	}

	function toggleSchedule(schedule) {
		const nextStatus = schedule.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
		mutations.updateSchedule.mutate({
			scheduleId: schedule.id,
			payload: {
				name: schedule.name,
				templateId: schedule.templateLocalId,
				timeOfDay: schedule.timeOfDay,
				timezone: schedule.timezone,
				status: nextStatus,
				audienceSource: schedule.audienceSource || 'abandoned_carts',
				notes: schedule.notes,
				audienceFilters: schedule.audienceFilters || {},
			},
		});
	}

	return (
		<div className="campaign-schedules">
			<form className="campaign-schedule-form campaign-custom-audience-card" onSubmit={handleSubmit}>
				<div className="campaign-schedule-form__header">
					<div>
						<span className="campaigns-eyebrow">Envío diario</span>
						<h4>{isEditing ? 'Editar programación' : 'Nueva programación'}</h4>
					</div>
					{isEditing ? (
						<button type="button" className="button ghost" onClick={resetForm}>
							Cancelar edición
						</button>
					) : null}
				</div>

				<div className="campaign-schedule-section">
					<div className="campaign-schedule-section__title">
						<strong>Configuración</strong>
						<span>Nombre, template y horario de ejecución.</span>
					</div>
					<div className="campaign-form-grid two-columns">
						<label className="field">
							<span>Nombre</span>
							<input
								value={form.name}
								onChange={(event) => updateField('name', event.target.value)}
							/>
						</label>
						<label className="field">
							<span>Template</span>
							<select
								value={form.templateId}
								onChange={(event) => updateField('templateId', event.target.value)}
							>
								<option value="">Seleccionar template</option>
								{templates.map((template) => (
									<option key={template.id} value={template.id}>
										{template.name} - {template.language} - {template.status}
									</option>
								))}
							</select>
						</label>
					</div>
					<div className="campaign-form-grid two-columns">
						<label className="field">
							<span>Hora</span>
							<input
								type="time"
								value={form.timeOfDay}
								onChange={(event) => updateField('timeOfDay', event.target.value)}
							/>
						</label>
						<label className="field">
							<span>Últimos días</span>
							<input
								type="number"
								min="1"
								max="90"
								value={form.daysBack}
								onChange={(event) => updateField('daysBack', Number(event.target.value || 1))}
							/>
						</label>
					</div>
				</div>

				<div className="campaign-schedule-section">
					<div className="campaign-schedule-section__title">
						<strong>Audiencia</strong>
						<span>{SCHEDULE_AUDIENCE_OPTIONS[form.audienceSource]?.helper}</span>
					</div>
					<div className="campaign-schedule-audience-choice" role="radiogroup" aria-label="Audiencia programada">
						{Object.entries(SCHEDULE_AUDIENCE_OPTIONS).map(([value, option]) => (
							<button
								key={value}
								type="button"
								role="radio"
								aria-checked={form.audienceSource === value}
								className={`campaign-schedule-audience-choice__button ${form.audienceSource === value ? 'is-active' : ''}`.trim()}
								onClick={() => updateField('audienceSource', value)}
							>
								<strong>{option.label}</strong>
								<span>{option.helper}</span>
							</button>
						))}
					</div>
					<div className="campaign-form-grid two-columns">
						<label className="field">
							<span>{SCHEDULE_AUDIENCE_OPTIONS[form.audienceSource]?.statusLabel}</span>
							<select
								value={form.audienceSource === 'pending_payment' ? 'ALL' : form.audienceStatus}
								onChange={(event) => updateField('audienceStatus', event.target.value)}
								disabled={form.audienceSource === 'pending_payment'}
							>
								<option value="NEW">Carritos nuevos</option>
								<option value="CONTACTED">Carritos ya contactados</option>
								<option value="ALL">Todos los carritos</option>
							</select>
							{form.audienceSource === 'pending_payment' ? (
								<small>Pagos pendientes usa pedidos con estado pendiente; no aplica estado de carrito.</small>
							) : null}
						</label>
						<label className="field">
							<span>Límite</span>
							<input
								type="number"
								min="1"
								max="500"
								value={form.limit}
								onChange={(event) => updateField('limit', Number(event.target.value || 100))}
							/>
						</label>
					</div>
				</div>

				<div className="campaign-schedule-section">
					<div className="campaign-schedule-section__title">
						<strong>Reglas de envío</strong>
						<span>Filtros opcionales para acotar la campaña programada.</span>
					</div>
					<div className="campaign-form-grid two-columns">
						<label className="field">
							<span>Monto mínimo</span>
							<input
								type="number"
								min="0"
								value={form.minTotal}
								onChange={(event) => updateField('minTotal', event.target.value)}
								placeholder="Sin mínimo"
							/>
						</label>
						<label className="field">
							<span>Producto</span>
							<input
								value={form.productQuery}
								onChange={(event) => updateField('productQuery', event.target.value)}
								placeholder="Opcional"
							/>
						</label>
					</div>
				</div>

				<label className="field">
					<span>Notas internas</span>
					<textarea
						value={form.notes}
						onChange={(event) => updateField('notes', event.target.value)}
						rows={3}
					/>
				</label>

				<label className="campaign-toggle campaign-toggle--card">
					<input
						type="checkbox"
						checked={form.status === 'ACTIVE'}
						onChange={(event) => updateField('status', event.target.checked ? 'ACTIVE' : 'PAUSED')}
					/>
					<span>
						<strong>Programación activa</strong>
						<small>Si está activa, se ejecuta todos los días a la hora indicada.</small>
					</span>
				</label>

				<div className="campaign-form-actions campaign-form-actions--end">
					<button
						type="submit"
						className="button primary"
						disabled={saving || !form.templateId}
					>
						{saving
							? 'Guardando...'
							: isEditing
								? 'Guardar cambios'
								: 'Crear programación'}
					</button>
				</div>
			</form>

			<div className="campaign-schedule-list">
				{loading ? <div className="campaign-custom-audience-empty">Cargando programaciones...</div> : null}
				{!loading && !schedules.length ? (
					<div className="campaign-custom-audience-empty">
						<strong>No hay programaciones creadas</strong>
						<span>Creá una programación para carritos abandonados o una distinta para pagos pendientes.</span>
					</div>
				) : null}

				{schedules.map((schedule) => (
					<div className="campaign-schedule-card" key={schedule.id}>
						<div className="campaign-schedule-card__main">
							<div>
								<span className={`campaign-schedule-status ${schedule.status === 'ACTIVE' ? 'is-active' : ''}`}>
									{schedule.status === 'ACTIVE' ? 'Activa' : 'Pausada'}
								</span>
								<h4>{schedule.name}</h4>
								<p>
									{formatScheduleAudience(schedule)} - {schedule.templateName} - todos los días {schedule.timeOfDay} - últimos {schedule.audienceFilters?.daysBack || 1} día(s)
								</p>
							</div>
							<div className="campaign-schedule-meta">
								<span>Próxima</span>
								<strong>{formatScheduleDate(schedule.nextRunAt)}</strong>
							</div>
							<div className="campaign-schedule-meta">
								<span>Ejecuciones</span>
								<strong>{schedule.runCount || 0}</strong>
							</div>
						</div>

						{schedule.lastError ? (
							<div className="campaign-schedule-error">{schedule.lastError}</div>
						) : null}

						<div className="campaign-detail-actions campaign-detail-actions--spaced">
							<button
								type="button"
								className="button ghost"
								onClick={() => setForm(scheduleToForm(schedule))}
							>
								Editar
							</button>
							<button
								type="button"
								className="button ghost"
								onClick={() => toggleSchedule(schedule)}
								disabled={mutations.updateSchedule.isPending}
							>
								{schedule.status === 'ACTIVE' ? 'Pausar' : 'Activar'}
							</button>
							<button
								type="button"
								className="button danger"
								onClick={() => {
									if (window.confirm(`Eliminar la programación "${schedule.name}"?`)) {
										mutations.deleteSchedule.mutate(schedule.id);
									}
								}}
								disabled={mutations.deleteSchedule.isPending}
							>
								Eliminar
							</button>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

export default function CampaignsFeaturePage() {
	const location = useLocation();
	const navigate = useNavigate();
	const {
		feedback,
		templates,
		campaigns,
		schedules,
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
									`Eliminar la campaña "${campaign.name}"?\n\nEsta acción no se puede deshacer.`
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

			case 'schedules':
				return (
					<CampaignSectionShell
						tabId={currentTab.id}
						eyebrow={currentTab.eyebrow}
						title={currentTab.title}
						description={currentTab.description}
					>
						<CampaignSchedulesPanel
							templates={templates}
							schedules={schedules}
							loading={queries.schedules.isLoading}
							mutations={mutations}
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
					<span className="campaigns-eyebrow">Campañas - WhatsApp Templates</span>
					<h2>Campañas de WhatsApp</h2>
					<p className="campaigns-hero-lead">
						Creá campañas, elegí audiencias, editá templates y programá envíos desde un solo lugar.
					</p>

					<CampaignFeedbackAlert feedback={feedback} />

					<div className="campaigns-tab-nav" role="tablist" aria-label="Secciones de campañas">
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
