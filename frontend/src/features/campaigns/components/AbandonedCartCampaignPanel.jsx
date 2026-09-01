import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatPreviewText } from '../utils.js';
import { getFriendlyError } from '../errorMessages.js';
import { formatTemplateStatusLabel } from '../../../utils/statusLabels.js';
import TemplateHeaderMediaUpload from './TemplateHeaderMediaUpload.jsx';
import {
	mergeHeaderMediaVariableMapping,
	readHeaderMediaIdFromVariableMapping,
	templateNeedsHeaderMediaUpload,
} from '../templateHeaderMedia.js';

function moneyLabel(value) {
	if (value === null || value === undefined || value === '') return 'Sin mínimo';
	const numeric = Number(value);
	if (Number.isNaN(numeric)) return String(value);
	return new Intl.NumberFormat('es-AR', {
		style: 'currency',
		currency: 'ARS',
		maximumFractionDigits: 0,
	}).format(numeric);
}

function formatAutomationDate(value) {
	if (!value) return 'Nunca';
	try {
		return new Date(value).toLocaleString('es-AR', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		});
	} catch {
		return 'Nunca';
	}
}

const defaultAutomationForm = {
	enabled: false,
	templateId: '',
	daysBack: 7,
	limit: 50,
	minCartAgeMinutes: 60,
	minTotal: '',
	productQuery: '',
};

const ABANDONED_CART_DATA_OPTIONS = [
	{ key: 'first_name', label: 'Nombre', description: 'Primer nombre del destinatario' },
	{ key: 'contact_name', label: 'Nombre completo', description: 'Nombre completo del destinatario' },
	{ key: 'phone', label: 'Telefono', description: 'Telefono normalizado' },
	{ key: 'checkout_url', label: 'Link del carrito', description: 'URL de recuperacion del checkout abandonado' },
	{ key: 'product_name', label: 'Producto', description: 'Primer producto del carrito' },
	{ key: 'total_amount', label: 'Monto total', description: 'Total formateado del carrito' },
	{ key: 'total_raw', label: 'Monto sin formato', description: 'Total numerico del carrito' },
	{ key: 'checkout_id', label: 'ID del carrito', description: 'Identificador del checkout abandonado' },
	{ key: 'last_order_id', label: 'ID ultimo pedido', description: 'Identificador interno del ultimo pedido' },
	{ key: 'last_order_number', label: 'Ultimo pedido', description: 'Ultimo pedido detectado del contacto' },
	{ key: '__manual__', label: 'Valor manual', description: 'Escribe un link o texto fijo para esa variable' },
];

const ABANDONED_CART_DEFAULT_MAPPING = {
	'1': 'first_name',
	'2': 'checkout_url',
	'3': 'product_name',
	'4': 'total_amount',
	'5': 'checkout_id',
	contact_name: 'contact_name',
	first_name: 'first_name',
	phone: 'phone',
	wa_id: 'phone',
	checkout_url: 'checkout_url',
	abandoned_checkout_url: 'checkout_url',
	product_name: 'product_name',
	first_product_name: 'product_name',
	total_amount: 'total_amount',
	total_raw: 'total_raw',
	checkout_id: 'checkout_id',
	last_order_id: 'last_order_id',
	last_order_number: 'last_order_number',
};

function normalizeString(value = '') {
	return String(value || '').trim();
}

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
			const key = normalizeString(rawKey);
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

function getDefaultAbandonedCartSource(variableKey = '') {
	const normalized = normalizeString(variableKey);
	return (
		ABANDONED_CART_DEFAULT_MAPPING[variableKey] ||
		ABANDONED_CART_DEFAULT_MAPPING[normalized.toLowerCase()] ||
		'contact_name'
	);
}

function normalizeManualVariables(values = {}, mapping = {}) {
	return Object.fromEntries(
		Object.entries(values || {})
			.map(([key, value]) => [normalizeString(key), String(value ?? '').trim()])
			.filter(([key]) => key && mapping[key] === '__manual__')
	);
}

function AutomationCard({
	templates = [],
	selectedTemplate = null,
	settings = null,
	loading = false,
	saving = false,
	running = false,
	onSave,
	onRunNow,
}) {
	const [form, setForm] = useState(defaultAutomationForm);
	const [variableMapping, setVariableMapping] = useState({});
	const [manualVariables, setManualVariables] = useState({});
	const [headerMediaId, setHeaderMediaId] = useState('');
	const [headerMediaFileName, setHeaderMediaFileName] = useState('');
	const selectedAutomationTemplate = useMemo(
		() => templates.find((template) => template.id === form.templateId) || null,
		[templates, form.templateId]
	);
	const templateVariableKeys = useMemo(
		() => extractTemplateVariableKeys(selectedAutomationTemplate),
		[selectedAutomationTemplate]
	);
	const dataOptions = settings?.availableVariables?.length
		? settings.availableVariables
		: ABANDONED_CART_DATA_OPTIONS;
	const effectiveVariableMapping = useMemo(() => {
		const mapping = {};
		templateVariableKeys.forEach((key) => {
			mapping[key] = variableMapping[key] || getDefaultAbandonedCartSource(key);
		});
		return mapping;
	}, [templateVariableKeys, variableMapping]);
	const effectiveManualVariables = useMemo(
		() => normalizeManualVariables(manualVariables, effectiveVariableMapping),
		[manualVariables, effectiveVariableMapping]
	);

	useEffect(() => {
		const filters = settings?.filters || {};
		setForm({
			enabled: Boolean(settings?.enabled),
			templateId: settings?.templateId || selectedTemplate?.id || '',
			daysBack: Number(filters.daysBack || 7),
			limit: Number(filters.limit || 50),
			minCartAgeMinutes: Number(settings?.minCartAgeMinutes || 60),
			minTotal: filters.minTotal ?? '',
			productQuery: filters.productQuery || '',
		});
		setVariableMapping(settings?.variableMapping || {});
		setManualVariables(settings?.manualVariables || {});
		const settingsTemplate =
			templates.find((template) => template.id === (settings?.templateId || selectedTemplate?.id || '')) ||
			null;
		setHeaderMediaId(readHeaderMediaIdFromVariableMapping(settingsTemplate, settings?.variableMapping || {}));
		setHeaderMediaFileName('');
	}, [settings, selectedTemplate?.id, templates]);

	function updateField(field, value) {
		setForm((current) => ({ ...current, [field]: value }));
	}

	function updateVariableSource(variableKey, sourceKey) {
		setVariableMapping((current) => ({
			...current,
			[variableKey]: sourceKey,
		}));
	}

	function updateManualVariable(variableKey, value) {
		setManualVariables((current) => ({
			...current,
			[variableKey]: value,
		}));
	}

	function updateTemplateId(templateId) {
		updateField('templateId', templateId);
		setHeaderMediaId('');
		setHeaderMediaFileName('');
	}

	function buildPayload(overrides = {}) {
		const nextForm = { ...form, ...overrides };
		const templateId = nextForm.templateId || selectedTemplate?.id || settings?.templateId || '';
		const templateForPayload =
			templates.find((template) => template.id === templateId) || selectedAutomationTemplate || null;
		return {
			enabled: nextForm.enabled,
			templateId,
			filters: {
				daysBack: nextForm.daysBack,
				status: 'ALL',
				limit: nextForm.limit,
				minTotal: nextForm.minTotal,
				productQuery: nextForm.productQuery,
			},
				minCartAgeMinutes: Math.max(1, Math.min(43200, Number(nextForm.minCartAgeMinutes || 60))),
			variableMapping: mergeHeaderMediaVariableMapping(
				templateForPayload,
				headerMediaId,
				effectiveVariableMapping
			),
			manualVariables: effectiveManualVariables,
		};
	}

	function handleToggle(nextEnabled) {
		const templateId = form.templateId || selectedTemplate?.id || settings?.templateId || '';

		if (nextEnabled && !templateId) return;
		if (
			nextEnabled &&
			templateNeedsHeaderMediaUpload(selectedAutomationTemplate, headerMediaId)
		) return;

		updateField('enabled', nextEnabled);
		onSave?.(buildPayload({ enabled: nextEnabled, templateId }));
	}

	function handleSave() {
		const payload = buildPayload();
		onSave?.({
			...payload,
		});
	}

	return (
		<div className="campaign-custom-audience-card campaign-abandoned-automation-card">
			<div className="campaign-abandoned-automation-card__header">
				<div>
					<span className="campaigns-eyebrow">Automatizacion</span>
					<h4>Enviar carritos nuevos automáticamente</h4>
					<p>Revisa carritos nuevos cada hora dentro de la ventana de contacto (09:00 a 21:00 ART).</p>
				</div>
				<span className={`campaign-schedule-status ${form.enabled ? 'is-active' : ''}`.trim()}>
					{form.enabled ? 'Activa' : 'Pausada'}
				</span>
			</div>

			<label className="campaign-toggle campaign-toggle--card">
				<input
					type="checkbox"
					checked={form.enabled}
					onChange={(event) => handleToggle(event.target.checked)}
					disabled={
						loading ||
						saving ||
						(!form.enabled && templateNeedsHeaderMediaUpload(selectedAutomationTemplate, headerMediaId))
					}
				/>
				<span>
					<strong>Automatizacion {form.enabled ? 'activada' : 'desactivada'}</strong>
					<small>
						{form.enabled
							? 'Se ejecuta como máximo cada hora entre las 09:00 y las 21:00.'
							: 'Activala para guardar el estado automaticamente.'}
					</small>
				</span>
			</label>

			<div className="campaign-form-grid two-columns">
				<label className="field">
					<span>Template automatico</span>
					<select
						value={form.templateId}
						onChange={(event) => updateTemplateId(event.target.value)}
						disabled={loading || saving}
					>
						<option value="">Seleccionar plantilla</option>
						{templates.map((template) => (
							<option key={template.id} value={template.id}>
								{template.name} - {template.language} - {formatTemplateStatusLabel(template.status)}
							</option>
						))}
					</select>
				</label>
				<label className="field">
					<span>Ventana</span>
					<select
						value={form.daysBack}
						onChange={(event) => updateField('daysBack', Number(event.target.value))}
						disabled={loading || saving}
					>
						<option value={1}>1 dia</option>
						<option value={3}>3 dias</option>
						<option value={7}>7 dias</option>
						<option value={15}>15 dias</option>
						<option value={30}>30 dias</option>
					</select>
				</label>
			</div>

			<TemplateHeaderMediaUpload
				template={selectedAutomationTemplate}
				mediaId={headerMediaId}
				fileName={headerMediaFileName}
				disabled={loading || saving}
				onUploaded={(nextMediaId, nextFileName) => {
					setHeaderMediaId(nextMediaId);
					setHeaderMediaFileName(nextFileName);
				}}
				onClear={() => {
					setHeaderMediaId('');
					setHeaderMediaFileName('');
				}}
			/>

			<div className="campaign-custom-audience-grid-4">
				<label className="field">
					<span>Limite por ejecucion</span>
					<input
						type="number"
						min="1"
						max="500"
						value={form.limit}
						onChange={(event) => updateField('limit', Number(event.target.value || 50))}
						disabled={loading || saving}
					/>
				</label>
				<label className="field">
					<span>Monto minimo</span>
					<input
						type="number"
						min="0"
						value={form.minTotal}
						onChange={(event) => updateField('minTotal', event.target.value)}
						placeholder="Sin minimo"
						disabled={loading || saving}
					/>
				</label>
				<label className="field campaign-abandoned-automation-card__wide">
					<span>Producto</span>
					<input
						value={form.productQuery}
						onChange={(event) => updateField('productQuery', event.target.value)}
						placeholder="Opcional"
						disabled={loading || saving}
					/>
				</label>
				<label className="field">
					<span>Espera minima (minutos)</span>
					<input
						type="number"
						min="1"
						max="43200"
						value={form.minCartAgeMinutes}
						onChange={(event) => updateField('minCartAgeMinutes', Number(event.target.value || 60))}
						disabled={loading || saving}
					/>
				</label>
			</div>

			<div className="campaign-abandoned-automation-meta">
				<span>
					<strong>Espera minima</strong>
					<small>{Number(settings?.minCartAgeMinutes || 60)} minutos</small>
				</span>
				<span>
					<strong>Ultima ejecucion</strong>
					<small>{formatAutomationDate(settings?.lastRunAt)}</small>
				</span>
				<span>
					<strong>Ultima campana</strong>
					<small>{settings?.lastCampaignId || 'Sin campana'}</small>
				</span>
				<span>
					<strong>Template</strong>
					<small>{selectedAutomationTemplate?.name || settings?.templateName || 'Sin plantilla'}</small>
				</span>
			</div>

			<div className="campaign-schedule-section">
				<div className="campaign-schedule-section__title">
					<strong>Variables del carrito</strong>
					<span>
						{templateVariableKeys.length
						? `${templateVariableKeys.length} variable(s) detectada(s) en la plantilla.`
							: 'Selecciona una plantilla con variables para mapear el link, nombre y otros datos.'}
					</span>
				</div>
				<div className="campaign-shipment-variable-grid">
					{templateVariableKeys.map((variableKey) => (
						<div className="field" key={variableKey}>
							<span>{`Variable {{${variableKey}}}`}</span>
							<select
								value={effectiveVariableMapping[variableKey] || ''}
								onChange={(event) => updateVariableSource(variableKey, event.target.value)}
								disabled={loading || saving}
							>
								{dataOptions.map((option) => (
									<option key={option.key} value={option.key}>
										{option.label}
									</option>
								))}
							</select>
							{effectiveVariableMapping[variableKey] === '__manual__' ? (
								<input
									value={manualVariables[variableKey] || ''}
									onChange={(event) => updateManualVariable(variableKey, event.target.value)}
									placeholder="Pega un link o texto fijo"
									disabled={loading || saving}
								/>
							) : null}
						</div>
					))}
					{!templateVariableKeys.length ? (
						<div className="campaign-custom-audience-empty">
							<strong>Sin variables detectadas</strong>
							<span>La plantilla seleccionada no tiene campos tipo {'{{1}}'} o {'{{checkout_url}}'}.</span>
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

			{settings?.lastError ? (
				<div className="campaign-schedule-error">{getFriendlyError({ message: settings.lastError })}</div>
			) : null}

			<div className="campaign-form-actions campaign-form-actions--end">
				<button
					type="button"
					className="button ghost"
					onClick={onRunNow}
					disabled={running || saving || !settings?.enabled}
				>
					{running ? 'Ejecutando...' : 'Ejecutar ahora'}
				</button>
				<button
					type="button"
					className="button primary"
					onClick={handleSave}
					disabled={
						saving ||
						loading ||
						(form.enabled && !buildPayload().templateId) ||
						(form.enabled && templateNeedsHeaderMediaUpload(selectedAutomationTemplate, headerMediaId))
					}
				>
					{saving ? 'Guardando...' : 'Guardar automatizacion'}
				</button>
			</div>
		</div>
	);
}

export default function AbandonedCartCampaignPanel({
	templates = [],
	selectedTemplate,
	automationSettings,
	automationLoading,
	savingAutomation,
	runningAutomation,
	onSaveAutomation,
	onRunAutomationNow,
}) {
	const navigate = useNavigate();

	return (
		<div className="campaign-automation-only">
			<AutomationCard
				templates={templates}
				selectedTemplate={selectedTemplate}
				settings={automationSettings}
				loading={automationLoading}
				saving={savingAutomation}
				running={runningAutomation}
				onSave={onSaveAutomation}
				onRunNow={onRunAutomationNow}
			/>
			<div className="campaign-automation-next-step">
				<div>
					<strong>¿Querés enviar una campaña puntual?</strong>
					<span>La configuración de audiencia, preview y lanzamiento está separada para que no modifiques la regla automática por accidente.</span>
				</div>
				<button type="button" className="button primary" onClick={() => navigate('/campaigns/segment?audience=abandoned_carts')}>
					Crear campaña puntual
				</button>
			</div>
		</div>
	);
}
