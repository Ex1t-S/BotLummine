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

function cleanCampaignCopy(value = '') {
	return String(value || '');
}

const SHIPMENT_DATA_OPTIONS = [
	{ key: 'first_name', label: 'Nombre', description: 'Primer nombre del destinatario' },
	{ key: 'contact_name', label: 'Nombre completo', description: 'Nombre completo del destinatario' },
	{ key: 'phone', label: 'Telefono', description: 'Telefono normalizado' },
	{ key: 'order_number', label: 'Numero de orden', description: 'Numero visible del pedido' },
	{ key: 'order_id', label: 'ID de orden', description: 'Identificador interno del pedido' },
	{ key: 'shipment_id', label: 'ID de despacho', description: 'Identificador del envio en Enbox' },
	{ key: 'tracking_number', label: 'Numero de seguimiento', description: 'Codigo de tracking' },
	{ key: 'tracking_url', label: 'Link de seguimiento', description: 'URL para seguir el envio' },
	{ key: 'shipping_status', label: 'Estado de envio', description: 'Estado detectado del despacho' },
	{ key: 'shipping_method', label: 'Metodo de envio', description: 'Metodo o transportista' },
	{ key: 'product_name', label: 'Producto', description: 'Primer producto del pedido' },
	{ key: 'source', label: 'Origen', description: 'Enbox o TiendaNube' },
	{ key: 'updated_at', label: 'Fecha de actualizacion', description: 'Fecha del despacho detectado' },
];

const SHIPMENT_DEFAULT_MAPPING = {
	'1': 'first_name',
	'2': 'order_number',
	'3': 'tracking_url',
	'4': 'tracking_number',
	'5': 'product_name',
	contact_name: 'contact_name',
	first_name: 'first_name',
	phone: 'phone',
	wa_id: 'phone',
	order_number: 'order_number',
	order_id: 'order_id',
	shipment_id: 'shipment_id',
	tracking_number: 'tracking_number',
	tracking_url: 'tracking_url',
	shipping_status: 'shipping_status',
	shipping_method: 'shipping_method',
	product_name: 'product_name',
	first_product_name: 'product_name',
};

function collectTemplateText(value, texts = []) {
	if (typeof value === 'string') {
		texts.push(value);
		return texts;
	}
	if (Array.isArray(value)) {
		value.forEach((item) => collectTemplateText(item, texts));
		return texts;
	}
	if (value && typeof value === 'object') {
		Object.values(value).forEach((item) => collectTemplateText(item, texts));
	}
	return texts;
}

function extractTemplateVariableKeys(template = null) {
	const components = Array.isArray(template?.rawPayload?.components) ? template.rawPayload.components : [];
	const keys = new Set();
	collectTemplateText(components).forEach((text) => {
		String(text).replace(/{{\s*([^}]+?)\s*}}/g, (_match, rawKey) => {
			const key = String(rawKey || '').trim();
			if (key) keys.add(key);
			return _match;
		});
	});
	return [...keys].sort((a, b) => {
		const aNumber = Number(a);
		const bNumber = Number(b);
		if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
		if (Number.isFinite(aNumber)) return -1;
		if (Number.isFinite(bNumber)) return 1;
		return a.localeCompare(b);
	});
}

function getDefaultShipmentSource(variableKey = '') {
	return SHIPMENT_DEFAULT_MAPPING[variableKey] || SHIPMENT_DEFAULT_MAPPING[String(variableKey).toLowerCase()] || 'contact_name';
}

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
	{
		id: 'shipments',
		path: 'shipments',
		label: 'Avisos de despacho',
		eyebrow: 'Automatizaciones',
		title: 'Avisos de despacho',
		description:
			'Selecciona pedidos despachados por rango de fechas, elegi una plantilla y activa o envia los avisos.',
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
			<span className="campaigns-tab-button__label">{cleanCampaignCopy(tab.label)}</span>
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
					{eyebrow ? <span className="campaigns-tab-shell__eyebrow">{cleanCampaignCopy(eyebrow)}</span> : null}
					<h3>{cleanCampaignCopy(title)}</h3>
					{description ? <p>{cleanCampaignCopy(description)}</p> : null}
				</div>
			</div>
			<div className="campaigns-tab-shell__body">{children}</div>
		</section>
	);
}

function CampaignConfirmDialog({ confirm, onCancel, onConfirm }) {
	if (!confirm) return null;

	return (
		<div className="campaign-confirm-backdrop" role="presentation">
			<div
				className="campaign-confirm-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="campaign-confirm-title"
			>
				<h3 id="campaign-confirm-title">{confirm.title}</h3>
				<p>{confirm.message}</p>
				<div className="campaign-confirm-actions">
					<button type="button" className="button ghost" onClick={onCancel}>
						Cancelar
					</button>
					<button type="button" className="button danger" onClick={onConfirm}>
						{confirm.confirmLabel || 'Eliminar'}
					</button>
				</div>
			</div>
		</div>
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

function getScheduleTimestamp(value) {
	const timestamp = new Date(value || '').getTime();
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function getScheduleHealth(schedule = {}) {
	const status = String(schedule.status || '').toUpperCase();
	const nextRunAt = getScheduleTimestamp(schedule.nextRunAt);
	const isActive = status === 'ACTIVE';
	const isDue = isActive && nextRunAt > 0 && nextRunAt <= Date.now();

	if (!isActive) {
		return {
			label: 'Pausada',
			className: '',
			message: 'La automatizacion esta pausada.',
		};
	}

	if (isDue) {
		return {
			label: 'Vencida',
			className: 'is-overdue',
			message: 'La hora programada ya paso. El dispatcher interno revisa cada minuto; si sigue igual, usa Ejecutar ahora y revisa logs.',
		};
	}

	return {
		label: 'Activa',
		className: 'is-active',
		message: '',
	};
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
	onDeleteSchedule,
}) {
	const [form, setForm] = useState(initialScheduleForm);
	const isEditing = Boolean(form.id);
	const saving = mutations.createSchedule.isPending || mutations.updateSchedule.isPending;
	const runningDispatcher = mutations.dispatchTick?.isPending || false;

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
								<option value="">Seleccionar plantilla</option>
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
				<div className="campaign-schedule-ops">
					<div>
						<strong>Estado operativo</strong>
						<span>El backend revisa programaciones cada minuto. Usa este control para dispararlo ahora.</span>
					</div>
					<button
						type="button"
						className="button secondary"
						onClick={() => mutations.dispatchTick?.mutate()}
						disabled={runningDispatcher}
					>
						{runningDispatcher ? 'Ejecutando...' : 'Ejecutar ahora'}
					</button>
				</div>
				{loading ? <div className="campaign-custom-audience-empty">Cargando programaciones...</div> : null}
				{!loading && !schedules.length ? (
					<div className="campaign-custom-audience-empty">
						<strong>No hay programaciones creadas</strong>
						<span>Creá una programación para carritos abandonados o una distinta para pagos pendientes.</span>
					</div>
				) : null}

				{schedules.map((schedule) => {
					const health = getScheduleHealth(schedule);

					return (
						<div className="campaign-schedule-card" key={schedule.id}>
						<div className="campaign-schedule-card__main">
							<div>
								<span className={`campaign-schedule-status ${health.className}`.trim()}>
									{health.label}
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
								<span>Ultima</span>
								<strong>{formatScheduleDate(schedule.lastRunAt)}</strong>
							</div>
							<div className="campaign-schedule-meta">
								<span>Ejecuciones</span>
								<strong>{schedule.runCount || 0}</strong>
							</div>
						</div>

						{health.message ? (
							<div className={`campaign-schedule-warning ${health.className}`.trim()}>
								{health.message}
							</div>
						) : null}

						{schedule.lastCampaignId ? (
							<div className="campaign-schedule-link">
								Ultima campana creada: <code>{schedule.lastCampaignId}</code>
							</div>
						) : null}

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
								onClick={() => onDeleteSchedule?.(schedule)}
								disabled={mutations.deleteSchedule.isPending}
							>
								Eliminar
							</button>
						</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function formatShipmentDate(value) {
	if (!value) return 'Sin fecha';
	try {
		return new Date(value).toLocaleString('es-AR', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		});
	} catch {
		return 'Sin fecha';
	}
}

function ShipmentNotificationsPanel({ templates = [], shipmentNotifications, queries, mutations }) {
	const settings = shipmentNotifications?.settings || {};
	const range = shipmentNotifications?.range || {};
	const candidates = shipmentNotifications?.candidates || [];
	const [templateId, setTemplateId] = useState('');
	const [enabled, setEnabled] = useState(false);
	const [selectedKeys, setSelectedKeys] = useState([]);
	const [variableMapping, setVariableMapping] = useState({});
	const saving = mutations.updateShipmentSettings.isPending;
	const sending = mutations.sendShipmentNotifications.isPending;
	const selectedTemplate = useMemo(
		() => templates.find((template) => template.id === templateId) || null,
		[templates, templateId]
	);
	const templateVariableKeys = useMemo(() => extractTemplateVariableKeys(selectedTemplate), [selectedTemplate]);
	const dataOptions = settings.availableVariables?.length ? settings.availableVariables : SHIPMENT_DATA_OPTIONS;
	const effectiveVariableMapping = useMemo(() => {
		const mapping = {};
		templateVariableKeys.forEach((key) => {
			mapping[key] = variableMapping[key] || getDefaultShipmentSource(key);
		});
		return mapping;
	}, [templateVariableKeys, variableMapping]);

	useEffect(() => {
		setTemplateId(settings.templateId || '');
		setEnabled(Boolean(settings.enabled));
		setVariableMapping(settings.variableMapping || {});
	}, [settings.templateId, settings.enabled, settings.variableMapping]);

	useEffect(() => {
		setSelectedKeys(candidates.filter((candidate) => !candidate.alreadyNotified).map((candidate) => candidate.notificationKey));
	}, [candidates]);

	const selectableCandidates = candidates.filter((candidate) => !candidate.alreadyNotified);
	const selectedSet = new Set(selectedKeys);

	function toggleCandidate(candidate) {
		if (candidate.alreadyNotified) return;
		setSelectedKeys((current) =>
			current.includes(candidate.notificationKey)
				? current.filter((key) => key !== candidate.notificationKey)
				: [...current, candidate.notificationKey]
		);
	}

	function saveSettings(nextEnabled = enabled) {
		mutations.updateShipmentSettings.mutate({
			enabled: nextEnabled,
			templateId,
			variableMapping: effectiveVariableMapping,
			daysBack: 3,
		});
	}

	function sendSelected() {
		mutations.sendShipmentNotifications.mutate({
			templateId,
			candidateKeys: selectedKeys,
			variableMapping: effectiveVariableMapping,
			dateFrom: range.dateFrom,
			dateTo: range.dateTo,
		});
	}

	function updateVariableMapping(variableKey, sourceKey) {
		setVariableMapping((current) => ({
			...current,
			[variableKey]: sourceKey,
		}));
	}

	return (
		<div className="campaign-shipment-notifications">
			<div className="campaign-schedule-ops">
				<div>
					<strong>Avisos de pedido despachado</strong>
					<span>Empieza desactivado. En manual podés elegir de qué día a qué día se despacharon.</span>
				</div>
				<label className="campaign-toggle">
					<input
						type="checkbox"
						checked={enabled}
						onChange={(event) => {
							const nextEnabled = event.target.checked;
							setEnabled(nextEnabled);
							saveSettings(nextEnabled);
						}}
						disabled={saving || !templateId}
					/>
					<span>
						<strong>{enabled ? 'Automatizacion activa' : 'Automatizacion desactivada'}</strong>
					</span>
				</label>
			</div>

			<div className="campaign-schedule-section">
				<div className="campaign-schedule-section__title">
					<strong>Plantilla</strong>
					<span>Elegí qué dato de despacho va en cada variable de la plantilla.</span>
				</div>
				<div className="campaign-form-grid two-columns">
					<label className="field">
						<span>Template para despacho</span>
						<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
							<option value="">Seleccionar plantilla</option>
							{templates.map((template) => (
								<option key={template.id} value={template.id}>
									{template.name} - {template.language} - {template.status}
								</option>
							))}
						</select>
					</label>
					<div className="campaign-form-actions campaign-form-actions--end">
						<button type="button" className="button primary" onClick={() => saveSettings()} disabled={saving || !templateId}>
							{saving ? 'Guardando...' : 'Guardar configuracion'}
						</button>
					</div>
				</div>
				{settings.lastError ? <div className="campaign-schedule-error">{settings.lastError}</div> : null}
			</div>

			<div className="campaign-schedule-section">
				<div className="campaign-schedule-section__title">
					<strong>Variables del despacho</strong>
					<span>
						{templateVariableKeys.length
							? `${templateVariableKeys.length} variable(s) detectada(s) en el template.`
							: 'Seleccioná una plantilla con variables para mapear los datos.'}
					</span>
				</div>
				<div className="campaign-shipment-variable-grid">
					{templateVariableKeys.map((variableKey) => (
						<label className="field" key={variableKey}>
							<span>{`Variable {{${variableKey}}}`}</span>
							<select
								value={effectiveVariableMapping[variableKey] || ''}
								onChange={(event) => updateVariableMapping(variableKey, event.target.value)}
							>
								{dataOptions.map((option) => (
									<option key={option.key} value={option.key}>
										{option.label}
									</option>
								))}
							</select>
						</label>
					))}
					{!templateVariableKeys.length ? (
						<div className="campaign-custom-audience-empty">
							<strong>Sin variables detectadas</strong>
							<span>La plantilla seleccionada no tiene campos tipo {'{{1}}'} o {'{{order_number}}'}.</span>
						</div>
					) : null}
				</div>
				<div className="campaign-shipment-data-options">
					{dataOptions.map((option) => (
						<span key={option.key}>
							<strong>{option.label}</strong>
							<small>{option.description}</small>
						</span>
					))}
				</div>
			</div>

			<div className="campaign-schedule-section">
				<div className="campaign-schedule-section__title">
					<strong>Despachos recientes</strong>
					<span>{selectableCandidates.length} pendiente(s) de {candidates.length} encontrado(s) en el rango.</span>
				</div>
				<div className="campaign-form-grid two-columns campaign-shipment-range">
					<label className="field">
						<span>Despachados desde</span>
						<input
							type="date"
							value={range.dateFrom || ''}
							onChange={(event) =>
								shipmentNotifications?.setRange?.((current) => ({
									...(current || {}),
									dateFrom: event.target.value,
								}))
							}
						/>
					</label>
					<label className="field">
						<span>Despachados hasta</span>
						<input
							type="date"
							value={range.dateTo || ''}
							onChange={(event) =>
								shipmentNotifications?.setRange?.((current) => ({
									...(current || {}),
									dateTo: event.target.value,
								}))
							}
						/>
					</label>
				</div>
				<div className="campaign-inline-actions campaign-inline-actions--wrap">
					<button
						type="button"
						className="button ghost"
						onClick={() => setSelectedKeys(selectableCandidates.map((candidate) => candidate.notificationKey))}
					>
						Seleccionar pendientes
					</button>
					<button
						type="button"
						className="button primary"
						onClick={sendSelected}
						disabled={sending || !templateId || !selectedKeys.length}
					>
						{sending ? 'Enviando...' : `Enviar seleccionados (${selectedKeys.length})`}
					</button>
				</div>

				{queries.shipmentCandidates.isLoading ? (
					<div className="campaign-custom-audience-empty">Cargando despachos...</div>
				) : null}

				<div className="campaign-shipment-list">
					{candidates.map((candidate) => (
						<label
							key={candidate.notificationKey}
							className={`campaign-shipment-row ${candidate.alreadyNotified ? 'is-disabled' : ''}`.trim()}
						>
							<input
								type="checkbox"
								checked={selectedSet.has(candidate.notificationKey)}
								disabled={candidate.alreadyNotified}
								onChange={() => toggleCandidate(candidate)}
							/>
							<span>
								<strong>{candidate.contactName || candidate.phone}</strong>
								<small>
									{candidate.orderNumber || candidate.orderId || 'Sin pedido'} - {candidate.productName || 'Producto'} - {candidate.shippingStatus || 'Despachado'}
								</small>
							</span>
							<span>
								<strong>{candidate.source === 'enbox' ? 'Enbox' : 'TiendaNube'}</strong>
								<small>{candidate.trackingNumber || candidate.trackingUrl || 'Sin tracking'}</small>
							</span>
							<span>
								<strong>{candidate.alreadyNotified ? 'Notificado' : 'Pendiente'}</strong>
								<small>{formatShipmentDate(candidate.updatedAt)}</small>
							</span>
						</label>
					))}
					{!queries.shipmentCandidates.isLoading && !candidates.length ? (
						<div className="campaign-custom-audience-empty">
							<strong>No hay despachos recientes</strong>
							<span>Sin pedidos despachados detectados entre las fechas elegidas.</span>
						</div>
					) : null}
				</div>
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
		shipmentNotifications,
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
	const [pendingConfirm, setPendingConfirm] = useState(null);
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

	function requestDeleteTemplate(template) {
		if (!template?.id) return;
		setPendingConfirm({
			type: 'template',
			id: template.id,
			title: 'Eliminar template',
			message: `Vas a eliminar "${template.name}" de la biblioteca local. Esta acción no se puede deshacer.`,
			confirmLabel: 'Eliminar template',
		});
	}

	function requestDeleteCampaign(campaign) {
		if (!campaign?.id) return;
		setPendingConfirm({
			type: 'campaign',
			id: campaign.id,
			title: 'Eliminar campaña',
			message: `Vas a eliminar "${campaign.name}". Esta acción no se puede deshacer.`,
			confirmLabel: 'Eliminar campaña',
		});
	}

	function requestDeleteSchedule(schedule) {
		if (!schedule?.id) return;
		setPendingConfirm({
			type: 'schedule',
			id: schedule.id,
			title: 'Eliminar programación',
			message: `Vas a eliminar "${schedule.name}". La automatización dejará de ejecutarse.`,
			confirmLabel: 'Eliminar programación',
		});
	}

	function confirmPendingAction() {
		if (!pendingConfirm) return;

		if (pendingConfirm.type === 'template') {
			mutations.deleteTemplate.mutate(pendingConfirm.id);
		}

		if (pendingConfirm.type === 'campaign') {
			mutations.deleteCampaign.mutate(pendingConfirm.id);
		}

		if (pendingConfirm.type === 'schedule') {
			mutations.deleteSchedule.mutate(pendingConfirm.id);
		}

		setPendingConfirm(null);
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
							onDeleteTemplate={requestDeleteTemplate}
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
							onDelete={requestDeleteCampaign}
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
							onDeleteSchedule={requestDeleteSchedule}
						/>
					</CampaignSectionShell>
				);

			case 'shipments':
				return (
					<CampaignSectionShell
						tabId={currentTab.id}
						eyebrow={currentTab.eyebrow}
						title={currentTab.title}
						description={currentTab.description}
					>
						<ShipmentNotificationsPanel
							templates={templates}
							shipmentNotifications={shipmentNotifications}
							queries={queries}
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

			<CampaignConfirmDialog
				confirm={pendingConfirm}
				onCancel={() => setPendingConfirm(null)}
				onConfirm={confirmPendingAction}
			/>
		</section>
	);
}
