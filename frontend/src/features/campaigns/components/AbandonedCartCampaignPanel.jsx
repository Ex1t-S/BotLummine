import { useEffect, useMemo, useState } from 'react';
import { formatPreviewText } from '../utils.js';

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
	minTotal: '',
	productQuery: '',
};

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
	const selectedAutomationTemplate = useMemo(
		() => templates.find((template) => template.id === form.templateId) || null,
		[templates, form.templateId]
	);

	useEffect(() => {
		const filters = settings?.filters || {};
		setForm({
			enabled: Boolean(settings?.enabled),
			templateId: settings?.templateId || selectedTemplate?.id || '',
			daysBack: Number(filters.daysBack || 7),
			limit: Number(filters.limit || 50),
			minTotal: filters.minTotal ?? '',
			productQuery: filters.productQuery || '',
		});
	}, [settings, selectedTemplate?.id]);

	function updateField(field, value) {
		setForm((current) => ({ ...current, [field]: value }));
	}

	function buildPayload(overrides = {}) {
		const nextForm = { ...form, ...overrides };
		const templateId = nextForm.templateId || selectedTemplate?.id || settings?.templateId || '';
		return {
			enabled: nextForm.enabled,
			templateId,
			filters: {
				daysBack: nextForm.daysBack,
				status: 'NEW',
				limit: nextForm.limit,
				minTotal: nextForm.minTotal,
				productQuery: nextForm.productQuery,
			},
		};
	}

	function handleToggle(nextEnabled) {
		const templateId = form.templateId || selectedTemplate?.id || settings?.templateId || '';
		updateField('enabled', nextEnabled);

		if (nextEnabled && !templateId) return;
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
					<h4>Enviar carritos nuevos cada hora</h4>
					<p>Cuando esta activa, detecta carritos nuevos con al menos 1 hora y manda el template configurado.</p>
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
					disabled={loading || saving}
				/>
				<span>
					<strong>Automatizacion {form.enabled ? 'activada' : 'desactivada'}</strong>
					<small>
						{form.enabled
							? 'Queda guardada al activar y se ejecuta como maximo una vez por hora.'
							: 'Activala para guardar el estado automaticamente.'}
					</small>
				</span>
			</label>

			<div className="campaign-form-grid two-columns">
				<label className="field">
					<span>Template automatico</span>
					<select
						value={form.templateId}
						onChange={(event) => updateField('templateId', event.target.value)}
						disabled={loading || saving}
					>
						<option value="">Seleccionar template</option>
						{templates.map((template) => (
							<option key={template.id} value={template.id}>
								{template.name} - {template.language} - {template.status}
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
						<option value={7}>7 dias</option>
						<option value={15}>15 dias</option>
						<option value={30}>30 dias</option>
					</select>
				</label>
			</div>

			<div className="campaign-custom-audience-grid-4">
				<label className="field">
					<span>Limite por hora</span>
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
					<small>{selectedAutomationTemplate?.name || settings?.templateName || 'Sin template'}</small>
				</span>
			</div>

			{settings?.lastError ? (
				<div className="campaign-schedule-error">{settings.lastError}</div>
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
					disabled={saving || loading || (form.enabled && !buildPayload().templateId)}
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
	onSelectTemplate,
	form,
	onUpdateField,
	preview,
	previewing,
	creating,
	automationSettings,
	automationLoading,
	savingAutomation,
	runningAutomation,
	onPreview,
	onCreate,
	onSaveAutomation,
	onRunAutomationNow,
}) {
	return (
		<div className="campaign-custom-audience campaign-custom-audience--premium">
			<div className="campaign-custom-audience-intro campaign-custom-audience-intro--compact">
				<div className="campaign-custom-audience-title-row">
					<div>
						<span className="campaigns-eyebrow">Audiencia inteligente</span>
						<h3>Recuperación de carritos</h3>
					</div>

					<div className="campaign-inline-summary campaign-inline-summary--soft campaign-inline-summary--tight">
						<div className="campaign-inline-summary-item">
							<strong>{form.daysBack}</strong>
							<span>días</span>
						</div>
						<div className="campaign-inline-summary-item">
							<strong>{form.limit || 0}</strong>
							<span>contactos</span>
						</div>
						<div className="campaign-inline-summary-item">
							<strong>{moneyLabel(form.minTotal)}</strong>
							<span>mínimo</span>
						</div>
						<div className="campaign-inline-summary-item">
							<strong>{preview.total || 0}</strong>
							<span>preview</span>
						</div>
					</div>
				</div>

				<p className="campaign-custom-audience-subtext">
					Filtrá carritos, revisá destinatarios y creá una campaña específica de recuperación.
				</p>
			</div>

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

			<div className="campaign-custom-audience-grid campaign-custom-audience-grid--balanced">
				<div className="campaign-custom-audience-card campaign-custom-audience-card--form">
					<label className="field">
						<span>Template</span>
						<select
							value={selectedTemplate?.id || ''}
							onChange={(e) => {
								const next = templates.find((template) => template.id === e.target.value) || null;
								onSelectTemplate(next);
							}}
						>
							<option value="">Seleccionar template</option>
							{templates.map((template) => (
								<option key={template.id} value={template.id}>
									{template.name} · {template.language} · {template.status}
								</option>
							))}
						</select>
					</label>

					<div className="campaign-form-grid two-columns">
						<label className="field">
							<span>Nombre</span>
							<input
								value={form.name}
								onChange={(e) => onUpdateField('name', e.target.value)}
								placeholder="Recuperación carritos 7 días"
							/>
						</label>

						<label className="field">
							<span>Ventana</span>
							<select
								value={form.daysBack}
								onChange={(e) => onUpdateField('daysBack', Number(e.target.value))}
							>
								<option value={7}>7 días</option>
								<option value={15}>15 días</option>
								<option value={30}>30 días</option>
							</select>
						</label>
					</div>

					<div className="campaign-custom-audience-grid-4">
						<label className="field">
							<span>Estado</span>
							<select
								value={form.status}
								onChange={(e) => onUpdateField('status', e.target.value)}
							>
								<option value="NEW">Nuevos</option>
								<option value="CONTACTED">Contactados</option>
								<option value="ALL">Todos</option>
							</select>
						</label>

						<label className="field">
							<span>Límite</span>
							<input
								type="number"
								min="1"
								max="500"
								value={form.limit}
								onChange={(e) => onUpdateField('limit', Number(e.target.value || 50))}
							/>
						</label>

						<label className="field">
							<span>Monto mínimo</span>
							<input
								type="number"
								min="0"
								value={form.minTotal}
								onChange={(e) => onUpdateField('minTotal', e.target.value)}
								placeholder="0"
							/>
						</label>

						<label className="field">
							<span>Producto</span>
							<input
								value={form.productQuery}
								onChange={(e) => onUpdateField('productQuery', e.target.value)}
								placeholder="body, faja, calza"
							/>
						</label>
					</div>

					<label className="field">
						<span>Notas internas</span>
						<textarea
							value={form.notes}
							onChange={(e) => onUpdateField('notes', e.target.value)}
							placeholder="Referencia interna"
							rows={3}
						/>
					</label>

					<label className="campaign-toggle campaign-toggle--card">
						<input
							type="checkbox"
							checked={form.launchNow}
							onChange={(e) => onUpdateField('launchNow', e.target.checked)}
						/>
						<span>
							<strong>Lanzar al crear</strong>
							<small>Para recuperaciones rápidas.</small>
						</span>
					</label>

					<div className="campaign-form-actions campaign-form-actions--end">
						<button
							type="button"
							className="button ghost"
							onClick={onPreview}
							disabled={previewing || !selectedTemplate}
						>
							{previewing ? 'Generando...' : 'Previsualizar'}
						</button>

						<button
							type="button"
							className="button primary"
							onClick={() => onCreate(form.launchNow)}
							disabled={creating || !selectedTemplate}
						>
							{creating
								? 'Creando campaña...'
								: form.launchNow
									? 'Crear y lanzar campaña'
									: 'Guardar campaña'}
						</button>
					</div>
				</div>

				<div className="campaign-custom-audience-card campaign-custom-audience-preview campaign-custom-audience-preview--elevated">
					<div className="campaign-custom-audience-preview-head">
						<div>
							<div className="campaign-custom-audience-preview-title">Vista previa</div>
							<div className="campaign-custom-audience-preview-subtitle">
								{preview.total || 0} destinatarios
							</div>
						</div>

						{selectedTemplate ? (
							<span className="campaign-custom-audience-pill">{selectedTemplate.name}</span>
						) : null}
					</div>

					<div
						className="campaign-custom-audience-preview-list"
						aria-live="polite"
						aria-busy={previewing}
					>
						{preview.recipients?.length ? (
							preview.recipients.slice(0, 8).map((recipient, index) => (
								<div
									key={`${recipient.phone}-${index}`}
									className="campaign-custom-audience-recipient"
								>
									<div className="campaign-custom-audience-recipient-top">
										<strong>{recipient.contactName || recipient.phone}</strong>
										<span>{recipient.totalAmount || ''}</span>
									</div>

									<div className="campaign-custom-audience-recipient-product">
										{recipient.primaryProductName || 'Sin producto principal'}
									</div>

									<div className="campaign-custom-audience-recipient-phone">
										{recipient.phone}
									</div>

									{recipient.renderedPreviewText ? (
										<div className="campaign-custom-audience-recipient-preview">
											{formatPreviewText(recipient.renderedPreviewText, 220)}
										</div>
									) : null}
								</div>
							))
						) : (
							<div className="campaign-custom-audience-empty">
								<strong>Sin destinatarios para mostrar</strong>
								<span>Elegí un template y previsualizá los primeros contactos antes de crear la campaña.</span>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
